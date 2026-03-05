// Pedersen commitments for hiding values with blinding factors
// Used for confidential transfers and privacy pool operations

import { Point, scalarMul, pointAdd, randomScalar, G, H, POINT_AT_INFINITY, negatePoint, mod } from "./elgamal";
import { STARK_PRIME, CURVE_ORDER } from "./constants";

export interface PedersenCommitment {
  commitment: Point;
  value: bigint;
  blinding: bigint;
}

// Create a Pedersen commitment: C = v*G + r*H
export function commit(value: bigint, blinding?: bigint): PedersenCommitment {
  const r = blinding ?? randomScalar();

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
  const negC2 = negatePoint(c2.commitment);

  return {
    commitment: pointAdd(c1.commitment, negC2),
    value: c1.value - c2.value,
    blinding: mod(c1.blinding - c2.blinding, CURVE_ORDER),
  };
}

// Range proof generation is NOT safe to implement here.
// Use generateCairoRangeProof32 from apps/web/src/lib/crypto/zkProofs.ts instead.
export interface RangeProof {
  commitment: Point;
  proof: bigint[];
}

export function createRangeProof(_value: bigint, _blinding: bigint, _bits: number = 64): RangeProof {
  throw new Error(
    "createRangeProof is not implemented in the shared package. " +
    "Use generateCairoRangeProof32 from apps/web/src/lib/crypto/zkProofs.ts"
  );
}

export function verifyRangeProof(_proof: RangeProof, _bits: number = 64): boolean {
  throw new Error(
    "verifyRangeProof is not implemented in the shared package. " +
    "Use verifyRangeProof from apps/web/src/lib/crypto/zkProofs.ts"
  );
}

// Balance proof generation is NOT safe to implement here (previously leaked blinding).
// Use generateBalanceProof from apps/web/src/lib/crypto/zkProofs.ts instead.
export interface BalanceProof {
  inputCommitments: Point[];
  outputCommitments: Point[];
  feeCommitment: Point;
  proof: bigint;
}

export function createBalanceProof(
  _inputs: PedersenCommitment[],
  _outputs: PedersenCommitment[],
  _fee: bigint
): BalanceProof {
  throw new Error(
    "createBalanceProof is not implemented in the shared package. " +
    "Use generateBalanceProof from apps/web/src/lib/crypto/zkProofs.ts"
  );
}
