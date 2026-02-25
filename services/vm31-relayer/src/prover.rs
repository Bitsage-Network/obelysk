use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use stwo_ml::privacy::pool_client::PoolClient;
use stwo_ml::privacy::relayer::{
    hash_batch_public_inputs_for_cairo, run_vm31_relayer_flow, RelayOutcome, SncastVm31Backend,
    Vm31RelayerConfig, WithdrawalRecipients,
};
use stwo_ml::privacy::tx_builder::{PendingTx, ProvenTransaction, TxBuilder};

use crate::batch_queue::ReadyBatch;
use crate::bridge::BridgeService;
use crate::store::{
    BatchRecord, BatchStatus, BatchStore, InMemoryStore, MerklePathRecord, NoteRecord, NoteStore,
    StatusUpdate,
};

/// Deposit note info extracted before the proving step (which moves txs).
struct DepositNoteInfo {
    owner_pubkey: [u32; 4],
    asset_id: u32,
    amount: u64,
    blinding: [u32; 4],
}

impl DepositNoteInfo {
    /// Compute a deterministic commitment key via FNV-1a hash of note fields.
    fn commitment_key(&self) -> String {
        let mut state: u64 = 0xcbf29ce484222325;
        for &v in &self.owner_pubkey {
            for b in v.to_le_bytes() {
                state ^= b as u64;
                state = state.wrapping_mul(0x100000001b3);
            }
        }
        for b in self.asset_id.to_le_bytes() {
            state ^= b as u64;
            state = state.wrapping_mul(0x100000001b3);
        }
        for b in self.amount.to_le_bytes() {
            state ^= b as u64;
            state = state.wrapping_mul(0x100000001b3);
        }
        for &v in &self.blinding {
            for b in v.to_le_bytes() {
                state ^= b as u64;
                state = state.wrapping_mul(0x100000001b3);
            }
        }
        format!("{:016x}", state)
    }
}

/// Orchestrates batch proving and on-chain submission.
pub struct ProverService {
    backend: SncastVm31Backend,
    pool_client: PoolClient,
    store: Arc<InMemoryStore>,
    relayer_config: Vm31RelayerConfig,
    bridge: BridgeService,
}

impl ProverService {
    pub fn new(
        backend: SncastVm31Backend,
        pool_client: PoolClient,
        store: Arc<InMemoryStore>,
        chunk_size: u32,
        bridge: BridgeService,
    ) -> Self {
        Self {
            backend,
            pool_client,
            store,
            relayer_config: Vm31RelayerConfig {
                chunk_size,
                ..Default::default()
            },
            bridge,
        }
    }

    /// Runs the batch processor loop, consuming from the mpsc channel.
    pub async fn run(self, mut rx: mpsc::Receiver<ReadyBatch>) {
        info!("prover service started, waiting for batches");
        while let Some(ready) = rx.recv().await {
            let batch_id = ready.batch_id.clone();
            info!(batch_id = %batch_id, tx_count = ready.transactions.len(), "processing batch");

            if let Err(e) = self.process_batch(&batch_id, ready.transactions).await {
                error!(batch_id = %batch_id, error = %e, "batch processing failed");
                // Ensure batch is marked Failed on ANY error path, preventing
                // batches stuck in "Proving" or "Submitting" forever.
                let _ = self
                    .store
                    .update_status(
                        &batch_id,
                        BatchStatus::Failed,
                        StatusUpdate {
                            error: Some(e.to_string()),
                            ..Default::default()
                        },
                    )
                    .await;
            }
        }
        warn!("prover service channel closed, shutting down");
    }

    async fn process_batch(
        &self,
        batch_id: &str,
        txs: Vec<PendingTx>,
    ) -> Result<(), ProverError> {
        let tx_count = txs.len();

        // Save initial batch record
        let record = BatchRecord::new(batch_id.to_string(), tx_count);
        self.store
            .save_batch(batch_id, &record)
            .await
            .map_err(|e| ProverError::Store(e.to_string()))?;

        // ── Step 1: Validate inputs (PoolClient calls are synchronous RPC) ──
        {
            let pool_client = self.pool_client.clone();
            let txs_ref = txs.clone();
            tokio::task::spawn_blocking(move || Self::validate_inputs_blocking(&pool_client, &txs_ref))
                .await
                .map_err(|e| ProverError::Validation(format!("task join error: {e}")))?
                ?;
        }

        // ── Step 2: Extract withdrawal recipients + deposit note info before proving ──
        let withdrawal_recipients = Self::extract_withdrawal_recipients(&txs);
        let deposit_notes = Self::extract_deposit_notes(&txs);

        // Capture tx kinds before the proving closure moves txs.
        // Used in Step 7 to map ProvenTransaction.new_commitments → deposit digests.
        // 0=Deposit (1 commitment), 1=Withdraw (0), 2=Transfer (2)
        let tx_kinds: Vec<u8> = txs
            .iter()
            .map(|tx| match tx {
                PendingTx::Deposit { .. } => 0u8,
                PendingTx::Withdraw { .. } => 1,
                PendingTx::Transfer { .. } => 2,
            })
            .collect();

        // Update status to Proving
        self.store
            .update_status(batch_id, BatchStatus::Proving, StatusUpdate::default())
            .await
            .map_err(|e| ProverError::Store(e.to_string()))?;

        // ── Step 3: Build + Prove via TxBuilder (CPU-bound, offload) ────────
        // TxBuilder::prove() handles witness construction AND STARK proving.
        info!(batch_id = %batch_id, "starting STARK proof generation");
        let proven = {
            tokio::task::spawn_blocking(move || {
                let mut builder = TxBuilder::new();
                for tx in txs {
                    match tx {
                        PendingTx::Deposit {
                            amount,
                            asset_id,
                            recipient_pubkey,
                            recipient_viewing_key,
                        } => {
                            builder.deposit(amount, asset_id, recipient_pubkey, recipient_viewing_key)?;
                        }
                        PendingTx::Withdraw {
                            amount,
                            asset_id,
                            note,
                            spending_key,
                            merkle_path,
                            merkle_root,
                            withdrawal_binding,
                        } => {
                            builder.withdraw_with_binding(
                                amount,
                                asset_id,
                                note,
                                spending_key,
                                merkle_path,
                                merkle_root,
                                withdrawal_binding,
                            )?;
                        }
                        PendingTx::Transfer {
                            amount,
                            asset_id,
                            recipient_pubkey,
                            recipient_viewing_key,
                            sender_viewing_key,
                            input_notes,
                            merkle_root,
                        } => {
                            builder.transfer(
                                amount,
                                asset_id,
                                recipient_pubkey,
                                recipient_viewing_key,
                                sender_viewing_key,
                                input_notes,
                                merkle_root,
                            )?;
                        }
                    }
                }
                builder.prove()
            })
            .await
            .map_err(|e| ProverError::Proving(format!("task join error: {e}")))?
            .map_err(|e| ProverError::Proving(e.to_string()))?
        };
        info!(batch_id = %batch_id, "proof generation complete");

        // Compute proof hash for on-chain binding
        let proof_hash_m31 = hash_batch_public_inputs_for_cairo(&proven.proof.public_inputs)
            .map_err(|e| ProverError::Proving(format!("hash error: {e}")))?;
        let proof_hash = format!(
            "0x{}",
            proof_hash_m31
                .iter()
                .map(|m| format!("{:08x}", m.0))
                .collect::<String>()
        );

        self.store
            .update_status(
                batch_id,
                BatchStatus::Submitting,
                StatusUpdate {
                    proof_hash: Some(proof_hash.clone()),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| ProverError::Store(e.to_string()))?;

        // ── Step 4: On-chain submission (5-step idempotent flow, blocking sncast) ─
        info!(batch_id = %batch_id, "submitting to chain");
        let outcome: RelayOutcome = {
            let backend = self.backend.clone();
            let pub_inputs = proven.proof.public_inputs.clone();
            let ph = proof_hash.clone();
            let wr = withdrawal_recipients.clone();
            let rc = self.relayer_config.clone();
            tokio::task::spawn_blocking(move || {
                run_vm31_relayer_flow(&backend, &pub_inputs, &ph, &wr, &rc)
            })
            .await
            .map_err(|e| ProverError::Relayer(format!("task join error: {e}")))?
            .map_err(|e| ProverError::Relayer(format!("{e}")))?
        };

        info!(
            batch_id = %batch_id,
            onchain_batch_id = %outcome.batch_id,
            finalized = outcome.finalized,
            "on-chain submission complete"
        );

        // ── Step 5: Bridge withdrawals ──────────────────────────────────────
        if !withdrawal_recipients.payout.is_empty() {
            info!(
                batch_id = %batch_id,
                count = withdrawal_recipients.payout.len(),
                "bridging withdrawals"
            );
            for (idx, _) in withdrawal_recipients.payout.iter().enumerate() {
                if let Err(e) = self.bridge.bridge_withdrawal(
                    &outcome.batch_id,
                    idx as u32,
                ).await {
                    // Non-fatal: log and continue. Bridge is idempotent and can be retried.
                    warn!(
                        batch_id = %batch_id,
                        withdrawal_idx = idx,
                        error = %e,
                        "bridge call failed (idempotent, can retry)"
                    );
                }
            }
        }

        // ── Step 6: Finalize record ─────────────────────────────────────────
        self.store
            .update_status(
                batch_id,
                BatchStatus::Finalized,
                StatusUpdate {
                    batch_id_onchain: Some(outcome.batch_id),
                    tx_hash: Some(outcome.proof_hash),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| ProverError::Store(e.to_string()))?;

        // ── Step 7: Store note records for deposit notes ──────────────────
        // Extract Poseidon2-M31 commitment digests from the proven transaction.
        // new_commitments contains (NoteCommitment, Note) for every output note
        // in the batch. We map them to deposits using the tx_kinds ordering.
        let deposit_digests = Self::extract_deposit_digests(&tx_kinds, &proven);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        for (idx, note_info) in deposit_notes.iter().enumerate() {
            let commitment = note_info.commitment_key();
            let digest = deposit_digests.get(idx).copied();
            if digest.is_some() {
                info!(
                    batch_id = %batch_id,
                    commitment = %commitment,
                    idx = idx,
                    "deposit note commitment digest extracted from proof"
                );
            }
            let record = NoteRecord {
                commitment: commitment.clone(),
                merkle_path: MerklePathRecord {
                    siblings: vec![], // Populated by TreeSyncService backfill
                    index: 0,
                },
                merkle_root: [0; 8], // Populated by TreeSyncService backfill
                batch_id: batch_id.to_string(),
                created_at: now,
                commitment_digest: digest,
                note_index_in_batch: idx,
            };
            if let Err(e) = self.store.save_note(&commitment, &record).await {
                warn!(
                    batch_id = %batch_id,
                    commitment = %commitment,
                    error = %e,
                    "failed to save note record (non-fatal)"
                );
            }
        }

        info!(batch_id = %batch_id, "batch finalized");
        Ok(())
    }

    /// Validates nullifiers and Merkle roots against the pool contract.
    /// This is a blocking function (synchronous RPC calls) — must run in spawn_blocking.
    fn validate_inputs_blocking(pool_client: &PoolClient, txs: &[PendingTx]) -> Result<(), ProverError> {
        for tx in txs {
            match tx {
                PendingTx::Withdraw {
                    merkle_root,
                    note,
                    spending_key,
                    ..
                } => {
                    if !pool_client
                        .is_known_root(merkle_root)
                        .map_err(|e| ProverError::Validation(format!("root check: {e}")))?
                    {
                        return Err(ProverError::Validation(
                            "unknown Merkle root in withdrawal".into(),
                        ));
                    }
                    let nullifier = note.nullifier(spending_key);
                    if pool_client
                        .is_nullifier_spent(&nullifier)
                        .map_err(|e| ProverError::Validation(format!("nullifier check: {e}")))?
                    {
                        return Err(ProverError::Validation("nullifier already spent".into()));
                    }
                }
                PendingTx::Transfer {
                    merkle_root,
                    input_notes,
                    ..
                } => {
                    if !pool_client
                        .is_known_root(merkle_root)
                        .map_err(|e| ProverError::Validation(format!("root check: {e}")))?
                    {
                        return Err(ProverError::Validation(
                            "unknown Merkle root in transfer".into(),
                        ));
                    }
                    for (note, sk, _) in input_notes {
                        let nullifier = note.nullifier(sk);
                        if pool_client
                            .is_nullifier_spent(&nullifier)
                            .map_err(|e| {
                                ProverError::Validation(format!("nullifier check: {e}"))
                            })?
                        {
                            return Err(ProverError::Validation(
                                "nullifier already spent in transfer".into(),
                            ));
                        }
                    }
                }
                PendingTx::Deposit { .. } => {}
            }
        }
        Ok(())
    }

    /// Maps ProvenTransaction.new_commitments to deposit-only digests using tx ordering.
    ///
    /// Each tx type produces a known number of output commitments:
    /// - Deposit: 1 (the shielded note)
    /// - Withdraw: 0
    /// - Transfer: 2 (recipient + change)
    ///
    /// By replaying the tx_kinds, we can extract exactly the deposit commitments.
    fn extract_deposit_digests(tx_kinds: &[u8], proven: &ProvenTransaction) -> Vec<[u32; 8]> {
        let mut digests = Vec::new();
        let mut ci = 0usize; // commitment index into proven.new_commitments
        for &kind in tx_kinds {
            match kind {
                0 => {
                    // Deposit: 1 new commitment
                    if ci < proven.new_commitments.len() {
                        let (ref c, _) = proven.new_commitments[ci];
                        digests.push([
                            c[0].0, c[1].0, c[2].0, c[3].0,
                            c[4].0, c[5].0, c[6].0, c[7].0,
                        ]);
                    }
                    ci += 1;
                }
                1 => {} // Withdraw: 0 new commitments
                2 => {
                    ci += 2; // Transfer: 2 new commitments (recipient + change)
                }
                _ => {}
            }
        }
        digests
    }

    /// Extracts deposit note info before the proving step (which moves txs).
    fn extract_deposit_notes(txs: &[PendingTx]) -> Vec<DepositNoteInfo> {
        let mut notes = Vec::new();
        for tx in txs {
            if let PendingTx::Deposit {
                amount,
                asset_id,
                recipient_pubkey,
                ..
            } = tx
            {
                notes.push(DepositNoteInfo {
                    owner_pubkey: [
                        recipient_pubkey[0].0,
                        recipient_pubkey[1].0,
                        recipient_pubkey[2].0,
                        recipient_pubkey[3].0,
                    ],
                    asset_id: *asset_id,
                    amount: *amount,
                    blinding: [0, 0, 0, 0], // Blinding is generated server-side by TxBuilder
                });
            }
        }
        notes
    }

    /// Extracts withdrawal recipients from the pending transactions.
    /// Called before proving since we need this info for the relay flow.
    fn extract_withdrawal_recipients(txs: &[PendingTx]) -> WithdrawalRecipients {
        let mut payout_recipients = Vec::new();
        let mut credit_recipients = Vec::new();

        for tx in txs {
            if let PendingTx::Withdraw {
                withdrawal_binding, ..
            } = tx
            {
                // The binding digest encodes (payout, credit, asset, amount, idx)
                // See relayer.rs compute_withdrawal_binding_digest()
                let binding_hex = format!(
                    "0x{}",
                    withdrawal_binding
                        .iter()
                        .map(|m| format!("{:08x}", m.0))
                        .collect::<String>()
                );
                payout_recipients.push(binding_hex.clone());
                credit_recipients.push(binding_hex);
            }
        }

        WithdrawalRecipients::new(payout_recipients, credit_recipients)
    }
}

#[derive(Debug)]
pub enum ProverError {
    Validation(String),
    Proving(String),
    Relayer(String),
    Store(String),
}

impl std::fmt::Display for ProverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProverError::Validation(msg) => write!(f, "validation: {msg}"),
            ProverError::Proving(msg) => write!(f, "proving: {msg}"),
            ProverError::Relayer(msg) => write!(f, "relayer: {msg}"),
            ProverError::Store(msg) => write!(f, "store: {msg}"),
        }
    }
}

impl std::error::Error for ProverError {}
