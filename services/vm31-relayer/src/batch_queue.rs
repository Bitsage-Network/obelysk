use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info};
use uuid::Uuid;

use stwo_ml::privacy::tx_builder::PendingTx;

/// A queued transaction with its assigned batch ID and enqueue time.
struct QueuedTx {
    tx: PendingTx,
    enqueued_at: Instant,
}

/// A flushed batch ready for proving.
pub struct ReadyBatch {
    pub batch_id: String,
    pub transactions: Vec<PendingTx>,
}

/// Accumulates `PendingTx` items and flushes when either the size threshold
/// or timeout is reached.
pub struct BatchQueue {
    pending: Arc<Mutex<Vec<QueuedTx>>>,
    max_size: usize,
    timeout: Duration,
    trigger_tx: mpsc::Sender<ReadyBatch>,
}

impl BatchQueue {
    /// Creates a new `BatchQueue` and its receive channel.
    ///
    /// The caller should pass the `Receiver` to `ProverService::run()`.
    pub fn new(
        max_size: usize,
        timeout_secs: u64,
        channel_buffer: usize,
    ) -> (Self, mpsc::Receiver<ReadyBatch>) {
        let (trigger_tx, trigger_rx) = mpsc::channel(channel_buffer);
        let queue = Self {
            pending: Arc::new(Mutex::new(Vec::with_capacity(max_size))),
            max_size,
            timeout: Duration::from_secs(timeout_secs),
            trigger_tx,
        };
        (queue, trigger_rx)
    }

    /// Adds a transaction to the queue.
    ///
    /// If the queue reaches `max_size`, it is immediately flushed and the
    /// batch ID is returned. Otherwise, the tx is held until timeout.
    /// Returns `(batch_id_if_flushed, queue_len)`.
    pub async fn push(&self, tx: PendingTx) -> (Option<String>, usize) {
        let mut pending = self.pending.lock().await;
        pending.push(QueuedTx {
            tx,
            enqueued_at: Instant::now(),
        });
        let len = pending.len();

        if len >= self.max_size {
            let batch_id = Uuid::new_v4().to_string();
            let txs: Vec<PendingTx> = pending.drain(..).map(|q| q.tx).collect();
            info!(batch_id = %batch_id, tx_count = txs.len(), "batch queue size-triggered flush");
            let _ = self
                .trigger_tx
                .send(ReadyBatch {
                    batch_id: batch_id.clone(),
                    transactions: txs,
                })
                .await;
            return (Some(batch_id), 0);
        }
        (None, len)
    }

    /// Returns the current number of pending transactions.
    pub async fn pending_count(&self) -> usize {
        self.pending.lock().await.len()
    }

    /// Forcibly flushes the queue regardless of size.
    /// Returns `None` if the queue is empty.
    pub async fn force_flush(&self) -> Option<String> {
        let mut pending = self.pending.lock().await;
        if pending.is_empty() {
            return None;
        }
        let batch_id = Uuid::new_v4().to_string();
        let txs: Vec<PendingTx> = pending.drain(..).map(|q| q.tx).collect();
        info!(batch_id = %batch_id, tx_count = txs.len(), "batch queue force-flushed");
        let _ = self
            .trigger_tx
            .send(ReadyBatch {
                batch_id: batch_id.clone(),
                transactions: txs,
            })
            .await;
        Some(batch_id)
    }

    /// Spawns a background task that periodically checks for timeout-based flushes.
    ///
    /// This should be called once at startup. The task runs until the sender
    /// is dropped or the runtime shuts down.
    pub fn spawn_timeout_loop(&self) {
        let pending = Arc::clone(&self.pending);
        let timeout = self.timeout;
        let trigger_tx = self.trigger_tx.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;

                // Hold the lock for the entire check-and-drain to prevent
                // a TOCTOU race where another task drains between our check
                // and our drain.
                let batch = {
                    let mut guard = pending.lock().await;
                    let should_flush = guard
                        .first()
                        .map(|oldest| oldest.enqueued_at.elapsed() >= timeout)
                        .unwrap_or(false);
                    if should_flush && !guard.is_empty() {
                        let batch_id = Uuid::new_v4().to_string();
                        let txs: Vec<PendingTx> = guard.drain(..).map(|q| q.tx).collect();
                        debug!(batch_id = %batch_id, tx_count = txs.len(), "batch queue timeout-triggered flush");
                        Some(ReadyBatch {
                            batch_id,
                            transactions: txs,
                        })
                    } else {
                        None
                    }
                };

                if let Some(ready) = batch {
                    if trigger_tx.send(ready).await.is_err() {
                        // Receiver dropped, exit loop
                        break;
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_dummy_deposit() -> PendingTx {
        use stwo_ml::prelude::M31;
        let zero4 = [M31::from_u32_unchecked(0); 4];
        PendingTx::Deposit {
            amount: 1000,
            asset_id: 1,
            recipient_pubkey: zero4,
            recipient_viewing_key: zero4,
        }
    }

    #[tokio::test]
    async fn test_size_triggered_flush() {
        let (queue, mut rx) = BatchQueue::new(2, 3600, 8);
        queue.push(make_dummy_deposit()).await;
        assert_eq!(queue.pending_count().await, 1);

        // Second push should trigger flush
        let (batch_id, len) = queue.push(make_dummy_deposit()).await;
        assert!(batch_id.is_some());
        assert_eq!(len, 0);

        let ready = rx.try_recv().unwrap();
        assert_eq!(ready.transactions.len(), 2);
    }

    #[tokio::test]
    async fn test_force_flush() {
        let (queue, mut rx) = BatchQueue::new(16, 3600, 8);
        queue.push(make_dummy_deposit()).await;
        let batch_id = queue.force_flush().await;
        assert!(batch_id.is_some());

        let ready = rx.try_recv().unwrap();
        assert_eq!(ready.transactions.len(), 1);

        // Empty queue returns None
        assert!(queue.force_flush().await.is_none());
    }
}
