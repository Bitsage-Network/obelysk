# Cryptographic Primitives over M31: Specification

> **Status**: Design Phase | **Date**: February 2026
> **Companion Docs**: [M31 Field Analysis](m31-field-analysis.md) | [Privacy Architecture](privacy-architecture.md)

---

## 1. Overview

This document specifies all cryptographic primitives needed for a privacy protocol operating natively over the M31 field. Every primitive is designed to be provable in a STARK circuit using the existing stwo-ml GKR/sumcheck/LogUp infrastructure.

**Design Principles**:
1. All crypto operations are hash-based (Poseidon), not EC-based (no ElGamal/Pedersen)
2. All operations are M31-native — no felt252 emulation
3. Every primitive maps to an existing stwo-ml gate type
4. Security target: 124 bits (QM31 output width)

---

## 2. Poseidon-M31 Hash Function

### 2.1 Specification

```
Parameters:
  Field:           M31 (p = 2^31 - 1)
  State width:     t = 16 M31 elements (512 bits)
  Rate:            r = 12 M31 elements (384 bits, absorbable per permutation)
  Capacity:        c = 4 M31 elements (128 bits, security margin)
  S-box:           x^5 (degree 5, coprime to p-1 = 2(2^30 - 1))
  Full rounds:     R_f = 8 (4 before, 4 after partial rounds)
  Partial rounds:  R_p = 14
  Total rounds:    R = 22
  MDS matrix:      16×16 Cauchy matrix over M31
  Output:          4 M31 elements = QM31 = 124 bits
```

### 2.2 Round Function

```
Full round:
  state ← AddRoundConstants(state)
  state ← S-box(state)          // x^5 for ALL elements
  state ← MDS(state)            // 16×16 matrix multiply

Partial round:
  state ← AddRoundConstants(state)
  state[0] ← S-box(state[0])   // x^5 for FIRST element only
  state ← MDS(state)
```

### 2.3 Sponge Construction

```
fn poseidon_m31_hash(inputs: &[M31]) -> [M31; 4] {
    let mut state = [M31::zero(); 16];

    // Domain separation
    state[0] = domain_tag;

    // Absorb phase
    for chunk in inputs.chunks(12) {
        for (i, &val) in chunk.iter().enumerate() {
            state[i + 4] += val;  // Add to rate portion (indices 4..16)
        }
        state = poseidon_permutation(state);
    }

    // Squeeze: output = state[0..4] (capacity portion)
    [state[0], state[1], state[2], state[3]]
}
```

### 2.4 Circuit Cost

```
Per permutation:
  Full round:    16 S-boxes × 3 muls (x^5 = x·x·x·x·x = 4 muls, but x²·x²·x = 3 muls)
               + 16×16 MDS = 256 muls
               = 48 + 256 = 304 M31 muls

  Partial round: 1 S-box × 3 muls + 256 MDS muls = 259 M31 muls

  Total: 8 × 304 + 14 × 259 = 2,432 + 3,626 = 6,058 M31 muls per permutation

For single hash (1 absorption): ~6,058 M31 muls
For Merkle node (2 children):   ~6,058 M31 muls (both children fit in rate)
```

### 2.5 GKR Gate Mapping

```
S-box (x^5):
  t₁ = x × x        → Mul gate
  t₂ = t₁ × t₁      → Mul gate
  y  = t₂ × x        → Mul gate
  3 Mul gates per S-box

MDS (16×16 matrix):
  16 inner products of length 16
  → 16 MatMul gates (degree 2, inner product sumcheck)
  OR: 256 individual Mul gates + 240 Add gates

Total per permutation: ~300 GKR gates
Total per hash:        ~300 GKR gates
```

---

## 3. Commitments

### 3.1 Poseidon Commitment Scheme

```
Commit(value: M31, blinding: M31) -> [M31; 4]:
  return Poseidon_M31(COMMITMENT_DOMAIN || value || blinding)

Properties:
  Binding:  Cannot find (v₁, r₁) ≠ (v₂, r₂) such that Commit(v₁, r₁) = Commit(v₂, r₂)
            (requires Poseidon collision, cost ≥ 2^62 birthday bound)
  Hiding:   Given C, cannot determine v without knowing r
            (Poseidon is a PRF; C reveals nothing about v)
```

### 3.2 Multi-Value Commitment

For committing to multiple values (e.g., a UTXO note):

```
NoteCommitment(value: M31, asset: M31, owner_key: [M31; 4], blinding: M31) -> [M31; 4]:
  return Poseidon_M31(
    COMMITMENT_DOMAIN ||
    value ||
    asset ||
    owner_key[0] || owner_key[1] || owner_key[2] || owner_key[3] ||
    blinding
  )

Total inputs: 7 M31 elements (fits in single absorption: rate = 12)
Cost: 1 Poseidon permutation = ~6,058 M31 muls
```

### 3.3 Why Not Pedersen Commitments

| Property | Pedersen (`v·G + r·H`) | Poseidon (`H(v, r)`) |
|----------|----------------------|---------------------|
| Additively homomorphic | Yes | **No** |
| Circuit cost (M31) | ~2.5M muls (EC scalar mul) | **~6K muls** |
| Security basis | Discrete log (EC) | Hash collision |
| Trusted setup for H | Verifiable (hash-to-curve) | N/A |
| In ZK circuit | Very expensive | **Very cheap** |

Poseidon commitments are **400x cheaper** in M31 circuits. The loss of homomorphism is irrelevant because all operations are proved in ZK (no on-chain homomorphic computation needed).

---

## 4. Range Proofs

### 4.1 Bit Decomposition + LogUp

Prove that a value `v` is in range `[0, 2^n)` by decomposing into bits:

```
RangeProof(v: M31, n: u32):
  // Decompose v into n bits
  bits = [b₀, b₁, ..., b_{n-1}]  where v = Σ 2^i × b_i

  // Prove each bit ∈ {0, 1} via LogUp table
  table = PrecomputedTable { inputs: [0, 1], outputs: [0, 1] }
  for each b_i:
    LogUp_lookup(b_i, table)

  // Prove weighted sum equals v
  assert: Σ 2^i × b_i = v  (inner product sumcheck)
```

### 4.2 Circuit Mapping

```
Components:
  1. LogUp table (2 entries: {0, 1})
     → ActivationEval pattern
     → 2 preprocessed columns, 3 execution columns, LogUp interaction
     → Proves each bit ∈ {0, 1}

  2. Inner product sumcheck
     → InnerProductOracle pattern (from matmul.rs)
     → Powers of 2 vector · bits vector = v
     → log₂(n) sumcheck rounds

Cost:
  64-bit range proof:
    64 LogUp lookups (multiplicities sum to 64)
    1 inner product sumcheck (6 rounds for 64-element vector)
    Total: ~2,048 M31 muls

  32-bit range proof:
    32 LogUp lookups
    1 inner product sumcheck (5 rounds)
    Total: ~1,024 M31 muls
```

### 4.3 Optimization: Chunk-Based Range Proof

For larger ranges, decompose into base-2^k chunks instead of individual bits:

```
Base-256 decomposition (k=8):
  v = d₀ + 256·d₁ + 256²·d₂ + ... + 256⁷·d₇
  Each d_i ∈ [0, 255]
  LogUp table: 256 entries (not 2)

  Cost: 8 LogUp lookups + 1 inner product (3 rounds)
  Total: ~512 M31 muls

Tradeoff: Larger table → fewer lookups but larger preprocessed trace
  2-entry table:   64 lookups, tiny trace     → best for small batches
  256-entry table:  8 lookups, moderate trace  → best for large batches
```

---

## 5. Merkle Trees

### 5.1 Poseidon-M31 Merkle Tree

```
Tree structure:
  Leaf:   L = Poseidon_M31(MERKLE_LEAF_DOMAIN || note_commitment)
  Node:   N = Poseidon_M31(MERKLE_NODE_DOMAIN || left_child || right_child)
  Root:   Single M31^4 value summarizing all leaves

  Depth: 20 (supports 2^20 = 1,048,576 leaves)

Note: Each Poseidon output is 4 M31 elements.
  A node hash takes 8 M31 inputs (2 children × 4 M31 each)
  → Fits in single Poseidon absorption (rate = 12)
  → 1 permutation per node = ~6,058 M31 muls
```

### 5.2 Membership Proof Circuit

```
MerkleProof(leaf, path, path_directions, root):
  current = Poseidon_M31(MERKLE_LEAF_DOMAIN || leaf)

  for i in 0..depth:
    sibling = path[i]        // 4 M31 elements
    direction = path_directions[i]  // 0 = left, 1 = right

    if direction == 0:
      current = Poseidon_M31(MERKLE_NODE_DOMAIN || current || sibling)
    else:
      current = Poseidon_M31(MERKLE_NODE_DOMAIN || sibling || current)

  assert: current == root

Circuit cost:
  20 Poseidon hashes × 6,058 M31 muls = ~121,160 M31 muls
  20 conditional swaps (direction bits) = ~80 M31 muls
  Total: ~121,240 M31 muls
```

### 5.3 Non-Membership Proof

For exclusion sets (proving a note is NOT in a set):

```
NonMembershipProof(leaf, left_neighbor, right_neighbor, merkle_proofs):
  // Prove left_neighbor is in the tree
  verify_membership(left_neighbor, left_proof, root)

  // Prove right_neighbor is in the tree
  verify_membership(right_neighbor, right_proof, root)

  // Prove left < leaf < right (or boundary conditions)
  assert: left_neighbor < leaf  (range comparison)
  assert: leaf < right_neighbor (range comparison)

  // Prove left and right are consecutive (no gap)
  assert: left_neighbor.next_index == right_neighbor.index

Cost: 2 × membership proof + 2 range comparisons
    = 2 × 121,240 + 2 × 2,048
    = ~246,576 M31 muls
```

---

## 6. Nullifiers

### 6.1 Nullifier Derivation

```
Nullifier(secret: [M31; 4], note_index: M31) -> [M31; 4]:
  return Poseidon_M31(NULLIFIER_DOMAIN || secret || note_index)

Properties:
  - Deterministic: same (secret, index) → same nullifier
  - Unlinkable: nullifier reveals nothing about which note it references
  - Unique: collision-resistant (different notes → different nullifiers)

Cost: 1 Poseidon hash = ~6,058 M31 muls
```

### 6.2 Nullifier in Spend Proof

```
SpendProof(note_commitment, secret, blinding, value, asset, owner_key, note_index, merkle_path, root):
  // 1. Recompute note commitment from witnesses
  recomputed = NoteCommitment(value, asset, owner_key, blinding)
  assert: recomputed == note_commitment

  // 2. Prove note is in the Merkle tree
  verify_membership(note_commitment, merkle_path, root)

  // 3. Compute nullifier
  nullifier = Nullifier(secret, note_index)
  // (nullifier is published on-chain; everything else is private)

  // 4. Range check on value
  range_proof(value, 64)

Cost:
  Commitment:  ~6,058 M31 muls
  Membership:  ~121,240 M31 muls
  Nullifier:   ~6,058 M31 muls
  Range proof: ~2,048 M31 muls
  Total:       ~135,404 M31 muls
```

---

## 7. Symmetric Encryption (For Private Communication)

### 7.1 Poseidon-Based Encryption

For encrypting data that only the recipient can read (e.g., transfer amounts):

```
Derive shared key (Diffie-Hellman analog via hash):
  shared_secret = Poseidon_M31(DH_DOMAIN || sender_secret || recipient_pubkey)
  encryption_key = Poseidon_M31(KEY_DOMAIN || shared_secret || nonce)

Encrypt:
  mask = Poseidon_M31(MASK_DOMAIN || encryption_key || counter)
  ciphertext = plaintext XOR mask[0..len]

Authenticate:
  tag = Poseidon_M31(AUTH_DOMAIN || encryption_key || ciphertext)

Decrypt (recipient):
  shared_secret = Poseidon_M31(DH_DOMAIN || recipient_secret || sender_pubkey)
  encryption_key = Poseidon_M31(KEY_DOMAIN || shared_secret || nonce)
  verify: tag == Poseidon_M31(AUTH_DOMAIN || encryption_key || ciphertext)
  mask = Poseidon_M31(MASK_DOMAIN || encryption_key || counter)
  plaintext = ciphertext XOR mask[0..len]
```

### 7.2 Key Generation

```
Secret key: sk = [M31; 4]  (random QM31 element, 124 bits)
Public key:  pk = Poseidon_M31(PUBKEY_DOMAIN || sk)  (4 M31 elements)

This is a one-way function — cannot derive sk from pk.
Note: Unlike EC-based keys, this does NOT support Diffie-Hellman.
```

### 7.3 Key Exchange Alternative

Since Poseidon-based keys don't support DH, use a **hash-based key agreement**:

```
Option 1: Registered public keys + encrypted notes
  - Both parties register pk on-chain
  - Sender encrypts under recipient's pk using hash-based KDF
  - No interactive key exchange needed

Option 2: One-time shared secrets (stealth-like)
  - Sender generates random r, publishes H(r)
  - Sender computes shared = Poseidon(sk_sender || pk_recipient || r)
  - Recipient computes shared = Poseidon(sk_recipient || pk_sender || r)
  - Problem: This requires sk_sender to derive same key — NOT possible with hash-based keys

Option 3: Encrypted note attachments
  - Sender includes encrypted(amount, blinding) alongside the commitment
  - Encrypted with recipient's public key via hybrid encryption
  - Recipient scans on-chain events, tries to decrypt each
  - This is the practical approach for M31-native protocols
```

---

## 8. View Keys and Scanning

### 8.1 View Key Derivation

```
Master secret: sk = [M31; 4]
Spend key:     sk_spend = Poseidon_M31(SPEND_DOMAIN || sk)
View key:      sk_view  = Poseidon_M31(VIEW_DOMAIN || sk)
Public spend:  pk_spend = Poseidon_M31(PUBKEY_DOMAIN || sk_spend)
Public view:   pk_view  = Poseidon_M31(PUBKEY_DOMAIN || sk_view)
```

### 8.2 View Tag for Efficient Scanning

```
For each note published on-chain:
  view_tag = Poseidon_M31(VIEW_TAG_DOMAIN || pk_view || note_data)[0] & 0xFFFF

Scanning:
  1. Read view_tag from event (2 bytes)
  2. Compute expected_tag from sk_view
  3. If tag matches: try full decryption (1 in 65K false positives)
  4. If tag mismatches: skip (fast)

Cost: ~6K M31 muls per scan attempt (vs ~135K for full decryption)
With view tags: 65K/1 amortized = ~0.09 M31 muls per note scanned
```

---

## 9. Association Set Proofs (Compliance)

### 9.1 ASP Membership Proof

For Privacy Pools compliance (Buterin et al.):

```
ASPMembershipProof(note_commitment, asp_merkle_path, asp_root):
  verify_membership(note_commitment, asp_merkle_path, asp_root)

Cost: 1 Merkle proof = ~121,240 M31 muls

On-chain: asp_root is published by the Association Set Provider
Contract verifies: STARK proof includes correct asp_root check
```

### 9.2 ASP Exclusion Proof

```
ASPExclusionProof(note_commitment, exclusion_proofs):
  for each exclusion_set:
    verify_non_membership(note_commitment, exclusion_proof, exclusion_root)

Cost: N × ~246,576 M31 muls (N = number of exclusion sets)
```

---

## 10. Circuit Composition Summary

### Complete Spend Proof

```
┌─────────────────────────────────────────────────────────┐
│  Spend Circuit (1 transaction)                          │
│                                                         │
│  Inputs (private):                                      │
│    value, asset, owner_key, blinding, secret,           │
│    note_index, merkle_path, asp_path                    │
│                                                         │
│  Inputs (public):                                       │
│    old_root, new_root, nullifier, new_commitment,       │
│    asp_root, recipient_encrypted_note                   │
│                                                         │
│  Circuit:                                               │
│  ┌───────────────────────┬──────────────────────────┐   │
│  │ Commitment verify     │  ~6,058 M31 muls         │   │
│  │ Merkle membership     │  ~121,240 M31 muls       │   │
│  │ Nullifier derive      │  ~6,058 M31 muls         │   │
│  │ Range proof (64-bit)  │  ~2,048 M31 muls         │   │
│  │ New commitment        │  ~6,058 M31 muls         │   │
│  │ Merkle update         │  ~121,240 M31 muls       │   │
│  │ ASP membership        │  ~121,240 M31 muls       │   │
│  │ Encryption (note)     │  ~12,116 M31 muls        │   │
│  ├───────────────────────┼──────────────────────────┤   │
│  │ TOTAL                 │  ~396,058 M31 muls       │   │
│  └───────────────────────┴──────────────────────────┘   │
│                                                         │
│  GKR layers: ~65 (Poseidon rounds + range + sumcheck)   │
│  GPU proving time: ~4ms per transaction                 │
│  Batch of 1000: ~4s total                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Gate Type Distribution

| Gate Type | Count | Purpose |
|-----------|-------|---------|
| Mul | ~3,200 | Poseidon S-boxes (x^5) |
| MatMul/Add | ~57,600 | Poseidon MDS matrices |
| LogUp | 64 | Range proof bit checks |
| Add | ~2,000 | Merkle path selection, accumulation |

All gate types already implemented in stwo-ml's GKR engine.

---

## 11. Primitive-to-File Mapping

| Primitive | New File | Depends On | stwo-ml Reuse |
|-----------|----------|-----------|---------------|
| Poseidon-M31 | `crypto/poseidon_m31.rs` | M31 field ops | MDS via `MatMul`, S-box via `Mul` |
| Commitment | `crypto/commitment.rs` | `poseidon_m31` | — |
| Range Proof | `crypto/range_proof.rs` | LogUp | `ActivationEval` (2-entry table) |
| Merkle Tree | `crypto/merkle_proof.rs` | `poseidon_m31` | `PoseidonMerkleTree` |
| Nullifier | `crypto/nullifier.rs` | `poseidon_m31` | — |
| Encryption | `crypto/encryption.rs` | `poseidon_m31` | — |
| Spend Proof | `privacy/spend_proof.rs` | All above | GKR circuit compiler |

---

*Crypto Primitives Specification — VM31 Project*
*Bitsage Network, February 2026*
