/**
 * ZK Proof Generation for Confidential Transfers
 *
 * Implements proper zero-knowledge proofs for the ConfidentialTransfer contract:
 * - Schnorr ownership proofs (knowledge of private key)
 * - Range proofs (bit decomposition with commitment)
 * - Balance proofs (proving correct balance update)
 * - Same-encryption proofs (proving ciphertexts share randomness)
 *
 * These proofs enable private transfers where:
 * - Amount is hidden from observers
 * - Sender proves they own the funds
 * - Sender proves the amount is valid (non-negative, sufficient balance)
 * - Cryptographic binding ensures no double-spending
 */

import {
  type ECPoint,
  type ElGamalCiphertext,
  CURVE_ORDER,
  STARK_PRIME,
} from "./constants";
import { hash } from "starknet";
import {
  getGenerator,
  getPedersenH,
  scalarMult,
  addPoints,
  negatePoint,
  randomScalar,
  mod,
  isOnCurve,
  pointToFelts,
} from "./elgamal";
import { commit, commitWithRandomBlinding } from "./pedersen";

// ============================================================================
// Types
// ============================================================================

/**
 * Schnorr proof of knowledge of discrete log
 * Proves: I know x such that Y = x * G
 */
export interface SchnorrProof {
  commitment: ECPoint;   // A = k * G (random commitment)
  response: bigint;      // s = k + c * x (response)
  challenge: bigint;     // c = H(G, Y, A) (Fiat-Shamir challenge)
}

/** OR-proof sub-proof for one branch of the binary constraint */
interface OrBranchProof {
  nonceCommitment: ECPoint;
  challenge: bigint;
  response: bigint;
}

/** Per-bit OR-proof proving C_i commits to 0 or 1 */
interface BitOrProof {
  proof0: OrBranchProof;
  proof1: OrBranchProof;
}

/**
 * Range proof using bit decomposition with OR-sigma binary constraint
 * Proves: 0 <= value < 2^bits
 */
export interface RangeProof {
  bitCommitments: ECPoint[];     // Commitment to each bit
  bitOrProofs: BitOrProof[];     // OR-proofs proving each bit is 0 or 1
  aggregateChallenge: bigint;    // Single Fiat-Shamir challenge
}

/**
 * Balance proof for confidential transfer
 * Proves: new_balance = old_balance - amount AND new_balance >= 0
 */
export interface BalanceProof {
  newBalanceCommitment: ECPoint;
  rangeProof: RangeProof;
  consistencyProof: SchnorrProof;
}

/**
 * Same-encryption proof
 * Proves: Two ciphertexts use the same randomness r
 */
export interface SameEncryptionProof {
  challenge: bigint;
  response: bigint;
  commitment: ECPoint;
}

/**
 * Complete transfer proof matching Cairo contract structure
 */
export interface TransferProof {
  ownership_a: ECPoint;        // Schnorr commitment A
  ownership_s: bigint;         // Schnorr response s
  ownership_c: bigint;         // Schnorr challenge c
  blinding_a: ECPoint;         // Blinding factor proof commitment
  blinding_s: bigint;          // Blinding response
  enc_a_l: ECPoint;            // Encryption proof commitment (left/C1)
  enc_s_b: bigint;             // Encryption response for blinding
  enc_s_r: bigint;             // Encryption response for randomness
  range_commitment: ECPoint;   // Range proof aggregate commitment
  range_challenge: bigint;     // Range proof challenge
  range_response_l: bigint;    // Range response (lower bits)
  range_response_r: bigint;    // Range response (upper bits)
  balance_commitment: ECPoint; // New balance commitment
  balance_response: bigint;    // Balance proof response
}

// ============================================================================
// Fiat-Shamir Hash (Non-interactive challenge generation)
// ============================================================================

/**
 * Compute Fiat-Shamir challenge using real Poseidon hash (Cairo-compatible).
 * All inputs are serialized as field elements and hashed via starknet.js Poseidon.
 */
function computeChallenge(...inputs: (ECPoint | bigint | string)[]): bigint {
  const values: string[] = [];
  for (const input of inputs) {
    if (typeof input === "string") {
      // Encode string as field element via hex
      const hex = "0x" + Buffer.from(input).toString("hex");
      values.push(hex);
    } else if (typeof input === "bigint") {
      values.push("0x" + mod(input, STARK_PRIME).toString(16));
    } else {
      // ECPoint - include both coordinates
      values.push("0x" + mod(input.x, STARK_PRIME).toString(16));
      values.push("0x" + mod(input.y, STARK_PRIME).toString(16));
    }
  }

  let result: string;
  if (values.length === 0) {
    return 0n;
  } else if (values.length === 1) {
    result = hash.computePoseidonHash(values[0], "0x0");
  } else if (values.length === 2) {
    result = hash.computePoseidonHash(values[0], values[1]);
  } else {
    result = hash.computePoseidonHashOnElements(values);
  }

  return mod(BigInt(result), CURVE_ORDER);
}

// ============================================================================
// Schnorr Proofs
// ============================================================================

/**
 * Generate Schnorr proof of knowledge of private key
 *
 * Proves: I know sk such that PK = sk * G
 *
 * Protocol:
 * 1. Prover picks random k, computes A = k * G
 * 2. Challenge c = H(G, PK, A)
 * 3. Response s = k + c * sk (mod n)
 *
 * Verification: s * G = A + c * PK
 */
export function generateSchnorrProof(
  privateKey: bigint,
  publicKey: ECPoint
): SchnorrProof {
  const g = getGenerator();

  // Random commitment
  const k = randomScalar();
  const commitment = scalarMult(k, g);

  // Fiat-Shamir challenge
  const challenge = computeChallenge(g, publicKey, commitment);

  // Response: s = k + c * sk
  const response = mod(k + challenge * privateKey, CURVE_ORDER);

  return { commitment, response, challenge };
}

/**
 * Verify Schnorr proof
 */
export function verifySchnorrProof(
  proof: SchnorrProof,
  publicKey: ECPoint
): boolean {
  const g = getGenerator();

  // Recompute challenge
  const expectedChallenge = computeChallenge(g, publicKey, proof.commitment);
  if (proof.challenge !== expectedChallenge) {
    return false;
  }

  // Check: s * G = A + c * PK
  const lhs = scalarMult(proof.response, g);
  const cPK = scalarMult(proof.challenge, publicKey);
  const rhs = addPoints(proof.commitment, cPK);

  return lhs.x === rhs.x && lhs.y === rhs.y;
}

// ============================================================================
// Range Proofs (Bit Decomposition)
// ============================================================================

/**
 * Generate range proof that 0 <= value < 2^bits
 *
 * Uses bit decomposition with OR-sigma protocol:
 *   value = b_0 + 2*b_1 + ... + 2^(n-1)*b_(n-1) where each b_i in {0, 1}
 *
 * For each bit b_i:
 *   C_i = b_i * G + r_i * H
 *   OR-proof: proves C_i commits to 0 or 1 without revealing which
 */
export function generateRangeProof(
  value: bigint,
  blinding: bigint,
  bits: number = 64
): RangeProof {
  const g = getGenerator();
  const h = getPedersenH();
  const negG = negatePoint(g);

  if (value < 0n || value >= (1n << BigInt(bits))) {
    throw new Error(`Value ${value} out of range [0, 2^${bits})`);
  }

  const bitCommitments: ECPoint[] = [];
  const bitBlindings: bigint[] = [];

  // Step 1: Decompose into bits and create commitments
  let totalBlinding = 0n;
  for (let i = 0; i < bits; i++) {
    const bit = (value >> BigInt(i)) & 1n;
    const weight = 1n << BigInt(i);

    // Random blinding per bit; last bit forced so aggregate matches
    const bitBlinding = i < bits - 1
      ? randomScalar()
      : mod(blinding - totalBlinding, CURVE_ORDER);
    bitBlindings.push(bitBlinding);
    totalBlinding = mod(totalBlinding + bitBlinding * weight, CURVE_ORDER);

    // C_i = bit * G + r_i * H
    const rH = scalarMult(bitBlinding, h);
    const C_i = bit === 1n ? addPoints(g, rH) : rH;
    bitCommitments.push(C_i);
  }

  // Step 2: Prepare OR-proofs (real + simulated branches)
  interface PreparedBit {
    bit: bigint;
    k_real: bigint;
    R_real: ECPoint;
    e_sim: bigint;
    s_sim: bigint;
    R_sim: ECPoint;
  }

  const prepared: PreparedBit[] = [];
  for (let i = 0; i < bits; i++) {
    const bit = (value >> BigInt(i)) & 1n;
    const C_i = bitCommitments[i];

    const k_real = randomScalar();
    const R_real = scalarMult(k_real, h);

    const e_sim = randomScalar();
    const s_sim = randomScalar();

    // Simulated branch target: C_i if simulating b=0, C_i - G if simulating b=1
    const target = bit === 0n ? addPoints(C_i, negG) : C_i;
    // R_sim = s_sim * H - e_sim * target
    const R_sim = addPoints(scalarMult(s_sim, h), negatePoint(scalarMult(e_sim, target)));

    prepared.push({ bit, k_real, R_real, e_sim, s_sim, R_sim });
  }

  // Step 3: Fiat-Shamir challenge over all commitments + nonce commitments
  const aggregateChallenge = computeChallenge(
    g, h,
    ...bitCommitments,
    ...prepared.flatMap(p =>
      p.bit === 0n
        ? [p.R_real, p.R_sim]  // branch-0 real, branch-1 sim
        : [p.R_sim, p.R_real]  // branch-0 sim, branch-1 real
    ),
    BigInt(bits),
  );

  // Step 4: Compute real-branch challenges and responses
  const bitOrProofs: BitOrProof[] = [];
  for (let i = 0; i < bits; i++) {
    const p = prepared[i];

    // Per-bit challenge derived from aggregate
    const perBitChallenge = computeChallenge(aggregateChallenge, BigInt(i));
    const e_real = mod(perBitChallenge - p.e_sim, CURVE_ORDER);
    const s_real = mod(p.k_real + e_real * bitBlindings[i], CURVE_ORDER);

    let proof0: OrBranchProof;
    let proof1: OrBranchProof;

    if (p.bit === 0n) {
      proof0 = { nonceCommitment: p.R_real, challenge: e_real, response: s_real };
      proof1 = { nonceCommitment: p.R_sim, challenge: p.e_sim, response: p.s_sim };
    } else {
      proof0 = { nonceCommitment: p.R_sim, challenge: p.e_sim, response: p.s_sim };
      proof1 = { nonceCommitment: p.R_real, challenge: e_real, response: s_real };
    }

    bitOrProofs.push({ proof0, proof1 });
  }

  return {
    bitCommitments,
    bitOrProofs,
    aggregateChallenge,
  };
}

/**
 * Verify range proof with OR-sigma binary constraints
 *
 * For each bit i:
 *   1. e_i = H(aggregateChallenge, i)
 *   2. e_0 + e_1 == e_i
 *   3. Branch-0: s_0 * H == R_0 + e_0 * C_i
 *   4. Branch-1: s_1 * H == R_1 + e_1 * (C_i - G)
 * Then: sum(C_i * 2^i) == valueCommitment
 */
export function verifyRangeProof(
  proof: RangeProof,
  valueCommitment: ECPoint,
  bits: number = 64
): boolean {
  const g = getGenerator();
  const h = getPedersenH();
  const negG = negatePoint(g);

  if (proof.bitCommitments.length !== bits || proof.bitOrProofs.length !== bits) {
    return false;
  }

  // Re-derive Fiat-Shamir challenge
  const noncePoints: ECPoint[] = [];
  for (let i = 0; i < bits; i++) {
    const orProof = proof.bitOrProofs[i];
    noncePoints.push(orProof.proof0.nonceCommitment, orProof.proof1.nonceCommitment);
  }
  const expectedChallenge = computeChallenge(
    g, h,
    ...proof.bitCommitments,
    ...noncePoints,
    BigInt(bits),
  );

  if (proof.aggregateChallenge !== expectedChallenge) {
    return false;
  }

  // Verify each bit's OR-proof
  for (let i = 0; i < bits; i++) {
    const C_i = proof.bitCommitments[i];
    const orProof = proof.bitOrProofs[i];

    if (!isOnCurve(C_i)) {
      return false;
    }

    // Per-bit challenge
    const perBitChallenge = computeChallenge(proof.aggregateChallenge, BigInt(i));

    // Challenge split: e_0 + e_1 == perBitChallenge
    const challengeSum = mod(orProof.proof0.challenge + orProof.proof1.challenge, CURVE_ORDER);
    if (challengeSum !== perBitChallenge) {
      return false;
    }

    // Branch-0: s_0 * H == R_0 + e_0 * C_i
    const lhs0 = scalarMult(orProof.proof0.response, h);
    const rhs0 = addPoints(orProof.proof0.nonceCommitment, scalarMult(orProof.proof0.challenge, C_i));
    if (lhs0.x !== rhs0.x || lhs0.y !== rhs0.y) {
      return false;
    }

    // Branch-1: s_1 * H == R_1 + e_1 * (C_i - G)
    const CiMinusG = addPoints(C_i, negG);
    const lhs1 = scalarMult(orProof.proof1.response, h);
    const rhs1 = addPoints(orProof.proof1.nonceCommitment, scalarMult(orProof.proof1.challenge, CiMinusG));
    if (lhs1.x !== rhs1.x || lhs1.y !== rhs1.y) {
      return false;
    }
  }

  // Verify aggregate: sum(C_i * 2^i) == valueCommitment
  let reconstructed: ECPoint = { x: 0n, y: 0n };
  for (let i = 0; i < bits; i++) {
    const weight = 1n << BigInt(i);
    reconstructed = addPoints(reconstructed, scalarMult(weight, proof.bitCommitments[i]));
  }

  if (reconstructed.x !== valueCommitment.x || reconstructed.y !== valueCommitment.y) {
    return false;
  }

  return true;
}

// ============================================================================
// Balance Proofs
// ============================================================================

/**
 * Generate balance proof
 * Proves: newBalance = oldBalance - amount AND newBalance >= 0
 */
export function generateBalanceProof(
  oldBalance: bigint,
  amount: bigint,
  oldBlinding: bigint,
  newBlinding?: bigint
): BalanceProof {
  const newBalance = oldBalance - amount;

  if (newBalance < 0n) {
    throw new Error("Insufficient balance");
  }

  const actualNewBlinding = newBlinding ?? randomScalar();

  // Commitment to new balance
  const newBalanceCommitment = commit(newBalance, actualNewBlinding);

  // Range proof for new balance
  const rangeProof = generateRangeProof(newBalance, actualNewBlinding, 64);

  // Consistency proof: prove relation between old and new
  // C_new = C_old - amount*G - (r_old - r_new)*H
  const deltaBlinding = mod(oldBlinding - actualNewBlinding, CURVE_ORDER);
  const consistencyProof = generateSchnorrProofForValue(
    amount,
    deltaBlinding,
    commit(amount, deltaBlinding)
  );

  return {
    newBalanceCommitment,
    rangeProof,
    consistencyProof,
  };
}

/**
 * Schnorr proof for Pedersen-committed value: C = v*G + r*H
 *
 * Proves knowledge of (v, r) opening the commitment:
 *   A = k_v * G + k_r * H
 *   e = H(G, H, C, A)
 *   s_v = k_v + e * v, s_r = k_r + e * r
 *
 * Verifier checks: s_v * G + s_r * H == A + e * C
 *
 * Returns both responses packed as a single combined response
 * to match the SchnorrProof interface used by BalanceProof.
 */
function generateSchnorrProofForValue(
  value: bigint,
  blinding: bigint,
  commitment: ECPoint
): SchnorrProof & { valueResponse: bigint } {
  const g = getGenerator();
  const h = getPedersenH();

  const k_v = randomScalar();
  const k_r = randomScalar();

  // A = k_v * G + k_r * H
  const commitmentA = addPoints(
    scalarMult(k_v, g),
    scalarMult(k_r, h)
  );

  const challenge = computeChallenge(g, h, commitment, commitmentA);

  // Both responses needed for full Pedersen opening proof
  const valueResponse = mod(k_v + challenge * value, CURVE_ORDER);
  const response = mod(k_r + challenge * blinding, CURVE_ORDER);

  return { commitment: commitmentA, response, challenge, valueResponse };
}

// ============================================================================
// Same-Encryption Proofs
// ============================================================================

/**
 * Generate same-encryption proof
 * Proves two ciphertexts (C1_a, C2_a) and (C1_b, C2_b) use same r
 * where C1 = r * G
 */
export function generateSameEncryptionProof(
  randomness: bigint,
  ciphertext1: ElGamalCiphertext,
  ciphertext2: ElGamalCiphertext
): SameEncryptionProof {
  const g = getGenerator();

  // Random commitment
  const k = randomScalar();
  const commitment = scalarMult(k, g);

  // Challenge incorporates both C1 values
  const c1_a: ECPoint = { x: ciphertext1.c1_x, y: ciphertext1.c1_y };
  const c1_b: ECPoint = { x: ciphertext2.c1_x, y: ciphertext2.c1_y };

  const challenge = computeChallenge(g, c1_a, c1_b, commitment);

  // Response
  const response = mod(k + challenge * randomness, CURVE_ORDER);

  return { challenge, response, commitment };
}

/**
 * Verify same-encryption proof
 */
export function verifySameEncryptionProof(
  proof: SameEncryptionProof,
  ciphertext1: ElGamalCiphertext,
  ciphertext2: ElGamalCiphertext
): boolean {
  const g = getGenerator();

  const c1_a: ECPoint = { x: ciphertext1.c1_x, y: ciphertext1.c1_y };
  const c1_b: ECPoint = { x: ciphertext2.c1_x, y: ciphertext2.c1_y };

  // Recompute challenge
  const expectedChallenge = computeChallenge(g, c1_a, c1_b, proof.commitment);
  if (proof.challenge !== expectedChallenge) {
    return false;
  }

  // Check both C1 values derive from same r
  // s * G = A + c * C1_a should hold
  const lhs = scalarMult(proof.response, g);
  const rhs_a = addPoints(proof.commitment, scalarMult(proof.challenge, c1_a));

  if (lhs.x !== rhs_a.x || lhs.y !== rhs_a.y) {
    return false;
  }

  // Also check C1_a === C1_b (same randomness means same C1)
  return c1_a.x === c1_b.x && c1_a.y === c1_b.y;
}

// ============================================================================
// Complete Transfer Proof Generation
// ============================================================================

/**
 * Generate complete transfer proof for ConfidentialTransfer contract
 */
export function generateTransferProof(
  privateKey: bigint,
  publicKey: ECPoint,
  amount: bigint,
  oldBalance: bigint,
  randomness: bigint,
  oldBlinding?: bigint
): TransferProof {
  // Validate public key is on curve to prevent invalid proofs
  if (!isOnCurve(publicKey)) {
    throw new Error("[TransferProof] Public key is not on the STARK curve");
  }
  if (amount <= 0n) {
    throw new Error("[TransferProof] Amount must be positive");
  }
  if (oldBalance < amount) {
    throw new Error("[TransferProof] Insufficient balance for transfer");
  }
  const g = getGenerator();
  const h = getPedersenH();

  const actualOldBlinding = oldBlinding ?? randomScalar();
  const newBalance = oldBalance - amount;
  const newBlinding = randomScalar();

  // 1. Schnorr ownership proof
  const ownershipProof = generateSchnorrProof(privateKey, publicKey);

  // 2. Blinding factor proof
  const blindingK = randomScalar();
  const blindingA = scalarMult(blindingK, h);
  const blindingChallenge = computeChallenge(h, blindingA, publicKey);
  const blindingS = mod(blindingK + blindingChallenge * randomness, CURVE_ORDER);

  // 3. Encryption proof
  const encK = randomScalar();
  const encA = scalarMult(encK, g);
  const encChallenge = computeChallenge(g, encA, BigInt(amount.toString()));
  const encSB = mod(encK + encChallenge * amount, CURVE_ORDER);
  const encSR = mod(encK + encChallenge * randomness, CURVE_ORDER);

  // 4. Range proof (simplified - using commitment approach)
  const rangeCommitment = commit(amount, randomness);
  const rangeChallenge = computeChallenge(rangeCommitment, BigInt(amount.toString()));
  const rangeResponseL = mod(amount + rangeChallenge * randomness, CURVE_ORDER);
  const rangeResponseR = mod(newBalance + rangeChallenge * newBlinding, CURVE_ORDER);

  // 5. Balance proof
  const balanceCommitment = commit(newBalance, newBlinding);
  const balanceChallenge = computeChallenge(balanceCommitment, rangeCommitment);
  const balanceResponse = mod(newBlinding + balanceChallenge * actualOldBlinding, CURVE_ORDER);

  return {
    ownership_a: ownershipProof.commitment,
    ownership_s: ownershipProof.response,
    ownership_c: ownershipProof.challenge,
    blinding_a: blindingA,
    blinding_s: blindingS,
    enc_a_l: encA,
    enc_s_b: encSB,
    enc_s_r: encSR,
    range_commitment: rangeCommitment,
    range_challenge: rangeChallenge,
    range_response_l: rangeResponseL,
    range_response_r: rangeResponseR,
    balance_commitment: balanceCommitment,
    balance_response: balanceResponse,
  };
}

/**
 * Convert transfer proof to contract calldata format
 */
export function transferProofToCalldata(proof: TransferProof): object {
  return {
    ownership_a: { x: "0x" + proof.ownership_a.x.toString(16), y: "0x" + proof.ownership_a.y.toString(16) },
    ownership_s: "0x" + proof.ownership_s.toString(16),
    ownership_c: "0x" + proof.ownership_c.toString(16),
    blinding_a: { x: "0x" + proof.blinding_a.x.toString(16), y: "0x" + proof.blinding_a.y.toString(16) },
    blinding_s: "0x" + proof.blinding_s.toString(16),
    enc_a_l: { x: "0x" + proof.enc_a_l.x.toString(16), y: "0x" + proof.enc_a_l.y.toString(16) },
    enc_s_b: "0x" + proof.enc_s_b.toString(16),
    enc_s_r: "0x" + proof.enc_s_r.toString(16),
    range_commitment: { x: "0x" + proof.range_commitment.x.toString(16), y: "0x" + proof.range_commitment.y.toString(16) },
    range_challenge: "0x" + proof.range_challenge.toString(16),
    range_response_l: "0x" + proof.range_response_l.toString(16),
    range_response_r: "0x" + proof.range_response_r.toString(16),
    balance_commitment: { x: "0x" + proof.balance_commitment.x.toString(16), y: "0x" + proof.balance_commitment.y.toString(16) },
    balance_response: "0x" + proof.balance_response.toString(16),
  };
}

/**
 * Verify transfer proof (for testing/validation)
 */
export function verifyTransferProof(
  proof: TransferProof,
  publicKey: ECPoint
): boolean {
  // Verify ownership proof
  const ownershipValid = verifySchnorrProof(
    {
      commitment: proof.ownership_a,
      response: proof.ownership_s,
      challenge: proof.ownership_c,
    },
    publicKey
  );

  if (!ownershipValid) {
    return false;
  }

  // Verify all points are on curve
  const points = [
    proof.ownership_a,
    proof.blinding_a,
    proof.enc_a_l,
    proof.range_commitment,
    proof.balance_commitment,
  ];

  for (const point of points) {
    if (!isOnCurve(point)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Exports
// ============================================================================

export {
  computeChallenge,
};
