/**
 * Stark Curve and Cryptographic Constants
 *
 * The Stark curve is an elliptic curve defined over the Stark field.
 * Used for ElGamal encryption and Pedersen commitments on Starknet.
 */

// Stark field prime: p = 2^251 + 17 * 2^192 + 1
export const STARK_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);

// Stark curve order (number of points on the curve)
export const CURVE_ORDER = BigInt(
  "0x800000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2f"
);

// Generator point G for the Stark curve
export const GENERATOR_X = BigInt(
  "0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca"
);
export const GENERATOR_Y = BigInt(
  "0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f"
);

// Second generator H for Pedersen commitments
// Derived via hash-to-curve (try-and-increment) with Poseidon
// Domain: "OBELYSK_PEDERSEN_H_V1" | Counter: 0
// Derivation script: scripts/deriveH.ts
// Nobody knows dlog_G(H) — binding property holds
export const PEDERSEN_H_X = BigInt(
  "0x73bd2c9434c955f80b06d2847f8384a226d6cc2557a5735fd9f84d632f576be"
);
export const PEDERSEN_H_Y = BigInt(
  "0x1bd58ea52858154de69bf90e446ff200f173d49da444c4f462652ce6b93457e"
);

// Curve parameter A (Stark curve: y^2 = x^3 + A*x + B)
export const CURVE_A = BigInt(1);
export const CURVE_B = BigInt(
  "0x6f21413efbe40de150e596d72f7a8c5609ad26c15c915c1f4cdfcb99cee9e89"
);

// Point at infinity representation
export const POINT_AT_INFINITY = { x: BigInt(0), y: BigInt(0) };

// ECPoint interface for curve points
export interface ECPoint {
  x: bigint;
  y: bigint;
}

// ElGamal ciphertext structure (matches on-chain format)
export interface ElGamalCiphertext {
  c1_x: bigint;  // (g^r)_x
  c1_y: bigint;  // (g^r)_y
  c2_x: bigint;  // (m * pk^r)_x
  c2_y: bigint;  // (m * pk^r)_y
}

// Privacy key pair
export interface PrivacyKeyPair {
  publicKey: ECPoint;
  privateKey: bigint;
}

// Stored key format (encrypted)
export interface StoredPrivacyKey {
  publicKey: ECPoint;
  encryptedPrivateKey: string;  // Base64 encoded AES-GCM ciphertext
  iv: string;                    // Base64 encoded IV
  salt: string;                  // Base64 encoded salt for HKDF
  version: number;               // Key version for rotation
  createdAt: number;             // Timestamp
}

// Note structure for privacy pool
export interface PrivacyNote {
  denomination: number;
  commitment: string;
  nullifierSecret: string;
  blinding: string;
  leafIndex: number;
  depositTxHash: string;
  createdAt: number;
  spent: boolean;
  spentTxHash?: string;
  // Which token this note represents (SAGE, ETH, STRK, USDC, wBTC)
  // Omitted = SAGE (backward-compatible with existing notes)
  tokenSymbol?: string;
  // ElGamal encrypted amount - for homomorphic reveal
  encryptedAmount?: ElGamalCiphertext;
  // Encryption randomness (needed for re-encryption proofs)
  encryptionRandomness?: string;
}

// Fixed denominations for privacy pool (in SAGE)
export const PRIVACY_DENOMINATIONS = [0.1, 1, 10, 100, 1000] as const;
export type PrivacyDenomination = typeof PRIVACY_DENOMINATIONS[number];

// Proof types
export type CircuitType = 'withdraw' | 'transfer' | 'range' | 'merkle_membership';

// Domain separator for key derivation
export const KEY_DERIVATION_DOMAIN = "BitSage Privacy Key v1";

// IndexedDB database name and stores
export const PRIVACY_DB_NAME = "bitsage-privacy";
export const PRIVACY_DB_VERSION = 1;
export const KEY_STORE_NAME = "privacy-keys";
export const NOTE_STORE_NAME = "privacy-notes";
export const PROVING_KEY_STORE_NAME = "proving-keys";
