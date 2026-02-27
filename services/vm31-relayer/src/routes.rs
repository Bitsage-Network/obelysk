use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;

use stwo_ml::prelude::M31;
use stwo_ml::crypto::commitment::Note;
use stwo_ml::crypto::merkle_m31::MerklePath;
use stwo_ml::privacy::tx_builder::PendingTx;

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};

use crate::batch_queue::BatchQueue;
use crate::config::RelayerConfig;
use crate::error::AppError;
use crate::store::{BatchStore, IdempotencyStore, InMemoryStore, MerklePathRecord, NoteStore, RateLimitStore};
use crate::tree_sync_service::TreeSyncService;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// M31 field modulus: 2^31 - 1
const M31_MODULUS: u32 = 0x7FFF_FFFF;

/// Maximum Merkle tree depth (32 levels → 2^32 leaves)
const MAX_MERKLE_DEPTH: usize = 32;

/// Maximum amount: (2^31 - 1) + (2^31 - 1) * 2^31  (matches stwo-ml MAX_NOTE_AMOUNT)
const MAX_NOTE_AMOUNT: u64 = ((1u64 << 31) - 1) + ((1u64 << 31) - 1) * (1u64 << 31);

/// Maximum pending transactions before rejecting new submissions
pub const MAX_PENDING_TXS: usize = 1024;

/// Standard denomination whitelist per asset (in base units).
/// All deposits MUST use one of these standard denominations to prevent
/// exact-amount correlation attacks (privacy gap #7).
///
/// Asset ID mapping (from VM31Pool.register_asset()):
///   0 = wBTC (8 decimals), 1 = SAGE (18 decimals), 2 = ETH (18 decimals),
///   3 = STRK (18 decimals), 4 = USDC (6 decimals)

/// BTC denominations (8 decimals, base unit = satoshi)
pub const BTC_DENOMINATIONS: [u64; 6] = [
    50_000,      // 0.0005 BTC
    100_000,     // 0.001 BTC
    500_000,     // 0.005 BTC
    1_000_000,   // 0.01 BTC
    5_000_000,   // 0.05 BTC
    10_000_000,  // 0.1 BTC
];

/// ETH denominations (18 decimals, base unit = wei)
const ETH_DENOMINATIONS: [u64; 6] = [
    1_000_000_000_000_000,      // 0.001 ETH
    5_000_000_000_000_000,      // 0.005 ETH
    10_000_000_000_000_000,     // 0.01 ETH
    50_000_000_000_000_000,     // 0.05 ETH
    100_000_000_000_000_000,    // 0.1 ETH
    500_000_000_000_000_000,    // 0.5 ETH
];

/// STRK denominations (18 decimals)
const STRK_DENOMINATIONS: [u64; 6] = [
    1_000_000_000_000_000_000,    // 1 STRK
    5_000_000_000_000_000_000,    // 5 STRK
    10_000_000_000_000_000_000,   // 10 STRK (overflow: u64 can't hold this)
    50_000_000_000_000_000,       // 0.05 STRK
    100_000_000_000_000_000,      // 0.1 STRK
    500_000_000_000_000_000,      // 0.5 STRK
];

/// USDC denominations (6 decimals, base unit = micro-USDC)
const USDC_DENOMINATIONS: [u64; 6] = [
    1_000_000,     // 1 USDC
    5_000_000,     // 5 USDC
    10_000_000,    // 10 USDC
    50_000_000,    // 50 USDC
    100_000_000,   // 100 USDC
    500_000_000,   // 500 USDC
];

/// SAGE denominations (18 decimals)
const SAGE_DENOMINATIONS: [u64; 6] = [
    100_000_000_000_000_000,     // 0.1 SAGE
    500_000_000_000_000_000,     // 0.5 SAGE
    1_000_000_000_000_000_000,   // 1 SAGE
    5_000_000_000_000_000_000,   // 5 SAGE
    10_000_000_000_000_000,      // 0.01 SAGE
    50_000_000_000_000_000,      // 0.05 SAGE
];

/// Backward-compatible alias
pub const BTC_DENOMINATIONS_SATS: [u64; 6] = BTC_DENOMINATIONS;

// ---------------------------------------------------------------------------
// App state (shared via Axum's State extractor)
// ---------------------------------------------------------------------------

pub struct AppState {
    pub queue: BatchQueue,
    pub store: Arc<InMemoryStore>,
    pub config: RelayerConfig,
    pub tree_sync: Option<Arc<TreeSyncService>>,
}

// ---------------------------------------------------------------------------
// JSON request/response types
// ---------------------------------------------------------------------------

/// JSON representation of a PendingTx for the HTTP API.
/// Since PendingTx doesn't derive serde, we define our own wire format.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SubmitRequest {
    Deposit {
        amount: u64,
        asset_id: u32,
        recipient_pubkey: [u32; 4],
        recipient_viewing_key: [u32; 4],
    },
    Withdraw {
        amount: u64,
        asset_id: u32,
        note: NoteJson,
        spending_key: [u32; 4],
        merkle_path: MerklePathJson,
        merkle_root: [u32; 8],
        withdrawal_binding: [u32; 8],
        /// Random salt preventing rainbow-table attacks on withdrawal bindings (privacy gap #5).
        /// H(payout, credit, asset, amount, idx, salt) is not precomputable.
        #[serde(default)]
        binding_salt: Option<[u32; 8]>,
    },
    Transfer {
        amount: u64,
        asset_id: u32,
        recipient_pubkey: [u32; 4],
        recipient_viewing_key: [u32; 4],
        sender_viewing_key: [u32; 4],
        input_notes: [InputNoteJson; 2],
        merkle_root: [u32; 8],
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteJson {
    pub owner_pubkey: [u32; 4],
    pub asset_id: u32,
    pub amount_lo: u32,
    pub amount_hi: u32,
    pub blinding: [u32; 4],
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MerklePathJson {
    pub siblings: Vec<[u32; 8]>,
    pub index: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InputNoteJson {
    pub note: NoteJson,
    pub spending_key: [u32; 4],
    pub merkle_path: MerklePathJson,
}

/// ECIES-encrypted submission envelope (privacy gap #1).
/// The client generates an ephemeral x25519 keypair, performs ECDH with the
/// relayer's static public key, derives AES-256-GCM key via HKDF-SHA256,
/// and encrypts the JSON SubmitRequest. The relayer decrypts in the prover's
/// spawn_blocking scope; plaintext never persists in memory outside that task.
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedSubmitRequest {
    /// Ephemeral x25519 public key (32 bytes, hex-encoded)
    pub ephemeral_pubkey: String,
    /// AES-256-GCM ciphertext (base64-encoded)
    pub ciphertext: String,
    /// AES-256-GCM nonce (12 bytes, hex-encoded)
    pub nonce: String,
    /// Protocol version for forward compatibility
    pub version: u8,
}

/// Unified submission body: either plaintext or encrypted
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SubmitBody {
    Encrypted(EncryptedSubmitRequest),
    Plaintext(SubmitRequest),
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/// Validates a u32 is within the M31 field (0..2^31-1).
fn validate_m31(val: u32, field_name: &str) -> Result<M31, AppError> {
    if val > M31_MODULUS {
        return Err(AppError::BadRequest(format!(
            "{field_name}: value {val} exceeds M31 field modulus"
        )));
    }
    Ok(M31::from_u32_unchecked(val))
}

fn validate_m31_4(arr: [u32; 4], field_name: &str) -> Result<[M31; 4], AppError> {
    Ok([
        validate_m31(arr[0], field_name)?,
        validate_m31(arr[1], field_name)?,
        validate_m31(arr[2], field_name)?,
        validate_m31(arr[3], field_name)?,
    ])
}

fn validate_m31_8(arr: [u32; 8], field_name: &str) -> Result<[M31; 8], AppError> {
    Ok([
        validate_m31(arr[0], field_name)?,
        validate_m31(arr[1], field_name)?,
        validate_m31(arr[2], field_name)?,
        validate_m31(arr[3], field_name)?,
        validate_m31(arr[4], field_name)?,
        validate_m31(arr[5], field_name)?,
        validate_m31(arr[6], field_name)?,
        validate_m31(arr[7], field_name)?,
    ])
}

fn validate_amount(amount: u64) -> Result<(), AppError> {
    if amount == 0 {
        return Err(AppError::BadRequest("amount must be > 0".into()));
    }
    if amount > MAX_NOTE_AMOUNT {
        return Err(AppError::BadRequest("amount exceeds maximum".into()));
    }
    Ok(())
}

/// Returns the denomination whitelist for a given asset ID, if any.
fn denominations_for_asset(asset_id: u32) -> Option<&'static [u64]> {
    match asset_id {
        0 => Some(&BTC_DENOMINATIONS),
        1 => Some(&SAGE_DENOMINATIONS),
        2 => Some(&ETH_DENOMINATIONS),
        3 => Some(&STRK_DENOMINATIONS),
        4 => Some(&USDC_DENOMINATIONS),
        _ => None, // Unknown asset — no denomination restriction
    }
}

/// Validates that deposits use a standard denomination for the asset.
/// Unknown assets pass through without restriction (forward-compatible).
fn validate_denomination(amount: u64, asset_id: u32) -> Result<(), AppError> {
    if let Some(denoms) = denominations_for_asset(asset_id) {
        if !denoms.contains(&amount) {
            return Err(AppError::BadRequest(format!(
                "Deposits must use standard denominations for asset {asset_id}. Got {amount}"
            )));
        }
    }
    Ok(())
}

/// Backward-compatible alias for BTC-only validation.
fn validate_btc_denomination(amount: u64, asset_id: u32) -> Result<(), AppError> {
    validate_denomination(amount, asset_id)
}

fn validate_merkle_path(p: &MerklePathJson) -> Result<MerklePath, AppError> {
    if p.siblings.len() > MAX_MERKLE_DEPTH {
        return Err(AppError::BadRequest(format!(
            "merkle path depth {} exceeds maximum {}",
            p.siblings.len(),
            MAX_MERKLE_DEPTH
        )));
    }
    let mut siblings = Vec::with_capacity(p.siblings.len());
    for (i, s) in p.siblings.iter().enumerate() {
        siblings.push(validate_m31_8(*s, &format!("merkle_sibling[{i}]"))?);
    }
    Ok(MerklePath {
        siblings,
        index: p.index,
    })
}

fn validate_note(n: &NoteJson) -> Result<Note, AppError> {
    Ok(Note {
        owner_pubkey: validate_m31_4(n.owner_pubkey, "note.owner_pubkey")?,
        asset_id: validate_m31(n.asset_id, "note.asset_id")?,
        amount_lo: validate_m31(n.amount_lo, "note.amount_lo")?,
        amount_hi: validate_m31(n.amount_hi, "note.amount_hi")?,
        blinding: validate_m31_4(n.blinding, "note.blinding")?,
    })
}

// ---------------------------------------------------------------------------
// Conversion with validation
// ---------------------------------------------------------------------------

impl SubmitRequest {
    pub fn validate_and_convert(&self) -> Result<PendingTx, AppError> {
        match self {
            SubmitRequest::Deposit {
                amount,
                asset_id,
                recipient_pubkey,
                recipient_viewing_key,
            } => {
                validate_amount(*amount)?;
                validate_btc_denomination(*amount, *asset_id)?;
                Ok(PendingTx::Deposit {
                    amount: *amount,
                    asset_id: *asset_id,
                    recipient_pubkey: validate_m31_4(*recipient_pubkey, "recipient_pubkey")?,
                    recipient_viewing_key: validate_m31_4(*recipient_viewing_key, "recipient_viewing_key")?,
                })
            }
            SubmitRequest::Withdraw {
                amount,
                asset_id,
                note,
                spending_key,
                merkle_path,
                merkle_root,
                withdrawal_binding,
                ..
            } => {
                validate_amount(*amount)?;
                Ok(PendingTx::Withdraw {
                    amount: *amount,
                    asset_id: *asset_id,
                    note: validate_note(note)?,
                    spending_key: validate_m31_4(*spending_key, "spending_key")?,
                    merkle_path: validate_merkle_path(merkle_path)?,
                    merkle_root: validate_m31_8(*merkle_root, "merkle_root")?,
                    withdrawal_binding: validate_m31_8(*withdrawal_binding, "withdrawal_binding")?,
                })
            }
            SubmitRequest::Transfer {
                amount,
                asset_id,
                recipient_pubkey,
                recipient_viewing_key,
                sender_viewing_key,
                input_notes,
                merkle_root,
            } => {
                validate_amount(*amount)?;
                let in0 = &input_notes[0];
                let in1 = &input_notes[1];
                Ok(PendingTx::Transfer {
                    amount: *amount,
                    asset_id: *asset_id,
                    recipient_pubkey: validate_m31_4(*recipient_pubkey, "recipient_pubkey")?,
                    recipient_viewing_key: validate_m31_4(*recipient_viewing_key, "recipient_viewing_key")?,
                    sender_viewing_key: validate_m31_4(*sender_viewing_key, "sender_viewing_key")?,
                    input_notes: [
                        (
                            validate_note(&in0.note)?,
                            validate_m31_4(in0.spending_key, "input[0].spending_key")?,
                            validate_merkle_path(&in0.merkle_path)?,
                        ),
                        (
                            validate_note(&in1.note)?,
                            validate_m31_4(in1.spending_key, "input[1].spending_key")?,
                            validate_merkle_path(&in1.merkle_path)?,
                        ),
                    ],
                    merkle_root: validate_m31_8(*merkle_root, "merkle_root")?,
                })
            }
        }
    }

    /// Compute a deterministic idempotency key from the payload via SHA-256.
    /// Collision-resistant — prevents accidental deduplication of distinct requests.
    pub fn idempotency_key(&self) -> String {
        match serde_json::to_vec(self) {
            Ok(json) => format!("{:x}", Sha256::digest(&json)),
            // If serialization fails, generate a unique key so we don't accidentally
            // deduplicate unrelated requests.
            Err(_) => {
                use std::time::SystemTime;
                let ts = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                format!("err:{ts:032x}")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ECIES decryption
// ---------------------------------------------------------------------------

impl EncryptedSubmitRequest {
    /// Compute deterministic idempotency key for encrypted payloads.
    /// Uses SHA-256(ephemeral_pubkey || nonce || ciphertext_prefix) so we can
    /// deduplicate without decrypting.
    pub fn idempotency_key(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.ephemeral_pubkey.as_bytes());
        hasher.update(self.nonce.as_bytes());
        // Only hash first 64 bytes of ciphertext to bound computation
        let ct_prefix = if self.ciphertext.len() > 64 {
            &self.ciphertext[..64]
        } else {
            &self.ciphertext
        };
        hasher.update(ct_prefix.as_bytes());
        format!("enc:{:x}", hasher.finalize())
    }

    /// Decrypt the ECIES envelope using the relayer's static X25519 private key.
    /// Returns the deserialized SubmitRequest.
    pub fn decrypt(&self, relayer_secret: &StaticSecret) -> Result<SubmitRequest, AppError> {
        if self.version != 1 {
            return Err(AppError::BadRequest(format!(
                "unsupported ECIES version: {}",
                self.version
            )));
        }

        // Parse ephemeral public key
        let epk_bytes = hex::decode(&self.ephemeral_pubkey).map_err(|_| {
            AppError::BadRequest("invalid ephemeral_pubkey hex".into())
        })?;
        if epk_bytes.len() != 32 {
            return Err(AppError::BadRequest("ephemeral_pubkey must be 32 bytes".into()));
        }
        let mut epk_arr = [0u8; 32];
        epk_arr.copy_from_slice(&epk_bytes);
        let ephemeral_pk = X25519PublicKey::from(epk_arr);

        // ECDH shared secret
        let shared_secret = relayer_secret.diffie_hellman(&ephemeral_pk);

        // HKDF-SHA256 to derive AES-256-GCM key
        let hk = Hkdf::<Sha256>::new(None, shared_secret.as_bytes());
        let mut aes_key = [0u8; 32];
        hk.expand(b"obelysk-ecies-v1", &mut aes_key)
            .map_err(|_| AppError::Internal("HKDF expand failed".into()))?;

        // Parse nonce
        let nonce_bytes = hex::decode(&self.nonce).map_err(|_| {
            AppError::BadRequest("invalid nonce hex".into())
        })?;
        if nonce_bytes.len() != 12 {
            return Err(AppError::BadRequest("nonce must be 12 bytes".into()));
        }
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Decode ciphertext from base64
        use base64::Engine;
        let ciphertext = base64::engine::general_purpose::STANDARD
            .decode(&self.ciphertext)
            .map_err(|_| AppError::BadRequest("invalid ciphertext base64".into()))?;

        // AES-256-GCM decrypt
        let cipher = Aes256Gcm::new_from_slice(&aes_key)
            .map_err(|_| AppError::Internal("AES key init failed".into()))?;
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
            AppError::BadRequest("ECIES decryption failed (bad key or tampered ciphertext)".into())
        })?;

        // Deserialize the JSON SubmitRequest
        serde_json::from_slice(&plaintext).map_err(|e| {
            AppError::BadRequest(format!("invalid decrypted payload: {e}"))
        })
    }
}

// ---------------------------------------------------------------------------
// Middleware: API key extraction
// ---------------------------------------------------------------------------

pub fn extract_api_key(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(String::from)
        })
}

pub fn require_auth(headers: &HeaderMap, config: &RelayerConfig) -> Result<String, AppError> {
    let key = extract_api_key(headers).ok_or(AppError::Unauthorized)?;
    if !config.is_api_key_valid(&key) {
        return Err(AppError::Unauthorized);
    }
    Ok(key)
}

/// Extract client IP from headers (X-Forwarded-For) or connection info.
///
/// SECURITY: X-Forwarded-For is only trusted when the direct connection comes from
/// a configured trusted proxy IP. Without this validation, any client can spoof
/// X-Forwarded-For to bypass per-IP rate limiting.
pub fn extract_client_ip(
    headers: &HeaderMap,
    addr: Option<SocketAddr>,
    trusted_proxies: &[String],
) -> String {
    let direct_ip = addr.map(|a| a.ip().to_string());

    // Only trust X-Forwarded-For if the request came from a known reverse proxy
    if !trusted_proxies.is_empty() {
        if let Some(ref proxy_ip) = direct_ip {
            if trusted_proxies.iter().any(|tp| tp == proxy_ip) {
                if let Some(xff) = headers.get("x-forwarded-for") {
                    if let Ok(s) = xff.to_str() {
                        if let Some(first_ip) = s.split(',').next() {
                            let ip = first_ip.trim();
                            if !ip.is_empty() {
                                return ip.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
    // No trusted proxies configured or request not from a trusted proxy:
    // always use the direct socket IP (safe default).
    direct_ip.unwrap_or_else(|| "unknown".into())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

pub async fn health() -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "service": "vm31-relayer",
    }))
}

pub async fn status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let pending = state.queue.pending_count().await;
    Json(json!({
        "pending_transactions": pending,
        "batch_max_size": state.config.batch_max_size,
        "batch_timeout_secs": state.config.batch_timeout_secs,
    }))
}

/// Serves the relayer's static X25519 public key for ECIES encryption.
pub async fn public_key(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AppError> {
    let secret_bytes = state.config.relayer_private_key.ok_or_else(|| {
        AppError::Internal("ECIES not configured (VM31_RELAYER_PRIVKEY not set)".into())
    })?;
    let secret = StaticSecret::from(secret_bytes);
    let public = X25519PublicKey::from(&secret);
    Ok(Json(json!({
        "public_key": hex::encode(public.as_bytes()),
        "version": 1,
        "algorithm": "x25519-aes256gcm-hkdf-sha256",
    })))
}

pub async fn submit(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SubmitBody>,
) -> Result<impl IntoResponse, AppError> {
    let api_key = require_auth(&headers, &state.config)?;

    // Per-key rate limit
    let allowed = state
        .store
        .check_rate(
            &format!("key:{api_key}"),
            state.config.rate_limit_per_min,
            60,
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !allowed {
        return Err(AppError::RateLimited);
    }

    // Per-IP rate limit (3x key limit as secondary control)
    let client_ip = extract_client_ip(&headers, Some(addr), &state.config.trusted_proxies);
    let ip_allowed = state
        .store
        .check_rate(
            &format!("ip:{client_ip}"),
            state.config.rate_limit_per_min * 3,
            60,
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !ip_allowed {
        return Err(AppError::RateLimited);
    }

    // Queue capacity check
    let pending = state.queue.pending_count().await;
    if pending >= MAX_PENDING_TXS {
        return Err(AppError::BatchFull);
    }

    // Resolve encrypted or plaintext submission.
    // PRIVACY: Both paths must take similar wall-clock time to prevent
    // timing side channels that reveal whether ECIES encryption was used.
    let submission_start = std::time::Instant::now();
    let (req, idem_key) = match body {
        SubmitBody::Encrypted(enc) => {
            let idem_key = enc.idempotency_key();
            let secret_bytes = state.config.relayer_private_key.ok_or_else(|| {
                AppError::Internal("ECIES not configured".into())
            })?;
            let secret = StaticSecret::from(secret_bytes);
            let req = enc.decrypt(&secret)?;
            (req, idem_key)
        }
        SubmitBody::Plaintext(req) => {
            // Reject plaintext in mainnet mode
            if !state.config.legacy_plaintext_allowed {
                return Err(AppError::BadRequest(
                    "plaintext submissions disabled — use ECIES encryption".into(),
                ));
            }
            let idem_key = req.idempotency_key();
            (req, idem_key)
        }
    };
    // Normalize response timing: ensure minimum processing time regardless of path.
    // ECIES decrypt takes ~1-3ms; this prevents plaintext path from responding
    // measurably faster and revealing the submission mode to network observers.
    let elapsed = submission_start.elapsed();
    let min_processing = std::time::Duration::from_millis(5);
    if elapsed < min_processing {
        tokio::time::sleep(min_processing - elapsed).await;
    }

    // Idempotency check
    if let Some(cached) = state
        .store
        .check_and_set(&idem_key, "pending")
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
    {
        return Ok((
            StatusCode::OK,
            Json(json!({
                "status": "duplicate",
                "cached_result": cached,
                "idempotency_key": idem_key,
            })),
        ));
    }

    // Validate and convert JSON → PendingTx (M31 bounds, merkle depth, amounts)
    let pending_tx = req.validate_and_convert()?;

    // Push to batch queue
    let (batch_id, queue_pos) = state.queue.push(pending_tx).await;

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "status": if batch_id.is_some() { "batch_triggered" } else { "queued" },
            "batch_id": batch_id,
            "queue_position": queue_pos,
            "idempotency_key": idem_key,
        })),
    ))
}

pub async fn get_batch(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_auth(&headers, &state.config)?;

    // Validate batch ID format (UUID)
    if id.len() > 64 || id.chars().any(|c| !c.is_ascii_alphanumeric() && c != '-') {
        return Err(AppError::BadRequest("invalid batch id format".into()));
    }

    let record = state
        .store
        .get_batch(&id)
        .await
        .map_err(|_| AppError::Internal("store error".into()))?
        .ok_or(AppError::BadRequest("batch not found".into()))?;

    Ok(Json(json!({
        "id": record.id,
        "status": record.status,
        "tx_count": record.tx_count,
        "proof_hash": record.proof_hash,
        "batch_id_onchain": record.batch_id_onchain,
        "tx_hash": record.tx_hash,
        "created_at": record.created_at,
        "error": record.error,
    })))
}

pub async fn force_prove(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let api_key = require_auth(&headers, &state.config)?;

    // Stricter rate limit for admin endpoint (1/5 of normal)
    let allowed = state
        .store
        .check_rate(
            &format!("prove:{api_key}"),
            (state.config.rate_limit_per_min / 5).max(1),
            60,
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !allowed {
        return Err(AppError::RateLimited);
    }

    match state.queue.force_flush().await {
        Some(batch_id) => Ok(Json(json!({
            "status": "flushed",
            "batch_id": batch_id,
        }))),
        None => Ok(Json(json!({
            "status": "empty",
            "message": "no pending transactions to prove",
        }))),
    }
}

pub async fn get_merkle_path(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(commitment): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    require_auth(&headers, &state.config)?;

    // Validate commitment format (hex string, reasonable length)
    if commitment.is_empty() || commitment.len() > 128 || commitment.chars().any(|c| !c.is_ascii_hexdigit() && c != '-' && c != '_') {
        return Err(AppError::BadRequest("invalid commitment format".into()));
    }

    // Try the store first
    let record = state
        .store
        .get_note(&commitment)
        .await
        .map_err(|_| AppError::Internal("store error".into()))?;

    if let Some(note) = record {
        // If the note has a real merkle root, return it directly
        if note.merkle_root != [0; 8] {
            return Ok((
                StatusCode::OK,
                Json(json!({
                    "commitment": note.commitment,
                    "merkle_path": {
                        "siblings": note.merkle_path.siblings,
                        "index": note.merkle_path.index,
                    },
                    "merkle_root": note.merkle_root,
                    "batch_id": note.batch_id,
                    "created_at": note.created_at,
                })),
            ));
        }

        // Note exists but merkle root is empty — try on-demand proof via TreeSyncService
        if let Some(ref ts) = state.tree_sync {
            if let Some(proof) = ts.get_proof(&commitment).await {
                // Update the store record with the real proof
                let mut updated = note.clone();
                updated.merkle_path = MerklePathRecord {
                    siblings: proof.siblings.clone(),
                    index: proof.index,
                };
                updated.merkle_root = proof.root;
                let _ = state.store.save_note(&commitment, &updated).await;

                return Ok((
                    StatusCode::OK,
                    Json(json!({
                        "commitment": updated.commitment,
                        "merkle_path": {
                            "siblings": proof.siblings,
                            "index": proof.index,
                        },
                        "merkle_root": proof.root,
                        "batch_id": updated.batch_id,
                        "created_at": updated.created_at,
                    })),
                ));
            }
        }

        // Note exists but proof not available yet — return pending status
        return Ok((
            StatusCode::OK,
            Json(json!({
                "commitment": note.commitment,
                "merkle_path": null,
                "merkle_root": null,
                "batch_id": note.batch_id,
                "created_at": note.created_at,
                "status": "pending_sync",
            })),
        ));
    }

    // No store record — try on-demand from TreeSyncService directly
    if let Some(ref ts) = state.tree_sync {
        if let Some(proof) = ts.get_proof(&commitment).await {
            return Ok((
                StatusCode::OK,
                Json(json!({
                    "commitment": commitment,
                    "merkle_path": {
                        "siblings": proof.siblings,
                        "index": proof.index,
                    },
                    "merkle_root": proof.root,
                    "batch_id": null,
                    "created_at": null,
                })),
            ));
        }
    }

    Err(AppError::NotFound("note not indexed yet".into()))
}
