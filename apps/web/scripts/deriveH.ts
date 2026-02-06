/**
 * Derive canonical Pedersen H generator via hash-to-curve (try-and-increment)
 *
 * Algorithm:
 *   domain = felt252("OBELYSK_PEDERSEN_H_V1")
 *   For counter = 0, 1, 2, ...:
 *     x = Poseidon(domain, counter) mod p
 *     rhs = x³ + x + β  (y² = x³ + αx + β, α=1)
 *     If rhs is a quadratic residue (Legendre symbol == 1):
 *       y = sqrt(rhs) mod p   (Tonelli-Shanks)
 *       Canonicalize: pick y ≤ p/2
 *       Return H = (x, y)
 *
 * Why Poseidon? Both Cairo and starknet.js natively support it,
 * ensuring identical results on-chain and off-chain.
 *
 * Run: npx ts-node apps/web/scripts/deriveH.ts
 */

import { hash } from "starknet";

// =============================================================================
// STARK Curve Constants
// =============================================================================

const STARK_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);
const CURVE_B = BigInt(
  "0x6f21413efbe40de150e596d72f7a8c5609ad26c15c915c1f4cdfcb99cee9e89"
);
const CURVE_A = 1n; // α = 1

// Domain separator: ASCII bytes of "OBELYSK_PEDERSEN_H_V1" as a felt252
// = 0x4f42454c59534b5f504544455253454e5f485f5631
const DOMAIN = BigInt("0x4f42454c59534b5f504544455253454e5f485f5631");

// =============================================================================
// Modular Arithmetic
// =============================================================================

function mod(a: bigint, m: bigint): bigint {
  return ((a % m) + m) % m;
}

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  if (m === 1n) return 0n;
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp % 2n === 1n) result = mod(result * base, m);
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}

/**
 * Tonelli-Shanks square root modulo p.
 * Returns sqrt(n) mod p, or null if n is not a quadratic residue.
 *
 * STARK prime p ≡ 1 (mod 4) with p-1 = 2^192 * q, so we cannot use
 * the simpler (p+1)/4 shortcut. Full Tonelli-Shanks is required.
 */
function sqrtMod(n: bigint, p: bigint): bigint | null {
  n = mod(n, p);
  if (n === 0n) return 0n;

  // Legendre symbol check
  if (modPow(n, (p - 1n) / 2n, p) !== 1n) return null;

  // Factor p-1 = Q * 2^S
  let Q = p - 1n;
  let S = 0n;
  while (Q % 2n === 0n) {
    Q /= 2n;
    S++;
  }

  // Find a quadratic non-residue z
  let z = 2n;
  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) z++;

  let M = S;
  let c = modPow(z, Q, p);
  let t = modPow(n, Q, p);
  let R = modPow(n, (Q + 1n) / 2n, p);

  while (true) {
    if (t === 0n) return 0n;
    if (t === 1n) return R;

    // Find least i such that t^(2^i) ≡ 1 (mod p)
    let i = 1n;
    let tmp = mod(t * t, p);
    while (tmp !== 1n) {
      tmp = mod(tmp * tmp, p);
      i++;
    }

    // Update variables
    let b = c;
    for (let j = 0n; j < M - i - 1n; j++) b = mod(b * b, p);
    M = i;
    c = mod(b * b, p);
    t = mod(t * c, p);
    R = mod(R * b, p);
  }
}

// =============================================================================
// Hash-to-Curve: Try-and-Increment with Poseidon
// =============================================================================

function deriveH(): { x: bigint; y: bigint; counter: number } {
  console.log("=== Obelysk Pedersen H Generator Derivation ===\n");
  console.log(`Domain separator: 0x${DOMAIN.toString(16)}`);
  console.log(`  = ASCII "OBELYSK_PEDERSEN_H_V1"`);
  console.log(`STARK prime p: 0x${STARK_PRIME.toString(16)}`);
  console.log(`Curve: y² = x³ + x + β  (α=1)`);
  console.log(`β: 0x${CURVE_B.toString(16)}\n`);

  for (let counter = 0; counter < 1000; counter++) {
    // x = Poseidon(domain, counter) — using starknet.js
    const domainHex = "0x" + DOMAIN.toString(16);
    const counterHex = "0x" + counter.toString(16);
    const xHex = hash.computePoseidonHash(domainHex, counterHex);
    const x = mod(BigInt(xHex), STARK_PRIME);

    // rhs = x³ + αx + β (mod p)
    const x3 = mod(x * x * x, STARK_PRIME);
    const rhs = mod(x3 + CURVE_A * x + CURVE_B, STARK_PRIME);

    // Legendre symbol: rhs^((p-1)/2) mod p
    const legendre = modPow(rhs, (STARK_PRIME - 1n) / 2n, STARK_PRIME);
    if (legendre !== 1n) {
      console.log(`  counter=${counter}: x=0x${x.toString(16).slice(0, 12)}... → not a QR`);
      continue;
    }

    // Found a quadratic residue — compute square root
    const y_raw = sqrtMod(rhs, STARK_PRIME);
    if (y_raw === null) {
      // Should not happen since Legendre == 1, but be safe
      continue;
    }

    // Canonicalize: pick y ≤ p/2
    const y = y_raw <= STARK_PRIME / 2n ? y_raw : mod(-y_raw, STARK_PRIME);

    // Verify: y² ≡ x³ + x + β (mod p)
    const check = mod(y * y, STARK_PRIME);
    if (check !== rhs) {
      console.error(`  counter=${counter}: sqrt verification FAILED`);
      continue;
    }

    console.log(`\n✓ Found valid curve point at counter=${counter}\n`);
    console.log(`  x = 0x${x.toString(16)}`);
    console.log(`  y = 0x${y.toString(16)}`);
    console.log(`  y² mod p == x³+x+β: ${check === rhs}`);

    return { x, y, counter };
  }

  throw new Error("Failed to find valid curve point in 1000 iterations");
}

// =============================================================================
// Main
// =============================================================================

const { x, y, counter } = deriveH();

console.log("\n=== Output Formats ===\n");

console.log("--- Cairo (contracts/src/elgamal.cairo) ---");
console.log(`/// Second generator H for Pedersen commitments`);
console.log(`/// Derived via hash-to-curve: try-and-increment with Poseidon`);
console.log(`/// Domain: "OBELYSK_PEDERSEN_H_V1" (0x${DOMAIN.toString(16)})`);
console.log(`/// Counter: ${counter}`);
console.log(`/// Nobody knows dlog_G(H) — binding property holds`);
console.log(`pub const GEN_H_X: felt252 = 0x${x.toString(16)};`);
console.log(`pub const GEN_H_Y: felt252 = 0x${y.toString(16)};`);

console.log("\n--- TypeScript (apps/web/src/lib/crypto/constants.ts) ---");
console.log(`// Second generator H for Pedersen commitments`);
console.log(`// Derived via hash-to-curve (try-and-increment) with Poseidon`);
console.log(`// Domain: "OBELYSK_PEDERSEN_H_V1" | Counter: ${counter}`);
console.log(`// Derivation script: scripts/deriveH.ts`);
console.log(`// Nobody knows dlog_G(H) — binding property holds`);
console.log(`export const PEDERSEN_H_X = BigInt("0x${x.toString(16)}");`);
console.log(`export const PEDERSEN_H_Y = BigInt("0x${y.toString(16)}");`);

console.log("\n--- TypeScript (packages/crypto/src/pedersen.ts) ---");
console.log(`export const H: Point = {`);
console.log(`  x: BigInt("0x${x.toString(16)}"),`);
console.log(`  y: BigInt("0x${y.toString(16)}"),`);
console.log(`};`);

console.log("\n=== Verification Data ===");
console.log(`Domain: 0x${DOMAIN.toString(16)}`);
console.log(`Counter: ${counter}`);
console.log(`Poseidon(domain, counter) = 0x${x.toString(16)}`);
console.log(`y² = x³ + x + β (mod p): VERIFIED`);
console.log(`y canonicalized (y ≤ p/2): ${y <= STARK_PRIME / 2n}`);
