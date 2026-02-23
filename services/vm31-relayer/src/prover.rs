use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use stwo_ml::privacy::pool_client::PoolClient;
use stwo_ml::privacy::relayer::{
    hash_batch_public_inputs_for_cairo, run_vm31_relayer_flow, RelayOutcome, SncastVm31Backend,
    Vm31RelayerConfig, WithdrawalRecipients,
};
use stwo_ml::privacy::tx_builder::{PendingTx, TxBuilder};

use crate::batch_queue::ReadyBatch;
use crate::bridge::BridgeService;
use crate::store::{BatchRecord, BatchStatus, BatchStore, InMemoryStore, StatusUpdate};

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

        // ── Step 2: Extract withdrawal recipients before proving ───────────
        let withdrawal_recipients = Self::extract_withdrawal_recipients(&txs);

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
