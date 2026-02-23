# VM31: A General-Purpose GPU-Accelerated Proving Platform

> **Status**: Design Phase | **Date**: February 2026
> **Authors**: Bitsage Network Engineering
> **Companion Docs**: [M31 Field Analysis](m31-field-analysis.md) | [Crypto Primitives](crypto-primitives-m31.md) | [Privacy Architecture](privacy-architecture.md) | [Batch Economics](batch-proving-economics.md) | [Implementation Plan](implementation-plan.md)

---

## 1. Executive Summary

**VM31** is a general-purpose, GPU-accelerated proving platform built natively over the Mersenne-31 field (M31). It extends the stwo-ml ZKML prover — currently the fastest ML inference proving system in production — into a full-spectrum cryptographic proving engine capable of generating STARK proofs for arbitrary computations including privacy protocols, DeFi operations, agentic AI decisions, and verifiable computation of any kind.

The core thesis: **the proving infrastructure built for ZKML (sumcheck, GKR, LogUp, GPU CUDA kernels, on-chain Cairo verifier) is already a general-purpose proving engine.** The ML-specific code (matmul, activation, forward pass) is just one application layer. VM31 exposes the lower-level primitives as a public SDK and adds domain-specific libraries for cryptographic operations, privacy protocols, and DeFi applications — all natively in M31, eliminating the 800x field emulation overhead that would arise from operating over felt252.

---

## 2. The Problem

### 2.1 The Current Landscape

Today's ZK proving tools fall into three categories:

| Category | Examples | Strength | Weakness |
|----------|----------|----------|----------|
| **General-purpose circuit DSLs** | Noir, Circom, Halo2 | Developer experience, mature ecosystem | CPU-only, slow for large circuits |
| **General-purpose zkVMs** | SP1, Risc0 | Easy to use (write Rust/C, get proofs) | 100-1000x overhead vs specialized circuits |
| **Specialized provers** | Giza (ML), EZKL (ML) | Fast for their niche | Single-purpose, can't be reused |

None of these combines:
- Native M31 field arithmetic (10-20x faster than BN254/felt252)
- GPU acceleration (50-100x throughput via CUDA)
- STARK backend (no trusted setup)
- On-chain Starknet verification (already deployed)
- Domain-specific circuit libraries (not just raw constraints)

### 2.2 The Field Mismatch Tax

Most Starknet applications operate over felt252 (the native Starknet field, p ~ 2^251). When proving computations involving felt252 values in an M31 prover, each felt252 operation must be emulated via limb decomposition:

```
felt252 multiplication:
  a = a₇·M31⁷ + a₆·M31⁶ + ... + a₁·M31 + a₀    (8 limbs)
  b = b₇·M31⁷ + b₆·M31⁶ + ... + b₁·M31 + b₀

  a × b requires: 64 M31 multiplications + 15 carry propagations

  Overhead: ~800x per field operation
```

This overhead makes it impractical to prove felt252-native cryptographic operations (Poseidon252, EC point operations on the STARK curve) in an M31 prover. The solution: **design the application to operate natively over M31/QM31, eliminating the field mismatch entirely.**

### 2.3 The Opportunity

By building privacy protocols, DeFi primitives, and cryptographic operations directly over M31:

| Operation | In felt252 (emulated) | In native M31 | Speedup |
|-----------|----------------------|---------------|---------|
| Poseidon hash | ~72,000 M31 muls | ~90 M31 muls | **800x** |
| Merkle proof (20 levels) | ~1,400,000 M31 muls | ~1,800 M31 muls | **780x** |
| Nullifier derivation | ~72,000 M31 muls | ~90 M31 muls | **800x** |
| Range proof (64-bit) | ~2,000 M31 muls | ~2,000 M31 muls | 1x (already native) |
| Full confidential transfer | ~1,500,000 M31 muls | ~6,000 M31 muls | **250x** |

Add GPU parallelism (50-100x) on top of M31's native speed advantage (10-20x over BN254):

**Combined throughput: 500-2,000x faster than Noir/Circom/Groth16 for equivalent circuits.**

---

## 3. What Already Exists (The Engine)

The stwo-ml proving engine, built for ZKML, already contains every general-purpose primitive needed:

### 3.1 Proving Primitives

| Primitive | Location | General-Purpose? |
|-----------|----------|-----------------|
| **Sumcheck over MLE** | `components/matmul.rs` | Yes — proves ANY inner product over multilinear extensions |
| **LogUp lookup tables** | `components/activation.rs` | Yes — proves ANY function evaluation via precomputed table lookup |
| **GKR layered circuit** | `gkr/prover.rs`, `gkr/verifier.rs` | Yes — proves ANY layered arithmetic circuit (9 gate types) |
| **GPU field arithmetic** | `gpu_sumcheck.rs` | Yes — M31/QM31 CUDA kernels for any computation |
| **Poseidon-M31 channel** | `crypto/poseidon_channel.rs` | Yes — Fiat-Shamir for any interactive proof |
| **Commitment schemes** | `crypto/poseidon_merkle.rs` | Yes — Poseidon Merkle trees over any data |
| **On-chain verifier** | `elo-cairo-verifier/` (Cairo) | Yes — verifies sumcheck/GKR/LogUp for any circuit |

### 3.2 GKR Gate Types (Already Implemented)

The GKR engine supports 9 gate types, each with CPU, GPU, and SIMD variants:

| Gate | Description | GPU Kernel | Degree |
|------|-------------|-----------|--------|
| MatMul | Inner product sumcheck | `m31_gemm_kernel` | 2 |
| Add | Linear split | `m31_add_kernel` | 1 |
| Mul | Eq-sumcheck product | `m31_mul_kernel` | 3 |
| Activation | LogUp eq-sumcheck | `logup_3way_round_kernel` | 3 |
| LayerNorm | Combined-product eq-sumcheck | (CPU) | 3 |
| RMSNorm | Same as LayerNorm minus mean | (CPU) | 3 |
| Dequantize | LogUp 2D table | (CPU) | 3 |
| Attention | Composed sub-matmuls | `combine_blocks_kernel` | 2-3 |
| MatMulDualSimd | 3-factor SIMD sumcheck | (GPU) | 3 |

**Every privacy circuit operation maps to one of these gates.**

### 3.3 On-Chain Verifier (Deployed)

The EloVerifier v4 contract is deployed on Starknet Sepolia with:
- Sumcheck verification (degree 2 and 3)
- GKR layer-by-layer verification (all 9 gate types)
- LogUp table sum verification
- Poseidon-based Fiat-Shamir channel
- Model registration + weight commitment binding
- 249 Cairo tests passing

**Contract**: `0x0068c7023d6edcb1c086bed57e0ce2b3b5dd007f50f0d6beaec3e57427c86eb7`

### 3.4 Test Coverage

```
Rust (stwo-ml):     466 tests (442 lib + 4 transcript + 20 E2E)
Cairo (verifier):   249 tests (GKR + contract + cross-language)
Security audit:     24 findings, all fixed
```

---

## 4. The VM31 Architecture

```
                              VM31 SDK
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Circuit DSL / Builder API                                │  │
│  │  ┌──────────────────────────────────────────────────────┐ │  │
│  │  │  fn privacy_transfer(                                │ │  │
│  │  │      note: M31, nullifier: M31, merkle_path: [M31]  │ │  │
│  │  │  ) {                                                 │ │  │
│  │  │      let commitment = poseidon_m31(value, blinding); │ │  │
│  │  │      assert_membership(commitment, merkle_root);     │ │  │
│  │  │      range_check(value, 0..2^64);                    │ │  │
│  │  │  }                                                   │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │ compiles to                      │
│                             ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Core Engine (ALREADY BUILT)                              │  │
│  │  ├── GKR Protocol (9 gate types, CPU/GPU/SIMD)           │  │
│  │  ├── Sumcheck (degree 2-3, batched)                      │  │
│  │  ├── LogUp (precomputed tables, GPU-accelerated)         │  │
│  │  ├── CUDA Kernels (M31/QM31 field arithmetic)            │  │
│  │  └── Poseidon-M31 Fiat-Shamir Channel                    │  │
│  └──────────────────────────┬───────────────────────────────┘  │
│                             │                                  │
│  ┌──────────────────────────▼──────────────────────────────┐  │
│  │  Application Libraries                                   │  │
│  │  ├── ml/       Current stwo-ml (matmul, activation, GKR) │  │
│  │  ├── crypto/   Range proofs, Poseidon, Merkle, nullifier │  │
│  │  ├── privacy/  UTXO pool, shielded transfers, batch      │  │
│  │  ├── defi/     AMM proofs, strategy compliance           │  │
│  │  └── agent/    Decision validation, trace commitment     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  On-Chain Verifier (EloVerifier v4 — ALREADY DEPLOYED)          │
│  ├── Sumcheck verifier (degree 2-3)                             │
│  ├── GKR layer-by-layer verifier                                │
│  ├── LogUp table sum verifier                                   │
│  ├── Poseidon Fiat-Shamir channel                               │
│  └── Contract: 0x0068c7...86eb7 (Starknet Sepolia)             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Application Tracks

### 5.1 ML Track (DONE)

The existing stwo-ml library. GPU-accelerated ZKML proving for neural network inference verification. 466 tests, 24 security findings fixed, on-chain verification deployed.

**Components**: MatMul sumcheck, LogUp activations, GKR circuit prover, ONNX/SafeTensors loading, multi-GPU distribution, SIMD block batching, chunked proving for large models.

### 5.2 Crypto Track (NEW)

General-purpose cryptographic circuit primitives over M31. Building blocks for all other tracks.

**Components**:
- `range_proof.rs` — Bit decomposition + LogUp {0,1} table
- `poseidon_m31.rs` — Poseidon hash over M31/QM31 (not felt252)
- `merkle_proof.rs` — Poseidon-M31 Merkle path verification circuit
- `nullifier.rs` — Nullifier derivation circuit (hash preimage proof)
- `commitment.rs` — Poseidon-based commitments (binding + hiding)

See [Crypto Primitives Specification](crypto-primitives-m31.md) for full details.

### 5.3 Privacy Track (NEW)

M31-native privacy protocol — UTXO/Note pool with batch proving.

**Components**:
- Note commitment scheme
- Spend proof circuit (Merkle membership + nullifier + range proof)
- Batch prover (1000 transactions per GKR proof)
- Privacy pool with ASP compliance layer
- Fixed-denomination and arbitrary-amount modes

See [Privacy Architecture](privacy-architecture.md) for full design.

### 5.4 DeFi Track (FUTURE)

Provable DeFi operations for on-chain verification.

**Components** (planned):
- AMM invariant proofs (x × y = k)
- Swap execution proofs (slippage bounds)
- Strategy compliance proofs (portfolio constraints)
- Liquidation proofs (collateral ratio verification)
- Oracle value proofs (signed price feeds)

### 5.5 Agent Track (FUTURE)

Verifiable AI agent decision pipelines for starknet-agentic.

**Components** (planned):
- Decision validator models (small MLP, Tier 1 ZKML)
- Execution trace commitments (Poseidon hash chain)
- Strategy compliance proofs (agent policy verification)
- Prediction accuracy proofs (Brier score computation)

---

## 6. Competitive Analysis

### 6.1 Versus Noir (Aztec)

| Dimension | Noir | VM31 |
|-----------|------|------|
| Field | BN254 (254-bit) | M31 (31-bit) |
| Field mul cost | ~20 CPU cycles | ~1-2 CPU cycles |
| GPU support | No | Yes (CUDA kernels) |
| Throughput | 1x (baseline) | **500-2,000x** |
| Backend | UltraPlonk | Circle STARK |
| Trusted setup | Yes (universal) | **No** |
| Target chain | Ethereum L1/L2 | Starknet |
| Maturity | 3+ years | New |
| Developer experience | Excellent | Building |

**Honest assessment**: Noir has years of developer tooling lead. VM31's advantage is raw performance and no trusted setup. For small circuits (< 10K constraints), Noir is "good enough." For batch operations (> 100K constraints), VM31 dominates.

### 6.2 Versus SP1/Risc0 (zkVMs)

| Dimension | SP1/Risc0 | VM31 |
|-----------|-----------|------|
| Programming model | Write Rust → prove RISC-V | Circuit DSL (specialized) |
| Overhead | 100-1000x vs native | **1-5x vs native** |
| GPU support | Yes (SP1) | Yes |
| Ease of use | Very easy | Requires circuit knowledge |
| Proof type | STARK | STARK |

**Honest assessment**: zkVMs trade performance for developer experience. For a single privacy transaction, the 100x overhead doesn't matter (still < 1s). For batch proving 1000 transactions, the overhead is the difference between "viable" and "impossible."

### 6.3 Versus Tongo (Starknet Privacy)

| Dimension | Tongo | VM31 Privacy |
|-----------|-------|-------------|
| Privacy model | Account-based (ElGamal) | **UTXO pool** |
| Anonymity set | 1 (your account) | **Entire pool** |
| Amounts hidden | Yes (ciphertext) | Yes (commitment) |
| Tx graph hidden | **No** | **Yes** |
| Proving cost | ~120K Cairo steps/tx | ~6K M31 muls/tx |
| Batch proving | No | **Yes (1000 txs/proof)** |
| On-chain cost | ~0.31 STRK/tx | **~0.0003 STRK/tx** (batched) |
| Compliance | Auditor keys | ASP (Privacy Pools) |

**Honest assessment**: VM31 privacy is architecturally superior (pool vs account anonymity, batch proving economics). But Tongo is already deployed and has users. VM31 is a better mousetrap that doesn't exist yet.

### 6.4 Versus Aztec (Privacy L2)

| Dimension | Aztec | VM31 Privacy |
|-----------|-------|-------------|
| Scope | Full privacy L2 | Privacy app on Starknet L2 |
| Proving | Barretenberg (BN254) | STWO (M31, GPU) |
| Network | Own chain | Starknet |
| DeFi | Full programmable privacy | Transfers + swaps |
| Funding | $100M+ | Bootstrapped |
| Maturity | 5+ years R&D | New |

**Honest assessment**: Aztec is building a privacy operating system. VM31 is building a privacy application. Different scope, different ambition. But VM31 on Starknet leverages Starknet's existing DeFi ecosystem (Ekubo, Nostra, etc.) instead of bootstrapping a new chain.

---

## 7. Why This Matters

### 7.1 For Starknet

Starknet currently has no production-grade privacy protocol with pool-based anonymity. Tongo provides confidential amounts but not transaction graph privacy. VM31 would be the first system offering:
- Full sender/receiver anonymity via UTXO pools
- Batch proving for economically viable large anonymity sets
- Compliance layer (Privacy Pools ASP) for regulatory compatibility
- GPU-accelerated proving for high throughput

### 7.2 For the Broader Crypto Ecosystem

The combination of M31-native crypto + GPU acceleration + STARK backend + batch proving is novel. No existing system offers all four simultaneously. The batch proving economics (1000 txs for the cost of 1) could fundamentally change how privacy protocols scale.

### 7.3 For Obelysk Protocol

Obelysk v1 inherited Tongo's account-based privacy model. VM31 enables Obelysk v2 to offer genuinely strong privacy (pool-based anonymity) at dramatically lower cost (batch proving), with the same compliance features (ASP) and a clear differentiator from every competitor on Starknet.

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| QM31 provides ~124 bits security (< 128) | Medium | Acceptable for most applications; use wider Poseidon output if needed |
| No existing M31-native crypto ecosystem | High | Build from scratch; leverage STWO's existing Poseidon-M31 |
| Regulatory risk (privacy pools) | High | ASP compliance layer (Buterin's Privacy Pools paper) |
| Small initial anonymity set | High | Batch proving economics incentivize adoption; fixed denominations |
| Developer adoption | Medium | Start with Obelysk v2 as flagship application |
| Aztec has more resources | High | Different niche (Starknet vs own chain); leverage existing ecosystem |

---

## 9. Glossary

| Term | Definition |
|------|-----------|
| **M31** | Mersenne-31 prime field, p = 2^31 - 1 = 2,147,483,647 |
| **QM31** | Quartic extension of M31 (4 M31 elements per field element), ~124-bit security |
| **CM31** | Complex extension of M31 (2 M31 elements), ~62-bit security |
| **GKR** | Goldwasser-Kalai-Rothblum interactive proof protocol for layered circuits |
| **LogUp** | Logarithmic derivative lookup argument (proves function evaluation via precomputed tables) |
| **Sumcheck** | Interactive proof that reduces a polynomial sum to a single evaluation |
| **STARK** | Scalable Transparent Argument of Knowledge (no trusted setup) |
| **ASP** | Association Set Provider — curated deposit lists for privacy pool compliance |
| **UTXO** | Unspent Transaction Output — note-based accounting model |
| **Nullifier** | Hash-derived value published when spending a note to prevent double-spending |

---

*VM31 — GPU-accelerated general-purpose proving for Starknet*
*Bitsage Network, February 2026*
