/**
 * useDarkPool Hook
 *
 * React hook for the commit-reveal batch auction dark pool.
 * Manages the full order lifecycle: commit → reveal → settle,
 * real on-chain epoch tracking, encrypted balance management,
 * and order history with contract state sync.
 *
 * Privacy model:
 * - Identity: Hidden (session keys / relayers)
 * - Balances: Always encrypted (ElGamal)
 * - Orders during commit: Fully hidden (only hash visible)
 * - Front-running: Impossible (commit-reveal)
 * - MEV: Zero (uniform clearing price)
 */

"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { RpcProvider } from "starknet";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { usePrivacyKeys } from "./usePrivacyKeys";
import { encrypt as elgamalEncrypt, randomScalar } from "@/lib/crypto/elgamal";
import { createAEHintFromRandomness, decryptAEHintFromCiphertext } from "@/lib/crypto/aeHints";
import type { ElGamalCiphertext, PrivacyKeyPair } from "@/lib/crypto/constants";
import {
  ASSET_ID_FOR_TOKEN,
  TOKEN_METADATA,
  NETWORK_CONFIG,
  type NetworkType,
  type TokenSymbol,
  getTokenAddressForSymbol,
} from "@/lib/contracts/addresses";
import {
  type DarkPoolOrder,
  type DarkPoolOrderNote,
  type TradingPairInfo,
  type ContractEpochInfo,
  type ContractEpochResult,
  type ContractOrderView,
  DARK_POOL_PAIRS,
  createOrder,
  buildBalanceProof,
  buildCommitCalls,
  buildRevealCalls,
  buildCancelCalls,
  buildSettleCalls,
  buildDepositCalls,
  buildWithdrawCalls,
  buildClaimFillCalls,
  storeOrderNote,
  loadOrderNotes,
  updateOrderNote,
  getDarkPoolAddress,
  readEpochFromContract,
  readEncryptedBalance,
  readBalanceHint,
  readEpochResult,
  readOrderFromContract,
  readIsOrderClaimed,
  parseOrderIdFromReceipt,
  cacheHintLocally,
  formatPrice,
  formatAmount,
} from "@/lib/darkpool/darkPoolOrder";

// ============================================================================
// Types
// ============================================================================

export type DarkPoolStage =
  | "idle"
  | "building"           // Constructing order + proofs
  | "committing"         // Submitting commit tx
  | "waiting-reveal"     // Waiting for reveal phase
  | "revealing"          // Submitting reveal tx
  | "waiting-settle"     // Waiting for settlement
  | "settling"           // Submitting settle tx
  | "settled"            // Fill confirmed
  | "depositing"         // Deposit in progress
  | "withdrawing"        // Withdrawal in progress
  | "error";

export type EpochPhase = "commit" | "reveal" | "settle" | "closed";

export interface EpochInfo {
  epoch: number;
  phase: EpochPhase;
  phaseEndBlock: number;
  blocksRemaining: number;
  secondsRemaining: number; // ~4s per block
  fromContract: boolean;    // true = read from chain, false = fallback estimate
}

export interface OrderView {
  orderId: bigint;
  side: "buy" | "sell";
  pair: string;
  price: string;
  amount: string;
  status: string;
  epoch: number;
  fillAmount?: string;
  clearingPrice?: string;
  commitTxHash?: string;
  revealTxHash?: string;
}

export interface EpochResultView {
  epochId: number;
  clearingPrice: string;
  totalBuyFilled: string;
  totalSellFilled: string;
  numFills: number;
}

export interface DarkPoolBalance {
  asset: string;
  symbol: TokenSymbol;
  encrypted: ElGamalCiphertext | null;
  decrypted: bigint | null;
}

export interface UseDarkPoolResult {
  // State
  stage: DarkPoolStage;
  error: string | null;
  currentEpoch: EpochInfo | null;

  // Actions
  submitOrder: (
    price: number,
    amount: number,
    side: "buy" | "sell",
    pair: TradingPairInfo,
  ) => Promise<void>;
  cancelOrder: (orderId: bigint) => Promise<void>;
  settleEpoch: (epochId: number) => Promise<void>;
  claimFill: (orderId: bigint) => Promise<void>;

  // Balance
  deposit: (tokenSymbol: TokenSymbol, amount: number) => Promise<void>;
  withdraw: (tokenSymbol: TokenSymbol, amount: number) => Promise<void>;
  balances: DarkPoolBalance[];
  refreshBalances: () => Promise<void>;

  // Data
  myOrders: OrderView[];
  epochResult: EpochResultView | null;
  pairs: TradingPairInfo[];

  // Helpers
  refreshOrders: () => Promise<void>;
  refreshEpoch: () => Promise<void>;
  resetError: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const BLOCK_TIME_SECONDS = 4;
const EPOCH_POLL_INTERVAL = 4000; // Poll every block
const BALANCE_TOKENS: TokenSymbol[] = ["ETH", "STRK", "wBTC", "USDC", "SAGE"];

// ============================================================================
// Hook
// ============================================================================

export function useDarkPool(): UseDarkPoolResult {
  const { address, account } = useAccount();
  const { network } = useNetwork();
  const { unlockKeys } = usePrivacyKeys();
  const keysRef = useRef<PrivacyKeyPair | null>(null);
  const { sendAsync } = useSendTransaction({});

  // State
  const [stage, setStage] = useState<DarkPoolStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentEpoch, setCurrentEpoch] = useState<EpochInfo | null>(null);
  const [myOrders, setMyOrders] = useState<OrderView[]>([]);
  const [balances, setBalances] = useState<DarkPoolBalance[]>([]);
  const [epochResult, setEpochResult] = useState<EpochResultView | null>(null);

  // Refs for pending reveals and submit guard
  // Store epoch alongside order to prevent cross-epoch reveal attempts
  const pendingReveals = useRef<Map<bigint, { order: DarkPoolOrder; epoch: number }>>(new Map());
  const submittingRef = useRef(false);

  // Reset error and return to idle
  const resetError = useCallback(() => {
    setError(null);
    setStage("idle");
  }, []);
  const lastSettledEpoch = useRef<number>(-1);

  const contractAddress = useMemo(() => getDarkPoolAddress(network as NetworkType), [network]);

  // RPC provider for tx receipt reads
  const provider = useMemo(() => {
    const rpcUrl = NETWORK_CONFIG[network as NetworkType]?.rpcUrl
      || process.env.NEXT_PUBLIC_RPC_URL
      || "https://rpc.starknet-testnet.lava.build";
    return new RpcProvider({ nodeUrl: rpcUrl });
  }, [network]);

  // --------------------------------------------------------------------------
  // Epoch Tracking (from contract)
  // --------------------------------------------------------------------------

  const refreshEpoch = useCallback(async () => {
    if (contractAddress === "0x0") return;

    const contractEpoch = await readEpochFromContract(network as NetworkType);

    if (contractEpoch) {
      const phaseMap: Record<string, EpochPhase> = {
        Commit: "commit",
        Reveal: "reveal",
        Settle: "settle",
        Closed: "closed",
      };

      setCurrentEpoch({
        epoch: contractEpoch.epoch,
        phase: phaseMap[contractEpoch.phase] ?? "closed",
        phaseEndBlock: contractEpoch.currentBlock + contractEpoch.blocksRemaining,
        blocksRemaining: contractEpoch.blocksRemaining,
        secondsRemaining: contractEpoch.secondsRemaining,
        fromContract: true,
      });

      // Check if a recent epoch was settled and we haven't fetched the result
      if (contractEpoch.epoch > 0 && lastSettledEpoch.current !== contractEpoch.epoch - 1) {
        const result = await readEpochResult(network as NetworkType, contractEpoch.epoch - 1);
        if (result && result.numFills > 0) {
          lastSettledEpoch.current = contractEpoch.epoch - 1;
          setEpochResult({
            epochId: result.epochId,
            clearingPrice: formatPrice(result.clearingPrice),
            totalBuyFilled: formatAmount(result.totalBuyFilled),
            totalSellFilled: formatAmount(result.totalSellFilled),
            numFills: result.numFills,
          });
        }
      }
    }
  }, [contractAddress, network]);

  // Poll epoch status
  useEffect(() => {
    refreshEpoch();
    const interval = setInterval(refreshEpoch, EPOCH_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refreshEpoch]);

  // Clear pending reveals on wallet/network change to prevent cross-account leakage
  useEffect(() => {
    pendingReveals.current.clear();
    revealingRef.current = false;
    submittingRef.current = false;
    setStage("idle");
    setError(null);
  }, [address, network]);

  // --------------------------------------------------------------------------
  // Balance Reading (from contract)
  // --------------------------------------------------------------------------

  const refreshBalances = useCallback(async () => {
    if (!address || contractAddress === "0x0") {
      setBalances([]);
      return;
    }

    // Get private key for decryption (if available)
    const privKey = keysRef.current?.privateKey ?? null;

    const balancePromises = BALANCE_TOKENS.map(async (symbol) => {
      const assetId = ASSET_ID_FOR_TOKEN[symbol] ?? "0x0";

      // Read encrypted balance + hint in parallel
      const [encrypted, hint] = await Promise.all([
        readEncryptedBalance(network as NetworkType, address, assetId),
        readBalanceHint(network as NetworkType, address, assetId),
      ]);

      let decrypted: bigint | null = null;

      // Attempt O(1) decryption via AE hint
      if (encrypted && hint && privKey) {
        try {
          decrypted = decryptAEHintFromCiphertext(
            { encryptedAmount: hint.encryptedAmount, nonce: hint.nonce, mac: hint.mac },
            encrypted,
            privKey,
          );
        } catch {
          // MAC failed or hint corrupted — leave as null
        }
      }

      return {
        asset: assetId,
        symbol,
        encrypted,
        decrypted,
      };
    });

    const results = await Promise.all(balancePromises);
    setBalances(results);
  }, [address, contractAddress, network]);

  // Refresh balances on mount and address change
  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  // --------------------------------------------------------------------------
  // Order Management
  // --------------------------------------------------------------------------

  const refreshOrders = useCallback(async () => {
    try {
      const notes = await loadOrderNotes(address ?? undefined);

      // Sync order status from contract for non-terminal orders
      const synced = await Promise.all(
        notes.map(async (note) => {
          if (
            note.orderId > 0n &&
            (note.status === "committed" || note.status === "revealed")
          ) {
            const contractOrder = await readOrderFromContract(
              network as NetworkType,
              note.orderId,
            );
            if (contractOrder) {
              const statusMap: Record<string, DarkPoolOrderNote["status"]> = {
                Committed: "committed",
                Revealed: "revealed",
                Filled: "filled",
                PartialFill: "filled",
                Cancelled: "cancelled",
                Expired: "expired",
              };
              let newStatus = statusMap[contractOrder.status] ?? note.status;
              // Check if a filled order has already been claimed on-chain
              if (newStatus === "filled") {
                const claimed = await readIsOrderClaimed(network as NetworkType, note.orderId);
                if (claimed) newStatus = "claimed";
              }
              if (newStatus !== note.status) {
                const updates: Partial<DarkPoolOrderNote> = { status: newStatus };
                if (contractOrder.fillAmount > 0n) {
                  updates.fillAmount = contractOrder.fillAmount;
                }
                await updateOrderNote(note.orderId, updates);
                return { ...note, ...updates };
              }
            }
          }
          return note;
        }),
      );

      const views: OrderView[] = synced.map((note) => {
        const pair = DARK_POOL_PAIRS.find(
          (p) =>
            (p.giveAssetId === note.order.giveAsset && p.wantAssetId === note.order.wantAsset) ||
            (p.wantAssetId === note.order.giveAsset && p.giveAssetId === note.order.wantAsset),
        );
        return {
          orderId: note.orderId,
          side: note.order.side,
          pair: pair?.label ?? "Unknown",
          price: formatPrice(note.order.price),
          amount: formatAmount(note.order.amount),
          status: note.status,
          epoch: note.epoch,
          fillAmount: note.fillAmount ? formatAmount(note.fillAmount) : undefined,
          clearingPrice: note.clearingPrice ? formatPrice(note.clearingPrice) : undefined,
          commitTxHash: note.commitTxHash,
          revealTxHash: note.revealTxHash,
        };
      });
      setMyOrders(views.sort((a, b) => Number(b.orderId - a.orderId)));
    } catch {
      // IndexedDB not available (SSR) — ignore
    }
  }, [network, address]);

  // Load orders on mount
  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  // --------------------------------------------------------------------------
  // Submit Order (Commit Phase)
  // --------------------------------------------------------------------------

  const submitOrder = useCallback(
    async (
      price: number,
      amount: number,
      side: "buy" | "sell",
      pair: TradingPairInfo,
    ) => {
      if (!address || !account) {
        setError("Connect wallet first");
        return;
      }
      if (contractAddress === "0x0") {
        setError("Dark pool not deployed on this network");
        return;
      }

      // Guard against double-submit
      if (submittingRef.current) return;
      submittingRef.current = true;

      try {
        // Phase gate: verify we're in commit phase from contract
        const epochNow = await readEpochFromContract(network as NetworkType);
        if (epochNow && epochNow.phase !== "Commit") {
          setError(`Cannot commit during ${epochNow.phase} phase. Wait for next Commit phase.`);
          return;
        }

        setStage("building");
        setError(null);

        // Unlock privacy keys
        const privacyKeys = keysRef.current ?? (await unlockKeys());
        if (privacyKeys) keysRef.current = privacyKeys;
        if (!privacyKeys) {
          throw new Error("Failed to unlock privacy keys");
        }

        // Determine decimals for the give asset
        const giveSymbol = side === "sell" ? pair.giveSymbol : pair.wantSymbol;
        const decimals = TOKEN_METADATA[giveSymbol]?.decimals ?? 18;

        // Create the order
        const order = createOrder(price, amount, side, pair, decimals);

        // Build balance proof (Fiat-Shamir bound to trader + asset)
        const proof = buildBalanceProof(null, order.amount, privacyKeys.privateKey, address, order.giveAsset);

        // Build commit transaction
        const calls = buildCommitCalls(order, proof, contractAddress);

        setStage("committing");
        const response = await sendAsync(calls);

        // Parse real order ID from tx receipt events
        let orderId: bigint;
        try {
          const receipt = await provider.waitForTransaction(response.transaction_hash);
          const parsed = parseOrderIdFromReceipt(receipt as unknown as { events?: Array<{ keys?: string[]; data?: string[] }> });
          orderId = parsed ?? BigInt(Date.now()); // Fallback if parsing fails
        } catch {
          orderId = BigInt(Date.now()); // Fallback
        }

        const epoch = epochNow?.epoch ?? currentEpoch?.epoch ?? 0;

        const note: DarkPoolOrderNote = {
          orderId,
          order,
          epoch,
          status: "committed",
          trader: address,
          commitTxHash: response.transaction_hash,
          createdAt: Date.now(),
        };
        await storeOrderNote(note, address);

        // Queue for auto-reveal (store epoch to prevent cross-epoch reveals)
        pendingReveals.current.set(orderId, { order, epoch });

        setStage("waiting-reveal");
        await refreshOrders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Order submission failed");
        setStage("error");
      } finally {
        submittingRef.current = false;
      }
    },
    [address, account, contractAddress, network, unlockKeys, sendAsync, currentEpoch, refreshOrders, provider],
  );

  // --------------------------------------------------------------------------
  // Auto-Reveal (when reveal phase begins)
  // --------------------------------------------------------------------------

  const revealAttemptRef = useRef(0);
  const revealingRef = useRef(false);

  useEffect(() => {
    if (currentEpoch?.phase !== "reveal" || pendingReveals.current.size === 0) return;
    if (stage !== "waiting-reveal") return;
    // Guard: wallet must be connected
    if (!account || !address) return;
    // Guard: prevent concurrent reveal attempts
    if (revealingRef.current) return;

    const revealAll = async () => {
      revealingRef.current = true;
      try {
        setStage("revealing");

        const revealEpoch = currentEpoch!.epoch;

        for (const [orderId, { order, epoch }] of pendingReveals.current.entries()) {
          // Skip orders from a different epoch (they've expired)
          if (epoch !== revealEpoch) {
            pendingReveals.current.delete(orderId);
            await updateOrderNote(orderId, { status: "expired" });
            continue;
          }

          const calls = buildRevealCalls(orderId, order, contractAddress);
          const response = await sendAsync(calls);

          await updateOrderNote(orderId, {
            status: "revealed",
            revealTxHash: response.transaction_hash,
          });
          // Remove successfully revealed orders
          pendingReveals.current.delete(orderId);
        }

        revealAttemptRef.current = 0;
        setStage("waiting-settle");
        await refreshOrders();
      } catch (err) {
        revealAttemptRef.current += 1;
        const maxRetries = 3;
        if (revealAttemptRef.current < maxRetries && pendingReveals.current.size > 0) {
          // Retry with backoff — re-queue for next poll cycle
          setError(`Reveal attempt ${revealAttemptRef.current}/${maxRetries} failed, retrying...`);
          setStage("waiting-reveal");
        } else {
          setError(err instanceof Error ? err.message : "Reveal failed after retries");
          setStage("error");
          revealAttemptRef.current = 0;
        }
      } finally {
        revealingRef.current = false;
      }
    };

    revealAll();
  }, [currentEpoch?.phase, stage, contractAddress, sendAsync, refreshOrders, account, address]);

  // --------------------------------------------------------------------------
  // Cancel Order
  // --------------------------------------------------------------------------

  const cancelOrder = useCallback(
    async (orderId: bigint) => {
      if (!address || contractAddress === "0x0") return;

      try {
        const calls = buildCancelCalls(orderId, contractAddress);
        await sendAsync(calls);
        await updateOrderNote(orderId, { status: "cancelled" });
        pendingReveals.current.delete(orderId);
        await refreshOrders();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Cancel failed");
      }
    },
    [address, contractAddress, sendAsync, refreshOrders],
  );

  // --------------------------------------------------------------------------
  // Settle Epoch (Permissionless)
  // --------------------------------------------------------------------------

  const settleEpoch = useCallback(
    async (epochId: number) => {
      if (!address || contractAddress === "0x0") return;

      try {
        setStage("settling");
        setError(null);
        const calls = buildSettleCalls(epochId, contractAddress);
        await sendAsync(calls);

        // Fetch the result after settlement
        const result = await readEpochResult(network as NetworkType, epochId);
        if (result) {
          lastSettledEpoch.current = epochId;
          setEpochResult({
            epochId: result.epochId,
            clearingPrice: formatPrice(result.clearingPrice),
            totalBuyFilled: formatAmount(result.totalBuyFilled),
            totalSellFilled: formatAmount(result.totalSellFilled),
            numFills: result.numFills,
          });
        }

        setStage("settled");
        await refreshOrders();
        await refreshBalances(); // Balances change after settlement
      } catch (err) {
        setError(err instanceof Error ? err.message : "Settlement failed");
        setStage("error");
      }
    },
    [address, contractAddress, network, sendAsync, refreshOrders, refreshBalances],
  );

  // --------------------------------------------------------------------------
  // Claim Fill (post-settlement balance update)
  // --------------------------------------------------------------------------

  const claimFill = useCallback(
    async (orderId: bigint) => {
      if (!address || !account || contractAddress === "0x0") return;

      try {
        setStage("building");
        setError(null);

        const privacyKeys = keysRef.current ?? (await unlockKeys());
        if (privacyKeys) keysRef.current = privacyKeys;
        if (!privacyKeys) throw new Error("Failed to unlock privacy keys");

        // Read order details to know fill amount and assets
        const orderView = await readOrderFromContract(network as NetworkType, orderId);
        if (!orderView) throw new Error("Order not found on chain");
        if (orderView.status !== "Filled" && orderView.status !== "PartialFill") {
          throw new Error(`Order not filled (status: ${orderView.status})`);
        }

        const fillAmount = orderView.fillAmount;
        if (fillAmount <= 0n) throw new Error("No fill amount");

        // Determine receive/spend amounts
        // The trader receives want_asset and spends give_asset
        const receiveAsset = orderView.wantAsset;
        const spendAsset = orderView.giveAsset;

        // Read epoch result to get clearing price for spend calculation
        const epochResult = await readEpochResult(network as NetworkType, orderView.epoch);
        const clearingPrice = epochResult?.clearingPrice ?? 0n;

        // For the amount the trader receives (fillAmount in want_asset terms)
        // and the amount they spend (fillAmount * clearingPrice / 1e18 in give_asset terms)
        const receiveAmount = fillAmount;
        const spendAmount = clearingPrice > 0n ? (fillAmount * clearingPrice) / BigInt(1e18) : fillAmount;

        // Encrypt receive amount
        const receiveRandomness = randomScalar();
        const receiveEncrypted = elgamalEncrypt(receiveAmount, privacyKeys.publicKey, receiveRandomness);

        // Read current receive balance to compute new hint
        const currentReceiveBal = balances.find((b) => b.asset === receiveAsset);
        const currentReceiveDecrypted = currentReceiveBal?.decrypted ?? 0n;
        const newReceiveBalance = currentReceiveDecrypted + receiveAmount;
        const receiveHint = createAEHintFromRandomness(newReceiveBalance, randomScalar(), privacyKeys.publicKey);

        // Encrypt spend amount
        const spendRandomness = randomScalar();
        const spendEncrypted = elgamalEncrypt(spendAmount, privacyKeys.publicKey, spendRandomness);

        // Read current spend balance to compute new hint
        const currentSpendBal = balances.find((b) => b.asset === spendAsset);
        const currentSpendDecrypted = currentSpendBal?.decrypted ?? 0n;
        const newSpendBalance = currentSpendDecrypted > spendAmount ? currentSpendDecrypted - spendAmount : 0n;
        const spendHint = createAEHintFromRandomness(newSpendBalance, randomScalar(), privacyKeys.publicKey);

        const calls = buildClaimFillCalls(
          orderId,
          receiveEncrypted,
          receiveHint,
          spendEncrypted,
          spendHint,
          contractAddress,
        );

        setStage("committing");
        await sendAsync(calls);

        // Mark order as claimed in IndexedDB
        await updateOrderNote(orderId, { status: "claimed" });

        // Cache hints locally
        cacheHintLocally(address, receiveAsset, receiveHint);
        cacheHintLocally(address, spendAsset, spendHint);

        setStage("idle");
        await refreshBalances();
        await refreshOrders();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Claim fill failed";
        // Handle "Already claimed" gracefully — just update local state
        if (msg.includes("Already claimed")) {
          await updateOrderNote(orderId, { status: "claimed" });
          await refreshOrders();
          setStage("idle");
          return;
        }
        setError(msg);
        setStage("error");
      }
    },
    [address, account, contractAddress, network, unlockKeys, sendAsync, refreshBalances, refreshOrders, balances],
  );

  // --------------------------------------------------------------------------
  // Balance Management
  // --------------------------------------------------------------------------

  const deposit = useCallback(
    async (tokenSymbol: TokenSymbol, amount: number) => {
      if (!address || !account || contractAddress === "0x0") return;

      try {
        setStage("depositing");
        setError(null);

        const privacyKeys = keysRef.current ?? (await unlockKeys());
        if (privacyKeys) keysRef.current = privacyKeys;
        if (!privacyKeys) throw new Error("Failed to unlock privacy keys");

        const decimals = TOKEN_METADATA[tokenSymbol]?.decimals ?? 18;
        const amountBigInt = BigInt(Math.round(amount * 10 ** decimals));
        const assetId = ASSET_ID_FOR_TOKEN[tokenSymbol] ?? "0x0";
        const tokenAddress = getTokenAddressForSymbol(network as NetworkType, tokenSymbol);

        // Encrypt the deposit amount
        const randomness = randomScalar();
        const encryptedAmount = elgamalEncrypt(amountBigInt, privacyKeys.publicKey, randomness);

        // Create AE hint for O(1) decryption
        const aeHint = createAEHintFromRandomness(amountBigInt, randomness, privacyKeys.publicKey);

        const calls = buildDepositCalls(
          assetId,
          amountBigInt,
          encryptedAmount,
          aeHint,
          tokenAddress,
          contractAddress,
        );

        await sendAsync(calls);

        // Cache hint locally so we can decrypt balance even before contract upgrade
        cacheHintLocally(address, assetId, aeHint);

        setStage("idle");
        await refreshBalances();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deposit failed");
        setStage("error");
      }
    },
    [address, account, contractAddress, network, unlockKeys, sendAsync, refreshBalances],
  );

  const withdraw = useCallback(
    async (tokenSymbol: TokenSymbol, amount: number) => {
      if (!address || !account || contractAddress === "0x0") return;

      try {
        setStage("withdrawing");
        setError(null);

        const privacyKeys = keysRef.current ?? (await unlockKeys());
        if (privacyKeys) keysRef.current = privacyKeys;
        if (!privacyKeys) throw new Error("Failed to unlock privacy keys");

        const decimals = TOKEN_METADATA[tokenSymbol]?.decimals ?? 18;
        const amountBigInt = BigInt(Math.round(amount * 10 ** decimals));
        const assetId = ASSET_ID_FOR_TOKEN[tokenSymbol] ?? "0x0";

        // Encrypt the withdrawal amount for homomorphic subtraction on-chain
        const randomness = randomScalar();
        const encryptedAmount = elgamalEncrypt(amountBigInt, privacyKeys.publicKey, randomness);

        // Create AE hint for the NEW (reduced) balance
        // First, find current decrypted balance — must be known
        const currentBal = balances.find((b) => b.symbol === tokenSymbol);
        if (currentBal?.decrypted === null || currentBal?.decrypted === undefined) {
          throw new Error(`Cannot withdraw: ${tokenSymbol} balance not yet decrypted. Refresh balances and try again.`);
        }
        const currentDecrypted = currentBal.decrypted;
        if (currentDecrypted < amountBigInt) {
          throw new Error(`Insufficient ${tokenSymbol} balance: have ${formatAmount(currentDecrypted)}, need ${formatAmount(amountBigInt)}`);
        }
        const newBalance = currentDecrypted - amountBigInt;
        const newRandomness = randomScalar();
        const aeHint = createAEHintFromRandomness(newBalance, newRandomness, privacyKeys.publicKey);

        const proof = buildBalanceProof(null, amountBigInt, privacyKeys.privateKey, address, assetId);
        const calls = buildWithdrawCalls(
          assetId,
          amountBigInt,
          encryptedAmount,
          aeHint,
          proof,
          contractAddress,
        );

        await sendAsync(calls);

        // Cache the new hint locally
        cacheHintLocally(address, assetId, aeHint);

        setStage("idle");
        await refreshBalances();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Withdrawal failed");
        setStage("error");
      }
    },
    [address, account, contractAddress, unlockKeys, sendAsync, refreshBalances, balances],
  );

  // --------------------------------------------------------------------------
  // Return
  // --------------------------------------------------------------------------

  return {
    stage,
    error,
    currentEpoch,
    submitOrder,
    cancelOrder,
    settleEpoch,
    claimFill,
    deposit,
    withdraw,
    balances,
    refreshBalances,
    myOrders,
    epochResult,
    pairs: DARK_POOL_PAIRS,
    refreshOrders,
    refreshEpoch,
    resetError,
  };
}
