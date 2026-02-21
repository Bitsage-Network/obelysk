/**
 * Pedersen Commitments for Privacy Pool
 *
 * Implements Pedersen commitments C = g^v * h^r
 * Used for hiding token values in privacy pool deposits.
 */

import {
  PEDERSEN_H_X,
  PEDERSEN_H_Y,
  CURVE_ORDER,
  STARK_PRIME,
  type ECPoint,
} from "./constants";
import {
  getGenerator,
  scalarMult,
  addPoints,
  randomScalar,
  mod,
  isOnCurve,
  pointToFelts,
} from "./elgamal";
import { hash } from "starknet";

// Get the Pedersen H generator (second generator)
export function getPedersenH(): ECPoint {
  return { x: PEDERSEN_H_X, y: PEDERSEN_H_Y };
}

// Create a Pedersen commitment: C = g^value * h^blinding
export function commit(value: bigint, blinding: bigint): ECPoint {
  const g = getGenerator();
  const h = getPedersenH();

  const gV = scalarMult(mod(value, CURVE_ORDER), g);
  const hR = scalarMult(mod(blinding, CURVE_ORDER), h);

  return addPoints(gV, hR);
}

// Create a commitment with random blinding factor
export function commitWithRandomBlinding(value: bigint): {
  commitment: ECPoint;
  blinding: bigint;
} {
  const blinding = randomScalar();
  const commitment = commit(value, blinding);
  return { commitment, blinding };
}

// Verify a commitment opening
export function verifyOpening(
  commitment: ECPoint,
  value: bigint,
  blinding: bigint
): boolean {
  const expectedCommitment = commit(value, blinding);
  return commitment.x === expectedCommitment.x && commitment.y === expectedCommitment.y;
}

// Add two commitments: C1 + C2 = commit(v1 + v2, r1 + r2)
export function addCommitments(c1: ECPoint, c2: ECPoint): ECPoint {
  return addPoints(c1, c2);
}

// Subtract commitments: C1 - C2 = commit(v1 - v2, r1 - r2)
export function subtractCommitments(c1: ECPoint, c2: ECPoint): ECPoint {
  const negC2: ECPoint = { x: c2.x, y: mod(-c2.y, STARK_PRIME) };
  return addPoints(c1, negC2);
}

// Scalar multiply commitment: k * C = commit(k * v, k * r)
export function scalarMultCommitment(k: bigint, c: ECPoint): ECPoint {
  return scalarMult(k, c);
}

// Verify commitment is on curve
export function verifyCommitment(c: ECPoint): boolean {
  return isOnCurve(c);
}

// Convert commitment to felt252 (Poseidon hash for on-chain storage)
export function commitmentToFelt(commitment: ECPoint): string {
  const felt = BigInt(
    hash.computePoseidonHash(
      commitment.x.toString(),
      commitment.y.toString()
    )
  );
  return "0x" + felt.toString(16);
}

// Create a privacy note with commitment
export interface NoteData {
  value: bigint;           // Token amount (in wei)
  blinding: bigint;        // Random blinding factor
  nullifierSecret: bigint; // Secret for nullifier derivation
  commitment: ECPoint;     // The Pedersen commitment
}

export function createNote(value: bigint): NoteData {
  const blinding = randomScalar();
  const nullifierSecret = randomScalar();
  const commitment = commit(value, blinding);

  return {
    value,
    blinding,
    nullifierSecret,
    commitment,
  };
}

// Serialize note for storage (encrypted externally)
export function serializeNote(note: NoteData): string {
  return JSON.stringify({
    value: note.value.toString(),
    blinding: note.blinding.toString(),
    nullifierSecret: note.nullifierSecret.toString(),
    commitment: {
      x: note.commitment.x.toString(),
      y: note.commitment.y.toString(),
    },
  });
}

// Deserialize note from storage
export function deserializeNote(data: string): NoteData {
  const parsed = JSON.parse(data);
  return {
    value: BigInt(parsed.value),
    blinding: BigInt(parsed.blinding),
    nullifierSecret: BigInt(parsed.nullifierSecret),
    commitment: {
      x: BigInt(parsed.commitment.x),
      y: BigInt(parsed.commitment.y),
    },
  };
}

// Convert value to fixed denomination
export function valueToFixedDenomination(
  value: number,
  decimals: number = 18
): bigint {
  return BigInt(Math.round(value * Math.pow(10, decimals)));
}

// Convert fixed denomination to readable value
export function fixedDenominationToValue(
  fixedValue: bigint,
  decimals: number = 18
): number {
  return Number(fixedValue) / Math.pow(10, decimals);
}

// Generate range proof data (simplified - in production use Bulletproofs)
export interface RangeProofData {
  commitment: ECPoint;
  value: bigint;
  blinding: bigint;
  bits: number;
  // In production: actual range proof bytes
}

export function generateRangeProof(
  value: bigint,
  blinding: bigint,
  bits: number = 64
): RangeProofData {
  const commitment = commit(value, blinding);

  // Verify value is in range [0, 2^bits)
  if (value < 0n || value >= (1n << BigInt(bits))) {
    throw new Error(`Value out of range [0, 2^${bits})`);
  }

  return {
    commitment,
    value,
    blinding,
    bits,
  };
}

// Verify range proof (simplified)
export function verifyRangeProof(proof: RangeProofData): boolean {
  // Verify commitment matches
  const expectedCommitment = commit(proof.value, proof.blinding);
  if (
    proof.commitment.x !== expectedCommitment.x ||
    proof.commitment.y !== expectedCommitment.y
  ) {
    return false;
  }

  // Verify value in range
  return proof.value >= 0n && proof.value < (1n << BigInt(proof.bits));
}

// Export commitment for contract call
export function commitmentToContractFormat(commitment: ECPoint): {
  x: string;
  y: string;
} {
  return {
    x: "0x" + commitment.x.toString(16),
    y: "0x" + commitment.y.toString(16),
  };
}
