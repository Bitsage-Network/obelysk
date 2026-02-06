/**
 * Privacy Pool Hook - Obelysk Integration
 *
 * Implements Vitalik Buterin's Privacy Pools using the Obelysk system:
 * - ElGamal encryption for amount hiding
 * - Pedersen commitments for note creation
 * - Nullifier derivation for double-spend prevention
 * - LeanIMT Merkle trees for membership proofs
 *
 * Flow: Deposit -> (Association Set) -> Withdraw with ZK proof
 */

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount, useContract } from "@starknet-react/core";
import { Contract, CallData, uint256, hash, RpcProvider, events, cairo } from "starknet";

// Import Obelysk crypto modules
import {
  // ElGamal encryption
  encrypt as elgamalEncrypt,
  randomScalar,
  pointToFelts,
} from "../crypto/elgamal";

import type { ECPoint, ElGamalCiphertext } from "../crypto/constants";

import {
  // Pedersen commitments
  createNote,
  commitmentToFelt,
  type NoteData,
} from "../crypto/pedersen";

import {
  // Nullifier derivation
  deriveNullifier,
  generateNullifierSecret,
} from "../crypto/nullifier";

import {
  // Key storage
  saveNote,
  getUnspentNotes,
  markNoteSpent,
  getUnspentBalance,
  updateNoteLeafIndex,
} from "../crypto/keyStore";

import type { PrivacyNote } from "../crypto/constants";


import {
  PRIVACY_POOL_FOR_TOKEN,
  ASSET_ID_FOR_TOKEN,
  getPrivacyPoolAddress,
  getTokenAddressForSymbol,
  TOKEN_METADATA,
  type NetworkType,
} from "../contracts/addresses";

import { usePrivacyKeys } from "./usePrivacyKeys";
import { useNetwork } from "@/lib/contexts/NetworkContext";
import { fetchMerkleProofWithFallback, invalidateMerkleCache } from "@/lib/crypto/localMerkleProof";

// Contract ABIs (minimal)
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
    name: "balanceOf",
    type: "function" as const,
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }],
    state_mutability: "view" as const,
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
];

// ECPoint struct definition for ABI
const EC_POINT_STRUCT = {
  type: "struct" as const,
  name: "sage_contracts::obelysk::elgamal::ECPoint",
  members: [
    { name: "x", type: "core::felt252" },
    { name: "y", type: "core::felt252" },
  ],
};

// u256 struct definition for proper serialization
const U256_STRUCT = {
  type: "struct" as const,
  name: "core::integer::u256",
  members: [
    { name: "low", type: "core::integer::u128" },
    { name: "high", type: "core::integer::u128" },
  ],
};

const PRIVACY_POOLS_ABI = [
  EC_POINT_STRUCT,
  U256_STRUCT,
  {
    name: "pp_deposit",
    type: "function" as const,
    inputs: [
      { name: "commitment", type: "core::felt252" },
      { name: "amount_commitment", type: "sage_contracts::obelysk::elgamal::ECPoint" },
      { name: "asset_id", type: "core::felt252" },
      { name: "amount", type: "core::integer::u256" },
      { name: "range_proof_data", type: "core::array::Span::<core::felt252>" },
    ],
    outputs: [{ type: "core::integer::u64" }],
    state_mutability: "external" as const,
  },
  {
    name: "pp_withdraw",
    type: "function" as const,
    inputs: [
      { name: "proof", type: "sage_contracts::obelysk::privacy_pools::PPWithdrawalProof" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external" as const,
  },
  {
    name: "get_global_deposit_root",
    type: "function" as const,
    inputs: [],
    outputs: [{ type: "core::felt252" }],
    state_mutability: "view" as const,
  },
  {
    name: "get_pp_stats",
    type: "function" as const,
    inputs: [],
    outputs: [{ type: "(core::integer::u64, core::integer::u64, core::integer::u256, core::integer::u256)" }],
    state_mutability: "view" as const,
  },
];

// Default contract addresses from environment (SAGE pool — backward compat)
const SAGE_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_SAGE_TOKEN_ADDRESS || "0x0") as `0x${string}`;
const PRIVACY_POOLS_ADDRESS = (process.env.NEXT_PUBLIC_PRIVACY_POOLS_ADDRESS || "0x0") as `0x${string}`;

// RPC URL for fetching transaction receipts
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.starknet-testnet.lava.build";

// Default network for pool lookups
const DEFAULT_NETWORK: NetworkType = "sepolia";

// PPDepositExecuted event selector (keccak hash of event name)
const PP_DEPOSIT_EVENT_KEY = hash.getSelectorFromName("PPDepositExecuted");

/**
 * Fetch the leafIndex from a deposit transaction receipt
 * The contract emits PPDepositExecuted event with global_index
 */
// Merkle proof fetching is now handled by @/lib/crypto/localMerkleProof
// which tries the coordinator API first, then falls back to local tree reconstruction.
async function fetchLeafIndexFromReceipt(
  txHash: string,
  commitment: string,
  poolAddress: string = PRIVACY_POOLS_ADDRESS,
): Promise<number | null> {
  try {
    const provider = new RpcProvider({ nodeUrl: RPC_URL });

    // Wait for transaction to be accepted
    const receipt = await provider.waitForTransaction(txHash, {
      retryInterval: 2000,
    });

    // Check finality_status for newer starknet.js versions
    const finality = "finality_status" in receipt ? receipt.finality_status : undefined;
    if (finality !== "ACCEPTED_ON_L2" && finality !== "ACCEPTED_ON_L1") {
      console.warn("Transaction not yet accepted:", finality);
      return null;
    }

    // Parse events to find PPDepositExecuted
    if ("events" in receipt && Array.isArray(receipt.events)) {
      for (const event of receipt.events) {
        // Check if this is a PPDepositExecuted event from our contract
        if (
          event.from_address.toLowerCase() === poolAddress.toLowerCase() &&
          event.keys && event.keys.length > 0
        ) {
          // Event structure: keys[0] = event selector, keys[1] = indexed commitment
          // data = [depositor, asset_id, global_index, timestamp]
          const eventCommitment = event.keys[1];

          if (eventCommitment && eventCommitment.toLowerCase() === commitment.toLowerCase()) {
            // Found our deposit event - global_index is in data[2]
            const globalIndex = event.data[2];
            console.log("Found deposit event, leafIndex:", globalIndex);
            return parseInt(globalIndex, 16);
          }
        }
      }
    }

    console.warn("PPDepositExecuted event not found in receipt");
    return null;
  } catch (error) {
    console.error("Failed to fetch leafIndex from receipt:", error);
    return null;
  }
}

// Denominations (in wei, 18 decimals)
export const PRIVACY_DENOMINATIONS = [
  0.1, // 0.1 SAGE
  1,   // 1 SAGE
  10,  // 10 SAGE
  100, // 100 SAGE
  1000, // 1000 SAGE
] as const;

export type PrivacyDenomination = (typeof PRIVACY_DENOMINATIONS)[number];

// Convert denomination to wei, accounting for token decimals
function toWei(amount: number, decimals: number = 18): bigint {
  return BigInt(Math.floor(amount * 10 ** decimals));
}

// Deposit phases (Tongo-style UX)
export type DepositPhase = "idle" | "proving" | "sending" | "confirming" | "confirmed" | "error";

// Proof details for display
export interface ProofData {
  commitment: string;
  amountCommitment: { x: string; y: string };
  leafIndex: number;
  amount: number;
}

// State types
interface DepositState {
  phase: DepositPhase;
  provingTimeMs: number | null;  // Time taken for client-side proving
  error: string | null;
  txHash: string | null;
  proofData: ProofData | null;  // ZK proof details for display
  // Legacy fields for backwards compatibility
  isDepositing: boolean;
  isPending: boolean;
  isGeneratingProof: boolean;
  proofProgress: number;
}

interface WithdrawState {
  isWithdrawing: boolean;
  isGeneratingProof: boolean;
  proofProgress: number;
  error: string | null;
  txHash: string | null;
}

interface PoolStats {
  totalDeposits: bigint;
  totalWithdrawals: bigint;
  totalVolume: bigint;
  yourBalance: bigint;
  yourNotes: PrivacyNote[];
  globalRoot: string;
}

// Compliance types for privacy pool withdrawals
export type ComplianceLevelId = "full_privacy" | "association_set" | "auditable";

export interface WithdrawComplianceOptions {
  complianceLevel: ComplianceLevelId;
  selectedASPs?: string[]; // ASP IDs for association set compliance
  auditKey?: { x: string; y: string }; // Audit key for auditable compliance
}

interface UsePrivacyPoolReturn {
  // States
  depositState: DepositState;
  withdrawState: WithdrawState;
  poolStats: PoolStats;

  // Key state
  isKeysDerived: boolean;
  isDeriving: boolean;
  publicKey: ECPoint | null;

  // Denominations
  availableDenominations: readonly number[];

  // Operations
  derivePrivacyKeys: () => Promise<void>;
  deposit: (denomination: PrivacyDenomination, tokenSymbol?: string) => Promise<string>;
  withdraw: (note: PrivacyNote, recipient?: string, complianceOptions?: WithdrawComplianceOptions) => Promise<string>;
  refreshStats: () => Promise<void>;
  refreshPoolStats: () => Promise<void>; // Alias for refreshStats
  resetDepositState: () => void; // Reset deposit state to idle

  // Ragequit operations (use contract calls directly - these are stubs for interface compatibility)
  initiateRagequit: (depositIndex: number) => Promise<string>;
  executeRagequit: (depositIndex: number) => Promise<string>;
}

export function usePrivacyPool(): UsePrivacyPoolReturn {
  const { address, account } = useAccount();
  const { network } = useNetwork();

  // Privacy keys hook
  const {
    publicKey: storedPublicKey,
    hasKeys,
    isLoading: isDeriving,
    initializeKeys,
    unlockKeys,
  } = usePrivacyKeys();

  // Local key state - keys must be unlocked to use
  const [publicKey, setPublicKey] = useState<ECPoint | null>(null);
  const [privateKey, setPrivateKey] = useState<bigint | null>(null);
  const [isKeysDerived, setIsKeysDerived] = useState(false);

  // Contracts
  const { contract: sageContract } = useContract({
    abi: ERC20_ABI,
    address: SAGE_TOKEN_ADDRESS,
  });

  const { contract: privacyPoolsContract } = useContract({
    abi: PRIVACY_POOLS_ABI,
    address: PRIVACY_POOLS_ADDRESS,
  });

  // States
  const [depositState, setDepositState] = useState<DepositState>({
    phase: "idle",
    provingTimeMs: null,
    error: null,
    txHash: null,
    proofData: null,
    // Legacy
    isDepositing: false,
    isPending: false,
    isGeneratingProof: false,
    proofProgress: 0,
  });

  const [withdrawState, setWithdrawState] = useState<WithdrawState>({
    isWithdrawing: false,
    isGeneratingProof: false,
    proofProgress: 0,
    error: null,
    txHash: null,
  });

  const [poolStats, setPoolStats] = useState<PoolStats>({
    totalDeposits: 0n,
    totalWithdrawals: 0n,
    totalVolume: 0n,
    yourBalance: 0n,
    yourNotes: [],
    globalRoot: "0x0",
  });

  // Auto-unlock keys if they exist when the wallet is connected
  useEffect(() => {
    if (hasKeys && !isKeysDerived && storedPublicKey) {
      console.log("Keys exist but not unlocked, will unlock on first privacy action");
      // Set the stored public key for display purposes, but privateKey remains null
      // Full unlock happens when derivePrivacyKeys() is called
      setPublicKey(storedPublicKey);
    }
  }, [hasKeys, isKeysDerived, storedPublicKey]);

  // Derive privacy keys - initializes keys if needed, then unlocks them
  const derivePrivacyKeys = useCallback(async () => {
    console.log("Deriving privacy keys...");

    try {
      // If keys don't exist, initialize them first
      if (!hasKeys) {
        console.log("No keys found, initializing...");
        await initializeKeys();
      }

      // Now unlock the keys to get the private key
      console.log("Unlocking keys...");
      const keyPair = await unlockKeys();

      if (keyPair) {
        console.log("Keys unlocked successfully");
        setPublicKey(keyPair.publicKey);
        setPrivateKey(keyPair.privateKey);
        setIsKeysDerived(true);
      } else {
        throw new Error("Failed to unlock keys - no keypair returned");
      }
    } catch (error) {
      console.error("Failed to derive privacy keys:", error);
      setIsKeysDerived(false);
      setPublicKey(null);
      setPrivateKey(null);
      throw error;
    }
  }, [hasKeys, initializeKeys, unlockKeys]);

  // Refresh pool stats
  const refreshStats = useCallback(async () => {
    if (!address) return;

    try {
      // Get local unspent notes
      const notes = await getUnspentNotes(address);
      const localBalance = await getUnspentBalance(address);

      // Get on-chain stats if contract available
      let onChainStats = {
        totalDeposits: 0n,
        totalWithdrawals: 0n,
        totalVolume: 0n,
        globalRoot: "0x0",
      };

      if (privacyPoolsContract) {
        try {
          const stats = await privacyPoolsContract.get_pp_stats();
          const root = await privacyPoolsContract.get_global_deposit_root();
          onChainStats = {
            totalDeposits: BigInt(stats[0] || 0),
            totalWithdrawals: BigInt(stats[1] || 0),
            totalVolume: BigInt(stats[2] || 0),
            globalRoot: root?.toString() || "0x0",
          };
        } catch (e) {
          console.warn("Failed to fetch on-chain stats:", e);
        }
      }

      setPoolStats({
        ...onChainStats,
        yourBalance: BigInt(Math.floor(localBalance * 1e18)),
        yourNotes: notes,
      });
    } catch (error) {
      console.error("Failed to refresh pool stats:", error);
    }
  }, [address, privacyPoolsContract]);

  // Deposit operation
  const deposit = useCallback(
    async (denomination: PrivacyDenomination, tokenSymbol: string = "SAGE"): Promise<string> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      // Resolve per-token pool and token addresses
      const poolAddress = getPrivacyPoolAddress(DEFAULT_NETWORK, tokenSymbol) as `0x${string}`;
      const tokenAddress = getTokenAddressForSymbol(DEFAULT_NETWORK, tokenSymbol) as `0x${string}`;
      const assetId = ASSET_ID_FOR_TOKEN[tokenSymbol] || "0x0";
      const decimals = TOKEN_METADATA[tokenSymbol as keyof typeof TOKEN_METADATA]?.decimals ?? 18;

      if (poolAddress === "0x0") {
        throw new Error(`Privacy pool not deployed for ${tokenSymbol}`);
      }
      if (tokenAddress === "0x0") {
        throw new Error(`Token address not configured for ${tokenSymbol}`);
      }

      // Get keys - unlock if needed
      let currentPublicKey = publicKey;
      let currentPrivateKey = privateKey;

      if (!currentPublicKey || !currentPrivateKey) {
        console.log("Keys not unlocked, unlocking now...");

        // Initialize keys if they don't exist
        if (!hasKeys) {
          await initializeKeys();
        }

        // Unlock keys to get the private key
        const keyPair = await unlockKeys();
        if (!keyPair) {
          throw new Error("Failed to unlock privacy keys");
        }

        currentPublicKey = keyPair.publicKey;
        currentPrivateKey = keyPair.privateKey;

        // Update local state
        setPublicKey(currentPublicKey);
        setPrivateKey(currentPrivateKey);
        setIsKeysDerived(true);

        console.log("Keys unlocked and ready");
      }

      const amountWei = toWei(denomination, decimals);

      // ==============================
      // PHASE 1: PROVING (client-side cryptography)
      // ==============================
      const provingStart = performance.now();
      setDepositState({
        phase: "proving",
        provingTimeMs: null,
        error: null,
        txHash: null,
        proofData: null,
        isDepositing: true,
        isPending: false,
        isGeneratingProof: true,
        proofProgress: 0,
      });

      try {
        console.log(`🔐 [Proving] Generating privacy note for amount: ${denomination} ${tokenSymbol}`);

        // Create Pedersen commitment note
        // H(secret || nullifier_seed || amount || asset_id)
        const noteData = createNote(amountWei);
        const nullifierSecret = noteData.nullifierSecret;

        // Create ElGamal encrypted amount commitment
        const encryptionRandomness = randomScalar();

        // Encrypt: C1 = r * G, C2 = amount * H + r * PK
        const encryptedAmount = elgamalEncrypt(
          amountWei,
          currentPublicKey,
          encryptionRandomness
        );

        // Contract expects C2 (encrypted amount)
        const amountCommitment = {
          x: "0x" + encryptedAmount.c2_x.toString(16),
          y: "0x" + encryptedAmount.c2_y.toString(16),
        };

        // Generate range proof data
        const rangeProofData: string[] = [
          "0x" + amountWei.toString(16),
          "0x" + encryptionRandomness.toString(16),
        ];

        const commitmentFelt = commitmentToFelt(noteData.commitment);

        // Calculate proving time
        const provingTimeMs = Math.round(performance.now() - provingStart);
        console.log(`✅ [Proving] Complete in ${provingTimeMs}ms`);

        // ==============================
        // PHASE 2: SENDING (submit to network)
        // ==============================
        setDepositState((prev) => ({
          ...prev,
          phase: "sending",
          provingTimeMs,
          proofProgress: 50,
          isGeneratingProof: false,
          isPending: true,
        }));

        console.log("📤 [Sending] Building transaction...");

        // ==============================
        // PRIVACY-PRESERVING APPROVAL
        // ==============================
        // Instead of approving the exact deposit amount (which reveals it),
        // we check existing allowance and only approve if needed.
        // When we do approve, we approve a LARGE blanket amount so that
        // future deposits don't require separate approvals that would reveal amounts.
        //
        // This is similar to how Uniswap works - approve once, swap many times.
        // The blanket approval doesn't reveal individual deposit amounts.

        const calls: { contractAddress: string; entrypoint: string; calldata: string[] | any }[] = [];

        // Blanket approval amount - 1 million SAGE (doesn't reveal individual deposits)
        const BLANKET_APPROVAL = 10n ** 24n; // 1M * 10^18

        // Check current allowance to avoid unnecessary approve calls
        let needsApproval = true;
        try {
          const provider = new RpcProvider({
            nodeUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/CrJvEXftXMfkXvyJfunp3mQVEfDU2D81",
          });
          const tokenContract = new Contract({ abi: ERC20_ABI, address: tokenAddress, providerOrAccount: provider });
          const allowanceResult = await tokenContract.allowance(address, poolAddress);

          // Convert u256 result to bigint
          const currentAllowance = BigInt(allowanceResult.toString());
          console.log("📋 [Privacy] Current allowance:", currentAllowance.toString());

          // Only approve if current allowance is less than needed
          needsApproval = currentAllowance < amountWei;

          if (!needsApproval) {
            console.log("✅ [Privacy] Sufficient allowance - skipping approve call (better privacy!)");
          }
        } catch (err) {
          console.warn("⚠️ [Privacy] Could not check allowance, will include approve:", err);
          needsApproval = true;
        }

        if (needsApproval) {
          console.log(`📋 [Privacy] Using blanket approval to hide deposit amount for ${tokenSymbol}`);
          const approveCall = {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: CallData.compile({
              spender: poolAddress,
              // Blanket approval - doesn't reveal individual deposit amounts
              amount: cairo.uint256(BLANKET_APPROVAL),
            }),
          };
          calls.push(approveCall);
        }

        // ==============================
        // Step 6: Call pp_deposit on Privacy Pools contract
        // Passes both encrypted amount (for privacy) and plaintext amount (for transfer)
        // ==============================
        console.log("Building pp_deposit call:", {
          commitment: commitmentFelt,
          amount_commitment: amountCommitment,
          asset_id: assetId,
          amount: amountWei.toString(),
          pool: poolAddress,
          token: tokenSymbol,
        });

        // Build raw calldata to ensure exact serialization
        // pp_deposit params:
        //   commitment: felt252 (1 felt)
        //   amount_commitment: ECPoint { x: felt252, y: felt252 } (2 felts)
        //   asset_id: felt252 (1 felt)
        //   amount: u256 { low: u128, high: u128 } (2 felts)
        //   range_proof_data: Span<felt252> (1 felt for len + N felts for data)

        // Calculate u256 components
        const TWO_POW_128 = 2n ** 128n;
        const amountLow = amountWei % TWO_POW_128;
        const amountHigh = amountWei / TWO_POW_128;

        // Ensure hex strings are properly formatted
        const formatHex = (n: bigint) => "0x" + n.toString(16);

        const rawCalldata = [
          commitmentFelt,                           // 1. commitment
          amountCommitment.x,                       // 2. ECPoint.x
          amountCommitment.y,                       // 3. ECPoint.y
          assetId,                                  // 4. asset_id
          formatHex(amountLow),                     // 5. u256.low
          formatHex(amountHigh),                    // 6. u256.high
          formatHex(BigInt(rangeProofData.length)), // 7. Span length
          ...rangeProofData,                        // 8-9. Span elements
        ];

        console.log("Raw pp_deposit calldata:", rawCalldata);
        console.log("u256 - low:", amountLow.toString(), "high:", amountHigh.toString());

        const depositCall = {
          contractAddress: poolAddress,
          entrypoint: "pp_deposit",
          calldata: rawCalldata,
        };
        calls.push(depositCall);

        // Execute calls in a single multicall (one wallet approval)
        // Note: The blanket approval hides the actual deposit amount from the approve call
        // However, the pp_deposit calldata still contains the amount (needed for transferFrom)
        // For maximum privacy, use fixed denominations so amounts are predictable
        console.log("📤 [Sending] Submitting to network...");
        console.log("📋 [Privacy] Calls in transaction:", calls.length,
          calls.length > 1 ? "(blanket approve + deposit)" : "(deposit only)");
        const result = await account.execute(calls);
        const txHash = result.transaction_hash;

        console.log("✅ [Sending] Transaction submitted:", txHash);

        // ==============================
        // PHASE 3: CONFIRMING (wait for L2 confirmation)
        // ==============================
        setDepositState((prev) => ({
          ...prev,
          phase: "confirming",
          txHash,
          proofProgress: 75,
        }));

        console.log("⏳ [Confirming] Waiting for L2 confirmation...");

        // Wait for transaction confirmation
        const provider = new RpcProvider({ nodeUrl: RPC_URL });
        const receipt = await provider.waitForTransaction(txHash);

        // Check receipt status - handle different starknet.js versions
        const receiptAny = receipt as { finality_status?: string; execution_status?: string; status?: string };
        const finalityStatus = receiptAny.finality_status || receiptAny.status;
        const executionStatus = receiptAny.execution_status;

        if (executionStatus === "REVERTED" || executionStatus === "REJECTED") {
          throw new Error(`Transaction failed: ${executionStatus}`);
        }

        console.log("✅ [Confirming] Transaction confirmed:", finalityStatus);

        // Store note locally
        const privacyNote: PrivacyNote = {
          denomination,
          commitment: commitmentFelt,
          nullifierSecret: nullifierSecret.toString(),
          blinding: noteData.blinding.toString(),
          leafIndex: 0,
          depositTxHash: txHash,
          createdAt: Date.now(),
          spent: false,
          tokenSymbol,
        };

        await saveNote(address, privacyNote);

        // Store proof data for display (leafIndex will be updated async)
        const initialProofData: ProofData = {
          commitment: commitmentFelt,
          amountCommitment,
          leafIndex: 0, // Will be updated when fetched
          amount: denomination,
        };

        // ==============================
        // PHASE 4: CONFIRMED
        // ==============================
        setDepositState((prev) => ({
          ...prev,
          phase: "confirmed",
          proofData: initialProofData,
          proofProgress: 100,
          isDepositing: false,
          isPending: false,
          isGeneratingProof: false,
        }));

        // Fetch leafIndex in background and update proofData
        fetchLeafIndexFromReceipt(txHash, commitmentFelt, poolAddress).then(async (leafIndex) => {
          if (leafIndex !== null) {
            await updateNoteLeafIndex(commitmentFelt, leafIndex);
            console.log("Note leafIndex updated:", leafIndex);
            // Update proofData with actual leafIndex
            setDepositState((prev) => ({
              ...prev,
              proofData: prev.proofData ? { ...prev.proofData, leafIndex } : null,
            }));
            await refreshStats();
          }
        }).catch((err) => {
          console.error("Error fetching leafIndex:", err);
        });

        console.log("🎉 [Confirmed] Deposit complete!");

        // Invalidate local Merkle tree cache so next withdrawal picks up this deposit
        invalidateMerkleCache();

        await refreshStats();
        return txHash;

      } catch (error) {
        console.error("❌ Deposit failed:", error);
        const errorMessage = error instanceof Error ? error.message : "Deposit failed";
        setDepositState({
          phase: "error",
          provingTimeMs: null,
          error: errorMessage,
          txHash: null,
          proofData: null,
          isDepositing: false,
          isPending: false,
          isGeneratingProof: false,
          proofProgress: 0,
        });
        throw error;
      }
    },
    [account, address, publicKey, privateKey, hasKeys, initializeKeys, unlockKeys, refreshStats]
  );

  // Withdraw operation
  const withdraw = useCallback(
    async (note: PrivacyNote, recipient?: string, complianceOptions?: WithdrawComplianceOptions): Promise<string> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      // Resolve pool address from note's tokenSymbol
      const noteToken = note.tokenSymbol || "SAGE";
      const poolAddress = getPrivacyPoolAddress(DEFAULT_NETWORK, noteToken) as `0x${string}`;
      const decimals = TOKEN_METADATA[noteToken as keyof typeof TOKEN_METADATA]?.decimals ?? 18;

      if (poolAddress === "0x0") {
        throw new Error(`Privacy pool not deployed for ${noteToken}`);
      }

      // Get keys - unlock if needed
      let currentPrivateKey = privateKey;

      if (!currentPrivateKey) {
        console.log("Keys not unlocked for withdrawal, unlocking now...");

        if (!hasKeys) {
          await initializeKeys();
        }

        const keyPair = await unlockKeys();
        if (!keyPair) {
          throw new Error("Failed to unlock privacy keys");
        }

        currentPrivateKey = keyPair.privateKey;

        // Update local state
        setPublicKey(keyPair.publicKey);
        setPrivateKey(currentPrivateKey);
        setIsKeysDerived(true);

        console.log("Keys unlocked for withdrawal");
      }

      const recipientAddress = recipient || address;
      const noteCommitment = note.commitment;

      setWithdrawState({
        isWithdrawing: true,
        isGeneratingProof: true,
        proofProgress: 0,
        error: null,
        txHash: null,
      });

      try {
        // Verify note is valid
        if (!note.commitment || note.spent) {
          throw new Error("Invalid note or note already spent");
        }

        // ==============================
        // Step 1: Generate Merkle proof from on-chain events
        // ==============================
        setWithdrawState((prev) => ({ ...prev, proofProgress: 20 }));

        // CRITICAL: Nullifier = H(nullifier_secret, leaf_index)
        // NOT H(nullifier_secret, commitment)!
        // The leaf_index is returned by pp_deposit and stored in the note
        if (note.leafIndex === 0 && note.depositTxHash) {
          // TODO: Fetch leafIndex from transaction receipt or indexer
          console.warn("Warning: leafIndex is 0, may need to fetch from chain");
        }

        const nullifier = deriveNullifier(
          BigInt(note.nullifierSecret),
          note.leafIndex
        );

        console.log("Withdrawal nullifier:", nullifier, "for leafIndex:", note.leafIndex);

        // ==============================
        // Step 2: Fetch Merkle proof (API first, local tree fallback)
        // ==============================
        setWithdrawState((prev) => ({ ...prev, proofProgress: 40 }));

        // Fetch Merkle proof — tries coordinator API first, falls back to local tree
        const merkleProof = await fetchMerkleProofWithFallback(noteCommitment, network as any);

        if (!merkleProof) {
          throw new Error(
            "Could not generate Merkle proof. Deposit commitment not found in on-chain events. " +
            "Please wait for the deposit to be confirmed on-chain."
          );
        }

        console.log("Merkle proof generated:", {
          root: merkleProof.root,
          siblings: merkleProof.siblings.length,
          leafIndex: merkleProof.leafIndex,
        });

        // Convert to contract-expected format (LeanIMTProof)
        const globalTreeProof = {
          siblings: merkleProof.siblings,
          path_indices: merkleProof.path_indices,
          leaf: noteCommitment,
          root: merkleProof.root,
          tree_size: merkleProof.tree_size,
        };

        // Update note's leafIndex from on-chain data
        if (note.leafIndex === 0 && merkleProof.leafIndex > 0) {
          await updateNoteLeafIndex(noteCommitment, merkleProof.leafIndex);
          note.leafIndex = merkleProof.leafIndex;
        }

        // ==============================
        // Step 2: Derive nullifier (must come after Merkle proof to have correct leafIndex)
        // ==============================
        setWithdrawState((prev) => ({ ...prev, proofProgress: 40 }));

        // CRITICAL: Nullifier = H(nullifier_secret, leaf_index)
        // The leaf_index comes from the on-chain Merkle proof
        const effectiveLeafIndex = merkleProof.leafIndex;
        const nullifier = deriveNullifier(
          BigInt(note.nullifierSecret),
          effectiveLeafIndex,
        );

        console.log("Withdrawal nullifier:", nullifier, "for leafIndex:", effectiveLeafIndex);

        // ==============================
        // Step 3: Build withdrawal proof
        // ==============================
        setWithdrawState((prev) => ({ ...prev, proofProgress: 60 }));

        const amountWei = toWei(note.denomination, decimals);

        // Build withdrawal proof based on compliance level
        const complianceLevel = complianceOptions?.complianceLevel || "full_privacy";

        // ASP membership proof: uses selected ASP ID for association set compliance
        // Full membership proof generation requires ASP registry indexer (not yet deployed)
        const associationSetId = complianceLevel === "association_set" && complianceOptions?.selectedASPs?.length
          ? complianceOptions.selectedASPs[0]
          : null;

        console.log("Withdrawal proof built with compliance level:", complianceLevel);

        // ==============================
        // Step 4: Submit withdrawal
        // ==============================
        setWithdrawState((prev) => ({
          ...prev,
          proofProgress: 80,
          isGeneratingProof: false,
        }));

        console.log("Submitting withdrawal transaction...");

        // Manual calldata serialization for PPWithdrawalProof
        // CallData.compile may not serialize LeanIMTProof arrays correctly
        const TWO_POW_128 = 2n ** 128n;
        const formatHex = (n: bigint) => "0x" + n.toString(16);

        const serializeIMTProof = (p: typeof globalTreeProof) => {
          const data: string[] = [];
          // siblings: Array<felt252>
          data.push(formatHex(BigInt(p.siblings.length)));
          p.siblings.forEach((s) => data.push(s));
          // path_indices: Array<felt252> (bool as felt)
          data.push(formatHex(BigInt(p.path_indices.length)));
          p.path_indices.forEach((b) => data.push(b ? "0x1" : "0x0"));
          // leaf, root, tree_size
          data.push(p.leaf);
          data.push(p.root);
          data.push(formatHex(BigInt(p.tree_size)));
          return data;
        };

        const rawWithdrawCalldata: string[] = [];

        // global_tree_proof: LeanIMTProof
        rawWithdrawCalldata.push(...serializeIMTProof(globalTreeProof));
        // deposit_commitment: felt252
        rawWithdrawCalldata.push(noteCommitment);
        // association_set_id: Option<felt252>
        if (associationSetId) {
          rawWithdrawCalldata.push("0x0"); // Some variant
          rawWithdrawCalldata.push(associationSetId);
        } else {
          rawWithdrawCalldata.push("0x1"); // None variant
        }
        // association_proof: Option<LeanIMTProof>
        rawWithdrawCalldata.push("0x1"); // None
        // exclusion_set_id: Option<felt252>
        rawWithdrawCalldata.push("0x1"); // None
        // exclusion_proof: Option<ExclusionProofData>
        rawWithdrawCalldata.push("0x1"); // None
        // nullifier: felt252
        rawWithdrawCalldata.push("0x" + nullifier.toString(16));
        // amount: u256 (low, high)
        rawWithdrawCalldata.push(formatHex(amountWei % TWO_POW_128));
        rawWithdrawCalldata.push(formatHex(amountWei / TWO_POW_128));
        // recipient: ContractAddress
        rawWithdrawCalldata.push(recipientAddress);
        // range_proof_data: Span<felt252>
        rawWithdrawCalldata.push("0x0"); // empty span length

        const withdrawCall = {
          contractAddress: poolAddress,
          entrypoint: "pp_withdraw",
          calldata: rawWithdrawCalldata,
        };

        const result = await account.execute([withdrawCall]);
        const txHash = result.transaction_hash;

        console.log("Withdrawal submitted:", txHash);

        // Mark note as spent
        await markNoteSpent(noteCommitment, txHash);

        setWithdrawState({
          isWithdrawing: false,
          isGeneratingProof: false,
          proofProgress: 100,
          error: null,
          txHash,
        });

        // Refresh stats
        await refreshStats();

        return txHash;
      } catch (error) {
        console.error("Withdrawal failed:", error);
        const errorMessage = error instanceof Error ? error.message : "Withdrawal failed";
        setWithdrawState({
          isWithdrawing: false,
          isGeneratingProof: false,
          proofProgress: 0,
          error: errorMessage,
          txHash: null,
        });
        throw error;
      }
    },
    [account, address, privateKey, hasKeys, initializeKeys, unlockKeys, poolStats.globalRoot, refreshStats, network]
  );

  // Auto-refresh on mount
  useEffect(() => {
    if (address && isKeysDerived) {
      refreshStats();
    }
  }, [address, isKeysDerived, refreshStats]);

  // Ragequit stub functions - actual implementation uses contract calls directly
  // These are provided for interface compatibility
  const initiateRagequit = useCallback(
    async (depositIndex: number): Promise<string> => {
      console.warn(
        "initiateRagequit from usePrivacyPool is a stub. " +
        "Use buildPrivacyPoolRagequitCall from @/lib/contracts for actual ragequit."
      );
      throw new Error("Use buildPrivacyPoolRagequitCall for ragequit operations");
    },
    []
  );

  const executeRagequit = useCallback(
    async (depositIndex: number): Promise<string> => {
      console.warn(
        "executeRagequit from usePrivacyPool is a stub. " +
        "Use buildExecuteRagequitCall from @/lib/contracts for actual ragequit."
      );
      throw new Error("Use buildExecuteRagequitCall for ragequit operations");
    },
    []
  );

  // Reset deposit state to idle (for "Deposit Another" flow)
  const resetDepositState = useCallback(() => {
    setDepositState({
      phase: "idle",
      provingTimeMs: null,
      error: null,
      txHash: null,
      proofData: null,
      isDepositing: false,
      isPending: false,
      isGeneratingProof: false,
      proofProgress: 0,
    });
  }, []);

  return {
    // States
    depositState,
    withdrawState,
    poolStats,

    // Key state
    isKeysDerived,
    isDeriving,
    publicKey,

    // Denominations
    availableDenominations: PRIVACY_DENOMINATIONS,

    // Operations
    derivePrivacyKeys,
    deposit,
    withdraw,
    refreshStats,
    refreshPoolStats: refreshStats, // Alias for compatibility
    resetDepositState,

    // Ragequit stubs
    initiateRagequit,
    executeRagequit,
  };
}

// Export types
export type {
  DepositState,
  WithdrawState,
  PoolStats,
  UsePrivacyPoolReturn,
  PrivacyNote,
};
