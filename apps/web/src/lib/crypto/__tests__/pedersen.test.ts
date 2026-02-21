/**
 * Pedersen Commitments — Unit Tests
 *
 * Tests commitment generation, verification, homomorphic properties,
 * note serialization, range proofs, and denomination helpers.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock starknet hash module before importing pedersen (which imports it)
vi.mock('starknet', () => ({
  hash: {
    computePoseidonHash: (a: string, b: string) => {
      // Deterministic fake hash: just XOR the last 8 hex digits
      const ai = BigInt(a);
      const bi = BigInt(b);
      return '0x' + ((ai ^ bi) | 1n).toString(16);
    },
    computePoseidonHashOnElements: (elems: string[]) => {
      let h = BigInt(elems[0]);
      for (let i = 1; i < elems.length; i++) {
        h = h ^ BigInt(elems[i]);
      }
      return '0x' + (h | 1n).toString(16);
    },
    computePedersenHash: (a: string, b: string) => {
      const ai = BigInt(a);
      const bi = BigInt(b);
      return '0x' + ((ai ^ bi) | 1n).toString(16);
    },
    computePedersenHashOnElements: (elems: string[]) => {
      let h = BigInt(elems[0]);
      for (let i = 1; i < elems.length; i++) {
        h = h ^ BigInt(elems[i]);
      }
      return '0x' + (h | 1n).toString(16);
    },
  },
}));

import {
  commit,
  verifyOpening,
  addCommitments,
  subtractCommitments,
  scalarMultCommitment,
  verifyCommitment,
  commitmentToFelt,
  commitmentToContractFormat,
  serializeNote,
  deserializeNote,
  valueToFixedDenomination,
  fixedDenominationToValue,
  generateRangeProof,
  verifyRangeProof,
  createNote,
  getPedersenH,
} from '../pedersen';
import {
  isOnCurve,
  addPoints,
  scalarMult,
  getGenerator,
  mod,
} from '../elgamal';
import { CURVE_ORDER, STARK_PRIME } from '../constants';

// ---------------------------------------------------------------------------
// Pedersen H generator
// ---------------------------------------------------------------------------

describe('getPedersenH()', () => {
  it('returns a point on the curve', () => {
    const h = getPedersenH();
    expect(isOnCurve(h)).toBe(true);
  });

  it('is different from generator G', () => {
    const g = getGenerator();
    const h = getPedersenH();
    expect(h.x).not.toBe(g.x);
  });
});

// ---------------------------------------------------------------------------
// Commitment generation
// ---------------------------------------------------------------------------

describe('commit()', () => {
  it('produces a point on the curve', () => {
    const c = commit(100n, 42n);
    expect(isOnCurve(c)).toBe(true);
  });

  it('is deterministic (same inputs produce same output)', () => {
    const c1 = commit(100n, 42n);
    const c2 = commit(100n, 42n);
    expect(c1.x).toBe(c2.x);
    expect(c1.y).toBe(c2.y);
  });

  it('different values produce different commitments', () => {
    const c1 = commit(100n, 42n);
    const c2 = commit(200n, 42n);
    expect(c1.x).not.toBe(c2.x);
  });

  it('different blinding factors produce different commitments', () => {
    const c1 = commit(100n, 42n);
    const c2 = commit(100n, 43n);
    expect(c1.x).not.toBe(c2.x);
  });

  it('commit(0, 0) = point at infinity', () => {
    const c = commit(0n, 0n);
    // 0*G + 0*H = infinity
    expect(c.x).toBe(0n);
    expect(c.y).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Commitment verification
// ---------------------------------------------------------------------------

describe('verifyOpening()', () => {
  it('verifies a valid opening', () => {
    const v = 500n;
    const r = 123456n;
    const c = commit(v, r);
    expect(verifyOpening(c, v, r)).toBe(true);
  });

  it('rejects wrong value', () => {
    const c = commit(500n, 123456n);
    expect(verifyOpening(c, 501n, 123456n)).toBe(false);
  });

  it('rejects wrong blinding', () => {
    const c = commit(500n, 123456n);
    expect(verifyOpening(c, 500n, 123457n)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Homomorphic properties
// ---------------------------------------------------------------------------

describe('homomorphic properties', () => {
  it('addCommitments: C(a,r1) + C(b,r2) = C(a+b, r1+r2)', () => {
    const a = 100n;
    const b = 200n;
    const r1 = 11n;
    const r2 = 22n;

    const c1 = commit(a, r1);
    const c2 = commit(b, r2);
    const cSum = addCommitments(c1, c2);

    const cExpected = commit(
      mod(a + b, CURVE_ORDER),
      mod(r1 + r2, CURVE_ORDER),
    );

    expect(cSum.x).toBe(cExpected.x);
    expect(cSum.y).toBe(cExpected.y);
  });

  it('subtractCommitments: C(a,r1) - C(b,r2) = C(a-b, r1-r2)', () => {
    const a = 300n;
    const b = 100n;
    const r1 = 50n;
    const r2 = 20n;

    const c1 = commit(a, r1);
    const c2 = commit(b, r2);
    const cDiff = subtractCommitments(c1, c2);

    const cExpected = commit(
      mod(a - b, CURVE_ORDER),
      mod(r1 - r2, CURVE_ORDER),
    );

    expect(cDiff.x).toBe(cExpected.x);
    expect(cDiff.y).toBe(cExpected.y);
  });

  it('scalarMultCommitment: k * C(v, r) = C(k*v, k*r)', () => {
    const v = 10n;
    const r = 7n;
    const k = 5n;

    const c = commit(v, r);
    const cScaled = scalarMultCommitment(k, c);

    const cExpected = commit(
      mod(k * v, CURVE_ORDER),
      mod(k * r, CURVE_ORDER),
    );

    expect(cScaled.x).toBe(cExpected.x);
    expect(cScaled.y).toBe(cExpected.y);
  });
});

// ---------------------------------------------------------------------------
// verifyCommitment()
// ---------------------------------------------------------------------------

describe('verifyCommitment()', () => {
  it('returns true for a valid commitment point', () => {
    const c = commit(100n, 42n);
    expect(verifyCommitment(c)).toBe(true);
  });

  it('returns false for an off-curve point', () => {
    expect(verifyCommitment({ x: 1n, y: 1n })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('commitmentToFelt()', () => {
  it('returns a hex string starting with 0x', () => {
    const c = commit(100n, 42n);
    const felt = commitmentToFelt(c);
    expect(felt.startsWith('0x')).toBe(true);
    // Should be a valid BigInt
    expect(() => BigInt(felt)).not.toThrow();
  });
});

describe('commitmentToContractFormat()', () => {
  it('returns x and y as hex strings', () => {
    const c = commit(100n, 42n);
    const fmt = commitmentToContractFormat(c);
    expect(fmt.x.startsWith('0x')).toBe(true);
    expect(fmt.y.startsWith('0x')).toBe(true);
    expect(BigInt(fmt.x)).toBe(c.x);
    expect(BigInt(fmt.y)).toBe(c.y);
  });
});

// ---------------------------------------------------------------------------
// Note serialization
// ---------------------------------------------------------------------------

describe('serializeNote() / deserializeNote()', () => {
  it('roundtrips a note', () => {
    const note = {
      value: 1000n,
      blinding: 42n,
      nullifierSecret: 999n,
      commitment: commit(1000n, 42n),
    };

    const serialized = serializeNote(note);
    expect(typeof serialized).toBe('string');

    const deserialized = deserializeNote(serialized);
    expect(deserialized.value).toBe(note.value);
    expect(deserialized.blinding).toBe(note.blinding);
    expect(deserialized.nullifierSecret).toBe(note.nullifierSecret);
    expect(deserialized.commitment.x).toBe(note.commitment.x);
    expect(deserialized.commitment.y).toBe(note.commitment.y);
  });
});

// ---------------------------------------------------------------------------
// Denomination helpers
// ---------------------------------------------------------------------------

describe('valueToFixedDenomination()', () => {
  it('converts 1.0 to 1e18', () => {
    expect(valueToFixedDenomination(1.0)).toBe(BigInt('1000000000000000000'));
  });

  it('converts 0.1 with 18 decimals', () => {
    expect(valueToFixedDenomination(0.1)).toBe(BigInt('100000000000000000'));
  });

  it('supports custom decimals', () => {
    expect(valueToFixedDenomination(1.5, 6)).toBe(1500000n);
  });
});

describe('fixedDenominationToValue()', () => {
  it('converts 1e18 back to 1.0', () => {
    expect(fixedDenominationToValue(BigInt('1000000000000000000'))).toBe(1.0);
  });

  it('supports custom decimals', () => {
    expect(fixedDenominationToValue(1500000n, 6)).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// Range proof
// ---------------------------------------------------------------------------

describe('generateRangeProof() / verifyRangeProof()', () => {
  it('generates and verifies a valid range proof', () => {
    const value = 100n;
    const blinding = 42n;
    const proof = generateRangeProof(value, blinding, 64);
    expect(verifyRangeProof(proof)).toBe(true);
  });

  it('verifies value = 0', () => {
    const proof = generateRangeProof(0n, 42n, 64);
    expect(verifyRangeProof(proof)).toBe(true);
  });

  it('verifies maximum value (2^bits - 1)', () => {
    const maxVal = (1n << 64n) - 1n;
    const proof = generateRangeProof(maxVal, 42n, 64);
    expect(verifyRangeProof(proof)).toBe(true);
  });

  it('throws for value out of range', () => {
    const tooLarge = 1n << 64n;
    expect(() => generateRangeProof(tooLarge, 42n, 64)).toThrow(
      'Value out of range',
    );
  });

  it('throws for negative value', () => {
    expect(() => generateRangeProof(-1n, 42n, 64)).toThrow(
      'Value out of range',
    );
  });

  it('rejects tampered commitment', () => {
    const proof = generateRangeProof(100n, 42n, 64);
    const tamperedProof = {
      ...proof,
      commitment: { x: proof.commitment.x + 1n, y: proof.commitment.y },
    };
    expect(verifyRangeProof(tamperedProof)).toBe(false);
  });

  it('rejects tampered value', () => {
    const proof = generateRangeProof(100n, 42n, 64);
    const tamperedProof = { ...proof, value: 101n };
    expect(verifyRangeProof(tamperedProof)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createNote()
// ---------------------------------------------------------------------------

describe('createNote()', () => {
  it('creates a note with the correct value', () => {
    const note = createNote(500n);
    expect(note.value).toBe(500n);
    expect(note.blinding).toBeGreaterThan(0n);
    expect(note.nullifierSecret).toBeGreaterThan(0n);
    expect(isOnCurve(note.commitment)).toBe(true);
  });

  it('commitment verifies against value and blinding', () => {
    const note = createNote(500n);
    expect(verifyOpening(note.commitment, note.value, note.blinding)).toBe(true);
  });
});
