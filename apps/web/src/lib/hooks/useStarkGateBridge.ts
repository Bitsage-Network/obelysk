/**
 * StarkGate Bridge Hook
 *
 * Combines Ethereum wallet (window.ethereum) + starknet-react
 * for native L1<->L2 bridging via StarkGate contracts.
 */

"use client";

import { useState, useCallback } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import {
  type BridgeState,
  type BridgeDepositParams,
  type WithdrawParams,
  type GasEstimate,
  ensureCorrectChain,
  getL1Accounts,
  approveL1Token,
  depositToL2,
  estimateDepositGas,
  waitForL1Confirmation,
  buildL2WithdrawMulticall,
  isValidEthereumAddress,
} from "@/lib/bridge/starkgateBridge";
import {
  L1_TOKEN_ADDRESSES,
  TOKEN_METADATA,
  type BridgeTokenSymbol,
} from "@/lib/contracts/addresses";

// Re-export types for consumers
export type { BridgeDepositParams, WithdrawParams, BridgeState, GasEstimate };
export type { BridgeTokenSymbol } from "@/lib/contracts/addresses";

// ============================================================================
// ETHEREUM WALLET HOOK (inline — no useMultichain dependency)
// ============================================================================

function useEthereumWallet() {
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const accounts = await getL1Accounts();
      if (accounts.length > 0) {
        setEthAddress(accounts[0]);
      }
    } catch {
      setEthAddress(null);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setEthAddress(null);
  }, []);

  return { ethAddress, isConnecting, connect, disconnect };
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: BridgeState = {
  stage: "idle",
  message: "",
  progress: 0,
  error: null,
  l1TxHash: null,
  l2TxHash: null,
};

// ============================================================================
// MAIN HOOK
// ============================================================================

export interface UseStarkGateBridgeResult {
  state: BridgeState;
  ethWallet: {
    address: string | null;
    isConnecting: boolean;
    connect: () => Promise<void>;
    disconnect: () => void;
  };
  deposit: (params: BridgeDepositParams) => Promise<void>;
  withdraw: (params: WithdrawParams) => Promise<void>;
  estimateDeposit: (params: BridgeDepositParams) => Promise<GasEstimate | null>;
  reset: () => void;
}

export function useStarkGateBridge(): UseStarkGateBridgeResult {
  const { address: l2Address } = useAccount();
  const { sendAsync } = useSendTransaction({});
  const ethWallet = useEthereumWallet();
  const [state, setState] = useState<BridgeState>(initialState);

  const updateState = useCallback(
    (patch: Partial<BridgeState>) =>
      setState((prev) => ({ ...prev, ...patch })),
    []
  );

  const reset = useCallback(() => setState(initialState), []);

  // ========================================================================
  // DEPOSIT (L1 → L2)
  // ========================================================================
  const deposit = useCallback(
    async (params: BridgeDepositParams) => {
      try {
        // 1. Switch chain
        updateState({
          stage: "switching-chain",
          message: `Switching to ${params.network === "mainnet" ? "Ethereum Mainnet" : "Sepolia"}...`,
          progress: 10,
          error: null,
          l1TxHash: null,
          l2TxHash: null,
        });
        await ensureCorrectChain(params.network);

        // 2. Connect accounts
        updateState({
          stage: "connecting",
          message: "Connecting MetaMask...",
          progress: 20,
        });
        const accounts = await getL1Accounts();
        if (!accounts.length) throw new Error("No Ethereum account connected");

        // 3. Approve ERC20 (if not native ETH)
        const l1Token = L1_TOKEN_ADDRESSES[params.network][params.token];
        if (l1Token) {
          updateState({
            stage: "approving",
            message: `Approving ${params.token} for bridge...`,
            progress: 35,
          });

          const decimals = TOKEN_METADATA[params.token]?.decimals ?? 18;
          const [whole = "0", frac = ""] = params.amount.split(".");
          const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
          const rawAmount = BigInt(whole + paddedFrac);

          const approveTx = await approveL1Token(
            params.token,
            rawAmount,
            params.network
          );

          // Wait for approval confirmation
          updateState({
            stage: "approving",
            message: "Waiting for approval confirmation...",
            progress: 45,
          });
          const approveSuccess = await waitForL1Confirmation(approveTx, 30);
          if (!approveSuccess) throw new Error("Token approval failed on L1");
        }

        // 4. Deposit
        updateState({
          stage: "depositing",
          message: `Depositing ${params.amount} ${params.token} to L2...`,
          progress: 60,
        });
        const depositTx = await depositToL2(params);

        updateState({
          stage: "confirming",
          message: "Waiting for L1 confirmation...",
          progress: 70,
          l1TxHash: depositTx,
        });

        // 5. Wait for L1 confirmation
        const success = await waitForL1Confirmation(depositTx, 60, (attempt) => {
          updateState({
            stage: "confirming",
            message: `Confirming on L1... (${attempt * 5}s)`,
            progress: 70 + Math.min(attempt, 20),
          });
        });

        if (!success) throw new Error("L1 deposit transaction failed");

        // 6. L2 processing
        updateState({
          stage: "l2-processing",
          message: "L1 confirmed! Tokens will appear on L2 in ~12-20 minutes.",
          progress: 95,
          l1TxHash: depositTx,
        });

        // After a short delay, mark confirmed
        await new Promise((r) => setTimeout(r, 3000));
        updateState({
          stage: "confirmed",
          message: "Deposit submitted! Tokens will arrive on L2 shortly.",
          progress: 100,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Deposit failed";
        updateState({
          stage: "error",
          message,
          error: message,
          progress: 0,
        });
      }
    },
    [updateState]
  );

  // ========================================================================
  // WITHDRAW (L2 → L1)
  // ========================================================================
  const withdraw = useCallback(
    async (params: WithdrawParams) => {
      try {
        if (!l2Address) throw new Error("Connect your Starknet wallet first");
        if (!isValidEthereumAddress(params.l1Recipient)) {
          throw new Error("Invalid Ethereum address");
        }

        updateState({
          stage: "depositing", // reuse for "submitting"
          message: `Initiating ${params.token} withdrawal to L1...`,
          progress: 30,
          error: null,
          l1TxHash: null,
          l2TxHash: null,
        });

        const calls = buildL2WithdrawMulticall(params);

        updateState({
          stage: "confirming",
          message: "Confirm the transaction in your Starknet wallet...",
          progress: 50,
        });

        const result = await sendAsync(calls);
        const txHash =
          typeof result === "object" && result !== null && "transaction_hash" in result
            ? (result as { transaction_hash: string }).transaction_hash
            : String(result);

        updateState({
          stage: "confirmed",
          message:
            "Withdrawal initiated! Funds will be claimable on L1 in ~2-6 hours via StarkGate.",
          progress: 100,
          l2TxHash: txHash,
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Withdrawal failed";
        updateState({
          stage: "error",
          message,
          error: message,
          progress: 0,
        });
      }
    },
    [l2Address, sendAsync, updateState]
  );

  // ========================================================================
  // ESTIMATE
  // ========================================================================
  const estimateDeposit = useCallback(
    async (params: BridgeDepositParams): Promise<GasEstimate | null> => {
      try {
        return await estimateDepositGas(params);
      } catch {
        return null;
      }
    },
    []
  );

  return {
    state,
    ethWallet: {
      address: ethWallet.ethAddress,
      isConnecting: ethWallet.isConnecting,
      connect: ethWallet.connect,
      disconnect: ethWallet.disconnect,
    },
    deposit,
    withdraw,
    estimateDeposit,
    reset,
  };
}
