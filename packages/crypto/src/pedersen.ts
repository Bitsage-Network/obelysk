// Pedersen commitments for hiding values with blinding factors
// Used for confidential transfers and privacy pool operations

import { Point, scalarMul, pointAdd, G, POINT_AT_INFINITY } from "./elgamal";
import { CURVE_ORDER, GENERATOR_X } from "./constants";

// Second generator H for Pedersen commitments
// H = hash_to_curve("OBELYSK_PEDERSEN_H")
// In production, this should be generated deterministically
export const H: Point = {
  x: BigInt("0x2a6a6e4d3b2c1f0e9d8c7b6a5948372615041302f1e0d9c8b7a6958473625140"),
  y: BigInt("0x3b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c"),
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
