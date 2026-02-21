/**
 * ElGamal Encryption on Stark Curve — Unit Tests
 *
 * Tests the core elliptic curve arithmetic, ElGamal encrypt/decrypt
 * roundtrip, BSGS discrete log recovery, homomorphic properties,
 * and edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  mod,
  modInverse,
  modPow,
  isInfinity,
  isOnCurve,
  negatePoint,
  addPoints,
  scalarMult,
  getGenerator,
  getPedersenH,
  encrypt,
  decrypt,
  addCiphertexts,
  subtractCiphertexts,
  scalarMultCiphertext,
  verifyCiphertext,
  ciphertextToFelts,
  feltsToChiphertext,
  pointToFelts,
  feltsToPoint,
  compressPoint,
  decompressPoint,
  generateKeyPair,
  tonelliShanks,
} from '../elgamal';
import {
  STARK_PRIME,
  CURVE_ORDER,
  POINT_AT_INFINITY,
  type ECPoint,
} from '../constants';

// ---------------------------------------------------------------------------
// Modular arithmetic helpers
// ---------------------------------------------------------------------------

describe('mod()', () => {
  it('returns positive result for positive inputs', () => {
    expect(mod(7n, 5n)).toBe(2n);
  });

  it('returns positive result for negative inputs', () => {
    expect(mod(-3n, 5n)).toBe(2n);
  });

  it('returns 0 when a is a multiple of m', () => {
    expect(mod(10n, 5n)).toBe(0n);
  });

  it('handles zero input', () => {
    expect(mod(0n, 5n)).toBe(0n);
  });
});

describe('modInverse()', () => {
  it('computes the modular inverse correctly', () => {
    // 3 * 2 = 6 ≡ 1 (mod 5)
    expect(mod(modInverse(3n, 5n) * 3n, 5n)).toBe(1n);
  });

  it('computes inverse for large primes', () => {
    const a = 42n;
    const inv = modInverse(a, STARK_PRIME);
    expect(mod(a * inv, STARK_PRIME)).toBe(1n);
  });
});

describe('modPow()', () => {
  it('returns 0 when modulus is 1', () => {
    expect(modPow(5n, 3n, 1n)).toBe(0n);
  });

  it('computes small exponentiation correctly', () => {
    // 2^10 = 1024 mod 1000 = 24
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
  });

  it('handles exponent 0', () => {
    expect(modPow(123n, 0n, 17n)).toBe(1n);
  });

  it('handles exponent 1', () => {
    expect(modPow(5n, 1n, 7n)).toBe(5n);
  });
});

// ---------------------------------------------------------------------------
// Point operations
// ---------------------------------------------------------------------------

describe('isInfinity()', () => {
  it('returns true for the point at infinity', () => {
    expect(isInfinity(POINT_AT_INFINITY)).toBe(true);
  });

  it('returns false for the generator', () => {
    expect(isInfinity(getGenerator())).toBe(false);
  });
});

describe('isOnCurve()', () => {
  it('returns true for the generator point G', () => {
    expect(isOnCurve(getGenerator())).toBe(true);
  });

  it('returns true for the Pedersen H point', () => {
    expect(isOnCurve(getPedersenH())).toBe(true);
  });

  it('returns true for the point at infinity', () => {
    expect(isOnCurve(POINT_AT_INFINITY)).toBe(true);
  });

  it('returns false for an arbitrary off-curve point', () => {
    const offCurve: ECPoint = { x: 1n, y: 1n };
    expect(isOnCurve(offCurve)).toBe(false);
  });
});

describe('negatePoint()', () => {
  it('negating the point at infinity returns infinity', () => {
    const result = negatePoint(POINT_AT_INFINITY);
    expect(isInfinity(result)).toBe(true);
  });

  it('negation preserves x, negates y mod p', () => {
    const g = getGenerator();
    const neg = negatePoint(g);
    expect(neg.x).toBe(g.x);
    expect(mod(neg.y + g.y, STARK_PRIME)).toBe(0n);
  });

  it('double negation returns original point', () => {
    const g = getGenerator();
    const doubleNeg = negatePoint(negatePoint(g));
    expect(doubleNeg.x).toBe(g.x);
    expect(doubleNeg.y).toBe(g.y);
  });
});

describe('addPoints()', () => {
  it('adding infinity to a point returns the point', () => {
    const g = getGenerator();
    const result = addPoints(POINT_AT_INFINITY, g);
    expect(result.x).toBe(g.x);
    expect(result.y).toBe(g.y);
  });

  it('adding a point to infinity returns the point', () => {
    const g = getGenerator();
    const result = addPoints(g, POINT_AT_INFINITY);
    expect(result.x).toBe(g.x);
    expect(result.y).toBe(g.y);
  });

  it('adding a point to its negation returns infinity', () => {
    const g = getGenerator();
    const result = addPoints(g, negatePoint(g));
    expect(isInfinity(result)).toBe(true);
  });

  it('point doubling (G + G) produces a point on the curve', () => {
    const g = getGenerator();
    const doubled = addPoints(g, g);
    expect(isOnCurve(doubled)).toBe(true);
  });

  it('addition is commutative (P + Q = Q + P)', () => {
    const g = getGenerator();
    const h = getPedersenH();
    const r1 = addPoints(g, h);
    const r2 = addPoints(h, g);
    expect(r1.x).toBe(r2.x);
    expect(r1.y).toBe(r2.y);
  });
});

describe('scalarMult()', () => {
  it('0 * G = infinity', () => {
    const result = scalarMult(0n, getGenerator());
    expect(isInfinity(result)).toBe(true);
  });

  it('1 * G = G', () => {
    const g = getGenerator();
    const result = scalarMult(1n, g);
    expect(result.x).toBe(g.x);
    expect(result.y).toBe(g.y);
  });

  it('2 * G = G + G', () => {
    const g = getGenerator();
    const doubled = addPoints(g, g);
    const scaled = scalarMult(2n, g);
    expect(scaled.x).toBe(doubled.x);
    expect(scaled.y).toBe(doubled.y);
  });

  it('n * G = infinity (curve order)', () => {
    const g = getGenerator();
    const result = scalarMult(CURVE_ORDER, g);
    expect(isInfinity(result)).toBe(true);
  });

  it('scalar multiplication of infinity returns infinity', () => {
    const result = scalarMult(42n, POINT_AT_INFINITY);
    expect(isInfinity(result)).toBe(true);
  });

  it('negative scalar multiplies the negated point', () => {
    const g = getGenerator();
    const pos = scalarMult(5n, g);
    const neg = scalarMult(-5n, g);
    // pos + neg should equal infinity
    const sum = addPoints(pos, neg);
    expect(isInfinity(sum)).toBe(true);
  });

  it('result is always on the curve', () => {
    const g = getGenerator();
    const result = scalarMult(12345n, g);
    expect(isOnCurve(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ElGamal encrypt / decrypt
// ---------------------------------------------------------------------------

describe('encrypt() / decrypt()', () => {
  // Use a known deterministic keypair for tests
  const privateKey = 42n;
  const publicKey = scalarMult(privateKey, getGenerator());

  it('encrypts and decrypts message = 0', () => {
    const r = 7n;
    const ct = encrypt(0n, publicKey, r);
    const result = decrypt(ct, privateKey, 2n ** 20n);
    expect(result).toBe(0n);
  });

  it('encrypts and decrypts message = 1', () => {
    const r = 13n;
    const ct = encrypt(1n, publicKey, r);
    const result = decrypt(ct, privateKey, 2n ** 20n);
    expect(result).toBe(1n);
  });

  it('encrypts and decrypts a small value (100)', () => {
    const r = 99n;
    const ct = encrypt(100n, publicKey, r);
    const result = decrypt(ct, privateKey, 2n ** 20n);
    expect(result).toBe(100n);
  });

  it('produces valid ciphertext (both points on curve)', () => {
    const r = 55n;
    const ct = encrypt(50n, publicKey, r);
    expect(verifyCiphertext(ct)).toBe(true);
  });

  it('same message with different randomness produces different ciphertexts', () => {
    const ct1 = encrypt(10n, publicKey, 1n);
    const ct2 = encrypt(10n, publicKey, 2n);
    expect(ct1.c1_x).not.toBe(ct2.c1_x);
  });
});

// ---------------------------------------------------------------------------
// Homomorphic operations
// ---------------------------------------------------------------------------

describe('addCiphertexts()', () => {
  const privateKey = 42n;
  const publicKey = scalarMult(privateKey, getGenerator());

  it('Enc(a) + Enc(b) decrypts to a + b', () => {
    const a = 7n;
    const b = 13n;
    const r1 = 100n;
    const r2 = 200n;
    const ctA = encrypt(a, publicKey, r1);
    const ctB = encrypt(b, publicKey, r2);
    const ctSum = addCiphertexts(ctA, ctB);
    const result = decrypt(ctSum, privateKey, 2n ** 20n);
    expect(result).toBe(a + b);
  });
});

describe('subtractCiphertexts()', () => {
  const privateKey = 42n;
  const publicKey = scalarMult(privateKey, getGenerator());

  it('Enc(a) - Enc(b) decrypts to a - b when a > b', () => {
    const a = 20n;
    const b = 7n;
    const ctA = encrypt(a, publicKey, 100n);
    const ctB = encrypt(b, publicKey, 200n);
    const ctDiff = subtractCiphertexts(ctA, ctB);
    const result = decrypt(ctDiff, privateKey, 2n ** 20n);
    expect(result).toBe(a - b);
  });
});

describe('scalarMultCiphertext()', () => {
  const privateKey = 42n;
  const publicKey = scalarMult(privateKey, getGenerator());

  it('k * Enc(m) decrypts to k * m', () => {
    const m = 5n;
    const k = 3n;
    const ct = encrypt(m, publicKey, 100n);
    const ctScaled = scalarMultCiphertext(k, ct);
    const result = decrypt(ctScaled, privateKey, 2n ** 20n);
    expect(result).toBe(k * m);
  });
});

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

describe('ciphertextToFelts() / feltsToChiphertext()', () => {
  it('roundtrips a ciphertext through felt serialization', () => {
    const privateKey = 42n;
    const publicKey = scalarMult(privateKey, getGenerator());
    const ct = encrypt(10n, publicKey, 55n);
    const felts = ciphertextToFelts(ct);
    expect(felts).toHaveLength(4);
    expect(felts[0].startsWith('0x')).toBe(true);

    const bigFelts = felts.map(f => BigInt(f));
    const restored = feltsToChiphertext(bigFelts);
    expect(restored.c1_x).toBe(ct.c1_x);
    expect(restored.c1_y).toBe(ct.c1_y);
    expect(restored.c2_x).toBe(ct.c2_x);
    expect(restored.c2_y).toBe(ct.c2_y);
  });
});

describe('pointToFelts() / feltsToPoint()', () => {
  it('roundtrips a point through felt serialization', () => {
    const g = getGenerator();
    const felts = pointToFelts(g);
    expect(felts).toHaveLength(2);
    const restored = feltsToPoint(felts.map(f => BigInt(f)));
    expect(restored.x).toBe(g.x);
    expect(restored.y).toBe(g.y);
  });
});

describe('tonelliShanks()', () => {
  it('computes sqrt for small prime p ≡ 1 (mod 4)', () => {
    // p = 5, 4 ≡ 1 (mod 5) → sqrt = 2 or 3
    const root = tonelliShanks(4n, 5n);
    expect(root).not.toBeNull();
    expect(mod(root! * root!, 5n)).toBe(4n);
  });

  it('computes sqrt for the STARK prime', () => {
    // y^2 for the generator point G
    const g = getGenerator();
    const y2 = mod(g.y * g.y, STARK_PRIME);
    const root = tonelliShanks(y2, STARK_PRIME);
    expect(root).not.toBeNull();
    expect(mod(root! * root!, STARK_PRIME)).toBe(y2);
    // root should be either g.y or -g.y
    expect(root === g.y || root === mod(-g.y, STARK_PRIME)).toBe(true);
  });

  it('computes sqrt for Pedersen H point', () => {
    const h = getPedersenH();
    const y2 = mod(h.y * h.y, STARK_PRIME);
    const root = tonelliShanks(y2, STARK_PRIME);
    expect(root).not.toBeNull();
    expect(mod(root! * root!, STARK_PRIME)).toBe(y2);
  });

  it('returns null for a quadratic non-residue', () => {
    // 2 is a non-residue mod 5
    expect(tonelliShanks(2n, 5n)).toBeNull();
  });

  it('returns 0 for n = 0', () => {
    expect(tonelliShanks(0n, STARK_PRIME)).toBe(0n);
  });
});

describe('compressPoint() / decompressPoint()', () => {
  it('compressPoint produces a valid compressed encoding', () => {
    const g = getGenerator();
    const compressed = compressPoint(g);
    expect(compressed).toMatch(/^0[23][0-9a-f]{64}$/);
  });

  it('compressPoint preserves x-coordinate in the encoding', () => {
    const g = getGenerator();
    const compressed = compressPoint(g);
    const xHex = compressed.slice(2);
    expect(BigInt('0x' + xHex)).toBe(g.x);
  });

  it('decompressPoint recovers x-coordinate correctly', () => {
    const g = getGenerator();
    const compressed = compressPoint(g);
    const decompressed = decompressPoint(compressed);
    expect(decompressed.x).toBe(g.x);
  });

  it('decompressPoint roundtrip recovers G exactly', () => {
    const g = getGenerator();
    const compressed = compressPoint(g);
    const decompressed = decompressPoint(compressed);
    expect(decompressed.x).toBe(g.x);
    expect(decompressed.y).toBe(g.y);
  });

  it('decompressPoint roundtrip recovers H exactly', () => {
    const h = getPedersenH();
    const compressed = compressPoint(h);
    const decompressed = decompressPoint(compressed);
    expect(decompressed.x).toBe(h.x);
    expect(decompressed.y).toBe(h.y);
  });

  it('decompressPoint roundtrip works for arbitrary on-curve points', () => {
    // Test with several scalar multiples of G
    const g = getGenerator();
    for (const k of [2n, 7n, 42n, 1000n]) {
      const p = scalarMult(k, g);
      const compressed = compressPoint(p);
      const decompressed = decompressPoint(compressed);
      expect(decompressed.x).toBe(p.x);
      expect(decompressed.y).toBe(p.y);
    }
  });

  it('decompressed point is on the curve', () => {
    const g = getGenerator();
    const compressed = compressPoint(g);
    const decompressed = decompressPoint(compressed);
    expect(isOnCurve(decompressed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateKeyPair()
// ---------------------------------------------------------------------------

describe('generateKeyPair()', () => {
  it('generates a keypair with public key on the curve', () => {
    const kp = generateKeyPair();
    expect(kp.privateKey).toBeGreaterThan(0n);
    expect(isOnCurve(kp.publicKey)).toBe(true);
  });

  it('public key = privateKey * G', () => {
    const kp = generateKeyPair();
    const expectedPub = scalarMult(kp.privateKey, getGenerator());
    expect(kp.publicKey.x).toBe(expectedPub.x);
    expect(kp.publicKey.y).toBe(expectedPub.y);
  });
});

// ---------------------------------------------------------------------------
// verifyCiphertext()
// ---------------------------------------------------------------------------

describe('verifyCiphertext()', () => {
  it('returns true for a valid ciphertext', () => {
    const publicKey = scalarMult(42n, getGenerator());
    const ct = encrypt(10n, publicKey, 55n);
    expect(verifyCiphertext(ct)).toBe(true);
  });

  it('returns false for a ciphertext with off-curve points', () => {
    const ct = { c1_x: 1n, c1_y: 1n, c2_x: 2n, c2_y: 2n };
    expect(verifyCiphertext(ct)).toBe(false);
  });
});
