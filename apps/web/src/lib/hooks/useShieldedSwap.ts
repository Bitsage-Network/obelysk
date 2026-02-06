/**
 * useShieldedSwap Hook
 *
 * Provides React integration for privacy-preserving token swaps through
 * Ekubo AMM pools. Uses real cryptographic operations:
 * - Pedersen commitments for deposit note creation
 * - Poseidon-based nullifier derivation
 * - ElGamal encryption for amount hiding
 * - On-chain Merkle proof generation via storage reads
 * - IndexedDB note storage via keyStore
 *
 * Privacy model:
 * - Identity: HIDDEN (router is the on-chain actor)
 * - Amounts: VISIBLE (Ekubo AMM requires plaintext)
 */

"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useAccount, useSendTransaction } from "@starknet-react/core";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { usePrivacyKeys } from "./usePrivacyKeys";
import {
  createNote,
  commitmentToFelt,
  commitmentToContractFormat,
  type NoteData,
} from "@/lib/crypto/pedersen";
import { deriveNullifier, nullifierToFelt } from "@/lib/crypto/nullifier";
import {
  encrypt as elgamalEncrypt,
  randomScalar,
} from "@/lib/crypto/elgamal";
import {
  getUnspentNotes,
  saveNote,
  markNoteSpent,
  updateNoteLeafIndex,
} from "@/lib/crypto/keyStore";
import type { PrivacyNote } from "@/lib/crypto/constants";
import { generateMerkleProofOnChain } from "@/lib/crypto/onChainMerkleProof";
import {
  type SwapStage,
  type ShieldedSwapParams,
  type SwapEstimate,
  buildShieldedSwapCalls,
  estimateSwapOutput,
  getMinOutputWithSlippage,
  getPrivacyPoolForToken,
  getTokenSymbolFromAddress,
  formatTokenAmount,
  validateSwapPrerequisites,
  getAssetIdForToken,
  SHIELDED_SWAP_ROUTER,
} from "@/lib/swap/shieldedSwap";
import {
  NETWORK_CONFIG,
  TOKEN_METADATA,
  type NetworkType,
} from "@/lib/contracts/addresses";

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
  executeSwap: (params: SwapParams) => Promise<string | null>;
  estimateOutput: (
    inputToken: string,
    outputToken: string,
    amount: string,
    inputDecimals: number
  ) => Promise<SwapEstimate | null>;
  reset: () => void;
  isRouterDeployed: boolean;
  getPrivacyPoolBalance: (tokenSymbol?: string) => Promise<number>;
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
// Helpers
// ============================================================================

/**
 * Select the best unspent note for a swap.
 * Prefers exact match, then smallest note >= required amount.
 */
function selectNoteForSwap(
  notes: PrivacyNote[],
  requiredAmount: number,
  tokenSymbol: string
): PrivacyNote | null {
  // Filter for the correct token (notes without tokenSymbol are assumed SAGE)
  const tokenNotes = notes.filter((n) => {
    const noteToken = n.tokenSymbol || "SAGE";
    return noteToken === tokenSymbol;
  });

  if (tokenNotes.length === 0) return null;

  // Sort by denomination ascending
  const sorted = [...tokenNotes].sort(
    (a, b) => a.denomination - b.denomination
  );

  // Exact match
  const exact = sorted.find((n) => n.denomination === requiredAmount);
  if (exact) return exact;

  // Smallest note >= required
  const sufficient = sorted.find((n) => n.denomination >= requiredAmount);
  if (sufficient) return sufficient;

  return null;
}

// ============================================================================
// Hook
// ============================================================================

export function useShieldedSwap(): UseShieldedSwapResult {
  const { address, account } = useAccount();
  const { network } = useNetwork();
  const { sendAsync } = useSendTransaction({});
  const { hasKeys, publicKey, initializeKeys, unlockKeys } = usePrivacyKeys();

  const [state, setState] = useState<ShieldedSwapState>(INITIAL_STATE);
  const abortRef = useRef(false);

  const isRouterDeployed = useMemo(() => {
    const router =
      SHIELDED_SWAP_ROUTER[network as keyof typeof SHIELDED_SWAP_ROUTER];
    return !!router && router !== "0x0";
  }, [network]);

  const reset = useCallback(() => {
    abortRef.current = true;
    setState(INITIAL_STATE);
    setTimeout(() => {
      abortRef.current = false;
    }, 100);
  }, []);

  /**
   * Get unspent privacy pool balance for a token.
   */
  const getPrivacyPoolBalance = useCallback(
    async (tokenSymbol: string = "SAGE"): Promise<number> => {
      if (!address) return 0;
      const notes = await getUnspentNotes(address);
      return notes
        .filter((n) => (n.tokenSymbol || "SAGE") === tokenSymbol)
        .reduce((sum, n) => sum + n.denomination, 0);
    },
    [address]
  );

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
   * Execute a full shielded swap with real cryptographic operations:
   * 0. Validate prerequisites
   * 1. Select note from IndexedDB
   * 2. Derive nullifier & fetch Merkle proof
   * 3. Create output deposit note with Pedersen commitment + ElGamal encryption
   * 4. Build and submit transaction
   * 5. Confirm and store output note
   */
  const executeSwap = useCallback(
    async (params: SwapParams) => {
      // ================================================================
      // Stage 0: Validate (0-5%)
      // ================================================================
      if (!address || !account) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: "Wallet not connected",
        }));
        return null;
      }

      if (!isRouterDeployed) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: "Shielded swap router not yet deployed on this network",
        }));
        return null;
      }

      const inputSymbol =
        params.inputSymbol ||
        getTokenSymbolFromAddress(
          params.inputToken,
          network as NetworkType
        ) ||
        "SAGE";
      const outputSymbol =
        params.outputSymbol ||
        getTokenSymbolFromAddress(
          params.outputToken,
          network as NetworkType
        ) ||
        "SAGE";

      // Validate pools are deployed
      const poolValidation = validateSwapPrerequisites(
        inputSymbol,
        outputSymbol,
        network
      );
      if (!poolValidation.valid) {
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: poolValidation.error || "Pool validation failed",
        }));
        return null;
      }

      // Ensure privacy keys exist
      if (!hasKeys) {
        try {
          await initializeKeys();
        } catch {
          setState((prev) => ({
            ...prev,
            stage: "error",
            error: "Privacy keys required. Please initialize keys first.",
          }));
          return null;
        }
      }

      abortRef.current = false;

      try {
        setState({
          ...INITIAL_STATE,
          stage: "generating-proofs",
          message: "Validating swap prerequisites...",
          progress: 2,
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

        const routerAddress =
          SHIELDED_SWAP_ROUTER[
            network as keyof typeof SHIELDED_SWAP_ROUTER
          ] || SHIELDED_SWAP_ROUTER.sepolia;

        const sourcePool = getPrivacyPoolForToken(
          network as NetworkType,
          inputSymbol
        );
        const destPool = getPrivacyPoolForToken(
          network as NetworkType,
          outputSymbol
        );

        // ================================================================
        // Stage 1: Note Selection (5-15%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          progress: 5,
          message: "Selecting privacy pool note...",
        }));

        const unspentNotes = await getUnspentNotes(address);
        const inputDenomination = parseFloat(params.inputAmount);

        const selectedNote = selectNoteForSwap(
          unspentNotes,
          inputDenomination,
          inputSymbol
        );

        if (!selectedNote) {
          const tokenNotes = unspentNotes.filter(
            (n) => (n.tokenSymbol || "SAGE") === inputSymbol
          );
          if (tokenNotes.length === 0) {
            throw new Error(
              `No privacy pool notes found for ${inputSymbol}. Deposit first.`
            );
          }
          const largest = Math.max(...tokenNotes.map((n) => n.denomination));
          throw new Error(
            `Insufficient balance. Largest note: ${largest} ${inputSymbol}`
          );
        }

        if (abortRef.current) return null;

        console.log("[ShieldedSwap] Selected note:", {
          commitment: selectedNote.commitment.slice(0, 16) + "...",
          denomination: selectedNote.denomination,
          leafIndex: selectedNote.leafIndex,
        });

        setState((prev) => ({
          ...prev,
          progress: 15,
          message: "Generating Merkle proof from on-chain data...",
        }));

        // ================================================================
        // Stage 2: Merkle Proof → Nullifier → Withdrawal Proof (15-45%)
        // ================================================================

        // Step 2a: Generate Merkle proof on-chain (must come before nullifier)
        const merkleProof = await generateMerkleProofOnChain(
          selectedNote.commitment,
          "sepolia"
        );

        if (!merkleProof) {
          throw new Error(
            "Could not generate Merkle proof. Deposit commitment not found on-chain. " +
            "Please wait for the deposit to be confirmed."
          );
        }

        // Update note's leafIndex from on-chain data
        if (
          selectedNote.leafIndex === 0 &&
          merkleProof.leafIndex > 0
        ) {
          await updateNoteLeafIndex(
            selectedNote.commitment,
            merkleProof.leafIndex
          );
          selectedNote.leafIndex = merkleProof.leafIndex;
        }

        console.log("[ShieldedSwap] Merkle proof generated:", {
          root: merkleProof.root.slice(0, 16) + "...",
          siblings: merkleProof.siblings.length,
          leafIndex: merkleProof.leafIndex,
          treeSize: merkleProof.tree_size,
        });

        if (abortRef.current) return null;

        setState((prev) => ({
          ...prev,
          progress: 25,
          message: "Deriving nullifier...",
        }));

        // Step 2b: Derive nullifier using leafIndex from proof
        const effectiveLeafIndex = merkleProof.leafIndex;
        const nullifier = deriveNullifier(
          BigInt(selectedNote.nullifierSecret),
          effectiveLeafIndex
        );

        console.log(
          "[ShieldedSwap] Nullifier derived:",
          nullifierToFelt(nullifier).slice(0, 16) + "...",
          "for leafIndex:",
          effectiveLeafIndex
        );

        if (abortRef.current) return null;

        setState((prev) => ({
          ...prev,
          progress: 35,
          message: "Estimating swap output...",
        }));

        // Estimate output
        const estimate = await estimateSwapOutput(
          params.inputToken,
          params.outputToken,
          inputAmountWei,
          network as NetworkType
        );

        if (abortRef.current) return null;

        setState((prev) => ({
          ...prev,
          progress: 40,
          message: "Building withdrawal proof...",
          outputAmount: formatTokenAmount(
            estimate.expectedOutput,
            params.outputSymbol
          ),
        }));

        // Build real withdrawal proof (matching Cairo PPWithdrawalProof)
        const withdrawalProof = {
          global_tree_proof: {
            siblings: merkleProof.siblings,
            path_indices: merkleProof.path_indices.map(
              (p: number) => p === 1
            ),
            leaf: selectedNote.commitment,
            root: merkleProof.root,
            tree_size: merkleProof.tree_size,
          },
          deposit_commitment: selectedNote.commitment,
          association_set_id: null,
          association_proof: null,
          exclusion_set_id: null,
          exclusion_proof: null,
          nullifier: nullifierToFelt(nullifier),
          amount: inputAmountWei.toString(),
          recipient: routerAddress,
          range_proof_data: [] as string[], // Empty = optional per contract
        };

        const provingTimeMs = Date.now() - provingStart;

        // ================================================================
        // Stage 3: Output Deposit Note (45-55%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          progress: 45,
          message: "Creating output deposit commitment...",
          provingTimeMs,
        }));

        // Create a new Pedersen commitment for the output amount
        const outputDecimals =
          TOKEN_METADATA[
            outputSymbol as keyof typeof TOKEN_METADATA
          ]?.decimals ?? 18;
        const estimatedOutputWei = estimate.expectedOutput;
        const outputNoteData: NoteData = createNote(estimatedOutputWei);

        // Convert commitment to felt for on-chain storage
        const outputCommitmentFelt = commitmentToFelt(
          outputNoteData.commitment
        );
        const outputCommitmentContract = commitmentToContractFormat(
          outputNoteData.commitment
        );

        // ElGamal encrypt the output amount for the user's public key
        let currentPublicKey = publicKey;
        if (!currentPublicKey) {
          const keyPair = await unlockKeys();
          if (!keyPair) {
            throw new Error("Failed to unlock privacy keys for encryption");
          }
          currentPublicKey = keyPair.publicKey;
        }

        const encryptionRandomness = randomScalar();
        const encryptedAmount = elgamalEncrypt(
          estimatedOutputWei,
          currentPublicKey,
          encryptionRandomness
        );

        // Calculate slippage-adjusted minimum output
        const minOutputAmount = getMinOutputWithSlippage(
          estimate.expectedOutput,
          params.slippageBps
        );

        if (abortRef.current) return null;

        // ================================================================
        // Stage 4: Submit Transaction (55-75%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          stage: "submitting",
          progress: 55,
          message: "Building shielded swap transaction...",
        }));

        const swapParams: ShieldedSwapParams = {
          inputToken: params.inputToken,
          outputToken: params.outputToken,
          inputAmount: inputAmountWei.toString(),
          minOutputAmount: minOutputAmount.toString(),
          withdrawalProof,
          depositCommitment: outputCommitmentFelt,
          depositAmountCommitment: {
            x: outputCommitmentContract.x,
            y: outputCommitmentContract.y,
          },
          depositAssetId: getAssetIdForToken(outputSymbol),
          depositRangeProof: [], // Empty = optional per contract
          sourcePool,
          destPool,
        };

        const calls = buildShieldedSwapCalls(
          swapParams,
          network as NetworkType
        );

        if (abortRef.current) return null;

        setState((prev) => ({
          ...prev,
          progress: 65,
          message: "Submitting transaction to Starknet...",
        }));

        const txResponse = await sendAsync(calls);
        const txHash = txResponse.transaction_hash;

        // ================================================================
        // Stage 5: Confirm & Store (75-100%)
        // ================================================================
        setState((prev) => ({
          ...prev,
          stage: "confirming",
          progress: 75,
          message: "Waiting for transaction confirmation...",
          txHash,
        }));

        // Poll for transaction receipt
        const rpcUrl =
          NETWORK_CONFIG[network as keyof typeof NETWORK_CONFIG]?.rpcUrl;
        let confirmed = false;

        if (rpcUrl) {
          const { RpcProvider } = await import("starknet");
          const provider = new RpcProvider({ nodeUrl: rpcUrl });

          let attempts = 0;
          while (!confirmed && attempts < 60 && !abortRef.current) {
            try {
              const receipt =
                await provider.getTransactionReceipt(txHash);
              if (receipt) {
                confirmed = true;

                // Try to parse leafIndex from events
                if ("events" in receipt && Array.isArray(receipt.events)) {
                  for (const event of receipt.events) {
                    // Look for deposit event with global_index
                    if (
                      event.data &&
                      event.data.length >= 2 &&
                      event.keys?.[0]
                    ) {
                      try {
                        const leafIndex = parseInt(
                          event.data[0],
                          16
                        );
                        if (leafIndex > 0 && leafIndex < 2 ** 32) {
                          await updateNoteLeafIndex(
                            outputCommitmentFelt,
                            leafIndex
                          );
                          console.log(
                            "[ShieldedSwap] Output note leafIndex:",
                            leafIndex
                          );
                        }
                      } catch {
                        // Not the right event, continue
                      }
                    }
                  }
                }
                break;
              }
            } catch {
              // Not yet available
            }
            await new Promise((r) => setTimeout(r, 3000));
            attempts++;

            setState((prev) => ({
              ...prev,
              progress: Math.min(95, 75 + attempts),
              message: `Confirming... (attempt ${attempts}/60)`,
            }));
          }
        }

        if (confirmed) {
          // Mark input note as spent ONLY after on-chain confirmation
          await markNoteSpent(selectedNote.commitment, txHash);

          // Save the output note to IndexedDB
          const outputNote: PrivacyNote = {
            denomination:
              Number(estimatedOutputWei) / 10 ** outputDecimals,
            commitment: outputCommitmentFelt,
            nullifierSecret:
              outputNoteData.nullifierSecret.toString(),
            blinding: outputNoteData.blinding.toString(),
            leafIndex: 0, // Updated from events above or via indexer later
            depositTxHash: txHash,
            createdAt: Date.now(),
            spent: false,
            tokenSymbol: outputSymbol,
            encryptedAmount,
            encryptionRandomness: encryptionRandomness.toString(),
          };
          await saveNote(address, outputNote);

          console.log(
            "[ShieldedSwap] Swap confirmed. Input note spent, output note saved."
          );
        } else {
          console.warn(
            "[ShieldedSwap] Tx submitted but not yet confirmed. Input note NOT marked spent."
          );
        }

        // ================================================================
        // Done
        // ================================================================
        setState((prev) => ({
          ...prev,
          stage: "confirmed",
          progress: 100,
          message: confirmed
            ? "Shielded swap completed successfully!"
            : "Transaction submitted. Confirmation pending.",
          outputAmount: formatTokenAmount(
            estimate.expectedOutput,
            params.outputSymbol
          ),
        }));

        return txHash;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          stage: "error",
          error: message,
          message: `Swap failed: ${message}`,
        }));
        return null;
      }
    },
    [
      address,
      account,
      network,
      isRouterDeployed,
      hasKeys,
      publicKey,
      sendAsync,
      initializeKeys,
      unlockKeys,
    ]
  );

  return {
    state,
    executeSwap,
    estimateOutput,
    reset,
    isRouterDeployed,
    getPrivacyPoolBalance,
  };
}
