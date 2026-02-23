# Privacy Architecture: M31-Native UTXO Pool Protocol

> **Status**: Design Specification
> **Date**: 2026-02-13
> **Companion Docs**: [vm31-vision.md](./vm31-vision.md), [m31-field-analysis.md](./m31-field-analysis.md), [crypto-primitives-m31.md](./crypto-primitives-m31.md)
> **Depends On**: crypto-primitives-m31.md (all primitive specs)

---

## 1. Executive Summary

This document specifies the privacy architecture for VM31: a UTXO/Note pool protocol built natively over M31 field arithmetic, proven with GKR+LogUp via stwo-ml's GPU prover. The design achieves **full transaction graph anonymity** (anonymity set = entire pool), **amount privacy** (Poseidon commitments), and **regulatory compatibility** (Privacy Pools ASP compliance layer).

The core insight: by operating entirely in M31, we eliminate the 800x field mismatch overhead that makes pool-based privacy prohibitively expensive on felt252/BN254 systems. Batch proving 1,000 transactions in a single GKR proof makes pool-based privacy economically viable at ~0.00031 STRK per transaction.

---

## 2. Privacy Model Comparison

### 2.1 Account-Based Privacy (Tongo / Obelysk v1)

The existing Obelysk Protocol and Tongo use **account-based** privacy with ElGamal encryption over the Stark curve:

| Property | Account-Based (Tongo) |
|---|---|
| Identity model | Public key = persistent account |
| Amount privacy | ElGamal encrypted balances |
| Sender anonymity | None (public key visible in events) |
| Receiver anonymity | None (public key visible in events) |
| Transaction graph | Fully visible (`TransferEvent{from, to}`) |
| Anonymity set | **1** (each user uniquely identified) |
| Compliance | Auditor escrow key decrypts all amounts |

**What Tongo hides**: Balance amounts, transfer amounts.
**What Tongo exposes**: Sender identity, receiver identity, transaction timing, frequency, funding source.

This is **financial privacy without anonymity**. Every transaction is attributable to a known account.

### 2.2 UTXO Pool Privacy (VM31 Target)

| Property | Pool-Based (VM31) |
|---|---|
| Identity model | One-time notes in shared pool |
| Amount privacy | Poseidon commitments (hash-based) |
| Sender anonymity | Full (note consumed via nullifier) |
| Receiver anonymity | Full (new note indistinguishable from all others) |
| Transaction graph | Hidden (nullifier unlinkable to commitment) |
| Anonymity set | **Entire pool** (all unspent notes) |
| Compliance | ASP membership proofs (Privacy Pools) |

**What VM31 hides**: Sender, receiver, amount, transaction graph.
**What VM31 exposes**: That a transaction occurred, total pool size, deposit/withdrawal times (at pool boundary).

### 2.3 Comparison with Existing Systems

| System | Field | Anonymity Set | Proving Cost | Compliance | Status |
|---|---|---|---|---|---|
| Tongo | felt252 | 1 | ~300K Cairo steps | Auditor escrow | Deployed |
| Tornado Cash | BN254 | ~1,000 per denomination | ~500K constraints | None (banned) | Sanctioned |
| Zcash Sapling | BLS12-381 | All shielded UTXOs | ~100ms on CPU | Optional viewing keys | Production |
| Aztec Connect | BN254 | Per-batch users | ~2M constraints | DeFi composability | Sunset |
| Privacy Pools | BN254 | Variable (ASP-defined) | ~600K constraints | ASP membership proof | Research |
| **VM31** | **M31** | **Entire pool** | **~396K M31 muls** | **ASP membership proof** | **Design** |

---

## 3. Note Structure

### 3.1 Note Definition

A **note** is the fundamental unit of value in the VM31 pool. Each note is a Poseidon commitment to four values:

```
Note = Poseidon-M31(owner_pubkey, asset_id, amount, blinding)
```

| Field | Type | Size | Description |
|---|---|---|---|
| `owner_pubkey` | QM31 | 4 M31 elements | Poseidon hash of owner's spending key |
| `asset_id` | M31 | 1 M31 element | Token identifier (0 = STRK, 1 = ETH, ...) |
| `amount` | M31 | 1 M31 element | Value in smallest unit (up to 2^31 - 2) |
| `blinding` | QM31 | 4 M31 elements | Random blinding factor for hiding |

Total commitment input: 10 M31 elements (fits in Poseidon-M31 rate of 12).

### 3.2 Note Commitment

```
commitment = Poseidon-M31(owner_pubkey[0..4] || asset_id || amount || blinding[0..4] || padding)
```

Output: 4 M31 elements (QM31), providing 124-bit collision resistance.

**Why hash-based, not Pedersen**: M31/QM31 multiplicative group has only ~62-bit order, insufficient for discrete-log-based commitments. Poseidon-M31 provides 124-bit security from hash output length, at 400x lower circuit cost than Pedersen over felt252.

### 3.3 Nullifier

Each note has a unique nullifier that is revealed when spent:

```
nullifier = Poseidon-M31(spending_key || commitment)
```

**Unlinkability**: Given a nullifier, an observer cannot determine which commitment it corresponds to without knowing the spending key. This is the foundation of transaction graph privacy.

### 3.4 Note Lifecycle

```
Deposit → Note created → Note sits in pool → Spend (nullifier published) → New note(s) created
                                                                          → Change note returned
```

1. **Deposit**: User deposits on-chain asset, receives note commitment in pool
2. **Dormancy**: Note exists in Merkle tree, indistinguishable from all other notes
3. **Spend**: User proves ownership (spending key) and publishes nullifier
4. **Output**: New note(s) created for recipient(s) + change note for sender

---

## 4. Merkle Tree Architecture

### 4.1 Note Tree (Append-Only)

All note commitments are stored in an append-only Merkle tree:

```
                    Root
                 /        \
              H01           H23
            /    \        /    \
          H0      H1    H2      H3
          |       |     |       |
        note_0  note_1  note_2  note_3
```

| Parameter | Value | Rationale |
|---|---|---|
| Hash function | Poseidon-M31 | Native to prover |
| Tree depth | 20 | Supports 2^20 = 1,048,576 notes |
| Leaf | Note commitment (4 M31 elements) | QM31 output of note hash |
| Empty leaf | Poseidon-M31(0, 0, 0, 0) | Deterministic zero commitment |
| Append-only | Yes | Notes never deleted, only nullified |

**Membership proof cost**: 20 hashes x 6,058 M31 muls = 121,160 M31 muls.

### 4.2 Nullifier Set

Nullifiers are tracked in a separate structure to prevent double-spending:

**Option A — On-chain mapping**: `nullifier -> bool` stored in Starknet contract storage. O(1) lookup, but requires on-chain state per spend.

**Option B — Nullifier Merkle tree**: Indexed Merkle tree supporting both membership and non-membership proofs. More complex but enables off-chain verification.

**Recommended**: Option A for initial deployment (simpler, Starknet storage is cheap). Option B for cross-chain or L3 deployments.

### 4.3 Historical Root Set

The contract maintains a rolling window of recent Merkle roots:

```
root_history: [QM31; 100]
```

This allows transactions proven against recent (but not current) roots to remain valid. Without this, a transaction proven at block N would be invalidated if another deposit occurs at block N+1.

---

## 5. Transaction Types

### 5.1 Deposit

Converts a public on-chain asset into a private note.

**Public inputs**: asset_id, amount, note_commitment
**Witness**: owner_pubkey, blinding
**On-chain action**: Transfer asset to pool contract, append note_commitment to tree

**Privacy**: Deposit amount and depositor are PUBLIC. Privacy begins after the note enters the pool and time passes.

**Circuit cost**: ~6,058 M31 muls (one Poseidon hash to verify commitment matches inputs).

### 5.2 Private Transfer (Spend)

Consumes one or more input notes and creates output notes.

**Public inputs**:
- `nullifiers[]` — one per input note consumed
- `output_commitments[]` — new note commitments
- `merkle_root` — root of note tree at proof time
- `asp_root` (optional) — ASP association set root

**Witness** (private):
- Input note preimages (owner, asset, amount, blinding) for each input
- Spending keys proving ownership
- Merkle paths proving input notes exist in tree
- Output note preimages
- ASP membership paths (if compliance required)

**Constraints proven in circuit**:

| Constraint | Purpose | M31 Muls |
|---|---|---|
| Commitment verify (per input) | Note hash matches tree leaf | ~6,058 |
| Merkle membership (per input) | Note exists in tree | ~121,160 |
| Nullifier derive (per input) | Nullifier correctly computed | ~6,058 |
| Ownership (per input) | Spending key hashes to owner_pubkey | ~6,058 |
| Output commitment (per output) | Output note correctly formed | ~6,058 |
| Amount balance | Sum of inputs = sum of outputs | ~100 |
| Range proof (per output) | Amount in [0, 2^31 - 2) | ~2,048 |
| ASP membership (optional) | Depositor in compliant set | ~121,160 |

**Typical 2-input / 2-output transfer**:

| Component | Count | M31 Muls Each | Total |
|---|---|---|---|
| Input commitment verify | 2 | 6,058 | 12,116 |
| Merkle membership | 2 | 121,160 | 242,320 |
| Nullifier derivation | 2 | 6,058 | 12,116 |
| Ownership proof | 2 | 6,058 | 12,116 |
| Output commitment | 2 | 6,058 | 12,116 |
| Amount balance check | 1 | 100 | 100 |
| Range proofs (64-bit) | 2 | 2,048 | 4,096 |
| ASP membership | 1 | 121,160 | 121,160 |
| **Total** | | | **~416,140** |

### 5.3 Withdrawal

Converts a private note back to a public on-chain asset.

**Public inputs**: nullifier, recipient_address, amount, asset_id, merkle_root
**Witness**: note preimage, spending key, Merkle path

**Privacy tradeoff**: Withdrawal amount and recipient are PUBLIC. The connection to the original deposit is hidden (anonymity set = all deposits of same asset).

**Circuit cost**: ~135,276 M31 muls (commitment + Merkle + nullifier + ownership).

### 5.4 Denomination Modes

**Fixed denomination** (Tornado Cash style):
- Pool accepts only fixed amounts (e.g., 100 STRK, 1000 STRK)
- Simpler circuit (no range proofs needed)
- Larger anonymity sets per denomination tier
- Less flexible for arbitrary amounts

**Arbitrary amount** (Zcash style):
- Any amount up to 2^31 - 2 M31 units
- Requires range proofs (+2,048 M31 muls per output)
- Smaller anonymity sets (amount diversity weakens privacy)
- Full flexibility

**Recommended**: Arbitrary amount mode with an optional "standard denomination" UI hint that encourages users to deposit in round amounts. This maximizes flexibility while soft-encouraging larger anonymity sets.

---

## 6. Anonymity Analysis

### 6.1 Anonymity Set Definition

The **anonymity set** for a spend is the set of notes that the spent note could plausibly be. In a UTXO pool:

```
Anonymity set = {all unspent notes in the tree at proof time}
```

For a pool with 10,000 deposited notes and 3,000 spent, the anonymity set is 7,000.

### 6.2 Anonymity Guarantees

| Property | Guarantee | Condition |
|---|---|---|
| **Sender anonymity** | Full | Nullifier unlinkable to commitment |
| **Receiver anonymity** | Full | Output commitment indistinguishable from all notes |
| **Amount privacy** | Full | Poseidon commitment hides amount |
| **Transaction graph** | Hidden | No on-chain link between inputs and outputs |
| **Temporal privacy** | Partial | Deposit/withdrawal times visible at pool boundary |

### 6.3 Honest Limitations

**L1: Entry/Exit Linkage**

When a user deposits 1,000 STRK and later withdraws 1,000 STRK, an observer can correlate:
- Small pool → high probability of matching deposit to withdrawal
- Unique amount → direct linkage
- Short time gap → temporal correlation

**Mitigations**: Wait before withdrawing, use standard denominations, withdraw to fresh address.

**L2: Timing Correlation**

If Alice deposits at block N and Bob receives a withdrawal at block N+5, the timing narrows the anonymity set to deposits in that window.

**Mitigation**: Encourage deposits to accumulate before withdrawals. Batch proving naturally creates temporal cover (1,000 txs submitted together).

**L3: Small Pool Bootstrap**

A new pool with 10 notes has anonymity set = 10. The first users get minimal privacy.

**Mitigation**: Seed pool with protocol-owned liquidity. Incentivize early deposits with rewards.

**L4: Cross-Asset Correlation**

If Alice deposits 100 STRK and 0.5 ETH, then Bob withdraws 100 STRK and 0.5 ETH, the joint probability links them.

**Mitigation**: Separate pools per asset. Use different timing for different assets.

**L5: Network-Level Deanonymization**

If a user submits a proof from the same IP address for deposit and withdrawal, network-level observers can correlate.

**Mitigation**: Use Tor/VPN. Submit transactions through relayers.

**L6: Proof Timing Metadata**

GPU proving takes ~4ms per transaction. If a user's local proving time is measurable, it could leak information about proof complexity.

**Mitigation**: Relayers batch-submit proofs, masking individual timing.

### 6.4 Quantitative Anonymity Model

For a pool with N unspent notes, an observer's best guess for the sender of a spend is uniform over N notes:

```
P(sender = note_i | spend event) = 1/N    for all unspent notes i
```

**Effective anonymity** degrades with auxiliary information:

| Auxiliary Info | Effective Anonymity Set |
|---|---|
| No extra info | N (full pool) |
| Known deposit time window | N_window (notes deposited in window) |
| Known amount (fixed denom) | N (no degradation) |
| Known amount (arbitrary) | N_amount (notes with matching amount) |
| Known IP address | 1 (fully deanonymized) |
| Known deposit + amount + timing | Potentially 1 |

**Target**: Anonymity set > 1,000 within 30 days of pool launch. Requires ~1,000 deposits in first month.

---

## 7. ASP Compliance Layer (Privacy Pools)

### 7.1 Design

Following the Privacy Pools framework (Buterin, Soleimani et al.), VM31 supports optional **Association Set Provider** (ASP) compliance proofs:

**ASP**: A third party that maintains a curated set of "compliant" deposit commitments. The ASP publishes a Merkle root of their association set.

**Compliance modes**:

| Mode | Proof Required | Privacy | Regulatory |
|---|---|---|---|
| **Full privacy** | No ASP proof | Maximum anonymity | Non-compliant |
| **Inclusion proof** | Prove input note's deposit is in ASP set | Anonymity within ASP set | Compliant |
| **Exclusion proof** | Prove input note's deposit is NOT in bad set | Full anonymity minus known bad | Semi-compliant |

### 7.2 ASP Merkle Tree

```
ASP_Root
   /    \
  H01    H23
 / \    / \
d0  d1  d2  d3    ← deposit commitments vetted by ASP
```

The ASP tree is separate from the note tree. A single deposit commitment may appear in multiple ASP trees (multiple ASPs can vouch for the same depositor).

### 7.3 Circuit Integration

ASP membership adds one Merkle proof to the spend circuit:

```
asp_leaf = deposit_commitment  (from the original deposit that created input note)
asp_path = Merkle path in ASP's association set
asp_root = ASP's published root (public input)

Verify: MerkleVerify(asp_leaf, asp_path, asp_root)
```

**Cost**: +121,160 M31 muls per ASP proof (one 20-level Merkle verification).

### 7.4 Deposit Commitment Tracking

The circuit must prove that the ASP-vetted deposit commitment corresponds to the actual input note being spent. This requires:

1. The deposit commitment is stored alongside the note commitment at deposit time
2. The spend circuit proves knowledge of the deposit commitment that was used to create the input note
3. The ASP membership proof is over this deposit commitment

This creates a chain: `deposit commitment → note commitment → nullifier`, all linked in the circuit but unlinkable on-chain.

---

## 8. Encryption and Scanning

### 8.1 The Recipient Discovery Problem

In a UTXO pool, the recipient doesn't know which note is theirs until they scan. This is fundamentally different from account-based systems where the contract stores `balance[pubkey]`.

### 8.2 Encrypted Note Memo

When creating an output note for a recipient, the sender encrypts the note preimage using the recipient's public key:

```
memo = PoseidonEncrypt(
    key = DeriveSharedKey(sender_ephemeral_key, recipient_pubkey),
    plaintext = (asset_id, amount, blinding)
)
```

The encrypted memo is posted on-chain alongside the output commitment.

### 8.3 View Key Scanning

The recipient uses their **view key** (derived from spending key) to attempt decryption of every new memo:

```
For each new output commitment + memo:
    shared_key = DeriveSharedKey(view_key, sender_ephemeral_pubkey)
    try:
        (asset_id, amount, blinding) = PoseidonDecrypt(shared_key, memo)
        expected_commitment = Poseidon-M31(my_pubkey, asset_id, amount, blinding)
        if expected_commitment == on_chain_commitment:
            # This note is mine!
            save_to_wallet(note)
```

**Scanning cost**: One Poseidon decryption attempt (~6,058 M31 muls) per new note per scan. For a pool with 100 new notes per block, scanning costs ~606K M31 muls per block — trivial on a modern CPU (~0.3ms).

### 8.4 View Key Delegation

Users can delegate a view key that allows scanning without spending authority:

```
spending_key → Poseidon-M31(spending_key || "spend") → spending_pubkey
spending_key → Poseidon-M31(spending_key || "view")  → view_key
```

A wallet provider or indexer with the view key can identify the user's notes but cannot spend them.

---

## 9. Comparison with Existing Obelysk Contracts

The current Obelysk Protocol implements 7 privacy-related contracts. Here's how each maps to the VM31 redesign:

### 9.1 Privacy Pools (privacy_pools.cairo)

**Current**: ASP-vetted deposit tree with Poseidon commitments over felt252. LeanIMT backing. Ragequit mechanism for emergency exits.

**VM31 Mapping**: Direct port. Replace felt252 Poseidon with Poseidon-M31. Keep LeanIMT structure (tree topology is field-agnostic). Keep ragequit mechanism. Add batch proving for withdrawals.

**Improvement**: ~20x cheaper hash operations. Batch withdrawal proofs (1,000 withdrawals in one STARK).

### 9.2 Privacy Router (privacy_router.cairo)

**Current**: Zether-like encrypted balances with ElGamal. Epoch rollups. SameEncryption3Proof for auditor.

**VM31 Mapping**: **Replace entirely** with UTXO pool model. Account-based encrypted balances provide no anonymity. The UTXO pool subsumes all privacy router functionality with strictly better privacy guarantees.

### 9.3 ElGamal (elgamal.cairo)

**Current**: ElGamal encryption over Stark curve. Schnorr proofs. BSGS discrete log.

**VM31 Mapping**: **Not needed in core protocol**. Poseidon-based symmetric encryption replaces ElGamal for note memos. No discrete log solving required (amount is a direct field element, not an exponent). ElGamal may be retained as an optional module for specific use cases (e.g., stealth address key exchange).

### 9.4 Confidential Transfer (confidential_transfer.cairo)

**Current**: ElGamal-encrypted transfer amounts with range proofs.

**VM31 Mapping**: **Subsumed by pool spend circuit**. A "private transfer" is just: consume input note → create output note for recipient. The pool circuit handles all constraints (ownership, balance, range).

### 9.5 Stealth Payments (stealth_payments.cairo)

**Current**: EIP-5564 one-time stealth addresses. Ephemeral key derivation. View tag scanning.

**VM31 Mapping**: **Complementary, not replaced**. Stealth addresses solve a different problem (recipient discovery without pool). In VM31, stealth-like derivation is used for encrypted note memos. The scanning protocol is similar but uses Poseidon-M31 instead of Keccak-256.

### 9.6 Dark Pool Auction (dark_pool_auction.cairo)

**Current**: Commit-reveal batch auction with ElGamal encrypted balances. Epoch-based clearing.

**VM31 Mapping**: **Enhanced by batch proving**. Replace commit-reveal with ZK proofs of valid orders. Batch prove all orders in an epoch in a single GKR proof. Clearing algorithm remains O(n log n) but settlement uses pool notes instead of encrypted balances.

### 9.7 Confidential Swap (confidential_swap.cairo)

**Current**: Private atomic swaps with rate proofs over ElGamal.

**VM31 Mapping**: **Rebuild over pool**. A confidential swap becomes: prove (in ZK) that two notes are consumed and two new notes are created with amounts satisfying the exchange rate. No ElGamal needed — all amounts are committed via Poseidon.

---

## 10. Batch Proving Integration

### 10.1 Why Batch Proving Changes Everything

In existing privacy systems, each transaction requires an individual proof verified on-chain. This means:
- Each user generates their own proof (~2-4 seconds on CPU)
- Each proof is verified individually on-chain (~300K-500K gas)
- Cost per transaction: ~0.3-1.0 STRK

With VM31 batch proving:
- A relayer collects 1,000 transactions
- All 1,000 are proven in a single GKR proof (~2 seconds on GPU)
- One proof is verified on-chain (~300K gas total)
- Cost per transaction: ~0.0003 STRK

### 10.2 Relayer Architecture

```
Users ──[encrypted txs]──> Relayer ──[batch proof]──> Starknet
                                                         │
                              ┌───────────────────────────┘
                              │
                          Pool Contract
                          ├── Verify single STARK proof
                          ├── Apply all 1,000 nullifiers
                          ├── Append all 1,000 new commitments
                          └── Update Merkle root
```

**Relayer role**:
1. Collect pending transactions (encrypted note data)
2. Arrange into batch (up to 1,000 txs)
3. Generate single GKR proof on GPU
4. Submit proof + public inputs to on-chain verifier
5. Contract verifies proof, applies all state transitions atomically

**Relayer trust model**: The relayer sees encrypted transaction data but cannot forge transactions (ZK proof required). The relayer can:
- Censor transactions (mitigated by multiple competing relayers)
- Reorder transactions within a batch (mitigated by deterministic ordering)
- Delay batches (mitigated by timeout mechanisms)

The relayer CANNOT:
- Steal funds (no access to spending keys)
- Link inputs to outputs (proven in ZK)
- Forge proofs (computationally infeasible)

### 10.3 Anonymity Set Amplification

Batch proving directly amplifies anonymity sets:

| Batch Size | Txs Per Batch | Anonymity Per Batch | Daily Txs (10 batches) |
|---|---|---|---|
| 100 | 100 | 100 input notes mixed | 1,000 |
| 500 | 500 | 500 input notes mixed | 5,000 |
| 1,000 | 1,000 | 1,000 input notes mixed | 10,000 |

Within a single batch, all 1,000 spend events are proven simultaneously. An observer sees 1,000 nullifiers and 1,000+ new commitments but cannot link any specific nullifier to any specific commitment. This is **intra-batch mixing** — a form of mix-net built into the proving layer.

---

## 11. GKR Circuit Mapping

### 11.1 Spend Transaction as GKR Circuit

The spend circuit maps to GKR gate types already implemented in stwo-ml:

```
Layer 0: Input layer (private witness)
    ├── spending_key (4 M31)
    ├── input_note_preimages (10 M31 each)
    ├── merkle_paths (20 x 4 M31 each)
    ├── output_note_preimages (10 M31 each)
    └── blinding_factors (4 M31 each)

Layers 1-5: Poseidon-M31 for commitment verify
    ├── AddConst gates (round constants)
    ├── Mul gates (S-box: x^5 via 3 muls)
    └── MatMul gates (MDS matrix)

Layers 6-10: Poseidon-M31 for nullifier
    └── (same gate types)

Layers 11-30: Poseidon-M31 for Merkle path (20 levels)
    └── (same gate types, repeated 20x)

Layers 31-35: Poseidon-M31 for output commitment
    └── (same gate types)

Layer 36: Amount balance check
    └── Add gates (sum inputs - sum outputs = 0)

Layers 37+: Range proofs (LogUp)
    └── LogUp gates (bit decomposition table lookup)
```

### 11.2 Gate Type Distribution

| Gate Type | Count per Tx | Percentage | stwo-ml Component |
|---|---|---|---|
| Mul (Poseidon S-box) | ~15,000 | 38% | `gkr/circuit.rs::LayerType::Mul` |
| MatMul (Poseidon MDS) | ~5,000 | 13% | `gkr/circuit.rs::LayerType::MatMul` |
| Add (balance + MDS) | ~12,000 | 30% | `gkr/circuit.rs::LayerType::Add` |
| AddConst (round keys) | ~3,000 | 8% | `gkr/circuit.rs::LayerType::AddConst` |
| LogUp (range proofs) | ~4,000 | 10% | `gkr/circuit.rs::LayerType::Activation` |
| Identity (wiring) | ~500 | 1% | `gkr/circuit.rs::LayerType::Identity` |

All gate types are already implemented. No new gate types required.

### 11.3 Batch Circuit Structure

For a batch of B transactions, the GKR circuit processes all B in parallel:

```
Total gates = B x gates_per_tx
Total M31 muls = B x 416,140

For B = 1,000:
    Total M31 muls = 416,140,000
    GPU proving time ≈ 2 seconds (at 200M M31 muls/sec on H100)
    On-chain verification = single STARK proof (~300K gas)
```

---

## 12. Threat Model

### 12.1 Adversary Capabilities

| Adversary | Capabilities | Defenses |
|---|---|---|
| **Passive chain observer** | Sees all on-chain data (nullifiers, commitments, Merkle roots) | Anonymity set = entire pool |
| **Active relayer** | Censors/delays transactions | Multiple competing relayers |
| **Network observer** | Sees IP addresses of submitters | Tor/VPN, relayer submission |
| **Colluding ASPs** | Can narrow anonymity set to their association set | Multiple independent ASPs |
| **State-level adversary** | Combines chain analysis, network surveillance, legal compulsion | Defense in depth (see below) |

### 12.2 Defense in Depth

1. **Cryptographic layer**: Poseidon-M31 commitments, 124-bit security
2. **Protocol layer**: UTXO pool, anonymity set = pool size
3. **Network layer**: Relayer submission, Tor compatibility
4. **Compliance layer**: ASP proofs satisfy regulators without breaking privacy
5. **Economic layer**: Batch proving makes privacy cheap (no "privacy premium")

### 12.3 Known Attack Vectors

**Intersection attack**: If the same user deposits and withdraws repeatedly with unique amounts, intersection of deposit/withdrawal sets narrows to that user. Mitigation: standard denominations, variable timing.

**Sybil deposits**: Adversary fills pool with controlled notes to dilute honest anonymity set. Cost: one deposit per note (expensive at scale). Partial mitigation: this actually increases pool size, which helps honest users.

**Griefing**: Adversary submits invalid transactions to waste relayer proving time. Mitigation: upfront fee or proof-of-work per transaction submission.

---

## 13. Starknet Integration

### 13.1 Contract Architecture

```
┌─────────────────────────┐
│    VM31 Pool Contract    │
├─────────────────────────┤
│ note_tree: MerkleTree    │  ← Poseidon-M31 append-only tree
│ nullifier_set: Map       │  ← Spent nullifiers
│ root_history: Array      │  ← Last 100 Merkle roots
│ asp_roots: Map<ASP, Root>│  ← Per-ASP association set roots
│ verifier: StwoVerifier   │  ← On-chain STARK verifier (deployed)
├─────────────────────────┤
│ deposit(commitment, ...)  │
│ spend(proof, pub_inputs)  │  ← Single STARK proof for batch
│ withdraw(proof, ...)      │
│ update_asp_root(asp, root)│
└─────────────────────────┘
```

### 13.2 Leveraging Existing Infrastructure

The on-chain STARK verifier (`StwoVerifier` at `0x00592...`) is already deployed and verified on Starknet Sepolia. The VM31 pool contract calls this verifier for batch proof verification.

The GKR prover, CUDA kernels, Fiat-Shamir channel, Poseidon channel, and recursive STARK verification — all already built in stwo-ml — are reused without modification.

---

## 14. Summary

VM31's privacy architecture achieves:

| Goal | Mechanism | Status |
|---|---|---|
| Amount privacy | Poseidon-M31 commitments | Primitive specified |
| Sender anonymity | Nullifier unlinkability | Primitive specified |
| Receiver anonymity | New note indistinguishability | Protocol designed |
| Transaction graph privacy | UTXO pool model | Protocol designed |
| Regulatory compliance | ASP membership proofs | Protocol designed |
| Economic viability | Batch proving (1,000 txs / proof) | Prover built |
| Scalability | GPU acceleration, 2s batch proving | Infrastructure built |

The key differentiator from all existing systems: **M31-native field arithmetic eliminates the performance tax** that has kept pool-based privacy systems expensive. Combined with GPU batch proving, this makes strong privacy cheap enough for everyday use.

---

*VM31 / Obelysk Protocol v2 — February 2026*
