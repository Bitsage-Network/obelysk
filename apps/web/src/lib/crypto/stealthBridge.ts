/**
 * Stealth Address Derivation for Garden Bridge
 *
 * Closes privacy gap #3 partially — Garden Finance can no longer link
 * bridge destinations to the user's main wallet.
 *
 * Uses the same stealth address scheme as stealth_payments.cairo:
 *   1. Receiver publishes (spendPK, viewPK) as their meta-address
 *   2. Sender generates ephemeral keypair (r, R = r*G)
 *   3. Shared secret: s = H(r * viewPK)
 *   4. Stealth public key: P_stealth = spendPK + s*G
 *   5. Stealth private key: sk_stealth = spendSK + s (only receiver can compute)
 *
 * Each bridge order uses a unique ephemeral key, producing a unique
 * stealth address that is unlinkable to the user's base keys.
 */

import {
  CURVE_ORDER,
  type ECPoint,
} from "./constants";
import {
  getGenerator,
  scalarMult,
  addPoints,
  randomScalar,
  mod,
} from "./elgamal";
import { poseidonHash } from "./nullifier";

export interface StealthAddressResult {
  /** The stealth public key (use as bridge destination) */
  stealthPublicKey: ECPoint;
  /** Ephemeral public key R (must be stored/published for receiver to find) */
  ephemeralPublicKey: ECPoint;
  /** Ephemeral secret scalar (only needed during derivation; discard after storing R) */
  ephemeralSecret: bigint;
  /** Shared secret hash s = H(r * viewPK) */
  sharedSecretHash: bigint;
}

export interface StealthRecovery {
  /** The stealth private key: sk_stealth = spendSK + s */
  stealthPrivateKey: bigint;
  /** The stealth public key (for verification) */
  stealthPublicKey: ECPoint;
}

/**
 * Derive a fresh stealth address for a bridge payment.
 *
 * @param spendPK - Receiver's spend public key
 * @param viewPK - Receiver's view public key
 * @returns Stealth address data including ephemeral key for later claiming
 */
export function deriveStealthAddressForBridge(
  spendPK: ECPoint,
  viewPK: ECPoint
): StealthAddressResult {
  const G = getGenerator();

  // Generate ephemeral keypair
  const r = randomScalar();
  const R = scalarMult(r, G);

  // ECDH shared secret: r * viewPK
  const sharedPoint = scalarMult(r, viewPK);

  // Hash shared secret to scalar: s = H(sharedPoint.x, sharedPoint.y)
  const s = mod(poseidonHash([sharedPoint.x, sharedPoint.y]), CURVE_ORDER);

  // Stealth public key: P = spendPK + s*G
  const sG = scalarMult(s, G);
  const stealthPK = addPoints(spendPK, sG);

  return {
    stealthPublicKey: stealthPK,
    ephemeralPublicKey: R,
    ephemeralSecret: r,
    sharedSecretHash: s,
  };
}

/**
 * Recover the stealth private key (receiver side).
 *
 * Given the ephemeral public key R from the sender:
 *   s = H(viewSK * R)
 *   sk_stealth = spendSK + s
 *
 * @param spendSK - Receiver's spend private key
 * @param viewSK - Receiver's view private key
 * @param ephemeralPK - Sender's ephemeral public key R
 * @returns The stealth keypair for spending the bridged funds
 */
export function recoverStealthKey(
  spendSK: bigint,
  viewSK: bigint,
  ephemeralPK: ECPoint
): StealthRecovery {
  const G = getGenerator();

  // Reconstruct shared secret: viewSK * R = viewSK * r * G = r * viewPK
  const sharedPoint = scalarMult(viewSK, ephemeralPK);
  const s = mod(poseidonHash([sharedPoint.x, sharedPoint.y]), CURVE_ORDER);

  // Stealth private key
  const stealthSK = mod(spendSK + s, CURVE_ORDER);
  const stealthPK = scalarMult(stealthSK, G);

  return {
    stealthPrivateKey: stealthSK,
    stealthPublicKey: stealthPK,
  };
}

/**
 * Convert an ECPoint to M31 limb representation for VM31 submission.
 * Takes the lower 31 bits of x and y components as 4 u32 values.
 */
export function stealthPKToM31Limbs(pk: ECPoint): [number, number, number, number] {
  const M31_MOD = 0x7FFF_FFFF;
  return [
    Number(pk.x & BigInt(M31_MOD)),
    Number((pk.x >> 31n) & BigInt(M31_MOD)),
    Number(pk.y & BigInt(M31_MOD)),
    Number((pk.y >> 31n) & BigInt(M31_MOD)),
  ];
}
