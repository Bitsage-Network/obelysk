// ElGamal encryption on the Stark curve
// Ported from apps/web/src/lib/crypto/elgamal.ts (secure reference implementation)

import { STARK_PRIME, CURVE_ORDER, CURVE_A, CURVE_B, GENERATOR_X, GENERATOR_Y, PEDERSEN_H_X, PEDERSEN_H_Y } from "./constants";

// Runtime check for secure random
if (typeof crypto === "undefined" || !crypto.getRandomValues) {
  throw new Error("Secure random required: crypto.getRandomValues is not available");
}

export interface Point {
  x: bigint;
  y: bigint;
}

export interface ElGamalCiphertext {
  c1: Point; // r * G
  c2: Point; // M + r * PK (where PK is public key)
}

export interface ElGamalKeyPair {
  privateKey: bigint;
  publicKey: Point;
}

// Point at infinity (identity element)
export const POINT_AT_INFINITY: Point = { x: 0n, y: 0n };

// Generator point G
export const G: Point = { x: GENERATOR_X, y: GENERATOR_Y };

// Pedersen H generator (second generator for amount encoding)
export const H: Point = { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };

// Modular arithmetic helpers
export function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result < 0n ? result + p : result;
}

export function modPow(base: bigint, exp: bigint, p: bigint): bigint {
  if (p === 1n) return 0n;
  let result = 1n;
  base = mod(base, p);
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = mod(result * base, p);
    }
    exp = exp >> 1n;
    base = mod(base * base, p);
  }
  return result;
}

export function modInverse(a: bigint, p: bigint): bigint {
  let [old_r, r] = [a, p];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  return mod(old_s, p);
}

// Point operations on the Stark curve

export function isPointAtInfinity(p: Point): boolean {
  return p.x === 0n && p.y === 0n;
}

// Check if point is on the curve: y^2 = x^3 + A*x + B
export function isOnCurve(p: Point): boolean {
  if (isPointAtInfinity(p)) return true;
  const left = mod(p.y * p.y, STARK_PRIME);
  const right = mod(p.x * p.x * p.x + CURVE_A * p.x + CURVE_B, STARK_PRIME);
  return left === right;
}

// Point negation
export function negatePoint(p: Point): Point {
  if (isPointAtInfinity(p)) return POINT_AT_INFINITY;
  return { x: p.x, y: mod(-p.y, STARK_PRIME) };
}

export function pointAdd(p1: Point, p2: Point): Point {
  if (isPointAtInfinity(p1)) return p2;
  if (isPointAtInfinity(p2)) return p1;

  // Check if points are inverses
  if (p1.x === p2.x && p1.y === mod(-p2.y, STARK_PRIME)) {
    return POINT_AT_INFINITY;
  }

  let slope: bigint;
  if (p1.x === p2.x && p1.y === p2.y) {
    // Point doubling: slope = (3*x^2 + A) / (2*y)
    const numerator = mod(3n * p1.x * p1.x + CURVE_A, STARK_PRIME);
    const denominator = modInverse(mod(2n * p1.y, STARK_PRIME), STARK_PRIME);
    slope = mod(numerator * denominator, STARK_PRIME);
  } else {
    // Point addition
    const numerator = mod(p2.y - p1.y, STARK_PRIME);
    const denominator = modInverse(mod(p2.x - p1.x, STARK_PRIME), STARK_PRIME);
    slope = mod(numerator * denominator, STARK_PRIME);
  }

  const x3 = mod(slope * slope - p1.x - p2.x, STARK_PRIME);
  const y3 = mod(slope * (p1.x - x3) - p1.y, STARK_PRIME);

  return { x: x3, y: y3 };
}

// Montgomery ladder scalar multiplication (constant-time w.r.t. scalar bits)
export function scalarMul(k: bigint, p: Point): Point {
  if (k === 0n || isPointAtInfinity(p)) return POINT_AT_INFINITY;
  if (k < 0n) {
    k = mod(-k, CURVE_ORDER);
    p = negatePoint(p);
  }
  k = mod(k, CURVE_ORDER);
  if (k === 0n) return POINT_AT_INFINITY;

  // Find highest bit position
  let bitLen = 0;
  let tmp = k;
  while (tmp > 0n) {
    bitLen++;
    tmp >>= 1n;
  }

  // Montgomery ladder: R0 = O (identity), R1 = P
  let R0: Point = POINT_AT_INFINITY;
  let R1: Point = p;

  for (let i = bitLen - 1; i >= 0; i--) {
    const bit = (k >> BigInt(i)) & 1n;
    if (bit === 0n) {
      R1 = pointAdd(R0, R1);
      R0 = pointAdd(R0, R0);
    } else {
      R0 = pointAdd(R0, R1);
      R1 = pointAdd(R1, R1);
    }
  }

  return R0;
}

// Generate a cryptographically secure random scalar in [1, CURVE_ORDER)
export function randomScalar(): bigint {
  for (;;) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let scalar = 0n;
    for (let i = 0; i < 32; i++) {
      scalar = (scalar << 8n) | BigInt(bytes[i]);
    }
    const result = mod(scalar, CURVE_ORDER);
    if (result !== 0n) return result;
  }
}

// Generate a new ElGamal key pair
export function generateKeyPair(): ElGamalKeyPair {
  const privateKey = randomScalar();
  const publicKey = scalarMul(privateKey, G);
  return { privateKey, publicKey };
}

// Encrypt a value using ElGamal
// Uses H (not G) for amount encoding — critical for security
// C1 = r * G, C2 = m * H + r * PK
export function encrypt(value: bigint, publicKey: Point, randomness?: bigint): ElGamalCiphertext {
  const r = randomness ?? randomScalar();

  // c1 = r * G (randomness point)
  const c1 = scalarMul(r, G);

  // c2 = m * H + r * PK (encrypted amount using Pedersen H)
  const mH = scalarMul(value, H);
  const rP = scalarMul(r, publicKey);
  const c2 = pointAdd(mH, rP);

  return { c1, c2 };
}

// Decrypt a ciphertext using the private key via BSGS on H
export function decrypt(ciphertext: ElGamalCiphertext, privateKey: bigint, maxValue: bigint = 2n ** 40n): bigint {
  // Compute C2 - sk * C1 = m * H
  const s = scalarMul(privateKey, ciphertext.c1);
  const negS = negatePoint(s);
  const mH = pointAdd(ciphertext.c2, negS);

  // Baby-step giant-step to find m where m * H = mH
  return babystepGiantstepH(mH, maxValue);
}

// BSGS for discrete log base H
function babystepGiantstepH(target: Point, maxValue: bigint): bigint {
  const m = BigInt(Math.ceil(Math.sqrt(Number(maxValue))));

  // Baby steps: compute i*H for i = 0 to m-1
  const babySteps = new Map<string, bigint>();
  let current = POINT_AT_INFINITY;
  for (let i = 0n; i <= m; i++) {
    const key = `${current.x},${current.y}`;
    babySteps.set(key, i);
    current = pointAdd(current, H);
  }

  // Giant step: -m * H
  const mH = scalarMul(m, H);
  const negMH = negatePoint(mH);

  // Giant steps: check target - j*m*H
  let gamma = target;
  for (let j = 0n; j <= m; j++) {
    const key = `${gamma.x},${gamma.y}`;
    const i = babySteps.get(key);
    if (i !== undefined) {
      return j * m + i;
    }
    gamma = pointAdd(gamma, negMH);
  }

  throw new Error("Discrete log not found within range");
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
    c1: negatePoint(c2.c1),
    c2: negatePoint(c2.c2),
  };
  return addCiphertexts(c1, negC2);
}

// Verify that a ciphertext is well-formed (both points on curve)
export function verifyCiphertext(ciphertext: ElGamalCiphertext): boolean {
  return isOnCurve(ciphertext.c1) && isOnCurve(ciphertext.c2);
}

// Tonelli-Shanks modular square root
export function tonelliShanks(n: bigint, p: bigint): bigint | null {
  if (n === 0n) return 0n;
  if (modPow(n, (p - 1n) / 2n, p) !== 1n) return null;

  let q = p - 1n;
  let s = 0n;
  while (q % 2n === 0n) {
    q /= 2n;
    s += 1n;
  }

  let z = 2n;
  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) {
    z += 1n;
  }

  let m = s;
  let c = modPow(z, q, p);
  let t = modPow(n, q, p);
  let r = modPow(n, (q + 1n) / 2n, p);

  while (true) {
    if (t === 1n) return r;

    let i = 1n;
    let tmp = mod(t * t, p);
    while (tmp !== 1n) {
      tmp = mod(tmp * tmp, p);
      i += 1n;
    }

    const b = modPow(c, modPow(2n, m - i - 1n, p - 1n), p);
    m = i;
    c = mod(b * b, p);
    t = mod(t * c, p);
    r = mod(r * b, p);
  }
}
