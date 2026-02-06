// Pedersen commitments for hiding values with blinding factors
// Used for confidential transfers and privacy pool operations

import { Point, scalarMul, pointAdd, G, POINT_AT_INFINITY } from "./elgamal";
import { CURVE_ORDER, GENERATOR_X } from "./constants";

// Second generator H for Pedersen commitments
// Derived via hash-to-curve (try-and-increment) with Poseidon
// Domain: "OBELYSK_PEDERSEN_H_V1" | Counter: 0
// Matches contracts/src/elgamal.cairo GEN_H_X/GEN_H_Y
// Nobody knows dlog_G(H) — binding property holds
export const H: Point = {
  x: BigInt("0x73bd2c9434c955f80b06d2847f8384a226d6cc2557a5735fd9f84d632f576be"),
  y: BigInt("0x1bd58ea52858154de69bf90e446ff200f173d49da444c4f462652ce6b93457e"),
};

export interface PedersenCommitment {
  commitment: Point;
  value: bigint;
  blinding: bigint;
}

// Create a Pedersen commitment: C = v*G + r*H
export function commit(value: bigint, blinding?: bigint): PedersenCommitment {
  const r = blinding ?? generateRandomScalar();

  const vG = scalarMul(value, G);
  const rH = scalarMul(r, H);
  const commitment = pointAdd(vG, rH);

  return {
    commitment,
    value,
    blinding: r,
  };
}

// Verify a Pedersen commitment
export function verifyCommitment(
  commitment: Point,
  value: bigint,
  blinding: bigint
): boolean {
  const expected = commit(value, blinding);
  return (
    commitment.x === expected.commitment.x &&
    commitment.y === expected.commitment.y
  );
}

// Add two commitments (homomorphic addition)
export function addCommitments(c1: PedersenCommitment, c2: PedersenCommitment): PedersenCommitment {
  return {
    commitment: pointAdd(c1.commitment, c2.commitment),
    value: c1.value + c2.value,
    blinding: (c1.blinding + c2.blinding) % CURVE_ORDER,
  };
}

// Subtract one commitment from another
export function subtractCommitments(c1: PedersenCommitment, c2: PedersenCommitment): PedersenCommitment {
  const negC2: Point = {
    x: c2.commitment.x,
    y: (-c2.commitment.y % BigInt("0x800000000000011000000000000000000000000000000000000000000000001") + BigInt("0x800000000000011000000000000000000000000000000000000000000000001")) % BigInt("0x800000000000011000000000000000000000000000000000000000000000001"),
  };

  return {
    commitment: pointAdd(c1.commitment, negC2),
    value: c1.value - c2.value,
    blinding: (c1.blinding - c2.blinding + CURVE_ORDER) % CURVE_ORDER,
  };
}

// Generate a random scalar
function generateRandomScalar(): bigint {
  // In production, use a cryptographically secure random number generator
  const randomHex = Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return BigInt("0x" + randomHex) % CURVE_ORDER;
}

// Create a range proof that value is in [0, 2^n)
// This is a simplified placeholder - real implementation uses bulletproofs
export interface RangeProof {
  commitment: Point;
  proof: bigint[];
}

export function createRangeProof(value: bigint, blinding: bigint, bits: number = 64): RangeProof {
  const { commitment } = commit(value, blinding);

  // Placeholder for actual range proof
  // In production, implement bulletproofs or similar
  return {
    commitment,
    proof: [value, blinding], // NOT a real proof - for development only
  };
}

export function verifyRangeProof(proof: RangeProof, bits: number = 64): boolean {
  // Placeholder verification
  // In production, verify the actual bulletproof
  return proof.proof.length > 0;
}

// Balance proof: prove that sum(inputs) = sum(outputs) + fee
export interface BalanceProof {
  inputCommitments: Point[];
  outputCommitments: Point[];
  feeCommitment: Point;
  proof: bigint;
}

export function createBalanceProof(
  inputs: PedersenCommitment[],
  outputs: PedersenCommitment[],
  fee: bigint
): BalanceProof {
  const feeCommitment = commit(fee, 0n);

  // The sum of input commitments should equal sum of output commitments + fee
  // Sum of blindings should also cancel out
  const blindingDiff = inputs.reduce((sum, c) => sum + c.blinding, 0n) -
    outputs.reduce((sum, c) => sum + c.blinding, 0n);

  return {
    inputCommitments: inputs.map(c => c.commitment),
    outputCommitments: outputs.map(c => c.commitment),
    feeCommitment: feeCommitment.commitment,
    proof: blindingDiff,
  };
}
