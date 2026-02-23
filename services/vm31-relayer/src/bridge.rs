use std::time::Duration;
use tokio::process::Command;
use tracing::{debug, error, info, warn};

/// Maximum retries for bridge calls (idempotent, safe to retry).
const MAX_BRIDGE_RETRIES: u32 = 3;
/// Base backoff between retries.
const RETRY_BACKOFF_MS: u64 = 2000;

/// Handles withdrawal -> ConfidentialTransfer bridging via sncast invoke.
///
/// The bridge contract's `bridge_withdrawal_to_confidential` is relayer-only
/// and idempotent (checks bridge_key not already processed).
///
/// SECURITY: sncast args come from internal state (UUID batch_id, u32 idx).
/// Never pass user-controlled strings to Command args.
pub struct BridgeService {
    account: String,
    rpc_url: String,
    bridge_contract: String,
}

impl BridgeService {
    pub fn new(account: String, rpc_url: String, bridge_contract: String) -> Self {
        Self {
            account,
            rpc_url,
            bridge_contract,
        }
    }

    /// Calls `bridge_withdrawal_to_confidential` on-chain with retries.
    ///
    /// This is idempotent: the contract rejects duplicate bridge_keys,
    /// so retrying after a timeout is safe.
    pub async fn bridge_withdrawal(
        &self,
        batch_id: &str,
        withdrawal_idx: u32,
    ) -> Result<String, BridgeError> {
        // Validate batch_id is a UUID (internal invariant — defense in depth)
        if !batch_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err(BridgeError::Validation("invalid batch_id format".into()));
        }

        for attempt in 0..MAX_BRIDGE_RETRIES {
            match self.try_bridge(batch_id, withdrawal_idx).await {
                Ok(result) => return Ok(result),
                Err(BridgeError::AlreadyBridged) => return Ok("already_bridged".into()),
                Err(e) if attempt < MAX_BRIDGE_RETRIES - 1 => {
                    let backoff = RETRY_BACKOFF_MS * 2u64.pow(attempt);
                    warn!(
                        batch_id = %batch_id,
                        withdrawal_idx = withdrawal_idx,
                        attempt = attempt + 1,
                        backoff_ms = backoff,
                        error = %e,
                        "bridge call failed, retrying"
                    );
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                }
                Err(e) => {
                    error!(
                        batch_id = %batch_id,
                        withdrawal_idx = withdrawal_idx,
                        attempts = MAX_BRIDGE_RETRIES,
                        "bridge call failed after all retries"
                    );
                    return Err(e);
                }
            }
        }
        unreachable!()
    }

    async fn try_bridge(
        &self,
        batch_id: &str,
        withdrawal_idx: u32,
    ) -> Result<String, BridgeError> {
        info!(
            batch_id = %batch_id,
            withdrawal_idx = withdrawal_idx,
            "invoking bridge_withdrawal_to_confidential"
        );

        let output = Command::new("sncast")
            .args([
                "invoke",
                "--contract-address",
                &self.bridge_contract,
                "--function",
                "bridge_withdrawal_to_confidential",
                "--calldata",
                &format!("{batch_id} {withdrawal_idx}"),
                "--account",
                &self.account,
                "--url",
                &self.rpc_url,
            ])
            .output()
            .await
            .map_err(|e| BridgeError::Execution(format!("sncast spawn failed: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        if !output.status.success() {
            // Check idempotent rejection (already bridged)
            if stderr.contains("already bridged") || stderr.contains("bridge_key exists") {
                debug!(
                    batch_id = %batch_id,
                    withdrawal_idx = withdrawal_idx,
                    "withdrawal already bridged (idempotent)"
                );
                return Err(BridgeError::AlreadyBridged);
            }

            // SECURITY: Log full stderr server-side but return sanitized error.
            // Never expose RPC errors, nonce details, or contract state to callers.
            error!(
                batch_id = %batch_id,
                withdrawal_idx = withdrawal_idx,
                exit_code = ?output.status.code(),
                "bridge sncast failed (details in server logs)"
            );
            // Categorize without leaking details
            let category = if stderr.contains("nonce") {
                "nonce conflict"
            } else if stderr.contains("insufficient") || stderr.contains("balance") {
                "insufficient gas"
            } else if stderr.contains("timeout") || stderr.contains("connection") {
                "rpc timeout"
            } else {
                "invocation failed"
            };
            return Err(BridgeError::OnChain(category.into()));
        }

        // Extract tx hash from sncast output
        let tx_hash = stdout
            .lines()
            .find(|line| line.contains("transaction_hash"))
            .map(|line| {
                line.split(':')
                    .last()
                    .unwrap_or("")
                    .trim()
                    .trim_matches('"')
                    .to_string()
            })
            .unwrap_or_else(|| "unknown".into());

        info!(
            batch_id = %batch_id,
            withdrawal_idx = withdrawal_idx,
            tx_hash = %tx_hash,
            "bridge call submitted"
        );

        Ok(tx_hash)
    }
}

#[derive(Debug)]
pub enum BridgeError {
    Validation(String),
    Execution(String),
    OnChain(String),
    AlreadyBridged,
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BridgeError::Validation(msg) => write!(f, "validation: {msg}"),
            BridgeError::Execution(msg) => write!(f, "execution: {msg}"),
            BridgeError::OnChain(msg) => write!(f, "on-chain: {msg}"),
            BridgeError::AlreadyBridged => write!(f, "already bridged"),
        }
    }
}

impl std::error::Error for BridgeError {}
