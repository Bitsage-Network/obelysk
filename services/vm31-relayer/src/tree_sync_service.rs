//! Background merkle tree syncer using stwo-ml's TreeSync.
//!
//! Periodically polls the pool contract for NoteInserted events, maintains
//! a local PoseidonMerkleTreeM31, and backfills pending NoteRecords with
//! real merkle proofs.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use stwo_ml::crypto::merkle_m31::Digest;
use stwo_ml::prelude::M31;
use stwo_ml::privacy::pool_client::{PoolClient, PoolClientConfig};
use stwo_ml::privacy::tree_sync::TreeSync;

use crate::store::{InMemoryStore, MerklePathRecord, NoteStore};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Proof result returned by on-demand lookups.
pub struct ProofResult {
    pub siblings: Vec<[u32; 8]>,
    pub index: usize,
    pub root: [u32; 8],
}

/// Background service that keeps the local merkle tree in sync with the
/// on-chain pool and backfills pending note records.
pub struct TreeSyncService {
    tree: Mutex<TreeSync>,
    pool_config: PoolClientConfig,
    store: Arc<InMemoryStore>,
    sync_interval: Duration,
}

impl TreeSyncService {
    /// Create a new service instance.
    ///
    /// `cache_path` — on-disk JSON cache for incremental sync (default: ~/.vm31/tree_cache.json).
    /// `sync_interval_secs` — polling interval for on-chain events.
    pub fn new(
        pool_config: PoolClientConfig,
        store: Arc<InMemoryStore>,
        cache_path: Option<String>,
        sync_interval_secs: u64,
    ) -> Result<Self, String> {
        let path = cache_path
            .map(PathBuf::from)
            .unwrap_or_else(TreeSync::default_cache_path);

        let tree = TreeSync::load_or_create(&path)
            .map_err(|e| format!("failed to load tree cache: {e}"))?;

        info!(
            cache = %path.display(),
            leaves = tree.size(),
            "tree sync service initialized"
        );

        Ok(Self {
            tree: Mutex::new(tree),
            pool_config,
            store,
            sync_interval: Duration::from_secs(sync_interval_secs),
        })
    }

    /// Run the sync → backfill loop forever.
    pub async fn run(&self) {
        info!(interval_secs = self.sync_interval.as_secs(), "tree sync loop started");
        let mut interval = tokio::time::interval(self.sync_interval);

        loop {
            interval.tick().await;

            if let Err(e) = self.sync_once().await {
                warn!(error = %e, "tree sync tick failed");
            }

            if let Err(e) = self.backfill_pending().await {
                warn!(error = %e, "backfill tick failed");
            }
        }
    }

    /// Single sync: fetch on-chain events, append to local tree, verify root.
    ///
    /// Takes the tree out of the mutex, runs the blocking sync in spawn_blocking,
    /// then puts the (potentially updated) tree back.
    async fn sync_once(&self) -> Result<(), String> {
        let pool_cfg = self.pool_config.clone();

        // Take the tree out so we can move it into spawn_blocking
        let tree = {
            let mut guard = self.tree.lock().await;
            std::mem::replace(&mut *guard, TreeSync::new())
        };

        let (tree, result) = tokio::task::spawn_blocking(move || {
            let pool = PoolClient::new(pool_cfg);
            let mut tree = tree;
            let result = tree.sync(&pool);
            (tree, result)
        })
        .await
        .map_err(|e| format!("join error: {e}"))?;

        // Put the tree back regardless of sync result
        {
            let mut guard = self.tree.lock().await;
            *guard = tree;
        }

        let result = result.map_err(|e| format!("{e}"))?;

        if result.events_added > 0 {
            info!(
                total_leaves = result.total_leaves,
                events_added = result.events_added,
                root_verified = result.root_verified,
                cross_verified = result.cross_verified,
                "tree synced"
            );
        } else {
            debug!(
                total_leaves = result.total_leaves,
                "tree up-to-date"
            );
        }

        Ok(())
    }

    /// Backfill pending note records (merkle_root == [0;8]) with real proofs.
    async fn backfill_pending(&self) -> Result<(), String> {
        let pending = self
            .store
            .list_pending_notes()
            .await
            .map_err(|e| format!("list pending: {e}"))?;

        if pending.is_empty() {
            return Ok(());
        }

        debug!(count = pending.len(), "backfilling pending notes");

        let tree = self.tree.lock().await;
        let mut filled = 0u32;

        for note in &pending {
            // Try to match the note to an on-chain leaf.
            // The commitment_digest field is the on-chain Poseidon hash.
            // If not set, try to find by the FNV commitment key stored in note.commitment.
            let digest = match note.commitment_digest {
                Some(raw) => {
                    let d: Digest = [
                        M31::from_u32_unchecked(raw[0]),
                        M31::from_u32_unchecked(raw[1]),
                        M31::from_u32_unchecked(raw[2]),
                        M31::from_u32_unchecked(raw[3]),
                        M31::from_u32_unchecked(raw[4]),
                        M31::from_u32_unchecked(raw[5]),
                        M31::from_u32_unchecked(raw[6]),
                        M31::from_u32_unchecked(raw[7]),
                    ];
                    Some(d)
                }
                None => None,
            };

            let leaf_index = match digest {
                Some(d) => tree.find_commitment(&d),
                None => {
                    // Without a commitment_digest we can't match to on-chain data.
                    // This note needs the frontend or prover to supply the on-chain
                    // commitment before we can backfill.
                    debug!(commitment = %note.commitment, "skipping note without commitment_digest");
                    continue;
                }
            };

            let leaf_index = match leaf_index {
                Some(idx) => idx,
                None => {
                    // Not yet on-chain (or not synced far enough). Will retry next tick.
                    continue;
                }
            };

            let proof = match tree.prove(leaf_index) {
                Ok(p) => p,
                Err(e) => {
                    warn!(commitment = %note.commitment, error = %e, "prove failed");
                    continue;
                }
            };

            let root = tree.root();

            let siblings: Vec<[u32; 8]> = proof
                .siblings
                .iter()
                .map(|s| {
                    [
                        s[0].0, s[1].0, s[2].0, s[3].0, s[4].0, s[5].0, s[6].0, s[7].0,
                    ]
                })
                .collect();

            let root_u32: [u32; 8] = [
                root[0].0, root[1].0, root[2].0, root[3].0, root[4].0, root[5].0, root[6].0,
                root[7].0,
            ];

            let mut updated = note.clone();
            updated.merkle_path = MerklePathRecord {
                siblings,
                index: proof.index,
            };
            updated.merkle_root = root_u32;

            if let Err(e) = self.store.save_note(&note.commitment, &updated).await {
                warn!(commitment = %note.commitment, error = %e, "failed to update note");
            } else {
                filled += 1;
            }
        }

        if filled > 0 {
            info!(filled, "backfilled note merkle paths");
        }

        Ok(())
    }

    /// On-demand proof lookup. Returns proof if the commitment is in the synced tree.
    ///
    /// `commitment_hex` — 0x-prefixed hex of the 8 × u32 Poseidon digest.
    pub async fn get_proof(&self, commitment_hex: &str) -> Option<ProofResult> {
        let digest = parse_commitment_hex(commitment_hex)?;

        let tree = self.tree.lock().await;
        let leaf_index = tree.find_commitment(&digest)?;
        let proof = tree.prove(leaf_index).ok()?;
        let root = tree.root();

        Some(ProofResult {
            siblings: proof
                .siblings
                .iter()
                .map(|s| [s[0].0, s[1].0, s[2].0, s[3].0, s[4].0, s[5].0, s[6].0, s[7].0])
                .collect(),
            index: proof.index,
            root: [
                root[0].0, root[1].0, root[2].0, root[3].0, root[4].0, root[5].0, root[6].0,
                root[7].0,
            ],
        })
    }
}

/// Parse "0xABCDEF..." (64 hex chars after prefix) into [M31; 8].
fn parse_commitment_hex(hex: &str) -> Option<Digest> {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    if hex.len() != 64 {
        return None;
    }
    let mut digest = [M31::from_u32_unchecked(0); 8];
    for i in 0..8 {
        let chunk = &hex[i * 8..(i + 1) * 8];
        let val = u32::from_str_radix(chunk, 16).ok()?;
        digest[i] = M31::from_u32_unchecked(val);
    }
    Some(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_commitment_hex() {
        let hex = "0x0000002a000000630000000700000001000000020000000300000004000000ff";
        let digest = parse_commitment_hex(hex).unwrap();
        assert_eq!(digest[0].0, 0x2a);
        assert_eq!(digest[1].0, 0x63);
        assert_eq!(digest[2].0, 7);
        assert_eq!(digest[7].0, 0xff);
    }

    #[test]
    fn test_parse_commitment_hex_invalid() {
        assert!(parse_commitment_hex("0x1234").is_none());
        assert!(parse_commitment_hex("").is_none());
        assert!(parse_commitment_hex("0xGGGG").is_none());
    }
}
