/**
 * Local Merkle Proof — Unit Tests
 *
 * Since localMerkleProof.ts relies on on-chain RPC calls and event fetching,
 * we test the underlying merkle.ts module (which it delegates to) plus
 * the exported cache/fallback logic with full mocking.
 *
 * The merkle module is the actual pure-logic core used to build trees
 * and generate proofs locally. We test:
 *   - Building a tree from leaves
 *   - Generating and verifying inclusion proofs
 *   - Empty/single/power-of-2/non-power-of-2 leaf counts
 *   - Cache invalidation in localMerkleProof
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock starknet before importing any module that uses it
vi.mock('starknet', () => {
  // A collision-resistant deterministic hash for tests.
  // Uses a simple polynomial-style mixing with a large prime modulus
  // to avoid the collisions that XOR-based mocks produce.
  const HASH_PRIME = (1n << 128n) - 159n; // A 128-bit prime
  const fakeHash = (a: bigint, b: bigint): bigint => {
    // Ensure positive inputs
    const pa = a < 0n ? -a : a;
    const pb = b < 0n ? -b : b;
    // polynomial hash: (a * K1 + b * K2 + K3) mod HASH_PRIME
    const K1 = 0x9E3779B97F4A7C15n;
    const K2 = 0x517CC1B727220A95n;
    const K3 = 0x6C62272E07BB0142n;
    return (pa * K1 + pb * K2 + K3) % HASH_PRIME;
  };

  const toHexStr = (n: bigint): string => {
    return '0x' + n.toString(16);
  };

  return {
    hash: {
      computePoseidonHash: (a: string, b: string) => {
        return toHexStr(fakeHash(BigInt(a), BigInt(b)));
      },
      computePoseidonHashOnElements: (elems: string[]) => {
        let h = BigInt(elems[0]);
        for (let i = 1; i < elems.length; i++) {
          h = fakeHash(h, BigInt(elems[i]));
        }
        return toHexStr(h);
      },
      computePedersenHash: (a: string, b: string) => {
        return toHexStr(fakeHash(BigInt(a), BigInt(b)));
      },
      computePedersenHashOnElements: (elems: string[]) => {
        let h = BigInt(elems[0]);
        for (let i = 1; i < elems.length; i++) {
          h = fakeHash(h, BigInt(elems[i]));
        }
        return toHexStr(h);
      },
      getSelectorFromName: (name: string) => '0x' + BigInt(name.length).toString(16),
    },
    num: {
      toHex: (v: unknown) => '0x' + BigInt(String(v)).toString(16),
    },
    RpcProvider: vi.fn().mockImplementation(() => ({
      getEvents: vi.fn().mockResolvedValue({ events: [], continuation_token: undefined }),
    })),
    Contract: vi.fn().mockImplementation(() => ({
      get_global_deposit_root: vi.fn().mockResolvedValue('0x0'),
      get_pp_stats: vi.fn().mockResolvedValue([0, 0, 0, 0]),
    })),
  };
});

import {
  getMerkleProof,
  verifyMerkleProof,
  initLeanIMT,
  insertLeaf,
  EMPTY_LEAF,
  TREE_DEPTH,
  computeRootFromProof,
  getLeafIndex,
  proofToContractFormat,
  contractFormatToProof,
} from '../merkle';
import { invalidateMerkleCache } from '../localMerkleProof';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

// Use a smaller depth for faster tests
const TEST_DEPTH = 4;

// ---------------------------------------------------------------------------
// getMerkleProof + verifyMerkleProof
// ---------------------------------------------------------------------------

describe('getMerkleProof() + verifyMerkleProof()', () => {
  it('generates a verifiable proof for the first leaf of 2 leaves', async () => {
    const leaves = [1n, 2n];
    const proof = await getMerkleProof(0, leaves, TEST_DEPTH);

    expect(proof.leaf).toBe(1n);
    expect(proof.leafIndex).toBe(0);
    expect(proof.pathElements).toHaveLength(TEST_DEPTH);
    expect(proof.pathIndices).toHaveLength(TEST_DEPTH);
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it('generates a verifiable proof for the second leaf of 2 leaves', async () => {
    const leaves = [1n, 2n];
    const proof = await getMerkleProof(1, leaves, TEST_DEPTH);

    expect(proof.leaf).toBe(2n);
    expect(proof.leafIndex).toBe(1);
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it('generates a verifiable proof for a single leaf', async () => {
    const leaves = [42n];
    const proof = await getMerkleProof(0, leaves, TEST_DEPTH);

    expect(proof.leaf).toBe(42n);
    expect(verifyMerkleProof(proof)).toBe(true);
  });

  it('handles power-of-2 leaf count (4 leaves)', async () => {
    const leaves = [10n, 20n, 30n, 40n];
    for (let i = 0; i < leaves.length; i++) {
      const proof = await getMerkleProof(i, leaves, TEST_DEPTH);
      expect(proof.leaf).toBe(leaves[i]);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('handles non-power-of-2 leaf count (3 leaves)', async () => {
    const leaves = [10n, 20n, 30n];
    for (let i = 0; i < leaves.length; i++) {
      const proof = await getMerkleProof(i, leaves, TEST_DEPTH);
      expect(proof.leaf).toBe(leaves[i]);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('handles non-power-of-2 leaf count (5 leaves)', async () => {
    const leaves = [1n, 2n, 3n, 4n, 5n];
    for (let i = 0; i < leaves.length; i++) {
      const proof = await getMerkleProof(i, leaves, TEST_DEPTH);
      expect(proof.leaf).toBe(leaves[i]);
      expect(verifyMerkleProof(proof)).toBe(true);
    }
  });

  it('all leaves in the same tree share the same root', async () => {
    const leaves = [10n, 20n, 30n, 40n];
    const proofs = await Promise.all(
      leaves.map((_, i) => getMerkleProof(i, leaves, TEST_DEPTH)),
    );

    const root = proofs[0].root;
    for (const proof of proofs) {
      expect(proof.root).toBe(root);
    }
  });

  it('different leaf sets produce different roots', async () => {
    const leaves1 = [1n, 2n, 3n, 4n];
    const leaves2 = [5n, 6n, 7n, 8n];
    const proof1 = await getMerkleProof(0, leaves1, TEST_DEPTH);
    const proof2 = await getMerkleProof(0, leaves2, TEST_DEPTH);
    expect(proof1.root).not.toBe(proof2.root);
  });

  it('throws for out-of-bounds leaf index', async () => {
    const leaves = [1n, 2n];
    await expect(getMerkleProof(5, leaves, TEST_DEPTH)).rejects.toThrow(
      'Leaf index out of bounds',
    );
  });

  it('verification fails if leaf is tampered', async () => {
    const leaves = [10n, 20n, 30n, 40n];
    const proof = await getMerkleProof(0, leaves, TEST_DEPTH);
    const tampered = { ...proof, leaf: 999n };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });

  it('verification fails if a sibling is tampered', async () => {
    const leaves = [10n, 20n, 30n, 40n];
    const proof = await getMerkleProof(0, leaves, TEST_DEPTH);
    const tampered = {
      ...proof,
      pathElements: [999n, ...proof.pathElements.slice(1)],
    };
    expect(verifyMerkleProof(tampered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeRootFromProof
// ---------------------------------------------------------------------------

describe('computeRootFromProof()', () => {
  it('computes the same root as the proof', async () => {
    const leaves = [10n, 20n, 30n];
    const proof = await getMerkleProof(1, leaves, TEST_DEPTH);
    const root = computeRootFromProof(
      proof.leaf,
      proof.pathElements,
      proof.pathIndices,
    );
    expect(root).toBe(proof.root);
  });
});

// ---------------------------------------------------------------------------
// getLeafIndex
// ---------------------------------------------------------------------------

describe('getLeafIndex()', () => {
  it('derives leaf index 0 from all-zero path indices', () => {
    expect(getLeafIndex([0, 0, 0, 0])).toBe(0);
  });

  it('derives leaf index 1 from [1, 0, 0, 0]', () => {
    expect(getLeafIndex([1, 0, 0, 0])).toBe(1);
  });

  it('derives leaf index from proof path indices', async () => {
    const leaves = [10n, 20n, 30n, 40n];
    for (let i = 0; i < leaves.length; i++) {
      const proof = await getMerkleProof(i, leaves, TEST_DEPTH);
      expect(getLeafIndex(proof.pathIndices)).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// Lean IMT
// ---------------------------------------------------------------------------

describe('initLeanIMT() / insertLeaf()', () => {
  it('initializes with size 0', () => {
    const tree = initLeanIMT(TEST_DEPTH);
    expect(tree.size).toBe(0);
    expect(tree.depth).toBe(TEST_DEPTH);
  });

  it('insertLeaf increments size', () => {
    let tree = initLeanIMT(TEST_DEPTH);
    tree = insertLeaf(tree, 42n);
    expect(tree.size).toBe(1);
    tree = insertLeaf(tree, 43n);
    expect(tree.size).toBe(2);
  });

  it('inserting same leaf twice changes root', () => {
    let tree1 = initLeanIMT(TEST_DEPTH);
    tree1 = insertLeaf(tree1, 42n);

    let tree2 = initLeanIMT(TEST_DEPTH);
    tree2 = insertLeaf(tree2, 42n);
    tree2 = insertLeaf(tree2, 42n);

    expect(tree1.root).not.toBe(tree2.root);
  });

  it('different leaves produce different roots', () => {
    let tree1 = initLeanIMT(TEST_DEPTH);
    tree1 = insertLeaf(tree1, 1n);

    let tree2 = initLeanIMT(TEST_DEPTH);
    tree2 = insertLeaf(tree2, 2n);

    expect(tree1.root).not.toBe(tree2.root);
  });
});

// ---------------------------------------------------------------------------
// Contract format roundtrip
// ---------------------------------------------------------------------------

describe('proofToContractFormat() / contractFormatToProof()', () => {
  it('roundtrips a proof through contract format', async () => {
    const leaves = [10n, 20n, 30n, 40n];
    const proof = await getMerkleProof(2, leaves, TEST_DEPTH);
    const formatted = proofToContractFormat(proof);

    expect(formatted.leaf.startsWith('0x')).toBe(true);
    expect(formatted.root.startsWith('0x')).toBe(true);
    expect(formatted.pathElements.every(e => e.startsWith('0x'))).toBe(true);
    expect(formatted.leafIndex).toBe(2);

    const restored = contractFormatToProof(formatted);
    expect(restored.leaf).toBe(proof.leaf);
    expect(restored.root).toBe(proof.root);
    expect(restored.leafIndex).toBe(proof.leafIndex);
    expect(restored.pathElements).toEqual(proof.pathElements);
    expect(restored.pathIndices).toEqual(proof.pathIndices);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation (localMerkleProof)
// ---------------------------------------------------------------------------

describe('invalidateMerkleCache()', () => {
  it('can be called without error', () => {
    expect(() => invalidateMerkleCache()).not.toThrow();
  });

  it('can be called multiple times', () => {
    invalidateMerkleCache();
    invalidateMerkleCache();
    // No error is success
  });
});

// ---------------------------------------------------------------------------
// TREE_DEPTH and EMPTY_LEAF constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('TREE_DEPTH is 20', () => {
    expect(TREE_DEPTH).toBe(20);
  });

  it('EMPTY_LEAF is 0n', () => {
    expect(EMPTY_LEAF).toBe(0n);
  });
});
