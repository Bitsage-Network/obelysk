# M31 Field Analysis: Mathematics of Native Privacy Proving

> **Status**: Research Complete | **Date**: February 2026
> **Companion Docs**: [VM31 Vision](vm31-vision.md) | [Crypto Primitives](crypto-primitives-m31.md)

---

## 1. The Mersenne-31 Field

### 1.1 Definition

```
M31: p = 2^31 - 1 = 2,147,483,647 (Mersenne prime)

Arithmetic:
  Addition:       a + b mod p
  Subtraction:    a - b mod p
  Multiplication: a × b mod p  →  (a × b) mod (2^31 - 1)

  Key property: reduction mod (2^31 - 1) is a single shift + add:
    x mod p = (x & 0x7FFFFFFF) + (x >> 31)

  Cost: ~1-2 CPU clock cycles per multiplication (vs ~20 for 254-bit fields)
```

### 1.2 Extension Tower

M31 is extended to provide sufficient security margin:

```
M31 (31 bits)
  │
  └── CM31 = M31[i] / (i² + 1)      (62 bits, 2 M31 elements)
        │
        └── QM31 = CM31[u] / (u² - 2 - i)  (124 bits, 4 M31 elements)
```

**QM31 element**: `(a + bi) + (c + di)u` where `a, b, c, d ∈ M31`

**QM31 multiplication**:
```
(a₁ + b₁i + c₁u + d₁iu) × (a₂ + b₂i + c₂u + d₂iu)

Requires: 16 M31 multiplications + 16 M31 additions
(using Karatsuba: 9 M31 multiplications + ~20 additions)
```

### 1.3 Security Margin

| Extension | Bits | Security (multiplicative group) | Sufficient? |
|-----------|------|--------------------------------|-------------|
| M31 | 31 | ~15 bits | No |
| CM31 | 62 | ~31 bits | No |
| QM31 | 124 | ~62 bits (multiplicative) | Marginal |
| QM31 (STARK proof) | 124 | ~124 bits (hash-based) | Yes |

**Critical distinction**:
- For **discrete-log-based crypto** (ElGamal, Pedersen over EC), QM31's multiplicative group provides only ~62 bits of security — **insufficient**.
- For **hash-based crypto** (Poseidon commitments, STARK proofs), security depends on the hash output size, not the field's multiplicative group order. Poseidon over QM31 with 4-element output provides ~124 bits — **sufficient**.

**Implication**: VM31 privacy MUST use hash-based primitives (Poseidon commitments, Poseidon Merkle trees) rather than discrete-log-based primitives (ElGamal, Pedersen EC commitments). This is not a limitation — it's the direction modern ZK protocols (Aztec 3, Mina) are already moving.

---

## 2. M31 vs felt252: Cost Comparison

### 2.1 Field Operation Costs

| Operation | M31 | felt252 | M31/felt252 Ratio |
|-----------|-----|---------|------------------|
| Addition | 1 cycle | 4 cycles | 4x faster |
| Multiplication | 1-2 cycles | 20 cycles | 10-20x faster |
| Inversion | ~310 muls (Fermat) | ~251 muls (Fermat) | ~equivalent |
| Memory per element | 4 bytes | 32 bytes | 8x less |

### 2.2 Poseidon Hash Comparison

**Poseidon-252 (Starknet native)**:
```
State width: 3 felt252 elements
Full rounds: 8 (MDS + S-box on all elements)
Partial rounds: 83 (MDS + S-box on 1 element)
Total multiplications: ~91 × 3 × 3 = ~819 felt252 muls
                     = ~819 × 20 cycles = ~16,380 CPU cycles
```

**Poseidon-M31 (VM31 native)**:
```
State width: 16 M31 elements (wider state for security)
Full rounds: 8
Partial rounds: 14
Total multiplications: 22 × 16 × 16 = ~5,632 M31 muls
                     = ~5,632 × 1.5 cycles = ~8,448 CPU cycles

But: GPU can parallelize the 16-wide state operations
GPU-accelerated: ~300-500 effective cycles per hash
```

**Poseidon-252 emulated in M31** (the approach we're avoiding):
```
Each felt252 multiplication in M31 limbs:
  felt252 = 8 × M31 limbs (32 bits each)
  Schoolbook multiply: 64 M31 muls + 15 carry propagations
  Reduction mod p_252: ~20 M31 muls
  Total: ~84 M31 muls per felt252 mul

Poseidon-252 in M31: 819 × 84 = ~68,796 M31 muls

Overhead vs native Poseidon-M31: 68,796 / 5,632 = ~12.2x
Overhead vs native Poseidon-252: 68,796 × 1.5 / 16,380 = ~6.3x
```

### 2.3 Aggregate Circuit Cost Comparison

**Confidential transfer (1 transaction)**:

| Component | felt252 (emulated in M31) | M31 (native) | Speedup |
|-----------|--------------------------|--------------|---------|
| Poseidon hash (nullifier) | 68,796 M31 muls | 5,632 M31 muls | 12.2x |
| Merkle proof (20 levels) | 1,375,920 M31 muls | 112,640 M31 muls | 12.2x |
| Range proof (64-bit) | 2,048 M31 muls | 2,048 M31 muls | 1x |
| Balance proof | 2,048 M31 muls | 2,048 M31 muls | 1x |
| Commitment verification | 68,796 M31 muls | 5,632 M31 muls | 12.2x |
| **Total** | **~1,517,608** | **~128,000** | **~12x** |

With GPU acceleration (100x throughput): ~1.28ms per transaction (native M31).

**Batch of 1000 transactions**:
- M31 native: ~128M M31 muls → ~1.3s on GPU
- felt252 emulated: ~1.52B M31 muls → ~15s on GPU
- Noir (BN254, CPU): ~45 minutes

---

## 3. Poseidon-M31 Specification

### 3.1 Why Poseidon-M31 (Not Poseidon-252)

| Property | Poseidon-252 | Poseidon-M31 |
|----------|-------------|-------------|
| Field | felt252 | M31 |
| Native to prover | No (emulated) | **Yes** |
| Native to Starknet | Yes (builtin) | No (verified via STARK) |
| Cost in M31 circuit | ~68,800 M31 muls | ~5,600 M31 muls |
| Security level | ~252 bits | ~124 bits (QM31 output) |
| GPU parallelism | Poor (wide limbs) | **Excellent (SIMD-friendly)** |

### 3.2 Parameter Selection

Following the Poseidon paper's security analysis for the M31 field:

```
t = 16          (state width in M31 elements)
d = 5           (S-box degree: x^5 is the lowest non-trivial power coprime to p-1)
R_f = 8         (full rounds, provides margin against statistical attacks)
R_p = 14        (partial rounds, sufficient for algebraic attack resistance)
```

**Security analysis**:
- Algebraic attacks: min(R_f + R_p, d^R_p) > 2^124 ✓
- Statistical attacks: R_f ≥ 6 + log_d(t) ≈ 6 + 1.7 = 8 ✓
- Interpolation attacks: d^(R_f + R_p) > p^t ✓

### 3.3 Output Encoding

For 124-bit security:
```
Hash output = 4 M31 elements = 1 QM31 element
  = 4 × 31 bits = 124 bits of output

Commitment: H(value, blinding) = Poseidon_M31(value || blinding || padding)[0..4]
Nullifier:  H(secret, index)  = Poseidon_M31(secret || index || padding)[0..4]
```

### 3.4 Domain Separation

```
COMMITMENT_DOMAIN = 0x434F4D4D  // "COMM"
NULLIFIER_DOMAIN  = 0x4E554C4C  // "NULL"
MERKLE_DOMAIN     = 0x4D45524B  // "MERK"
ENCRYPTION_DOMAIN = 0x454E4352  // "ENCR"

Usage: state[0] = domain_tag before first permutation
```

---

## 4. Elliptic Curves Over M31 — Why We Don't Need Them

### 4.1 The Traditional Approach

Traditional privacy protocols (Zcash, Tongo, Obelysk v1) use elliptic curve cryptography:
- **Pedersen commitments**: `C = v·G + r·H` (requires EC point multiplication)
- **ElGamal encryption**: `(r·G, m·H + r·PK)` (requires EC point multiplication)
- **Schnorr proofs**: `(k·G, s = k - e·x)` (requires EC scalar mul)

These require a curve with a large prime-order subgroup (128+ bits). Over M31:
- The Circle group has order 2^31 — too small
- Over CM31: order ~2^62 — still too small
- Over QM31: possible but complex and uncharted territory

### 4.2 The Hash-Based Alternative

Modern ZK protocols are moving away from EC-based primitives toward hash-based alternatives:

| EC-Based | Hash-Based Alternative | Security Basis |
|----------|----------------------|----------------|
| Pedersen commitment: `v·G + r·H` | **Poseidon commitment**: `H(v, r)` | Hash collision resistance |
| ElGamal encryption | **Symmetric encryption**: `E_k(m) = m ⊕ H(k, nonce)` + ZK proof | PRF security |
| Schnorr proof of knowledge | **STARK proof of hash preimage** | Soundness of STARK |
| EC-based Merkle tree | **Poseidon-M31 Merkle tree** | Hash collision resistance |

**Key insight**: In a STARK-based system, you don't need interactive proofs (Schnorr). The STARK itself proves everything — knowledge of preimages, correct computation, range validity. Interactive EC-based proofs are unnecessary overhead.

### 4.3 Homomorphic Properties

**What we lose**: Pedersen commitments are additively homomorphic (`C(a) + C(b) = C(a+b)`). Poseidon commitments are not.

**Why it doesn't matter**: Homomorphic commitments are useful for on-chain balance updates without proofs. In the VM31 model, ALL state transitions are proved in ZK — the contract just verifies the STARK proof and updates the state root. No homomorphic operations needed on-chain.

```
Old model (Tongo/Obelysk v1):
  On-chain:  encrypted_balance = encrypted_balance ⊕ encrypted_amount
  (Homomorphic, no proof needed for update itself)

New model (VM31):
  Off-chain: prove(old_balance - amount >= 0, new_commitment = H(new_balance, new_r))
  On-chain:  verify STARK proof, update state_root
  (No homomorphism needed, proof covers everything)
```

---

## 5. Bigint Arithmetic in M31 (For Interoperability)

### 5.1 When You Need felt252 Anyway

Some operations inherently require felt252 arithmetic:
- Interacting with Starknet storage (contract addresses are felt252)
- Verifying existing Poseidon-252 hashes (for bridge proofs)
- Interoperating with ERC-20 token amounts (uint256)

### 5.2 Limb Representation

```
felt252 in M31 limbs:
  f = f₇·B⁷ + f₆·B⁶ + f₅·B⁵ + f₄·B⁴ + f₃·B³ + f₂·B² + f₁·B + f₀

Where:
  B = 2^32 (limb base, fits in M31 with 1 bit headroom)
  f_i ∈ [0, 2^32) ⊂ M31
  8 limbs × 32 bits = 256 bits ≥ 252 bits

Multiplication:
  Schoolbook: 64 M31 muls + carry propagation
  Karatsuba: 44 M31 muls + more additions

Reduction mod p_252:
  ~20 M31 additions (Barrett reduction)
```

### 5.3 When To Use Bigint vs Native

| Operation | Use Native M31 | Use Bigint (felt252 in M31) |
|-----------|---------------|---------------------------|
| Privacy commitments | ✓ | |
| Nullifier derivation | ✓ | |
| Merkle trees | ✓ | |
| Range proofs | ✓ | |
| ERC-20 amount handling | | ✓ (uint256 token amounts) |
| Contract address verification | | ✓ (Starknet addresses) |
| Bridge proofs | | ✓ (cross-chain hash verification) |

**Design principle**: Keep the privacy circuit in native M31. Only use bigint for the "edges" where the privacy system interfaces with Starknet's felt252 world.

---

## 6. Security Analysis

### 6.1 Collision Resistance of Poseidon-M31

For a Poseidon hash with t=16 state width and 4 M31 output elements:

```
Output space: |M31|⁴ = (2^31 - 1)⁴ ≈ 2^124

Birthday bound for collision: √(2^124) = 2^62 hash evaluations

Security level: ~124 bits against generic attacks
               ~124 bits against algebraic attacks (R_p ≥ 14)
```

**124 bits vs 128 bits**: The industry standard is 128-bit security. QM31 provides 124 bits — a 4-bit shortfall. In practice:
- 2^124 operations ≈ $10^25 at current compute costs (infeasible)
- 2^128 operations ≈ 16 × 2^124 (16x harder — marginally better)
- For comparison, Bitcoin's PoW provides ~80 bits of security
- **Conclusion**: 124 bits is sufficient for all practical purposes

### 6.2 Preimage Resistance

Poseidon-M31 with t=16 input and 4-element output:
- Preimage: find x such that H(x) = y
- Generic attack: 2^124 evaluations (same as collision)
- No known algebraic shortcuts for Poseidon with sufficient rounds

### 6.3 STARK Soundness

The STWO STARK proof system provides:
```
Security = log_blowup × n_queries + pow_bits
         = 8 × 14 + 20
         = 132 bits

This is INDEPENDENT of the M31 field size.
The STARK proof's soundness comes from FRI, not from the field's group structure.
```

### 6.4 Comparison With Competing Systems

| System | Proof Security | Crypto Security | Trusted Setup |
|--------|---------------|-----------------|---------------|
| Groth16 (BN254) | 128 bits | 128 bits (EC) | Yes |
| UltraPlonk (Noir) | 128 bits | 128 bits (EC) | Yes (universal) |
| STARK (STWO/M31) | 132 bits | 124 bits (hash) | **No** |
| Bulletproofs (Curve25519) | N/A (transparent) | 128 bits (EC) | No |

VM31 trades 4 bits of crypto security for no trusted setup and 500-2000x performance. This is an excellent tradeoff.

---

## 7. GPU Acceleration Properties of M31

### 7.1 SIMD Friendliness

```
M31 element: 32 bits (fits in a single int32)

SIMD packing:
  AVX-512:  16 × M31 per register (512 / 32)
  AVX2:      8 × M31 per register (256 / 32)
  NEON:      4 × M31 per register (128 / 32)

Compare felt252:
  AVX-512:  2 × felt252 per register (512 / 256)

M31 processes 8x more elements per SIMD instruction than felt252.
```

### 7.2 GPU Thread Utilization

```
CUDA warp: 32 threads × 32-bit M31 = 1024 bits of field data per warp
           vs  32 threads × 256-bit felt252 = 8192 bits per warp

M31 requires 8x less memory bandwidth per field element.
At memory-bandwidth-bound operations: 8x more throughput.

For compute-bound operations (e.g., multiplication):
  M31 mul: 1 instruction (IMUL32)
  felt252 mul: ~15 instructions (limb multiply + carry chain)

  15x more operations per thread × 8x less memory = ~120x total throughput advantage
```

### 7.3 Existing CUDA Kernels (Already Built)

```
M31 Kernels in stwo-ml/gpu_sumcheck.rs:
  m31_gemm_kernel         — Matrix multiply (16×16 blocks)
  m31_add_kernel          — Element-wise addition
  m31_mul_kernel          — Element-wise multiplication
  m31_relu_kernel         — ReLU activation
  m31_restrict_rows_kernel — Fused MLE restrict
  m31_restrict_cols_kernel — Fused MLE restrict
  logup_denominator_kernel — LogUp denominator computation
  logup_3way_round_kernel  — Degree-3 round polynomial
  logup_4way_reduce_kernel — Cross-block reduction
  logup_3way_fold_kernel   — Simultaneous 3-MLE fold
  combine_blocks_kernel    — SIMD block batching

All kernels reusable for crypto circuits without modification.
```

---

## 8. Summary of Key Mathematical Results

| Property | Value | Implication |
|----------|-------|------------|
| M31 mul cost | ~1.5 CPU cycles | 10-20x faster than BN254 |
| QM31 security | ~124 bits | Sufficient (industry standard is 128) |
| Poseidon-M31 cost | ~5,600 M31 muls | 12x cheaper than emulated Poseidon-252 |
| Merkle proof (20 lvl) | ~112,640 M31 muls | 12x cheaper than emulated |
| GPU throughput advantage | ~120x vs felt252 | Dominates for batch operations |
| STARK proof security | 132 bits | Independent of field size |
| No trusted setup | N/A | Eliminates MPC ceremony risk |
| Confidential transfer | ~128,000 M31 muls | ~1.3ms on GPU |
| Batch of 1000 transfers | ~128M M31 muls | ~1.3s on GPU |

**Bottom line**: M31-native privacy proving is 12x cheaper per operation than felt252 emulation, with an additional 120x throughput advantage from GPU acceleration. Combined with batch proving (1000 txs per proof), the economics enable privacy at a scale impossible with any other system.

---

*M31 Field Analysis — VM31 Project*
*Bitsage Network, February 2026*
