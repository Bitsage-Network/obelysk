/**
 * Local Merkle Tree Fallback for Privacy Pool Proofs
 *
 * When the coordinator API is offline, this module reconstructs the
 * Merkle tree locally by fetching PPDepositExecuted events from chain,
 * extracting commitments in insertion order, and generating proofs
 * using the existing Lean IMT implementation.
 *
 * Used by both usePrivacyPool.ts (withdrawals) and useShieldedSwap.ts (swaps).
 */

import { RpcProvider, Contract } from "starknet";
import { getMerkleProof, proofToContractFormat } from "./merkle";
import { fetchPrivacyEvents, type PrivacyEvent } from "../events/privacyEvents";
import { CONTRACTS, NETWORK_CONFIG, type NetworkType } from "../contracts/addresses";

// ============================================================================
// Types
// ============================================================================

export interface MerkleProofResult {
  siblings: string[];
  path_indices: number[];
  root: string;
  leafIndex: number;
}

// ============================================================================
// Cache
// ============================================================================

let cachedCommitments: string[] | null = null;
let cachedDepositCount: number = 0;
let cachedNetwork: string = "";

// ============================================================================
// ABI for on-chain calls
// ============================================================================

const PRIVACY_POOLS_VIEW_ABI = [
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
    outputs: [
      {
        type: "(core::integer::u64, core::integer::u64, core::integer::u256, core::integer::u256)",
      },
    ],
    state_mutability: "view" as const,
  },
];

// ============================================================================
// Helpers
// ============================================================================

function getProvider(network: NetworkType): RpcProvider {
  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for network: ${network}`);
  }
  return new RpcProvider({ nodeUrl: rpcUrl });
}

function getPrivacyPoolsContract(network: NetworkType): Contract {
  const provider = getProvider(network);
  const address = CONTRACTS[network]?.PRIVACY_POOLS;
  if (!address || address === "0x0") {
    throw new Error(`Privacy Pools not deployed on ${network}`);
  }
  return new Contract(PRIVACY_POOLS_VIEW_ABI, address, provider);
}

/**
 * Fetch the total deposit count from the on-chain get_pp_stats view function.
 * Returns (total_deposits, total_withdrawals, total_vol_deposited, total_vol_withdrawn).
 */
async function fetchDepositCount(network: NetworkType): Promise<number> {
  const contract = getPrivacyPoolsContract(network);
  const stats = await contract.get_pp_stats();
  // stats[0] is total_deposits (u64)
  return Number(BigInt(stats[0] || 0));
}

/**
 * Fetch the on-chain global deposit root for validation.
 */
async function fetchOnChainRoot(network: NetworkType): Promise<string> {
  const contract = getPrivacyPoolsContract(network);
  const root = await contract.get_global_deposit_root();
  return root?.toString() || "0x0";
}

/**
 * Fetch all PPDepositExecuted events and extract commitments in insertion order.
 * Uses pagination to retrieve all events and caches the result.
 */
async function fetchAllDepositCommitments(
  network: NetworkType
): Promise<string[]> {
  // Check cache validity
  const depositCount = await fetchDepositCount(network);

  if (
    cachedCommitments &&
    cachedDepositCount === depositCount &&
    cachedNetwork === network
  ) {
    console.log(
      `[LocalMerkle] Using cached commitments (${cachedCommitments.length} deposits)`
    );
    return cachedCommitments;
  }

  console.log(
    `[LocalMerkle] Fetching deposit events from chain (${depositCount} total deposits)...`
  );

  // Fetch all deposit events with pagination
  const allEvents: PrivacyEvent[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await fetchPrivacyEvents({
      network,
      eventTypes: ["deposit"],
      fromBlock: 0,
      chunkSize: 1000,
      continuationToken,
    });
    allEvents.push(...result.events);
    continuationToken = result.continuationToken;
  } while (continuationToken);

  // Sort by block number ASC (oldest first = insertion order)
  // fetchPrivacyEvents sorts descending by default, so we reverse
  allEvents.sort((a, b) => a.blockNumber - b.blockNumber);

  // Extract commitments from rawKeys[1] (PPDepositExecuted: keys[0]=selector, keys[1]=commitment)
  const commitments = allEvents
    .map((e) => e.rawKeys[1])
    .filter((c): c is string => !!c);

  console.log(
    `[LocalMerkle] Fetched ${commitments.length} commitments from ${allEvents.length} events`
  );

  // Update cache
  cachedCommitments = commitments;
  cachedDepositCount = depositCount;
  cachedNetwork = network;

  return commitments;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build a local Merkle proof for a given commitment by reconstructing
 * the tree from on-chain deposit events.
 */
export async function fetchMerkleProofLocal(
  commitment: string,
  network: NetworkType
): Promise<MerkleProofResult | null> {
  const commitments = await fetchAllDepositCommitments(network);

  if (commitments.length === 0) {
    console.warn("[LocalMerkle] No deposits found on chain");
    return null;
  }

  // Find the target commitment's index (compare as BigInt for normalization)
  const targetBigInt = BigInt(commitment);
  const targetIndex = commitments.findIndex(
    (c) => BigInt(c) === targetBigInt
  );

  if (targetIndex === -1) {
    console.warn(
      "[LocalMerkle] Commitment not found in on-chain events. " +
        "Deposit may not be indexed yet."
    );
    return null;
  }

  console.log(
    `[LocalMerkle] Found commitment at index ${targetIndex} of ${commitments.length}`
  );

  // Convert all commitments to bigint for the Merkle tree
  const leaves = commitments.map((c) => BigInt(c));

  // Build the tree and generate proof
  const proof = await getMerkleProof(targetIndex, leaves);
  const formatted = proofToContractFormat(proof);

  // Validate root against on-chain root
  try {
    const onChainRoot = await fetchOnChainRoot(network);
    if (BigInt(formatted.root) !== BigInt(onChainRoot)) {
      console.warn(
        "[LocalMerkle] Root mismatch — local:",
        formatted.root,
        "on-chain:",
        onChainRoot,
        "— tree may be stale. Contract will validate."
      );
    } else {
      console.log("[LocalMerkle] Root validated against on-chain state");
    }
  } catch (e) {
    console.warn("[LocalMerkle] Could not validate root against chain:", e);
  }

  return {
    siblings: formatted.pathElements,
    path_indices: formatted.pathIndices,
    root: formatted.root,
    leafIndex: formatted.leafIndex,
  };
}

// ============================================================================
// API Fallback Wrapper
// ============================================================================

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * Try fetching a Merkle proof from the coordinator API first.
 * Falls back to building a local tree from on-chain events if the API is unavailable.
 */
export async function fetchMerkleProofWithFallback(
  commitment: string,
  network: NetworkType
): Promise<MerkleProofResult | null> {
  // 1. Try coordinator API (fast path)
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/privacy/proof/${commitment}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.found) {
        console.log("[MerkleProof] Using coordinator API");
        return {
          siblings: data.siblings,
          path_indices: data.path_indices.map((p: number) => p),
          root: data.current_root || data.root,
          leafIndex: data.leaf_index,
        };
      }
    }
  } catch {
    // API unavailable — fall through to local tree
  }

  // 2. Fall back to local tree (slow path)
  console.log("[MerkleProof] API unavailable, building local Merkle tree...");
  return fetchMerkleProofLocal(commitment, network);
}

/**
 * Invalidate the cached commitments.
 * Call this after a new deposit is confirmed to force a refetch.
 */
export function invalidateMerkleCache(): void {
  cachedCommitments = null;
  cachedDepositCount = 0;
  cachedNetwork = "";
}
