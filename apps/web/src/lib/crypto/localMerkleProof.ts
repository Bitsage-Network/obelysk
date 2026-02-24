/**
 * Merkle Proof Module for Privacy Pool Proofs
 *
 * Tries the coordinator API first (fast path), then falls back to
 * on-chain storage reading via onChainMerkleProof.ts which uses the
 * correct domain-separated Poseidon hash matching the Cairo LeanIMT.
 *
 * Used by both usePrivacyPool.ts (withdrawals) and useShieldedSwap.ts (swaps).
 */

import { generateMerkleProofOnChain, clearMerkleCache } from "./onChainMerkleProof";
import type { NetworkType } from "../contracts/addresses";

// ============================================================================
// Types
// ============================================================================

export interface MerkleProofResult {
  siblings: string[];
  path_indices: number[];
  root: string;
  leafIndex: number;
  tree_size: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build a Merkle proof by reading deposit commitments from on-chain storage
 * and reconstructing the Cairo-compatible LeanIMT with domain-separated Poseidon.
 *
 * @param commitment - The deposit commitment (hex string)
 * @param network - Which network to scan
 * @param poolAddress - Optional per-token pool contract address
 */
export async function fetchMerkleProofLocal(
  commitment: string,
  network: NetworkType,
  poolAddress?: string,
): Promise<MerkleProofResult | null> {
  const result = await generateMerkleProofOnChain(commitment, network, poolAddress);

  if (!result) {
    return null;
  }

  return {
    siblings: result.siblings,
    path_indices: result.path_indices,
    root: result.root,
    leafIndex: result.leafIndex,
    tree_size: result.tree_size,
  };
}

// ============================================================================
// API Fallback Wrapper
// ============================================================================

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * Try fetching a Merkle proof from the coordinator API first.
 * Falls back to on-chain storage reading with correct LeanIMT hashing.
 *
 * @param commitment - The deposit commitment (hex string)
 * @param network - Which network to scan
 * @param poolAddress - Optional per-token pool contract address
 */
export async function fetchMerkleProofWithFallback(
  commitment: string,
  network: NetworkType,
  poolAddress?: string,
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
          tree_size: data.tree_size || 0,
        };
      }
    }
  } catch {
    // API unavailable — fall through to on-chain proof
  }

  // 2. Fall back to on-chain storage reading with correct domain-separated hashing
  console.log("[MerkleProof] API unavailable, reading on-chain storage for LeanIMT proof...");
  return fetchMerkleProofLocal(commitment, network, poolAddress);
}

/**
 * Invalidate the cached commitments.
 * Call this after a new deposit is confirmed to force a refetch.
 */
export function invalidateMerkleCache(poolAddress?: string): void {
  clearMerkleCache(poolAddress);
}
