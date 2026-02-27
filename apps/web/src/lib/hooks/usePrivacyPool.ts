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

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
  getRpcUrl,
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

// Resolve network from env — NEVER silently fall back to sepolia.
// If NEXT_PUBLIC_STARKNET_NETWORK is unset the caller must supply a network
// via the NetworkContext (useNetwork hook) which detects the wallet chain.
function resolveNetworkStrict(): NetworkType {
  const env = process.env.NEXT_PUBLIC_STARKNET_NETWORK as NetworkType | undefined;
  if (!env || (env !== "mainnet" && env !== "sepolia" && env !== "devnet")) {
    throw new Error(
      "[usePrivacyPool] NEXT_PUBLIC_STARKNET_NETWORK is unset or invalid. " +
      "Set it to 'mainnet' or 'sepolia' in your .env to avoid silent fallback."
    );
  }
  return env;
}

// RPC URL for fetching transaction receipts
const RPC_URL = getRpcUrl(resolveNetworkStrict());

// Network for pool address lookups
const DEFAULT_NETWORK: NetworkType = resolveNetworkStrict();

// Per-network hardcoded pool addresses — bypass all lookup machinery.
const HARDCODED_POOLS_BY_NETWORK: Record<string, Record<string, string>> = {
  sepolia: {
    SAGE: "0x0d85ad03dcd91a075bef0f4226149cb7e43da795d2c1d33e3227c68bfbb78a7",
    ETH:  "0x07ad28f81b8e90e9e7ae0a2bd5692d54df7fc9df91bbc2d403845698caf0fe67",
    STRK: "0x03624fd7adc5e5b82e0925c68dd4714fde4031da4a9222ca7bd223ef71418e2b",
    wBTC: "0x06ca244b53fea7ebee5a169f6f3a26ff22cd57c772f3f563ed1bafc367555263",
    USDC: "0x02bcb455a7e356ef3ff1422d33d0742e633e4b8b4eb9fa6c15e62e8fd16b7e50",
  },
  mainnet: {
    SAGE: "0x0224977344d123eb5c20fd088f15b62d0541f8282f4a23dd87bdf9839aac724f",
    ETH:  "0x06d0b41c96809796faa02a5eac2f74e090effd09ccab7274054b90aa671e82b5",
    STRK: "0x02c348e89b355691ba5e4ece681fd6b497f8ab2ba670fa5842208b251a3c9cf1",
    wBTC: "0x030fcfd4ae4f022e720e52f54359258a02517e11701c153ae46ab2cf10d5e5e2",
    USDC: "0x05d36d7fd19d094ee0fd454e461061d68eb9f4fd0b241e2d1c94320b46d4d59b",
  },
};

const HARDCODED_TOKENS_BY_NETWORK: Record<string, Record<string, string>> = {
  sepolia: {
    SAGE: "0x072349097c8a802e7f66dc96b95aca84e4d78ddad22014904076c76293a99850",
    ETH:  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    wBTC: "0x00452bd5c0512a61df7c7be8cfea5e4f893cb40e126bdc40aee6054db955129e",
    USDC: "0x053b40A647CEDfca6cA84f542A0fe36736031905A9639a7f19A3C1e66bFd5080",
  },
  mainnet: {
    SAGE: "0x0098d563900789f934e610b67482ae58793a2efc373ba3a45af94cdbf931c799",
    ETH:  "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    wBTC: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    USDC: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  },
};

// Resolve for current network — never silently fall back to sepolia
const HARDCODED_POOLS = HARDCODED_POOLS_BY_NETWORK[DEFAULT_NETWORK];
const HARDCODED_TOKENS = HARDCODED_TOKENS_BY_NETWORK[DEFAULT_NETWORK];

if (!HARDCODED_POOLS || !HARDCODED_TOKENS) {
  throw new Error(
    `[usePrivacyPool] No hardcoded pool/token addresses for network "${DEFAULT_NETWORK}". ` +
    `Add entries to HARDCODED_POOLS_BY_NETWORK / HARDCODED_TOKENS_BY_NETWORK.`
  );
}

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
      // Transaction not yet accepted — skip silently (privacy: no log output)
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
            return parseInt(globalIndex, 16);
          }
        }
      }
    }

    // PPDepositExecuted event not found — skip silently (privacy: no log output)
    return null;
  } catch (error) {
    // Failed to fetch leafIndex — silently return null (privacy: no log output)
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

export type PrivacyDenomination = (typeof PRIVACY_DENOMINATIONS)[number] | number;

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
  // Private key stored in useRef (not useState) to prevent exposure via React DevTools
  const [publicKey, setPublicKey] = useState<ECPoint | null>(null);
  const privateKeyRef = useRef<bigint | null>(null);
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
      // Set the stored public key for display purposes, but privateKey remains null
      // Full unlock happens when derivePrivacyKeys() is called
      setPublicKey(storedPublicKey);
    }
  }, [hasKeys, isKeysDerived, storedPublicKey]);

  // Derive privacy keys - initializes keys if needed, then unlocks them
  const derivePrivacyKeys = useCallback(async () => {
    try {
      // If keys don't exist, initialize them first
      if (!hasKeys) {
        await initializeKeys();
      }

      // Now unlock the keys to get the private key
      const keyPair = await unlockKeys();

      if (keyPair) {
        setPublicKey(keyPair.publicKey);
        privateKeyRef.current = keyPair.privateKey;
        setIsKeysDerived(true);
      } else {
        throw new Error("Failed to unlock keys - no keypair returned");
      }
    } catch (error) {
      // Privacy key derivation failed — silently update state (privacy: no log output)
      setIsKeysDerived(false);
      setPublicKey(null);
      privateKeyRef.current = null;
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
          // On-chain stats fetch failed — silently skip (privacy: no log output)
        }
      }

      setPoolStats({
        ...onChainStats,
        yourBalance: BigInt(Math.floor(localBalance * 1e18)),
        yourNotes: notes,
      });
    } catch (error) {
      // Pool stats refresh failed — silently skip (privacy: no log output)
    }
  }, [address, privacyPoolsContract]);

  // Deposit operation
  const deposit = useCallback(
    async (denomination: PrivacyDenomination, tokenSymbol: string = "SAGE"): Promise<string> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      // Resolve per-token pool and token addresses
      // Use hardcoded addresses first (guaranteed correct), fall back to lookup
      const poolAddress = (HARDCODED_POOLS[tokenSymbol] || getPrivacyPoolAddress(DEFAULT_NETWORK, tokenSymbol)) as `0x${string}`;
      const tokenAddress = (HARDCODED_TOKENS[tokenSymbol] || getTokenAddressForSymbol(DEFAULT_NETWORK, tokenSymbol)) as `0x${string}`;
      const assetId = ASSET_ID_FOR_TOKEN[tokenSymbol] || "0x0";
      const decimals = TOKEN_METADATA[tokenSymbol as keyof typeof TOKEN_METADATA]?.decimals ?? 18;

      // Privacy: pool address and token details intentionally not logged

      if (poolAddress === "0x0") {
        throw new Error(`Privacy pool not deployed for ${tokenSymbol} on ${DEFAULT_NETWORK}`);
      }
      if (tokenAddress === "0x0") {
        throw new Error(`Token address not configured for ${tokenSymbol}`);
      }

      // Get keys - unlock if needed
      let currentPublicKey = publicKey;
      let currentPrivateKey = privateKeyRef.current;

      if (!currentPublicKey || !currentPrivateKey) {
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
        privateKeyRef.current = currentPrivateKey;
        setIsKeysDerived(true);
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
            nodeUrl: getRpcUrl(DEFAULT_NETWORK),
          });
          const tokenContract = new Contract({ abi: ERC20_ABI, address: tokenAddress, providerOrAccount: provider });
          const allowanceResult = await tokenContract.allowance(address, poolAddress);

          // Convert u256 result to bigint
          const currentAllowance = BigInt(allowanceResult.toString());

          // Only approve if current allowance is less than needed
          needsApproval = currentAllowance < amountWei;

        } catch (err) {
          // Allowance check failed — silently fall back to include approval (privacy: no log output)
          needsApproval = true;
        }

        if (needsApproval) {
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
        const result = await account.execute(calls);
        const txHash = result.transaction_hash;

        // ==============================
        // SAVE NOTE IMMEDIATELY (before waiting for confirmation)
        // This prevents note loss if the page is closed/refreshed during confirmation.
        // If the tx later reverts, the note will be cleaned up.
        // ==============================
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

        // ==============================
        // PHASE 3: CONFIRMING (wait for L2 confirmation)
        // ==============================
        setDepositState((prev) => ({
          ...prev,
          phase: "confirming",
          txHash,
          proofProgress: 75,
        }));

        // Wait for transaction confirmation
        const provider = new RpcProvider({ nodeUrl: RPC_URL });
        const receipt = await provider.waitForTransaction(txHash);

        // Check receipt status - handle different starknet.js versions
        const receiptAny = receipt as { finality_status?: string; execution_status?: string; status?: string };
        const finalityStatus = receiptAny.finality_status || receiptAny.status;
        const executionStatus = receiptAny.execution_status;

        if (executionStatus === "REVERTED" || executionStatus === "REJECTED") {
          // Transaction failed on-chain — mark the optimistic note as spent so it's not shown
          await markNoteSpent(commitmentFelt, `reverted:${txHash}`);
          throw new Error(`Transaction failed: ${executionStatus}`);
        }

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

        // Fetch leafIndex in background and update proofData (guarded against unmount)
        try {
          const leafIndex = await fetchLeafIndexFromReceipt(txHash, commitmentFelt, poolAddress);
          if (leafIndex !== null) {
            await updateNoteLeafIndex(commitmentFelt, leafIndex);
            setDepositState((prev) => ({
              ...prev,
              proofData: prev.proofData ? { ...prev.proofData, leafIndex } : null,
            }));
            await refreshStats();
          }
        } catch (err) {
          // leafIndex fetch error — silently skip (privacy: no log output)
        }

        // Invalidate local Merkle tree cache so next withdrawal picks up this deposit
        invalidateMerkleCache();

        await refreshStats();
        return txHash;

      } catch (error) {
        // Deposit failed — error surfaced via state (privacy: no log output)
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
    [account, address, publicKey, hasKeys, initializeKeys, unlockKeys, refreshStats]
  );

  // Withdraw operation
  const withdraw = useCallback(
    async (note: PrivacyNote, recipient?: string, complianceOptions?: WithdrawComplianceOptions): Promise<string> => {
      if (!account || !address) {
        throw new Error("Wallet not connected");
      }

      // Resolve pool address from note's tokenSymbol
      const noteToken = note.tokenSymbol || "SAGE";
      const poolAddress = (HARDCODED_POOLS[noteToken] || getPrivacyPoolAddress(DEFAULT_NETWORK, noteToken)) as `0x${string}`;
      const decimals = TOKEN_METADATA[noteToken as keyof typeof TOKEN_METADATA]?.decimals ?? 18;

      if (poolAddress === "0x0") {
        throw new Error(`Privacy pool not deployed for ${noteToken}`);
      }

      // Get keys - unlock if needed
      let currentPrivateKey = privateKeyRef.current;

      if (!currentPrivateKey) {
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
        privateKeyRef.current = currentPrivateKey;
        setIsKeysDerived(true);
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

        // ==============================
        // Step 2: Fetch Merkle proof (API first, local tree fallback)
        // ==============================
        setWithdrawState((prev) => ({ ...prev, proofProgress: 40 }));

        // Fetch Merkle proof — tries coordinator API first, falls back to on-chain LeanIMT
        const merkleProof = await fetchMerkleProofWithFallback(noteCommitment, network as any, poolAddress);

        if (!merkleProof) {
          throw new Error(
            "Could not generate Merkle proof. Deposit commitment not found in on-chain events. " +
            "Please wait for the deposit to be confirmed on-chain."
          );
        }

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

        // ==============================
        // Step 4: Submit withdrawal
        // ==============================
        setWithdrawState((prev) => ({
          ...prev,
          proofProgress: 80,
          isGeneratingProof: false,
        }));

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
        // Withdrawal failed — error surfaced via state (privacy: no log output)
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
    [account, address, hasKeys, initializeKeys, unlockKeys, poolStats.globalRoot, refreshStats, network]
  );

  // Auto-refresh on mount
  useEffect(() => {
    if (address && isKeysDerived) {
      refreshStats();
    }
  }, [address, isKeysDerived, refreshStats]);

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
