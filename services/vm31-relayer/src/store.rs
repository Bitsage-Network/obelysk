use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::debug;

use crate::config::RelayerConfig;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BatchStatus {
    Pending,
    Proving,
    Submitting,
    Finalized,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchRecord {
    pub id: String,
    pub status: BatchStatus,
    pub tx_count: usize,
    pub proof_hash: Option<String>,
    pub batch_id_onchain: Option<String>,
    pub tx_hash: Option<String>,
    pub created_at: u64,
    pub error: Option<String>,
}

impl BatchRecord {
    pub fn new(id: String, tx_count: usize) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Self {
            id,
            status: BatchStatus::Pending,
            tx_count,
            proof_hash: None,
            batch_id_onchain: None,
            tx_hash: None,
            created_at: now,
            error: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Trait definitions
// ---------------------------------------------------------------------------

pub trait BatchStore: Send + Sync + 'static {
    fn save_batch(
        &self,
        id: &str,
        batch: &BatchRecord,
    ) -> impl std::future::Future<Output = Result<(), StoreError>> + Send;

    fn get_batch(
        &self,
        id: &str,
    ) -> impl std::future::Future<Output = Result<Option<BatchRecord>, StoreError>> + Send;

    fn update_status(
        &self,
        id: &str,
        status: BatchStatus,
        extra: StatusUpdate,
    ) -> impl std::future::Future<Output = Result<(), StoreError>> + Send;
}

pub trait IdempotencyStore: Send + Sync + 'static {
    /// Returns `Some(cached_result)` if the key was already set, else sets it and returns `None`.
    fn check_and_set(
        &self,
        key: &str,
        result: &str,
    ) -> impl std::future::Future<Output = Result<Option<String>, StoreError>> + Send;
}

pub trait RateLimitStore: Send + Sync + 'static {
    /// Returns `true` if the request is allowed, `false` if rate-limited.
    fn check_rate(
        &self,
        key: &str,
        limit: u32,
        window_secs: u64,
    ) -> impl std::future::Future<Output = Result<bool, StoreError>> + Send;
}

/// Extra fields to set when updating batch status.
#[derive(Default)]
pub struct StatusUpdate {
    pub proof_hash: Option<String>,
    pub batch_id_onchain: Option<String>,
    pub tx_hash: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub enum StoreError {
    NotFound(String),
    Backend(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::NotFound(id) => write!(f, "batch not found: {id}"),
            StoreError::Backend(msg) => write!(f, "store backend error: {msg}"),
        }
    }
}

impl std::error::Error for StoreError {}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/// Maximum entries in idempotency store before forced eviction.
const MAX_IDEMPOTENCY_ENTRIES: usize = 50_000;
/// Idempotency entries expire after 1 hour.
const IDEMPOTENCY_TTL_SECS: u64 = 3600;
/// Rate limit entries expire after 1 hour (much longer than any window).
const RATE_LIMIT_EVICTION_SECS: u64 = 3600;

pub struct InMemoryStore {
    batches: DashMap<String, BatchRecord>,
    idempotency: DashMap<String, (String, u64)>, // (result, created_epoch)
    rate_limits: DashMap<String, (u32, u64)>,     // (count, window_start_epoch)
    eviction_counter: AtomicU64,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self {
            batches: DashMap::new(),
            idempotency: DashMap::new(),
            rate_limits: DashMap::new(),
            eviction_counter: AtomicU64::new(0),
        }
    }

    /// Spawns a background task that periodically evicts expired entries.
    pub fn spawn_eviction_task(self: &Arc<Self>) {
        let store = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(300));
            loop {
                interval.tick().await;
                store.evict_expired();
            }
        });
    }

    fn evict_expired(&self) {
        let now = now_epoch();

        // Evict expired idempotency entries
        let before = self.idempotency.len();
        self.idempotency.retain(|_, (_, created)| {
            now.saturating_sub(*created) < IDEMPOTENCY_TTL_SECS
        });
        let evicted_idem = before - self.idempotency.len();

        // Evict expired rate limit entries
        let before = self.rate_limits.len();
        self.rate_limits.retain(|_, (_, window_start)| {
            now.saturating_sub(*window_start) < RATE_LIMIT_EVICTION_SECS
        });
        let evicted_rl = before - self.rate_limits.len();

        // Evict old finalized/failed batches (>24h)
        let before = self.batches.len();
        self.batches.retain(|_, rec| {
            matches!(rec.status, BatchStatus::Pending | BatchStatus::Proving | BatchStatus::Submitting)
                || now.saturating_sub(rec.created_at) < 86400
        });
        let evicted_batches = before - self.batches.len();

        if evicted_idem + evicted_rl + evicted_batches > 0 {
            debug!(
                evicted_idem, evicted_rl, evicted_batches,
                "store eviction complete"
            );
        }
    }
}

impl BatchStore for InMemoryStore {
    async fn save_batch(&self, id: &str, batch: &BatchRecord) -> Result<(), StoreError> {
        self.batches.insert(id.to_string(), batch.clone());
        Ok(())
    }

    async fn get_batch(&self, id: &str) -> Result<Option<BatchRecord>, StoreError> {
        Ok(self.batches.get(id).map(|r| r.value().clone()))
    }

    async fn update_status(
        &self,
        id: &str,
        status: BatchStatus,
        extra: StatusUpdate,
    ) -> Result<(), StoreError> {
        let mut entry = self
            .batches
            .get_mut(id)
            .ok_or_else(|| StoreError::NotFound(id.into()))?;
        let rec = entry.value_mut();
        rec.status = status;
        if let Some(v) = extra.proof_hash {
            rec.proof_hash = Some(v);
        }
        if let Some(v) = extra.batch_id_onchain {
            rec.batch_id_onchain = Some(v);
        }
        if let Some(v) = extra.tx_hash {
            rec.tx_hash = Some(v);
        }
        if let Some(v) = extra.error {
            rec.error = Some(v);
        }
        Ok(())
    }
}

impl IdempotencyStore for InMemoryStore {
    async fn check_and_set(&self, key: &str, result: &str) -> Result<Option<String>, StoreError> {
        use dashmap::mapref::entry::Entry;
        let now = now_epoch();

        // Atomic check-and-set via DashMap's entry API to prevent TOCTOU races.
        // Two concurrent submissions with the same key will serialize on the
        // shard lock, so exactly one will insert and the other will see the
        // existing value.
        let outcome = match self.idempotency.entry(key.to_string()) {
            Entry::Occupied(mut occ) => {
                let (ref cached_result, created) = *occ.get();
                if now.saturating_sub(created) < IDEMPOTENCY_TTL_SECS {
                    // Non-expired duplicate
                    Some(cached_result.clone())
                } else {
                    // Expired — overwrite in place
                    occ.insert((result.to_string(), now));
                    None
                }
            }
            Entry::Vacant(vac) => {
                vac.insert((result.to_string(), now));
                None
            }
        };

        // Evict if over capacity (probabilistic to avoid hot path contention)
        let count = self.eviction_counter.fetch_add(1, Ordering::Relaxed);
        if count % 100 == 0 && self.idempotency.len() > MAX_IDEMPOTENCY_ENTRIES {
            self.idempotency.retain(|_, (_, created)| {
                now.saturating_sub(*created) < IDEMPOTENCY_TTL_SECS
            });
        }

        Ok(outcome)
    }
}

impl RateLimitStore for InMemoryStore {
    async fn check_rate(&self, key: &str, limit: u32, window_secs: u64) -> Result<bool, StoreError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut entry = self
            .rate_limits
            .entry(key.to_string())
            .or_insert((0, now));
        let (count, window_start) = entry.value_mut();

        // Reset window if expired
        if now - *window_start >= window_secs {
            *count = 0;
            *window_start = now;
        }

        if *count >= limit {
            return Ok(false);
        }
        *count += 1;
        Ok(true)
    }
}

// ---------------------------------------------------------------------------
// Redis implementation (feature-gated)
// ---------------------------------------------------------------------------

#[cfg(feature = "redis")]
pub struct RedisStore {
    client: redis::Client,
}

#[cfg(feature = "redis")]
impl RedisStore {
    pub fn new(url: &str) -> Result<Self, StoreError> {
        let client =
            redis::Client::open(url).map_err(|e| StoreError::Backend(e.to_string()))?;
        Ok(Self { client })
    }

    async fn conn(&self) -> Result<redis::aio::MultiplexedConnection, StoreError> {
        self.client
            .get_multiplexed_tokio_connection()
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))
    }
}

#[cfg(feature = "redis")]
impl BatchStore for RedisStore {
    async fn save_batch(&self, id: &str, batch: &BatchRecord) -> Result<(), StoreError> {
        let mut conn = self.conn().await?;
        let json =
            serde_json::to_string(batch).map_err(|e| StoreError::Backend(e.to_string()))?;
        redis::cmd("SET")
            .arg(format!("batch:{id}"))
            .arg(&json)
            .arg("EX")
            .arg(86400u64) // 24h TTL
            .exec_async(&mut conn)
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))
    }

    async fn get_batch(&self, id: &str) -> Result<Option<BatchRecord>, StoreError> {
        let mut conn = self.conn().await?;
        let val: Option<String> = redis::cmd("GET")
            .arg(format!("batch:{id}"))
            .query_async(&mut conn)
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        match val {
            Some(json) => {
                let rec: BatchRecord =
                    serde_json::from_str(&json).map_err(|e| StoreError::Backend(e.to_string()))?;
                Ok(Some(rec))
            }
            None => Ok(None),
        }
    }

    async fn update_status(
        &self,
        id: &str,
        status: BatchStatus,
        extra: StatusUpdate,
    ) -> Result<(), StoreError> {
        let mut rec = self
            .get_batch(id)
            .await?
            .ok_or_else(|| StoreError::NotFound(id.into()))?;
        rec.status = status;
        if let Some(v) = extra.proof_hash {
            rec.proof_hash = Some(v);
        }
        if let Some(v) = extra.batch_id_onchain {
            rec.batch_id_onchain = Some(v);
        }
        if let Some(v) = extra.tx_hash {
            rec.tx_hash = Some(v);
        }
        if let Some(v) = extra.error {
            rec.error = Some(v);
        }
        self.save_batch(id, &rec).await
    }
}

#[cfg(feature = "redis")]
impl IdempotencyStore for RedisStore {
    async fn check_and_set(&self, key: &str, result: &str) -> Result<Option<String>, StoreError> {
        let mut conn = self.conn().await?;
        let redis_key = format!("idem:{key}");
        // SET NX with 1h TTL — returns true only if the key was newly set
        let was_set: bool = redis::cmd("SET")
            .arg(&redis_key)
            .arg(result)
            .arg("NX")
            .arg("EX")
            .arg(3600u64)
            .query_async(&mut conn)
            .await
            .unwrap_or(false);
        if was_set {
            Ok(None)
        } else {
            let existing: Option<String> = redis::cmd("GET")
                .arg(&redis_key)
                .query_async(&mut conn)
                .await
                .map_err(|e| StoreError::Backend(e.to_string()))?;
            Ok(existing)
        }
    }
}

#[cfg(feature = "redis")]
impl RateLimitStore for RedisStore {
    async fn check_rate(&self, key: &str, limit: u32, window_secs: u64) -> Result<bool, StoreError> {
        let mut conn = self.conn().await?;
        let redis_key = format!("rl:{key}");
        let count: u32 = redis::cmd("INCR")
            .arg(&redis_key)
            .query_async(&mut conn)
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        // Always refresh EXPIRE to prevent orphaned keys from a failed first EXPIRE.
        // Using EXPIRE (not EXPIREAT) ensures the window extends from now.
        let _: () = redis::cmd("EXPIRE")
            .arg(&redis_key)
            .arg(window_secs)
            .exec_async(&mut conn)
            .await
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        Ok(count <= limit)
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Builds the appropriate store based on config.
/// Returns an `InMemoryStore` by default. If `redis` feature is enabled and
/// `config.redis_url` is set, attempts a `RedisStore`.
pub fn build_store(config: &RelayerConfig) -> Arc<InMemoryStore> {
    // For now, the concrete type is InMemoryStore. When redis feature is enabled,
    // the caller can construct RedisStore separately. We keep the factory simple
    // because trait objects with async fns require boxing; the concrete type
    // approach avoids that overhead.
    let _ = config;
    Arc::new(InMemoryStore::new())
}

#[cfg(feature = "redis")]
pub fn build_redis_store(url: &str) -> Result<Arc<RedisStore>, StoreError> {
    Ok(Arc::new(RedisStore::new(url)?))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_in_memory_batch_lifecycle() {
        let store = InMemoryStore::new();
        let rec = BatchRecord::new("batch-1".into(), 4);
        store.save_batch("batch-1", &rec).await.unwrap();

        let fetched = store.get_batch("batch-1").await.unwrap().unwrap();
        assert_eq!(fetched.status, BatchStatus::Pending);
        assert_eq!(fetched.tx_count, 4);

        store
            .update_status(
                "batch-1",
                BatchStatus::Proving,
                StatusUpdate::default(),
            )
            .await
            .unwrap();
        let fetched = store.get_batch("batch-1").await.unwrap().unwrap();
        assert_eq!(fetched.status, BatchStatus::Proving);
    }

    #[tokio::test]
    async fn test_in_memory_idempotency() {
        let store = InMemoryStore::new();
        let result = store.check_and_set("tx-abc", "batch-1").await.unwrap();
        assert!(result.is_none());

        let result = store.check_and_set("tx-abc", "batch-2").await.unwrap();
        assert_eq!(result.unwrap(), "batch-1");
    }

    #[tokio::test]
    async fn test_in_memory_rate_limit() {
        let store = InMemoryStore::new();
        for _ in 0..3 {
            assert!(store.check_rate("key-1", 3, 60).await.unwrap());
        }
        assert!(!store.check_rate("key-1", 3, 60).await.unwrap());
    }
}
