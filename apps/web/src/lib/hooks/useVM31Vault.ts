/**
 * useVM31Vault Hook
 *
 * Full-stack integration for BTC Privacy Vaults:
 * - VM31 relayer HTTP API (deposit/withdraw/transfer)
 * - ERC20 approve + on-chain deposit via account.execute()
 * - Privacy key derivation via usePrivacyKeys()
 * - Note storage in IndexedDB (same store as privacy pools)
 * - Token balance queries via useTokenBalance()
 * - Batch status polling with auto-refresh
 * - ProvingStage-compatible state for ProvingFlowCard
 *
 * The VM31 relayer/prover is asset-agnostic: this hook handles
 * asset ID resolution, amount encoding (bigint → M31 lo/hi pair),
 * and JSON formatting to match the Rust SubmitRequest enum.
 */

"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useAccount } from "@starknet-react/core";
import { useQuery } from "@tanstack/react-query";
import { RpcProvider, Contract, CallData, cairo, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, EXTERNAL_TOKENS, VM31_ASSET_ID_FOR_TOKEN } from "../contracts/addresses";
import { useNetwork } from "../contexts/NetworkContext";
import { usePrivacyKeys } from "./usePrivacyKeys";
import { saveNote, markNoteSpent } from "../crypto/keyStore";
import type { PrivacyNote } from "../crypto";
import type { ProvingStage } from "@/components/privacy/ProvingFlowCard";

// ============================================================================
// Constants
// ============================================================================

/** M31 field modulus: 2^31 - 1 */
const M31_MOD = 0x7FFF_FFFF;

/** Blanket ERC20 approval amount (10^18 * 10 = 10 BTC in 8-decimal base units) */
const BLANKET_APPROVAL = 10n ** 18n;

/** ERC20 ABI for approve + allowance */
const ERC20_ABI = [
  {
    name: "approve",
    type: "function" as const,
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external" as const,
  },
  {
    name: "allowance",
    type: "function" as const,
    inputs: [
      { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view" as const,
  },
  {
    name: "balance_of",
    type: "function" as const,
    inputs: [
      { name: "account", type: "core::starknet::contract_address::ContractAddress" },
    ],
    outputs: [{ name: "balance", type: "core::integer::u256" }],
    state_mutability: "view" as const,
  },
] as const;

// ============================================================================
// Types
// ============================================================================

export type VaultAction = "deposit" | "withdraw" | "transfer";

export type VaultPhase =
  | "idle"
  | "preparing"
  | "keys"
  | "approving"
  | "submitting"
  | "queued"
  | "proving"
  | "confirming"
  | "confirmed"
  | "error";

/** Maps VaultPhase → ProvingStage for ProvingFlowCard compatibility */
export function vaultPhaseToProvingStage(phase: VaultPhase): ProvingStage {
  switch (phase) {
    case "idle": return "idle";
    case "preparing": case "keys": return "preparing";
    case "approving": case "submitting": return "submitting";
    case "queued": case "proving": return "proving";
    case "confirming": return "confirming";
    case "confirmed": return "confirmed";
    case "error": return "error";
  }
}

export interface VaultState {
  phase: VaultPhase;
  message: string;
  progress: number;
  error: string | null;
  batchId: string | null;
  queuePosition: number | null;
  idempotencyKey: string | null;
  depositTxHash: string | null;
}

export interface VaultAssetInfo {
  symbol: string;
  tokenAddress: string;
  vm31AssetId: number;
  decimals: number;
  available: boolean;
}

/** JSON format matching Rust NoteJson in routes.rs */
export interface VaultNote {
  owner_pubkey: [number, number, number, number];
  asset_id: number;
  amount_lo: number;
  amount_hi: number;
  blinding: [number, number, number, number];
}

export interface VaultMerklePath {
  siblings: [number, number, number, number, number, number, number, number][];
  index: number;
}

export interface VaultInputNote {
  note: VaultNote;
  spending_key: [number, number, number, number];
  merkle_path: VaultMerklePath;
}

export interface VaultDepositParams {
  amount: bigint;
  assetSymbol: string;
  recipientPubkey?: [number, number, number, number];
  recipientViewingKey?: [number, number, number, number];
}

export interface VaultWithdrawParams {
  amount: bigint;
  assetSymbol: string;
  note: VaultNote;
  spendingKey: [number, number, number, number];
  merklePath: VaultMerklePath;
  merkleRoot: [number, number, number, number, number, number, number, number];
  withdrawalBinding: [number, number, number, number, number, number, number, number];
}

export interface VaultTransferParams {
  amount: bigint;
  assetSymbol: string;
  recipientPubkey: [number, number, number, number];
  recipientViewingKey: [number, number, number, number];
  senderViewingKey: [number, number, number, number];
  inputNotes: [VaultInputNote, VaultInputNote];
  merkleRoot: [number, number, number, number, number, number, number, number];
}

export interface VaultSubmitResult {
  status: "queued" | "batch_triggered" | "duplicate";
  batchId?: string;
  queuePosition?: number;
  idempotencyKey?: string;
}

export interface VaultBatchStatus {
  id: string;
  status: string;
  txCount: number;
  proofHash?: string;
  batchIdOnchain?: string;
  txHash?: string;
  createdAt?: string;
  error?: string;
}

export interface RelayerHealth {
  status: string;
  version: string;
  service: string;
}

export interface RelayerStatus {
  pendingTransactions: number;
  batchMaxSize: number;
  batchTimeoutSecs: number;
}

/** Stored vault note — extends PrivacyNote with VM31-specific fields */
export interface StoredVaultNote {
  symbol: string;
  amount: string; // bigint as string
  amountLo: number;
  amountHi: number;
  assetId: number;
  batchId: string | null;
  createdAt: number;
  spent: boolean;
  spentTxHash?: string;
  /** Commitment identifier for note lifecycle management */
  commitment: string;
  /** Owner public key stored for withdrawal reconstruction */
  ownerPubkey: [number, number, number, number];
  /** Blinding factor stored for withdrawal reconstruction */
  blinding: [number, number, number, number];
  /** Whether a real merkle proof has been fetched from relayer */
  merkleProofAvailable: boolean;
  /** Cached merkle path (from relayer v2 when available) */
  merklePath?: VaultMerklePath;
  /** Cached merkle root (from relayer v2 when available) */
  merkleRoot?: [number, number, number, number, number, number, number, number];
}

// ============================================================================
// Amount encoding helpers
// ============================================================================

/** Convert bigint → (lo, hi) M31 pair for VM31 notes */
export function encodeAmountM31(amount: bigint): { lo: number; hi: number } {
  const mod = BigInt(M31_MOD);
  return {
    lo: Number(amount % mod),
    hi: Number(amount / mod),
  };
}

/** Decode (lo, hi) M31 pair → bigint */
export function decodeAmountM31(lo: number, hi: number): bigint {
  return BigInt(lo) + BigInt(hi) * BigInt(M31_MOD);
}

function amountToU64(amount: bigint): number {
  if (amount > BigInt("0xFFFFFFFFFFFFFFFF")) {
    throw new Error("Amount exceeds u64 max");
  }
  return Number(amount);
}

/** Format BTC amount with up to 8 decimal places */
export function formatBtcAmount(amount: bigint, decimals = 8): string {
  const divisor = 10n ** BigInt(decimals);
  const intPart = amount / divisor;
  const fracPart = amount % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  if (!fracStr) return intPart.toString();
  return `${intPart}.${fracStr}`;
}

// ============================================================================
// Spending key & merkle helpers
// ============================================================================

/** Split a bigint private key into 4 M31 limbs for VM31 spending key */
export function deriveSpendingKey(privateKey: bigint): [number, number, number, number] {
  const mod = BigInt(M31_MOD);
  return [
    Number(privateKey & mod),
    Number((privateKey >> 31n) & mod),
    Number((privateKey >> 62n) & mod),
    Number((privateKey >> 93n) & mod),
  ];
}

/** Build zero-filled placeholder merkle data (relayer v2 will provide real proofs) */
export function buildPlaceholderMerkleData(): {
  merklePath: VaultMerklePath;
  merkleRoot: [number, number, number, number, number, number, number, number];
  withdrawalBinding: [number, number, number, number, number, number, number, number];
} {
  return {
    merklePath: { siblings: [], index: 0 },
    merkleRoot: [0, 0, 0, 0, 0, 0, 0, 0],
    withdrawalBinding: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

/** Check if merkle root is all zeros (placeholder) */
export function isMerkleDataPlaceholder(
  root: [number, number, number, number, number, number, number, number],
): boolean {
  return root.every((v) => v === 0);
}

/** Generate a random blinding factor as 4 M31 values */
function generateRandomBlinding(): [number, number, number, number] {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return [
    values[0] & M31_MOD,
    values[1] & M31_MOD,
    values[2] & M31_MOD,
    values[3] & M31_MOD,
  ];
}

// ============================================================================
// Initial state
// ============================================================================

const INITIAL_STATE: VaultState = {
  phase: "idle",
  message: "",
  progress: 0,
  error: null,
  batchId: null,
  queuePosition: null,
  idempotencyKey: null,
  depositTxHash: null,
};

// ============================================================================
// Hook
// ============================================================================

export function useVM31Vault() {
  const { address, account } = useAccount();
  const { network } = useNetwork();
  const [state, setState] = useState<VaultState>(INITIAL_STATE);
  const [vaultNotes, setVaultNotes] = useState<StoredVaultNote[]>([]);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Privacy keys integration
  const {
    hasKeys,
    publicKey,
    isInitialized: keysInitialized,
    initializeKeys,
    unlockKeys,
  } = usePrivacyKeys();

  // Environment config
  const relayerUrl = process.env.NEXT_PUBLIC_VM31_RELAYER_URL || "http://localhost:3080";
  const apiKey = process.env.NEXT_PUBLIC_VM31_API_KEY || "";
  const vm31PoolAddress =
    process.env.NEXT_PUBLIC_VM31_POOL_ADDRESS ||
    CONTRACTS[network as keyof typeof CONTRACTS]?.VM31_POOL ||
    "0x0";

  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl || "";
  const provider = useMemo(
    () => (rpcUrl ? new RpcProvider({ nodeUrl: rpcUrl }) : null),
    [rpcUrl],
  );

  const poolDeployed = vm31PoolAddress !== "0x0" && BigInt(vm31PoolAddress) !== 0n;

  // ========================================================================
  // Asset info resolution
  // ========================================================================

  const getAssetInfo = useCallback(
    (symbol: string): VaultAssetInfo => {
      const tokens = EXTERNAL_TOKENS[network as keyof typeof EXTERNAL_TOKENS];
      const tokenAddress = tokens?.[symbol as keyof typeof tokens] || "0x0";
      const vm31AssetId = VM31_ASSET_ID_FOR_TOKEN[symbol] ?? 0;
      const decimalsMap: Record<string, number> = {
        wBTC: 8, LBTC: 8, tBTC: 8, SolvBTC: 8,
      };

      return {
        symbol,
        tokenAddress: tokenAddress as string,
        vm31AssetId,
        decimals: decimalsMap[symbol] ?? 8,
        available: tokenAddress !== "0x0" && BigInt(tokenAddress as string) !== 0n,
      };
    },
    [network],
  );

  // On-chain asset ID query (immutable once assigned)
  const useAssetId = (tokenAddress: string) =>
    useQuery({
      queryKey: ["vm31AssetId", network, vm31PoolAddress, tokenAddress],
      queryFn: async () => {
        if (!provider || !poolDeployed) throw new Error("VM31Pool not deployed");
        const result = await provider.callContract({
          contractAddress: vm31PoolAddress,
          entrypoint: "get_token_asset",
          calldata: [tokenAddress],
        });
        return Number(BigInt(result[0] || "0"));
      },
      enabled: poolDeployed && !!provider && tokenAddress !== "0x0" && BigInt(tokenAddress) !== 0n,
      staleTime: Infinity,
      retry: 2,
    });

  // ========================================================================
  // Token balance query
  // ========================================================================

  const useTokenBalance = (symbol: string) => {
    const info = getAssetInfo(symbol);
    return useQuery({
      queryKey: ["vm31TokenBalance", network, info.tokenAddress, address],
      queryFn: async () => {
        if (!provider || !address || !info.available) return 0n;
        const contract = new Contract({ abi: ERC20_ABI as any, address: info.tokenAddress, providerOrAccount: provider });
        const result = await contract.balance_of(address);
        return BigInt(result.toString());
      },
      enabled: !!provider && !!address && info.available,
      staleTime: 15_000,
      refetchInterval: 30_000,
    });
  };

  // ========================================================================
  // Relayer health + status
  // ========================================================================

  const healthQuery = useQuery<RelayerHealth>({
    queryKey: ["vm31RelayerHealth", relayerUrl],
    queryFn: async () => {
      const res = await fetch(`${relayerUrl}/health`);
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const statusQuery = useQuery<RelayerStatus>({
    queryKey: ["vm31RelayerStatus", relayerUrl],
    queryFn: async () => {
      const res = await fetch(`${relayerUrl}/status`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      const data = await res.json();
      return {
        pendingTransactions: data.pending_transactions,
        batchMaxSize: data.batch_max_size,
        batchTimeoutSecs: data.batch_timeout_secs,
      };
    },
    enabled: healthQuery.data?.status === "ok",
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // ========================================================================
  // ERC20 allowance check
  // ========================================================================

  const checkAllowance = useCallback(
    async (tokenAddress: string, spender: string): Promise<bigint> => {
      if (!provider || !address) return 0n;
      try {
        const contract = new Contract({ abi: ERC20_ABI as any, address: tokenAddress, providerOrAccount: provider });
        const result = await contract.allowance(address, spender);
        return BigInt(result.toString());
      } catch {
        return 0n;
      }
    },
    [provider, address],
  );

  // ========================================================================
  // Relayer submit
  // ========================================================================

  const submitToRelayer = useCallback(
    async (body: Record<string, unknown>): Promise<VaultSubmitResult> => {
      const res = await fetch(`${relayerUrl}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Relayer error (${res.status}): ${errBody}`);
      }

      const data = await res.json();
      return {
        status: data.status,
        batchId: data.batch_id ?? undefined,
        queuePosition: data.queue_position ?? undefined,
        idempotencyKey: data.idempotency_key ?? undefined,
      };
    },
    [relayerUrl, apiKey],
  );

  // ========================================================================
  // Batch status polling
  // ========================================================================

  const getBatchStatus = useCallback(
    async (batchId: string): Promise<VaultBatchStatus> => {
      const res = await fetch(`${relayerUrl}/batch/${encodeURIComponent(batchId)}`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) throw new Error(`Batch query failed: ${res.status}`);
      const data = await res.json();
      return {
        id: data.id,
        status: data.status,
        txCount: data.tx_count,
        proofHash: data.proof_hash,
        batchIdOnchain: data.batch_id_onchain,
        txHash: data.tx_hash,
        createdAt: data.created_at,
        error: data.error,
      };
    },
    [relayerUrl, apiKey],
  );

  // ========================================================================
  // Merkle path fetch
  // ========================================================================

  const fetchMerklePath = useCallback(
    async (commitment: string): Promise<{ merklePath: VaultMerklePath; merkleRoot: [number, number, number, number, number, number, number, number] } | null> => {
      const res = await fetch(`${relayerUrl}/merkle-path/${encodeURIComponent(commitment)}`, {
        headers: { "x-api-key": apiKey },
      });
      if (res.status === 404) return null; // not indexed yet
      if (!res.ok) throw new Error(`Merkle fetch failed: ${res.status}`);
      const data = await res.json();
      return {
        merklePath: data.merkle_path as VaultMerklePath,
        merkleRoot: data.merkle_root as [number, number, number, number, number, number, number, number],
      };
    },
    [relayerUrl, apiKey],
  );

  const startBatchPolling = useCallback(
    (batchId: string) => {
      if (batchPollRef.current) clearInterval(batchPollRef.current);

      batchPollRef.current = setInterval(async () => {
        try {
          const status = await getBatchStatus(batchId);
          if (status.status === "confirmed" || status.status === "finalized") {
            setState((p) => ({
              ...p,
              phase: "confirmed",
              message: "Batch confirmed on-chain!",
              progress: 100,
            }));
            if (batchPollRef.current) clearInterval(batchPollRef.current);

            // Auto-fetch merkle paths for notes in this batch
            setVaultNotes((prev) => {
              const notesInBatch = prev.filter(
                (n) => n.batchId === batchId && !n.merkleProofAvailable,
              );
              for (const note of notesInBatch) {
                fetchMerklePath(note.commitment)
                  .then((result) => {
                    if (result) {
                      setVaultNotes((cur) =>
                        cur.map((n) =>
                          n.commitment === note.commitment
                            ? {
                                ...n,
                                merklePath: result.merklePath,
                                merkleRoot: result.merkleRoot,
                                merkleProofAvailable: true,
                              }
                            : n,
                        ),
                      );
                    }
                  })
                  .catch((err) => {
                    console.warn("[VM31] Merkle path fetch failed for", note.commitment, ":", err instanceof Error ? err.message : err);
                  });
              }
              return prev; // Don't mutate synchronously — async updates above
            });
          } else if (status.status === "proving") {
            setState((p) => ({
              ...p,
              phase: "proving",
              message: `STWO proving (${status.txCount} txs in batch)...`,
              progress: 85,
            }));
          } else if (status.error) {
            setState((p) => ({
              ...p,
              phase: "error",
              message: status.error || "Batch failed",
              error: status.error || "Batch failed",
              progress: 0,
            }));
            if (batchPollRef.current) clearInterval(batchPollRef.current);
          }
        } catch (err) {
          // Throttled warning — log ~10% of retries to avoid flooding console
          if (Math.random() < 0.1) {
            console.warn("[VM31] Batch poll error:", err instanceof Error ? err.message : err);
          }
        }
      }, 5_000);
    },
    [getBatchStatus, fetchMerklePath],
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (batchPollRef.current) clearInterval(batchPollRef.current);
    };
  }, []);

  // ========================================================================
  // Deposit (full flow: keys → approve → relayer submit → note storage)
  // ========================================================================

  const deposit = useCallback(
    async (params: VaultDepositParams): Promise<VaultSubmitResult> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      setState({ ...INITIAL_STATE, phase: "preparing", message: "Preparing deposit...", progress: 5 });

      try {
        const info = getAssetInfo(params.assetSymbol);
        if (!info.available) {
          throw new Error(`${params.assetSymbol} is not available on ${network}`);
        }

        // Stage 1: Privacy key derivation
        setState((p) => ({ ...p, phase: "keys", message: "Preparing privacy keys...", progress: 10 }));

        let pubkey = params.recipientPubkey;
        let viewKey = params.recipientViewingKey;

        if (!pubkey || !viewKey) {
          // Derive from wallet if not provided
          if (!hasKeys) {
            await initializeKeys();
          }
          const keyPair = await unlockKeys();
          if (!keyPair) throw new Error("Failed to unlock privacy keys");

          // Convert ECPoint → [u32; 4] for VM31 (take lower 31 bits of x/y components)
          const pk = keyPair.publicKey;
          pubkey = pubkey || [
            Number(pk.x & BigInt(M31_MOD)),
            Number((pk.x >> 31n) & BigInt(M31_MOD)),
            Number(pk.y & BigInt(M31_MOD)),
            Number((pk.y >> 31n) & BigInt(M31_MOD)),
          ];
          viewKey = viewKey || pubkey; // Use same key for viewing in this context
        }

        // Stage 2: ERC20 approval (if VM31Pool is deployed on-chain)
        if (poolDeployed) {
          setState((p) => ({ ...p, phase: "approving", message: "Checking token allowance...", progress: 25 }));

          const currentAllowance = await checkAllowance(info.tokenAddress, vm31PoolAddress);
          const needsApproval = currentAllowance < params.amount;

          if (needsApproval) {
            setState((p) => ({ ...p, message: "Approving token spend...", progress: 35 }));

            const calls = [
              {
                contractAddress: info.tokenAddress,
                entrypoint: "approve",
                calldata: CallData.compile({
                  spender: vm31PoolAddress,
                  amount: cairo.uint256(BLANKET_APPROVAL),
                }),
              },
            ];

            const approveResult = await account.execute(calls);
            setState((p) => ({ ...p, message: "Waiting for approval confirmation...", progress: 45 }));

            if (provider) {
              await provider.waitForTransaction(approveResult.transaction_hash);
            }

            setState((p) => ({
              ...p,
              depositTxHash: approveResult.transaction_hash,
              message: "Token approved!",
              progress: 50,
            }));
          }
        }

        // Stage 3: Submit to VM31 relayer
        setState((p) => ({ ...p, phase: "submitting", message: "Submitting to VM31 relayer...", progress: 60 }));

        const result = await submitToRelayer({
          type: "deposit",
          amount: amountToU64(params.amount),
          asset_id: info.vm31AssetId,
          recipient_pubkey: pubkey,
          recipient_viewing_key: viewKey,
        });

        // Stage 4: Store note locally
        const { lo, hi } = encodeAmountM31(params.amount);
        const blindingFactor = generateRandomBlinding();
        const noteCommitment = result.idempotencyKey || `vm31-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const note: StoredVaultNote = {
          symbol: params.assetSymbol,
          amount: params.amount.toString(),
          amountLo: lo,
          amountHi: hi,
          assetId: info.vm31AssetId,
          batchId: result.batchId || null,
          createdAt: Date.now(),
          spent: false,
          commitment: noteCommitment,
          ownerPubkey: pubkey!,
          blinding: blindingFactor,
          merkleProofAvailable: false,
        };
        setVaultNotes((prev) => [...prev, note]);

        // Also store as PrivacyNote for unified note management
        if (address) {
          const privacyNote: PrivacyNote = {
            denomination: Number(params.amount) / 10 ** info.decimals,
            commitment: noteCommitment,
            nullifierSecret: "0",
            blinding: "0",
            leafIndex: 0,
            depositTxHash: result.batchId || "",
            createdAt: Date.now(),
            spent: false,
            tokenSymbol: params.assetSymbol,
          };
          await saveNote(address, privacyNote);
        }

        // Update state
        const newPhase = result.status === "batch_triggered" ? "proving" : "queued";
        setState({
          phase: newPhase,
          message: newPhase === "proving"
            ? "STWO STARK proof generation in progress..."
            : `Queued at position ${result.queuePosition ?? "?"}`,
          progress: newPhase === "proving" ? 80 : 70,
          error: null,
          batchId: result.batchId || null,
          queuePosition: result.queuePosition ?? null,
          idempotencyKey: result.idempotencyKey || null,
          depositTxHash: state.depositTxHash,
        });

        // Start batch polling if we got a batch ID
        if (result.batchId) {
          startBatchPolling(result.batchId);
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Deposit failed";
        setState((p) => ({
          ...p,
          phase: "error",
          message: msg,
          error: msg,
          progress: 0,
        }));
        throw err;
      }
    },
    [account, address, getAssetInfo, network, submitToRelayer, hasKeys,
     initializeKeys, unlockKeys, poolDeployed, checkAllowance, vm31PoolAddress,
     provider, state.depositTxHash, startBatchPolling],
  );

  // ========================================================================
  // Withdraw
  // ========================================================================

  const withdraw = useCallback(
    async (params: VaultWithdrawParams): Promise<VaultSubmitResult> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      // Block withdrawals with placeholder (all-zero) merkle data
      if (params.merkleRoot.every((v: number) => v === 0)) {
        throw new Error("Cannot withdraw with placeholder Merkle data. Proof indexing required.");
      }

      setState({ ...INITIAL_STATE, phase: "preparing", message: "Preparing withdrawal...", progress: 5 });

      try {
        const info = getAssetInfo(params.assetSymbol);

        // Stage 1: Spending key derivation
        setState((p) => ({ ...p, phase: "keys", message: "Unlocking spending key...", progress: 20 }));

        if (!hasKeys) {
          await initializeKeys();
        }
        const keyPair = await unlockKeys();
        if (!keyPair) throw new Error("Failed to unlock privacy keys");

        // Stage 2: Submit to relayer
        setState((p) => ({ ...p, phase: "submitting", message: "Submitting withdrawal to relayer...", progress: 50 }));

        const result = await submitToRelayer({
          type: "withdraw",
          amount: amountToU64(params.amount),
          asset_id: info.vm31AssetId,
          note: params.note,
          spending_key: params.spendingKey,
          merkle_path: params.merklePath,
          merkle_root: params.merkleRoot,
          withdrawal_binding: params.withdrawalBinding,
        });

        const newPhase = result.status === "batch_triggered" ? "proving" : "queued";
        setState({
          phase: newPhase,
          message: newPhase === "proving" ? "Proving withdrawal..." : "Withdrawal queued",
          progress: newPhase === "proving" ? 80 : 70,
          error: null,
          batchId: result.batchId || null,
          queuePosition: result.queuePosition ?? null,
          idempotencyKey: result.idempotencyKey || null,
          depositTxHash: null,
        });

        if (result.batchId) startBatchPolling(result.batchId);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Withdraw failed";
        setState((p) => ({ ...p, phase: "error", message: msg, error: msg, progress: 0 }));
        throw err;
      }
    },
    [account, address, getAssetInfo, submitToRelayer, startBatchPolling, hasKeys, initializeKeys, unlockKeys],
  );

  // ========================================================================
  // Transfer
  // ========================================================================

  const transfer = useCallback(
    async (params: VaultTransferParams): Promise<VaultSubmitResult> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      setState({ ...INITIAL_STATE, phase: "preparing", message: "Preparing transfer...", progress: 5 });

      try {
        const info = getAssetInfo(params.assetSymbol);

        // Stage 1: Spending key derivation
        setState((p) => ({ ...p, phase: "keys", message: "Unlocking spending key...", progress: 20 }));

        if (!hasKeys) {
          await initializeKeys();
        }
        const keyPair = await unlockKeys();
        if (!keyPair) throw new Error("Failed to unlock privacy keys");

        // Stage 2: Submit to relayer
        setState((p) => ({ ...p, phase: "submitting", message: "Submitting transfer to relayer...", progress: 50 }));

        const result = await submitToRelayer({
          type: "transfer",
          amount: amountToU64(params.amount),
          asset_id: info.vm31AssetId,
          recipient_pubkey: params.recipientPubkey,
          recipient_viewing_key: params.recipientViewingKey,
          sender_viewing_key: params.senderViewingKey,
          input_notes: params.inputNotes,
          merkle_root: params.merkleRoot,
        });

        const newPhase = result.status === "batch_triggered" ? "proving" : "queued";
        setState({
          phase: newPhase,
          message: newPhase === "proving" ? "Proving transfer..." : "Transfer queued",
          progress: newPhase === "proving" ? 80 : 70,
          error: null,
          batchId: result.batchId || null,
          queuePosition: result.queuePosition ?? null,
          idempotencyKey: result.idempotencyKey || null,
          depositTxHash: null,
        });

        if (result.batchId) startBatchPolling(result.batchId);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Transfer failed";
        setState((p) => ({ ...p, phase: "error", message: msg, error: msg, progress: 0 }));
        throw err;
      }
    },
    [account, address, getAssetInfo, submitToRelayer, startBatchPolling, hasKeys, initializeKeys, unlockKeys],
  );

  // ========================================================================
  // Local note management
  // ========================================================================

  const getUnspentNotes = useCallback(
    (symbol?: string): StoredVaultNote[] => {
      return vaultNotes.filter((n) => !n.spent && (!symbol || n.symbol === symbol));
    },
    [vaultNotes],
  );

  const getShieldedBalance = useCallback(
    (symbol: string): bigint => {
      return getUnspentNotes(symbol).reduce(
        (sum, n) => sum + BigInt(n.amount),
        0n,
      );
    },
    [getUnspentNotes],
  );

  // ========================================================================
  // Mark note spent
  // ========================================================================

  const markVaultNoteSpent = useCallback(
    async (commitment: string, batchId: string) => {
      // Update local state
      setVaultNotes((prev) =>
        prev.map((n) =>
          n.commitment === commitment
            ? { ...n, spent: true, spentTxHash: batchId }
            : n,
        ),
      );
      // Persist to IndexedDB
      try {
        await markNoteSpent(commitment, batchId);
      } catch {
        // IndexedDB failure is non-fatal — local state is already updated
      }
    },
    [],
  );

  // ========================================================================
  // Reset
  // ========================================================================

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    if (batchPollRef.current) {
      clearInterval(batchPollRef.current);
      batchPollRef.current = null;
    }
  }, []);

  return {
    // State (full VaultState for detailed UI)
    state,
    phase: state.phase,
    error: state.error,
    poolDeployed,

    // Privacy keys
    hasKeys,
    publicKey,
    keysInitialized,

    // Actions
    deposit,
    withdraw,
    transfer,
    reset,

    // Asset resolution
    getAssetInfo,
    useAssetId,
    useTokenBalance,

    // Batch tracking
    getBatchStatus,
    startBatchPolling,
    fetchMerklePath,

    // Note management
    vaultNotes,
    getUnspentNotes,
    getShieldedBalance,
    markVaultNoteSpent,

    // Relayer queries
    relayerHealth: healthQuery.data ?? null,
    relayerOnline: healthQuery.data?.status === "ok",
    isRelayerLoading: healthQuery.isLoading,
    relayerStatus: statusQuery.data ?? null,

    // ERC20
    checkAllowance,

    // Helpers
    encodeAmountM31,
    decodeAmountM31,
    formatBtcAmount,
    vaultPhaseToProvingStage,
  };
}

export default useVM31Vault;
