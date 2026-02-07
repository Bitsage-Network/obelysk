/**
 * On-Chain Merkle Proof Generator
 *
 * Generates LeanIMT Merkle proofs by reading deposit commitments directly
 * from contract storage and reconstructing the tree client-side.
 *
 * Matches the Cairo LeanIMT implementation exactly:
 *   - Domain-separated Poseidon hash: hash_pair(l, r) = poseidon([DOMAIN, l, r])
 *   - Dynamic depth: grows from 0 to 32 as needed
 *   - Sparse tree: left child without sibling propagates up (no zero hashing)
 *   - Variable-length proofs: only non-zero siblings included
 *
 * Flow:
 *   1. Read total deposits via get_pp_stats()
 *   2. Read each commitment from global_deposit_nodes storage
 *   3. Rebuild the LeanIMT locally with correct hash_pair
 *   4. Generate sparse proof (skip empty siblings)
 *   5. Verify locally before returning
 */

import { hash, num } from "starknet";
import { CONTRACTS, NETWORK_CONFIG, type NetworkType } from "../contracts/addresses";

// ============================================================================
// Constants (matching lean_imt.cairo)
// ============================================================================

/**
 * Domain separator for LeanIMT hashing.
 * Cairo: pub const LEAN_IMT_DOMAIN: felt252 = 'OBELYSK_LEAN_IMT_V1';
 * Encoded as felt252: 0x4f42454c59534b5f4c45414e5f494d545f5631
 */
const LEAN_IMT_DOMAIN = "0x4f42454c59534b5f4c45414e5f494d545f5631";

// ============================================================================
// Types
// ============================================================================

export interface OnChainMerkleProofResult {
  /** Sibling hashes (variable length — only non-zero siblings) */
  siblings: string[];
  /** Path direction for each sibling: 0 = left, 1 = right */
  path_indices: number[];
  /** Tree root at time of proof */
  root: string;
  /** Leaf index in the tree */
  leafIndex: number;
  /** Total number of leaves */
  tree_size: number;
}

// ============================================================================
// Cairo-Compatible LeanIMT Hash
// ============================================================================

/**
 * hash_pair matching Cairo's lean_imt.cairo:
 *   poseidon_hash_span(array![LEAN_IMT_DOMAIN, left, right].span())
 */
function hashPair(left: string, right: string): string {
  return hash.computePoseidonHashOnElements([LEAN_IMT_DOMAIN, left, right]);
}

/**
 * calculate_depth matching Cairo's lean_imt.cairo:
 *   0 leaves → 0, 1 leaf → 1, 2 leaves → 1, 3 → 2, 4 → 2, 5 → 3
 *   i.e. ceil(log2(n)) for n >= 2, special cases for 0 and 1
 */
function calculateDepth(n: number): number {
  if (n === 0) return 0;
  if (n === 1) return 1;
  let depth = 0;
  let remaining = n - 1;
  while (remaining > 0) {
    remaining = Math.floor(remaining / 2);
    depth++;
  }
  return depth;
}

// ============================================================================
// Module-level cache — keyed by pool address for multi-pool support
// ============================================================================

interface PoolCache {
  commitments: string[];
  nodes: Map<string, string>;
  root: string | null;
}

/** Per-pool cache keyed by normalized pool address */
const poolCaches = new Map<string, PoolCache>();

function getPoolCache(poolAddr: string): PoolCache {
  const key = poolAddr.toLowerCase();
  let cache = poolCaches.get(key);
  if (!cache) {
    cache = { commitments: [], nodes: new Map(), root: null };
    poolCaches.set(key, cache);
  }
  return cache;
}

/**
 * Clear the cached tree (useful for testing or after new deposits).
 * If poolAddress is provided, only clears that pool's cache.
 */
export function clearMerkleCache(poolAddress?: string): void {
  if (poolAddress) {
    poolCaches.delete(poolAddress.toLowerCase());
  } else {
    poolCaches.clear();
  }
}

// ============================================================================
// RPC Helpers
// ============================================================================

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC error (${method}): ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

// ============================================================================
// Storage Reading
// ============================================================================

/**
 * Compute the storage address for global_deposit_nodes[(level, index)].
 *
 * Cairo storage layout for Map<(u8, u64), felt252>:
 *   address = pedersen(pedersen(sn_keccak(var_name), level), index)
 */
const NODES_STORAGE_BASE = hash.getSelectorFromName("global_deposit_nodes");

function nodesStorageAddr(level: number, index: number): string {
  return hash.computePedersenHash(
    hash.computePedersenHash(NODES_STORAGE_BASE, "0x" + level.toString(16)),
    "0x" + index.toString(16),
  );
}

/**
 * Read the total number of deposits from get_pp_stats().
 * Returns: (total_deposits: u64, total_withdrawals: u64, total_volume: u256, ...)
 */
async function fetchTotalDeposits(
  rpcUrl: string,
  contractAddr: string,
): Promise<number> {
  const result = await rpcCall(rpcUrl, "starknet_call", {
    request: {
      contract_address: contractAddr,
      entry_point_selector: hash.getSelectorFromName("get_pp_stats"),
      calldata: [],
    },
    block_id: "latest",
  });

  // result[0] = total_deposits (u64)
  return Number(BigInt(result[0] || "0"));
}

/**
 * Read deposit commitments from contract storage.
 * Uses starknet_getStorageAt to read global_deposit_nodes[(0, i)] for each leaf.
 */
async function fetchCommitmentsFromStorage(
  rpcUrl: string,
  contractAddr: string,
  totalDeposits: number,
): Promise<string[]> {
  const commitments: string[] = [];

  // Batch reads for efficiency (read in parallel chunks of 10)
  const BATCH_SIZE = 10;
  for (let start = 0; start < totalDeposits; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, totalDeposits);
    const promises: Promise<string>[] = [];

    for (let i = start; i < end; i++) {
      const storageKey = nodesStorageAddr(0, i);
      promises.push(
        rpcCall(rpcUrl, "starknet_getStorageAt", {
          contract_address: contractAddr,
          key: storageKey,
          block_id: "latest",
        }),
      );
    }

    const results = await Promise.all(promises);
    commitments.push(...results);
  }

  return commitments;
}

// ============================================================================
// Tree Reconstruction (Cairo-compatible LeanIMT)
// ============================================================================

/**
 * Rebuild the LeanIMT from commitments, matching _update_global_deposit_path in Cairo.
 * Returns the tree nodes map and final root.
 */
function rebuildTree(commitments: string[]): {
  nodes: Map<string, string>;
  root: string;
  depth: number;
} {
  const nodes = new Map<string, string>();
  const setNode = (level: number, index: number, val: string) =>
    nodes.set(`${level},${index}`, val);
  const getNode = (level: number, index: number): string =>
    nodes.get(`${level},${index}`) || "0x0";

  let root = "0x0";

  for (let insertIdx = 0; insertIdx < commitments.length; insertIdx++) {
    const commitment = commitments[insertIdx];
    const newSize = insertIdx + 1;
    const depth = calculateDepth(newSize);

    // Write leaf at level 0
    setNode(0, insertIdx, commitment);

    // Update path (matching _update_global_deposit_path in privacy_pools.cairo)
    let currentHash = commitment;
    let currentIndex = insertIdx;

    for (let level = 0; level < depth; level++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const parentIndex = Math.floor(currentIndex / 2);

      const siblingHash = getNode(level, siblingIndex);

      if (isRight) {
        if (siblingHash !== "0x0") {
          currentHash = hashPair(siblingHash, currentHash);
        }
        // else: propagate up (sparse optimization)
      } else {
        if (siblingHash !== "0x0") {
          currentHash = hashPair(currentHash, siblingHash);
        }
        // else: propagate up (sparse optimization)
      }

      setNode(level + 1, parentIndex, currentHash);
      currentIndex = parentIndex;
    }

    root = currentHash;
  }

  return { nodes, root, depth: calculateDepth(commitments.length) };
}

// ============================================================================
// Proof Generation
// ============================================================================

/**
 * Generate a sparse LeanIMT proof for a leaf.
 * Only includes non-zero siblings (matching Cairo's proof verification).
 */
function generateProof(
  leafIndex: number,
  commitments: string[],
  nodes: Map<string, string>,
  treeDepth: number,
): { siblings: string[]; pathIndices: boolean[]; root: string } {
  const getNode = (level: number, index: number): string =>
    nodes.get(`${level},${index}`) || "0x0";

  const siblings: string[] = [];
  const pathIndices: boolean[] = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < treeDepth; level++) {
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
    const siblingHash = getNode(level, siblingIndex);

    // Only include non-zero siblings (LeanIMT sparse optimization)
    if (siblingHash !== "0x0") {
      siblings.push(siblingHash);
      pathIndices.push(isRight);
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  const root = getNode(treeDepth, 0);
  return { siblings, pathIndices, root };
}

/**
 * Verify a proof by recomputing the root.
 */
function verifyProof(
  leaf: string,
  siblings: string[],
  pathIndices: boolean[],
  expectedRoot: string,
): boolean {
  let current = leaf;
  for (let i = 0; i < siblings.length; i++) {
    current = pathIndices[i]
      ? hashPair(siblings[i], current)
      : hashPair(current, siblings[i]);
  }
  return num.toHex(num.toBigInt(current)) === num.toHex(num.toBigInt(expectedRoot));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate a Merkle proof for a deposit commitment by reading on-chain storage.
 *
 * @param commitment - The deposit commitment felt252 (hex string)
 * @param network - Which network to scan (default: "sepolia")
 * @param poolAddress - Optional pool contract address (defaults to CONTRACTS[network].PRIVACY_POOLS)
 * @returns The Merkle proof data needed for pp_withdraw, or null if commitment not found
 */
export async function generateMerkleProofOnChain(
  commitment: string,
  network: NetworkType = "sepolia",
  poolAddress?: string,
): Promise<OnChainMerkleProofResult | null> {
  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  if (!rpcUrl) throw new Error(`No RPC URL for network: ${network}`);

  const contracts = CONTRACTS[network];
  const privacyPoolsAddr = poolAddress || contracts.PRIVACY_POOLS;
  if (!privacyPoolsAddr || privacyPoolsAddr === "0x0") {
    throw new Error(`PrivacyPools not deployed on ${network}`);
  }

  const contractAddr = num.toHex(num.toBigInt(privacyPoolsAddr));
  const normalizedCommitment = num.toHex(num.toBigInt(commitment));

  // Per-pool cache
  const cache = getPoolCache(contractAddr);
  const needsFetch = cache.commitments.length === 0;

  if (needsFetch) {
    console.log(`[MerkleProof] Reading deposits from pool ${contractAddr.slice(0, 12)}...`);
    const totalDeposits = await fetchTotalDeposits(rpcUrl, contractAddr);
    console.log(`[MerkleProof] Total deposits: ${totalDeposits}`);

    cache.commitments = await fetchCommitmentsFromStorage(rpcUrl, contractAddr, totalDeposits);
    cache.nodes = new Map();
    cache.root = null;
    console.log(`[MerkleProof] Read ${cache.commitments.length} commitments`);
  }

  // Find our commitment
  let leafIndex = cache.commitments.findIndex(
    (c) => num.toHex(num.toBigInt(c)) === normalizedCommitment,
  );

  // If not found, re-fetch in case new deposits happened since cache
  if (leafIndex === -1 && !needsFetch) {
    console.log("[MerkleProof] Commitment not in cache, re-fetching...");
    const totalDeposits = await fetchTotalDeposits(rpcUrl, contractAddr);
    cache.commitments = await fetchCommitmentsFromStorage(rpcUrl, contractAddr, totalDeposits);
    cache.nodes = new Map();
    cache.root = null;

    leafIndex = cache.commitments.findIndex(
      (c) => num.toHex(num.toBigInt(c)) === normalizedCommitment,
    );
  }

  if (leafIndex === -1) {
    console.warn("[MerkleProof] Commitment not found:", normalizedCommitment);
    return null;
  }

  // Rebuild tree if cache is stale
  if (cache.nodes.size === 0 || !cache.root) {
    console.log("[MerkleProof] Rebuilding LeanIMT...");
    const { nodes, root, depth } = rebuildTree(cache.commitments);
    cache.nodes = nodes;
    cache.root = root;
    console.log(`[MerkleProof] Tree rebuilt: root=${root.slice(0, 20)}... depth=${depth} size=${cache.commitments.length}`);
  }

  // Generate proof
  const treeDepth = calculateDepth(cache.commitments.length);
  const { siblings, pathIndices, root } = generateProof(
    leafIndex,
    cache.commitments,
    cache.nodes,
    treeDepth,
  );

  // Verify locally
  const leaf = cache.commitments[leafIndex];
  const isValid = verifyProof(leaf, siblings, pathIndices, root);
  if (!isValid) {
    console.error("[MerkleProof] Local proof verification FAILED");
    return null;
  }

  console.log(`[MerkleProof] Proof verified. Siblings: ${siblings.length}, Root: ${root.slice(0, 20)}...`);

  return {
    siblings,
    path_indices: pathIndices.map((b) => (b ? 1 : 0)),
    root,
    leafIndex,
    tree_size: cache.commitments.length,
  };
}

/**
 * Verify that the locally-reconstructed root matches the on-chain root.
 */
export async function verifyRootAgainstChain(
  network: NetworkType = "sepolia",
  poolAddress?: string,
): Promise<{ match: boolean; localRoot: string | null; onChainRoot: string | null }> {
  const rpcUrl = NETWORK_CONFIG[network]?.rpcUrl;
  const contracts = CONTRACTS[network];
  const privacyPoolsAddr = poolAddress || contracts.PRIVACY_POOLS;
  const contractAddr = num.toHex(num.toBigInt(privacyPoolsAddr));
  const cache = getPoolCache(contractAddr);

  if (!rpcUrl || !cache.root) {
    return { match: false, localRoot: cache.root, onChainRoot: null };
  }

  const result = await rpcCall(rpcUrl, "starknet_call", {
    request: {
      contract_address: contractAddr,
      entry_point_selector: hash.getSelectorFromName("get_global_deposit_root"),
      calldata: [],
    },
    block_id: "latest",
  });

  const onChainRoot = result?.[0] || null;
  if (!onChainRoot) {
    return { match: false, localRoot: cache.root, onChainRoot: null };
  }

  const normalizedLocal = num.toHex(num.toBigInt(cache.root));
  const normalizedOnChain = num.toHex(num.toBigInt(onChainRoot));
  const match = normalizedLocal === normalizedOnChain;

  if (!match) {
    console.warn("[MerkleProof] Root mismatch! Local:", normalizedLocal, "On-chain:", normalizedOnChain);
  }

  return { match, localRoot: normalizedLocal, onChainRoot: normalizedOnChain };
}
