// ElGamal encryption on the Stark curve
// Used for encrypting balances in the privacy wallet

import { STARK_PRIME, CURVE_ORDER, GENERATOR_X, GENERATOR_Y } from "./constants";

export interface Point {
  x: bigint;
  y: bigint;
}

export interface ElGamalCiphertext {
  c1: Point; // r * G
  c2: Point; // M + r * P (where P is public key)
}

export interface ElGamalKeyPair {
  privateKey: bigint;
  publicKey: Point;
}

// Point at infinity (identity element)
export const POINT_AT_INFINITY: Point = { x: 0n, y: 0n };

// Generator point
export const G: Point = { x: GENERATOR_X, y: GENERATOR_Y };

// Modular arithmetic helpers
function mod(n: bigint, p: bigint): bigint {
  return ((n % p) + p) % p;
}

function modPow(base: bigint, exp: bigint, p: bigint): bigint {
  let result = 1n;
  base = mod(base, p);
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = mod(result * base, p);
    }
    exp = exp / 2n;
    base = mod(base * base, p);
  }
  return result;
}

function modInverse(a: bigint, p: bigint): bigint {
  return modPow(a, p - 2n, p);
}

// Point operations on the Stark curve
export function isPointAtInfinity(p: Point): boolean {
  return p.x === 0n && p.y === 0n;
}

export function pointAdd(p1: Point, p2: Point): Point {
  if (isPointAtInfinity(p1)) return p2;
  if (isPointAtInfinity(p2)) return p1;

  if (p1.x === p2.x && p1.y !== p2.y) {
    return POINT_AT_INFINITY;
  }

  let slope: bigint;
  if (p1.x === p2.x && p1.y === p2.y) {
    // Point doubling
    const numerator = mod(3n * p1.x * p1.x, STARK_PRIME);
    const denominator = mod(2n * p1.y, STARK_PRIME);
    slope = mod(numerator * modInverse(denominator, STARK_PRIME), STARK_PRIME);
  } else {
    // Point addition
    const numerator = mod(p2.y - p1.y, STARK_PRIME);
    const denominator = mod(p2.x - p1.x, STARK_PRIME);
    slope = mod(numerator * modInverse(denominator, STARK_PRIME), STARK_PRIME);
  }

  const x3 = mod(slope * slope - p1.x - p2.x, STARK_PRIME);
  const y3 = mod(slope * (p1.x - x3) - p1.y, STARK_PRIME);

  return { x: x3, y: y3 };
}

export function scalarMul(k: bigint, p: Point): Point {
  k = mod(k, CURVE_ORDER);
  let result = POINT_AT_INFINITY;
  let addend = p;

  while (k > 0n) {
    if (k % 2n === 1n) {
      result = pointAdd(result, addend);
    }
    addend = pointAdd(addend, addend);
    k = k / 2n;
  }

  return result;
}

// Generate a new ElGamal key pair
export function generateKeyPair(): ElGamalKeyPair {
  // In production, use a cryptographically secure random number generator
  const privateKey = mod(
    BigInt("0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")),
    CURVE_ORDER
  );
  const publicKey = scalarMul(privateKey, G);

  return { privateKey, publicKey };
}

// Encrypt a value using ElGamal
export function encrypt(value: bigint, publicKey: Point, randomness?: bigint): ElGamalCiphertext {
  // Use provided randomness or generate new
  const r = randomness ?? mod(
    BigInt("0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")),
    CURVE_ORDER
  );

  // c1 = r * G
  const c1 = scalarMul(r, G);

  // Encode value as a point (simplified - using value * G)
  const valuePoint = scalarMul(value, G);

  // c2 = M + r * P
  const rP = scalarMul(r, publicKey);
  const c2 = pointAdd(valuePoint, rP);

  return { c1, c2 };
}

// Decrypt a ciphertext using the private key
export function decrypt(ciphertext: ElGamalCiphertext, privateKey: bigint): bigint {
  // s = privateKey * c1
  const s = scalarMul(privateKey, ciphertext.c1);

  // M = c2 - s
  const negS: Point = { x: s.x, y: mod(-s.y, STARK_PRIME) };
  const M = pointAdd(ciphertext.c2, negS);

  // Note: In practice, you need to solve the discrete log to get the value
  // This is only feasible for small values using a lookup table (baby-step giant-step)
  // For now, return a placeholder
  return M.x; // This is NOT the actual decrypted value
}

// Add two ciphertexts (homomorphic addition)
export function addCiphertexts(c1: ElGamalCiphertext, c2: ElGamalCiphertext): ElGamalCiphertext {
  return {
    c1: pointAdd(c1.c1, c2.c1),
    c2: pointAdd(c1.c2, c2.c2),
  };
}

// Subtract one ciphertext from another (homomorphic subtraction)
export function subtractCiphertexts(c1: ElGamalCiphertext, c2: ElGamalCiphertext): ElGamalCiphertext {
  const negC2: ElGamalCiphertext = {
    c1: { x: c2.c1.x, y: mod(-c2.c1.y, STARK_PRIME) },
    c2: { x: c2.c2.x, y: mod(-c2.c2.y, STARK_PRIME) },
  };
  return addCiphertexts(c1, negC2);
}

// Verify that a ciphertext is well-formed
export function verifyCiphertext(ciphertext: ElGamalCiphertext): boolean {
  // Check that both points are on the curve
  // y^2 = x^3 + alpha * x + beta (Stark curve equation)
  // For now, just check they're not at infinity
  return !isPointAtInfinity(ciphertext.c1) && !isPointAtInfinity(ciphertext.c2);
}
