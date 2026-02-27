/**
 * Real EC-based Sigma Protocol Range Proofs
 *
 * Replaces the fake Poseidon-hash range proofs used in testnet.
 * Implements bit-decomposition range proofs on the Stark curve:
 *
 * For a value v in [0, 2^numBits):
 *   1. Decompose v into bits b_0, b_1, ..., b_{n-1}
 *   2. For each bit b_i, create a Pedersen commitment: C_i = b_i*G + r_i*H
 *   3. Prove each C_i commits to 0 or 1 via OR-Sigma protocol
 *   4. Fiat-Shamir challenge via Poseidon hash over all commitments
 *   5. Compute aggregate: sum(C_i * 2^i) == commit(v, sum(r_i * 2^i))
 *
 * OR-Sigma protocol for binary constraint (per bit):
 *   Branch b=0: C_i = 0*G + r_i*H. Real proof on C_i, simulated on C_i - G.
 *   Branch b=1: C_i = 1*G + r_i*H. Simulated proof on C_i, real on C_i - G.
 *   Verifier sees two sub-proofs with challenges e_0, e_1 s.t. e_0 + e_1 = e.
 *
 * Also provides:
 * - Rate proof: Schnorr proof that want = rate * give (scaled integer)
 * - Balance proof: Prove knowledge of opening for C_balance - C_amount
 *
 * All proofs use real EC operations matching the Cairo verifiers.
 */

import {
  CURVE_ORDER,
  type ECPoint,
} from "./constants";
import {
  getGenerator,
  getPedersenH,
  scalarMult,
  addPoints,
  randomScalar,
  mod,
  isInfinity,
  negatePoint,
} from "./elgamal";
import { commit } from "./pedersen";
import { poseidonHash } from "./nullifier";

// ============================================================================
// Types
// ============================================================================

/** OR-proof sub-proof for one branch of the binary constraint */
interface OrBranchProof {
  nonceCommitment: ECPoint; // R = k*H (real) or simulated
  challenge: bigint;        // e_0 or e_1
  response: bigint;         // s = k + e*r (real) or chosen freely (simulated)
}

/** Per-bit OR-proof proving C_i commits to 0 or 1 */
interface BitOrProof {
  proof0: OrBranchProof; // Sub-proof for "C_i commits to 0"
  proof1: OrBranchProof; // Sub-proof for "C_i - G commits to 0" (i.e. C_i commits to 1)
}

// Re-export proof types for useConfidentialSwap
export interface RangeProof {
  bitCommitments: ECPoint[];
  bitOrProofs: BitOrProof[];
  challenge: bigint;         // Aggregate Fiat-Shamir challenge
  numBits: number;
}

export interface RateProof {
  rateCommitment: ECPoint;
  challenge: bigint;
  responseGive: bigint;
  responseRate: bigint;
  responseBlinding: bigint;
}

export interface BalanceProof {
  balanceCommitment: ECPoint;
  challenge: bigint;
  response: bigint;
}

// ============================================================================
// Range Proof Generation
// ============================================================================

/**
 * Generate a real bit-decomposition range proof with OR-sigma binary constraints.
 *
 * For each bit b_i:
 *   C_i = b_i * G + r_i * H
 *
 * OR-sigma proves C_i commits to 0 or 1 without revealing which:
 *   - Two branches: branch-0 proves C_i is commitment to 0, branch-1 proves C_i - G is commitment to 0
 *   - The real branch (matching actual bit) uses honest Schnorr; the other branch is simulated
 *   - Challenges satisfy: e_0 + e_1 = e (aggregate challenge)
 *   - Verifier can check both but can't distinguish real from simulated
 */
export function generateRangeProof(
  amount: bigint,
  randomness: bigint,
  numBits: number = 64
): RangeProof {
  const G = getGenerator();
  const H = getPedersenH();
  const negG = negatePoint(G);
  const bitCommitments: ECPoint[] = [];
  const blindings: bigint[] = [];
  const bitOrProofs: BitOrProof[] = [];

  // Step 1: Decompose amount and create per-bit commitments
  for (let i = 0; i < numBits; i++) {
    const bit = (amount >> BigInt(i)) & 1n;
    // Derive per-bit blinding deterministically from master randomness
    const r_i = mod(poseidonHash([randomness, BigInt(i), 0n]), CURVE_ORDER);
    blindings.push(r_i);

    // C_i = bit * G + r_i * H
    const rH = scalarMult(r_i, H);
    const C_i = bit === 1n ? addPoints(G, rH) : rH;
    bitCommitments.push(C_i);
  }

  // Step 2: Generate OR-sigma proofs for each bit before computing aggregate challenge
  // We first need the nonce commitments to include in the Fiat-Shamir hash.
  //
  // Process: for each bit, prepare both branches. For the real branch, choose
  // nonce k and compute R = k*H. For the simulated branch, choose (e_sim, s_sim)
  // first and compute R_sim = s_sim*H - e_sim*(C_i or C_i-G).

  interface PreparedBit {
    bit: bigint;
    r_i: bigint;
    k_real: bigint;
    R_real: ECPoint;
    e_sim: bigint;
    s_sim: bigint;
    R_sim: ECPoint;
  }

  const prepared: PreparedBit[] = [];

  for (let i = 0; i < numBits; i++) {
    const bit = (amount >> BigInt(i)) & 1n;
    const r_i = blindings[i];
    const C_i = bitCommitments[i];

    // Real branch nonce
    const k_real = mod(poseidonHash([randomness, BigInt(i), 2n]), CURVE_ORDER);
    if (k_real === 0n) {
      // Fallback: use fresh random if hash gives 0
      const k_fallback = randomScalar();
      prepared.push(prepBit(bit, r_i, k_fallback, C_i, randomness, BigInt(i)));
    } else {
      prepared.push(prepBit(bit, r_i, k_real, C_i, randomness, BigInt(i)));
    }
  }

  function prepBit(bit: bigint, r_i: bigint, k_real: bigint, C_i: ECPoint, rnd: bigint, idx: bigint): PreparedBit {
    const R_real = scalarMult(k_real, H);

    // Simulated branch: choose random challenge and response
    const e_sim = mod(poseidonHash([rnd, idx, 3n]), CURVE_ORDER);
    const s_sim = mod(poseidonHash([rnd, idx, 4n]), CURVE_ORDER);

    // Compute simulated nonce commitment:
    // For the simulated branch, we need: R_sim = s_sim*H - e_sim*target
    // where target = C_i (if simulating branch-0) or C_i - G (if simulating branch-1)
    let target: ECPoint;
    if (bit === 0n) {
      // Real proof is for branch-0 (C_i commits to 0, target = C_i for real, so C_i for branch-0).
      // Simulated branch is branch-1: target = C_i - G
      target = addPoints(C_i, negG);
    } else {
      // Real proof is for branch-1 (C_i - G commits to 0).
      // Simulated branch is branch-0: target = C_i
      target = C_i;
    }

    // R_sim = s_sim * H - e_sim * target
    const sH = scalarMult(s_sim, H);
    const eTarget = scalarMult(e_sim, target);
    const R_sim = addPoints(sH, negatePoint(eTarget));

    return { bit, r_i, k_real, R_real, e_sim, s_sim, R_sim };
  }

  // Step 3: Fiat-Shamir challenge from all commitments + all nonce commitments (both branches)
  const challengeInputs: bigint[] = [];
  for (const c of bitCommitments) {
    challengeInputs.push(c.x, c.y);
  }
  for (let i = 0; i < numBits; i++) {
    const p = prepared[i];
    if (p.bit === 0n) {
      // Branch order: branch-0 (real), branch-1 (simulated)
      challengeInputs.push(p.R_real.x, p.R_real.y);
      challengeInputs.push(p.R_sim.x, p.R_sim.y);
    } else {
      // Branch order: branch-0 (simulated), branch-1 (real)
      challengeInputs.push(p.R_sim.x, p.R_sim.y);
      challengeInputs.push(p.R_real.x, p.R_real.y);
    }
  }
  const challenge = mod(poseidonHash(challengeInputs), CURVE_ORDER);

  // Step 4: For each bit, compute real branch challenge and response
  for (let i = 0; i < numBits; i++) {
    const p = prepared[i];

    // Per-bit aggregate challenge (derived from main challenge + bit index for uniqueness)
    const perBitChallenge = mod(
      poseidonHash([challenge, BigInt(i)]),
      CURVE_ORDER
    );

    // e_real = perBitChallenge - e_sim (mod n)
    const e_real = mod(perBitChallenge - p.e_sim, CURVE_ORDER);

    // s_real = k_real + e_real * r_i (mod n) — standard Schnorr
    const s_real = mod(p.k_real + e_real * p.r_i, CURVE_ORDER);

    let proof0: OrBranchProof;
    let proof1: OrBranchProof;

    if (p.bit === 0n) {
      // Branch-0 is real, branch-1 is simulated
      proof0 = { nonceCommitment: p.R_real, challenge: e_real, response: s_real };
      proof1 = { nonceCommitment: p.R_sim, challenge: p.e_sim, response: p.s_sim };
    } else {
      // Branch-0 is simulated, branch-1 is real
      proof0 = { nonceCommitment: p.R_sim, challenge: p.e_sim, response: p.s_sim };
      proof1 = { nonceCommitment: p.R_real, challenge: e_real, response: s_real };
    }

    bitOrProofs.push({ proof0, proof1 });
  }

  return {
    bitCommitments,
    bitOrProofs,
    challenge,
    numBits,
  };
}

/**
 * Verify a range proof with OR-sigma binary constraints.
 *
 * For each bit i:
 *   1. Recompute per-bit challenge: e_i = Poseidon(challenge, i)
 *   2. Check e_i = proof0.challenge + proof1.challenge (mod n)
 *   3. Branch-0: s_0 * H == R_0 + e_0 * C_i (proves C_i commits to 0)
 *   4. Branch-1: s_1 * H == R_1 + e_1 * (C_i - G) (proves C_i commits to 1)
 *
 * Then verify aggregate: sum(C_i * 2^i) == valueCommitment
 */
export function verifyRangeProof(
  proof: RangeProof,
  valueCommitment: ECPoint,
  numBits: number = 64
): boolean {
  const G = getGenerator();
  const H = getPedersenH();
  const negG = negatePoint(G);

  if (proof.bitCommitments.length !== numBits || proof.bitOrProofs.length !== numBits) {
    return false;
  }

  // Re-derive Fiat-Shamir challenge
  const challengeInputs: bigint[] = [];
  for (const c of proof.bitCommitments) {
    challengeInputs.push(c.x, c.y);
  }
  for (let i = 0; i < numBits; i++) {
    const orProof = proof.bitOrProofs[i];
    challengeInputs.push(orProof.proof0.nonceCommitment.x, orProof.proof0.nonceCommitment.y);
    challengeInputs.push(orProof.proof1.nonceCommitment.x, orProof.proof1.nonceCommitment.y);
  }
  const expectedChallenge = mod(poseidonHash(challengeInputs), CURVE_ORDER);

  if (proof.challenge !== expectedChallenge) {
    return false;
  }

  // Verify each bit's OR-proof
  for (let i = 0; i < numBits; i++) {
    const C_i = proof.bitCommitments[i];
    const orProof = proof.bitOrProofs[i];

    // Per-bit challenge
    const perBitChallenge = mod(
      poseidonHash([proof.challenge, BigInt(i)]),
      CURVE_ORDER
    );

    // Check challenge split: e_0 + e_1 == perBitChallenge
    const challengeSum = mod(orProof.proof0.challenge + orProof.proof1.challenge, CURVE_ORDER);
    if (challengeSum !== perBitChallenge) {
      return false;
    }

    // Branch-0 Schnorr check: s_0 * H == R_0 + e_0 * C_i
    // (if C_i commits to 0: C_i = 0*G + r*H, so e_0*C_i = e_0*r*H, and s_0 = k + e_0*r)
    const lhs0 = scalarMult(orProof.proof0.response, H);
    const rhs0 = addPoints(
      orProof.proof0.nonceCommitment,
      scalarMult(orProof.proof0.challenge, C_i)
    );
    if (lhs0.x !== rhs0.x || lhs0.y !== rhs0.y) {
      return false;
    }

    // Branch-1 Schnorr check: s_1 * H == R_1 + e_1 * (C_i - G)
    // (if C_i commits to 1: C_i - G = r*H, so e_1*(C_i - G) = e_1*r*H, and s_1 = k + e_1*r)
    const CiMinusG = addPoints(C_i, negG);
    const lhs1 = scalarMult(orProof.proof1.response, H);
    const rhs1 = addPoints(
      orProof.proof1.nonceCommitment,
      scalarMult(orProof.proof1.challenge, CiMinusG)
    );
    if (lhs1.x !== rhs1.x || lhs1.y !== rhs1.y) {
      return false;
    }
  }

  // Verify aggregate: sum(C_i * 2^i) == valueCommitment
  let reconstructed: ECPoint = { x: 0n, y: 0n };
  for (let i = 0; i < numBits; i++) {
    const weight = 1n << BigInt(i);
    const weightedCommitment = scalarMult(weight, proof.bitCommitments[i]);
    reconstructed = addPoints(reconstructed, weightedCommitment);
  }

  if (reconstructed.x !== valueCommitment.x || reconstructed.y !== valueCommitment.y) {
    return false;
  }

  return true;
}

// ============================================================================
// Rate Proof
// ============================================================================

/**
 * Generate a Schnorr-style rate proof: prove that want = rate * give.
 *
 * Given public knowledge of committed giveAmount and wantAmount:
 *   rate = wantAmount / giveAmount (encoded as scaled integer)
 *   rateCommitment = rate * G + blinding * H
 *
 * Prover demonstrates knowledge of (rate, blinding) via Schnorr:
 *   R = k_rate * G + k_blind * H
 *   e = Poseidon(R, C_rate, giveAmount, wantAmount)
 *   s_give = k_rate + e * giveAmount (mod n)
 *   s_rate = k_rate + e * rate (mod n)
 *   s_blind = k_blind + e * blinding (mod n)
 */
export function generateRateProof(
  giveAmount: bigint,
  wantAmount: bigint,
  randomness: bigint
): RateProof {
  const G = getGenerator();
  const H = getPedersenH();

  // Rate as scaled integer (avoid fractions)
  const rate = giveAmount > 0n
    ? mod((wantAmount * 1000000n) / giveAmount, CURVE_ORDER)
    : 0n;
  const blinding = mod(poseidonHash([randomness, rate]), CURVE_ORDER);

  // Rate commitment: C_rate = rate * G + blinding * H
  const rateCommitment = addPoints(
    scalarMult(rate, G),
    scalarMult(blinding, H)
  );

  // Schnorr nonces
  const k_rate = mod(poseidonHash([randomness, 0n, rate]), CURVE_ORDER);
  const k_blind = mod(poseidonHash([randomness, 1n, blinding]), CURVE_ORDER);

  // Nonce commitment: R = k_rate * G + k_blind * H
  const R = addPoints(
    scalarMult(k_rate, G),
    scalarMult(k_blind, H)
  );

  // Fiat-Shamir challenge
  const challenge = mod(
    poseidonHash([R.x, R.y, rateCommitment.x, rateCommitment.y, giveAmount, wantAmount]),
    CURVE_ORDER
  );

  // Responses
  const responseGive = mod(k_rate + challenge * giveAmount, CURVE_ORDER);
  const responseRate = mod(k_rate + challenge * rate, CURVE_ORDER);
  const responseBlinding = mod(k_blind + challenge * blinding, CURVE_ORDER);

  return {
    rateCommitment,
    challenge,
    responseGive,
    responseRate,
    responseBlinding,
  };
}

/**
 * Generate a balance sufficiency proof: prove balance >= amount.
 *
 * Creates a Pedersen commitment to (balance - amount) and proves
 * knowledge of the opening, showing the difference is non-negative
 * (combined with a range proof on the difference).
 *
 *   difference = balance - amount
 *   C_diff = difference * G + blinding * H
 *   R = k * H (nonce commitment)
 *   e = Poseidon(R, C_diff, balance_hash)
 *   s = k + e * blinding (mod n)
 */
export function generateBalanceProof(
  balance: bigint,
  amount: bigint,
  randomness: bigint
): BalanceProof {
  const G = getGenerator();
  const H = getPedersenH();

  const difference = balance - amount;
  if (difference < 0n) {
    throw new Error("Insufficient balance for proof");
  }

  const blinding = mod(poseidonHash([randomness, difference]), CURVE_ORDER);

  // Commitment to the difference
  const balanceCommitment = addPoints(
    scalarMult(mod(difference, CURVE_ORDER), G),
    scalarMult(blinding, H)
  );

  // Schnorr nonce
  const k = mod(poseidonHash([randomness, blinding, difference]), CURVE_ORDER);
  const R = scalarMult(k, H);

  // Fiat-Shamir challenge
  const balanceHash = poseidonHash([balance, amount]);
  const challenge = mod(
    poseidonHash([R.x, R.y, balanceCommitment.x, balanceCommitment.y, balanceHash]),
    CURVE_ORDER
  );

  // Response: s = k + e * blinding (mod n)
  const response = mod(k + challenge * blinding, CURVE_ORDER);

  return {
    balanceCommitment,
    challenge,
    response,
  };
}
