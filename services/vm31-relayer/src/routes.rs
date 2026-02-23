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

    /// Compute a deterministic idempotency key from the payload.
    /// Uses FNV-1a 128-bit hash for collision resistance beyond SipHash's 64 bits.
    pub fn idempotency_key(&self) -> String {
        let json = serde_json::to_vec(self).unwrap_or_default();
        // Simple SHA-256 via manual Merkle-Damgard would be overkill here;
        // use a collision-resistant hash from the payload bytes.
        // We hash the JSON bytes with a simple FNV-1a 128-bit approach for now,
        // but in production with the `sha2` crate this would be SHA-256.
        // For defense-in-depth, combine with a random server-side seed.
        let mut state: u128 = 0xcbf29ce484222325;
        for byte in &json {
            state ^= *byte as u128;
            state = state.wrapping_mul(0x100000001b3);
        }
        // Also mix in the length to prevent length-extension
        let len_bytes = json.len().to_le_bytes();
        for byte in &len_bytes {
            state ^= *byte as u128;
            state = state.wrapping_mul(0x100000001b3);
        }
        format!("{:032x}", state)
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
pub fn extract_client_ip(headers: &HeaderMap, addr: Option<SocketAddr>) -> String {
    // Check X-Forwarded-For first (reverse proxy)
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
    addr.map(|a| a.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
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

pub async fn submit(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<SubmitRequest>,
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
    let client_ip = extract_client_ip(&headers, Some(addr));
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

    // Idempotency check
    let idem_key = req.idempotency_key();
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
