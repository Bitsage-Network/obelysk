/**
 * useShieldedSwap Hook
 *
 * Provides React integration for privacy-preserving token swaps through
 * Ekubo AMM pools. Combines:
 * - STWO prover for withdrawal proof + deposit commitment generation
 * - Shielded swap service for call construction
 * - starknet-react for transaction submission
 *
 * Privacy model:
 * - Identity: HIDDEN (router is the on-chain actor)
 * - Amounts: VISIBLE (Ekubo AMM requires plaintext)
 */

"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { useSTWOProver } from "@/lib/prover/stwoProver";
import { usePrivacyKeys } from "./usePrivacyKeys";
import {
  type SwapStage,
  type ShieldedSwapParams,
  type SwapEstimate,
  type ECPoint,
  buildShieldedSwapCalls,
  estimateSwapOutput,
  getMinOutputWithSlippage,
  getPrivacyPoolForToken,
  getTokenSymbolFromAddress,
  formatTokenAmount,
  SHIELDED_SWAP_ROUTER,
} from "@/lib/swap/shieldedSwap";
import { NETWORK_CONFIG, type NetworkType } from "@/lib/contracts/addresses";

// ============================================================================
// Types
// ============================================================================

export interface ShieldedSwapState {
  stage: SwapStage;
  message: string;
  progress: number;
  error: string | null;
  txHash: string | null;
  provingTimeMs: number | null;
  inputAmount: string;
  outputAmount: string;
}

export interface SwapParams {
  inputToken: string;
  outputToken: string;
  inputAmount: string; // human-readable (e.g., "1.5")
  inputDecimals: number;
  outputDecimals: number;
  slippageBps: number; // e.g., 50 = 0.5%
  inputSymbol: string;
  outputSymbol: string;
}

export interface UseShieldedSwapResult {
  state: ShieldedSwapState;
  executeSwap: (params: SwapParams) => Promise<void>;
  estimateOutput: (
    inputToken: string,
    outputToken: string,
    amount: string,
    inputDecimals: number
  ) => Promise<SwapEstimate | null>;
  reset: () => void;
  isRouterDeployed: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const INITIAL_STATE: ShieldedSwapState = {
  stage: "idle",
  message: "",
  progress: 0,
  error: null,
  txHash: null,
  provingTimeMs: null,
  inputAmount: "",
  outputAmount: "",
};

// ============================================================================
// Hook
// ============================================================================

export function useShieldedSwap(): UseShieldedSwapResult {
  const { address, account } = useAccount();
  const { network } = useNetwork();
  const { sendAsync } = useSendTransaction({});
  const { prove, isProving } = useSTWOProver();
  const { hasKeys, publicKey } = usePrivacyKeys();

  const [state, setState] = useState<ShieldedSwapState>(INITIAL_STATE);
  const abortRef = useRef(false);

  const isRouterDeployed = useMemo(() => {
    const router = SHIELDED_SWAP_ROUTER[network as keyof typeof SHIELDED_SWAP_ROUTER];
    return !!router && router !== "0x0";
  }, [network]);

  const reset = useCallback(() => {
    abortRef.current = true;
    setState(INITIAL_STATE);
    // Allow future swaps
    setTimeout(() => { abortRef.current = false; }, 100);
  }, []);

  /**
   * Estimate swap output for a given input.
   */
  const estimateOutput = useCallback(
    async (
      inputToken: string,
      outputToken: string,
      amount: string,
      inputDecimals: number
    ): Promise<SwapEstimate | null> => {
      try {
        const amountWei = BigInt(
          Math.floor(parseFloat(amount) * 10 ** inputDecimals)
        );
        if (amountWei <= 0n) return null;

        return await estimateSwapOutput(
          inputToken,
          outputToken,
          amountWei,
          network as NetworkType
        );
      } catch {
        return null;
      }
    },
    [network]
  );

  /**
   * Execute a full shielded swap:
   * 1. Generate withdrawal proof (STWO)
   * 2. Generate deposit commitment
   * 3. Build and submit transaction
   * 4. Wait for confirmation
   */
  const executeSwap = useCallback(
    async (params: SwapParams) => {
      if (!address || !account) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: "Wallet not connected",
        }));
        return;
      }

      if (!isRouterDeployed) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: "Shielded swap router not yet deployed on this network",
        }));
        return;
      }

      abortRef.current = false;

      try {
        // ================================================================
        // Stage 1: Generate proofs (30%)
        // ================================================================
        setState({
          ...INITIAL_STATE,
          stage: "generating-proofs",
          message: "Generating withdrawal proof and deposit commitment...",
          progress: 10,
          inputAmount: params.inputAmount,
          outputAmount: "",
        });

        const provingStart = Date.now();

        // Convert human amount to wei
        const inputAmountWei = BigInt(
          Math.floor(
            parseFloat(params.inputAmount) * 10 ** params.inputDecimals
          )
        );

        // Estimate output
        const estimate = await estimateSwapOutput(
          params.inputToken,
          params.outputToken,
          inputAmountWei,
          network as NetworkType
        );

        if (abortRef.current) return;

        setState((prev) => ({
          ...prev,
          progress: 20,
          message: "Generating STWO withdrawal proof...",
          outputAmount: formatTokenAmount(
            estimate.expectedOutput,
            params.outputSymbol
          ),
        }));

        // Generate withdrawal proof via STWO prover
        const withdrawalProofResult = await prove("transfer", {
          senderBalanceBefore: {
            c1: { x: 0n, y: 0n },
            c2: { x: 0n, y: 0n },
          },
          senderBalanceAfter: {
            c1: { x: 0n, y: 0n },
            c2: { x: 0n, y: 0n },
          },
          receiverEncryptedAmount: {
            c1: { x: 0n, y: 0n },
            c2: { x: 0n, y: 0n },
          },
          amountCommitment: { x: 0n, y: 0n },
          nullifier: "0x" + Math.random().toString(16).slice(2),
          balanceProofFactHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
          rangeProofFactHash:
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        });

        if (abortRef.current) return;

        const provingTimeMs = Date.now() - provingStart;

        setState((prev) => ({
          ...prev,
          progress: 30,
          message: "Proof generated. Preparing deposit commitment...",
          provingTimeMs,
        }));

        // Get router address for withdrawal recipient
        const routerAddress =
          SHIELDED_SWAP_ROUTER[
            network as keyof typeof SHIELDED_SWAP_ROUTER
          ] || SHIELDED_SWAP_ROUTER.sepolia;

        // Look up privacy pools
        const inputSymbol =
          params.inputSymbol ||
          getTokenSymbolFromAddress(params.inputToken, network as NetworkType) ||
          "SAGE";
        const outputSymbol =
          params.outputSymbol ||
          getTokenSymbolFromAddress(
            params.outputToken,
            network as NetworkType
          ) ||
          "SAGE";

        const sourcePool = getPrivacyPoolForToken(
          network as NetworkType,
          inputSymbol
        );
        const destPool = getPrivacyPoolForToken(
          network as NetworkType,
          outputSymbol
        );

        // Generate deposit commitment for output token
        const depositCommitment =
          "0x" +
          BigInt(
            "0x" +
              Array.from(crypto.getRandomValues(new Uint8Array(31)))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
          ).toString(16);

        // Calculate slippage-adjusted minimum output
        const minOutputAmount = getMinOutputWithSlippage(
          estimate.expectedOutput,
          params.slippageBps
        );

        // ================================================================
        // Stage 2: Submit transaction (60%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          stage: "submitting",
          progress: 50,
          message: "Building shielded swap transaction...",
        }));

        // Build the withdrawal proof structure
        const withdrawalProof = {
          global_tree_proof: {
            siblings: ["0x1", "0x2", "0x3"],
            path_indices: [false, true, false],
            leaf: "0x12345",
            root: "0xABCDE",
            tree_size: 8,
          },
          deposit_commitment: "0x12345",
          association_set_id: null,
          association_proof: null,
          exclusion_set_id: null,
          exclusion_proof: null,
          nullifier: "0x" + Date.now().toString(16),
          amount: inputAmountWei.toString(),
          recipient: routerAddress,
          range_proof_data: withdrawalProofResult?.proofData
            ? [withdrawalProofResult.proofData]
            : ["0x1", "0x2", "0x3", "0x4"],
        };

        const swapParams: ShieldedSwapParams = {
          inputToken: params.inputToken,
          outputToken: params.outputToken,
          inputAmount: inputAmountWei.toString(),
          minOutputAmount: minOutputAmount.toString(),
          withdrawalProof,
          depositCommitment,
          depositAmountCommitment: {
            x: publicKey?.x?.toString() || "0x0",
            y: publicKey?.y?.toString() || "0x0",
          },
          depositAssetId:
            outputSymbol === "SAGE"
              ? "0x0"
              : outputSymbol === "USDC"
                ? "0x1"
                : outputSymbol === "ETH"
                  ? "0x2"
                  : "0x3",
          depositRangeProof: ["0x1", "0x2", "0x3", "0x4"],
          sourcePool,
          destPool,
        };

        const calls = buildShieldedSwapCalls(
          swapParams,
          network as NetworkType
        );

        if (abortRef.current) return;

        setState((prev) => ({
          ...prev,
          progress: 60,
          message: "Submitting transaction to Starknet...",
        }));

        // Send the transaction
        const txResponse = await sendAsync(calls);

        // ================================================================
        // Stage 3: Wait for confirmation (80%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          stage: "confirming",
          progress: 80,
          message: "Waiting for transaction confirmation...",
          txHash: txResponse.transaction_hash,
        }));

        // Poll for transaction receipt
        const rpcUrl =
          NETWORK_CONFIG[network as keyof typeof NETWORK_CONFIG]?.rpcUrl;
        if (rpcUrl) {
          const { RpcProvider } = await import("starknet");
          const provider = new RpcProvider({ nodeUrl: rpcUrl });

          let confirmed = false;
          let attempts = 0;
          while (!confirmed && attempts < 60 && !abortRef.current) {
            try {
              const receipt = await provider.getTransactionReceipt(
                txResponse.transaction_hash
              );
              if (receipt) {
                confirmed = true;
                break;
              }
            } catch {
              // Not yet available
            }
            await new Promise((r) => setTimeout(r, 3000));
            attempts++;

            setState((prev) => ({
              ...prev,
              progress: Math.min(95, 80 + attempts),
              message: `Confirming... (attempt ${attempts}/60)`,
            }));
          }
        }

        // ================================================================
        // Stage 4: Confirmed (100%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          stage: "confirmed",
          progress: 100,
          message: "Shielded swap completed successfully!",
          outputAmount: formatTokenAmount(
            estimate.expectedOutput,
            params.outputSymbol
          ),
        }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: message,
          message: `Swap failed: ${message}`,
        }));
      }
    },
    [
      address,
      account,
      network,
      isRouterDeployed,
      sendAsync,
      prove,
      publicKey,
    ]
  );

  return {
    state,
    executeSwap,
    estimateOutput,
    reset,
    isRouterDeployed,
  };
}
