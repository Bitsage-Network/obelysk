use std::env;

#[derive(Debug, Clone)]
pub struct RelayerConfig {
    // Server
    pub host: String,
    pub port: u16,

    // Starknet
    pub rpc_url: String,
    pub account: String,
    pub verifier_contract: String,
    pub pool_contract: String,
    pub bridge_contract: String,
    pub ct_contract: String,

    // Batch
    pub batch_max_size: usize,
    pub batch_timeout_secs: u64,
    pub chunk_size: u32,
    /// Minimum transactions required for timeout-triggered flush (default: 3).
    /// Prevents single-tx batches that offer zero privacy mixing.
    pub min_batch_size: usize,
    /// Maximum seconds any transaction can wait in queue (default: 300).
    /// Hard ceiling to prevent indefinite queueing when min_batch_size is not met.
    pub max_batch_wait_secs: u64,

    // Auth
    pub api_keys: Vec<String>,

    // ECIES encryption for relayer submissions
    /// X25519 private key for decrypting ECIES envelopes (32 bytes, hex-encoded).
    /// Generated via `openssl rand -hex 32` and set as VM31_RELAYER_PRIVKEY.
    pub relayer_private_key: Option<[u8; 32]>,
    /// When false, reject plaintext submissions (mainnet mode).
    /// When true, accept both encrypted and plaintext (migration mode).
    pub legacy_plaintext_allowed: bool,

    // Encrypted note storage
    /// AES-256 key for encrypting NoteRecord values at rest (32 bytes, hex-encoded).
    pub storage_key: Option<[u8; 32]>,

    // Redis (optional)
    pub redis_url: Option<String>,

    // Rate limiting
    pub rate_limit_per_min: u32,

    // CORS
    pub allowed_origins: Vec<String>,

    // Tree sync
    pub tree_cache_path: Option<String>,
    pub tree_sync_interval_secs: u64,
}

impl RelayerConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let rpc_url = require_env("STARKNET_RPC_URL")?;
        validate_rpc_url(&rpc_url)?;

        let account = require_env("STARKNET_ACCOUNT")?;
        let verifier_contract = require_env("VM31_VERIFIER_CONTRACT")?;
        validate_hex(&verifier_contract, "VM31_VERIFIER_CONTRACT")?;
        let pool_contract = require_env("VM31_POOL_CONTRACT")?;
        validate_hex(&pool_contract, "VM31_POOL_CONTRACT")?;
        let bridge_contract = require_env("VM31_BRIDGE_CONTRACT")?;
        validate_hex(&bridge_contract, "VM31_BRIDGE_CONTRACT")?;
        let ct_contract = require_env("VM31_CT_CONTRACT")?;
        validate_hex(&ct_contract, "VM31_CT_CONTRACT")?;

        let api_keys_raw = require_env("VM31_API_KEYS")?;
        let api_keys: Vec<String> = api_keys_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if api_keys.is_empty() {
            return Err(ConfigError::Missing("VM31_API_KEYS (no valid keys found)".into()));
        }

        let redis_url = env::var("REDIS_URL").ok().filter(|s| !s.is_empty());

        let allowed_origins = env::var("VM31_ALLOWED_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();

        let batch_max_size: usize = parse_env_or("VM31_BATCH_MAX_SIZE", 16)?;
        if batch_max_size == 0 {
            return Err(ConfigError::Invalid("VM31_BATCH_MAX_SIZE".into(), "must be > 0".into()));
        }
        let batch_timeout_secs: u64 = parse_env_or("VM31_BATCH_TIMEOUT_SECS", 60)?;
        if batch_timeout_secs == 0 {
            return Err(ConfigError::Invalid("VM31_BATCH_TIMEOUT_SECS".into(), "must be > 0".into()));
        }
        let chunk_size: u32 = parse_env_or("VM31_CHUNK_SIZE", 32)?;
        if chunk_size == 0 {
            return Err(ConfigError::Invalid("VM31_CHUNK_SIZE".into(), "must be > 0".into()));
        }
        let rate_limit_per_min: u32 = parse_env_or("VM31_RATE_LIMIT", 30)?;
        if rate_limit_per_min == 0 {
            return Err(ConfigError::Invalid("VM31_RATE_LIMIT".into(), "must be > 0".into()));
        }

        let min_batch_size: usize = parse_env_or("VM31_MIN_BATCH_SIZE", 3)?;
        if min_batch_size == 0 {
            return Err(ConfigError::Invalid("VM31_MIN_BATCH_SIZE".into(), "must be > 0".into()));
        }
        let max_batch_wait_secs: u64 = parse_env_or("VM31_MAX_BATCH_WAIT_SECS", 300)?;
        if max_batch_wait_secs == 0 {
            return Err(ConfigError::Invalid("VM31_MAX_BATCH_WAIT_SECS".into(), "must be > 0".into()));
        }

        // ECIES relayer private key (optional, enables encrypted submissions)
        let relayer_private_key = parse_hex_key_32("VM31_RELAYER_PRIVKEY")?;
        let legacy_plaintext_allowed: bool = env::var("VM31_ALLOW_PLAINTEXT")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(true); // Default true during migration

        // Storage encryption key (optional, enables at-rest encryption)
        let storage_key = parse_hex_key_32("VM31_STORAGE_KEY")?;

        let tree_cache_path = env::var("VM31_TREE_CACHE_PATH").ok().filter(|s| !s.is_empty());
        let tree_sync_interval_secs: u64 = parse_env_or("VM31_TREE_SYNC_INTERVAL", 15)?;
        if tree_sync_interval_secs == 0 {
            return Err(ConfigError::Invalid("VM31_TREE_SYNC_INTERVAL".into(), "must be > 0".into()));
        }

        Ok(Self {
            host: env::var("VM31_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("VM31_PORT")
                .unwrap_or_else(|_| "3080".into())
                .parse()
                .map_err(|_| ConfigError::Invalid("VM31_PORT".into(), "must be a valid port number".into()))?,
            rpc_url,
            account,
            verifier_contract,
            pool_contract,
            bridge_contract,
            ct_contract,
            batch_max_size,
            batch_timeout_secs,
            chunk_size,
            min_batch_size,
            max_batch_wait_secs,
            api_keys,
            relayer_private_key,
            legacy_plaintext_allowed,
            storage_key,
            redis_url,
            rate_limit_per_min,
            allowed_origins,
            tree_cache_path,
            tree_sync_interval_secs,
        })
    }

    /// Constant-time API key validation to prevent timing side-channel attacks.
    pub fn is_api_key_valid(&self, key: &str) -> bool {
        use subtle::ConstantTimeEq;
        let key_bytes = key.as_bytes();
        for valid_key in &self.api_keys {
            let valid_bytes = valid_key.as_bytes();
            // Length check first (leaks length but not content — acceptable for API keys)
            if key_bytes.len() == valid_bytes.len()
                && key_bytes.ct_eq(valid_bytes).into()
            {
                return true;
            }
        }
        false
    }
}

fn require_env(name: &str) -> Result<String, ConfigError> {
    env::var(name)
        .map_err(|_| ConfigError::Missing(name.into()))
        .and_then(|v| {
            if v.is_empty() {
                Err(ConfigError::Missing(name.into()))
            } else {
                Ok(v)
            }
        })
}

fn parse_env_or<T: std::str::FromStr>(name: &str, default: T) -> Result<T, ConfigError> {
    match env::var(name) {
        Ok(v) if !v.is_empty() => v
            .parse()
            .map_err(|_| ConfigError::Invalid(name.into(), format!("could not parse '{v}'"))),
        _ => Ok(default),
    }
}

fn parse_hex_key_32(env_name: &str) -> Result<Option<[u8; 32]>, ConfigError> {
    match env::var(env_name) {
        Ok(v) if !v.is_empty() => {
            let hex = v.strip_prefix("0x").unwrap_or(&v);
            if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(ConfigError::Invalid(
                    env_name.into(),
                    "must be exactly 64 hex characters (32 bytes)".into(),
                ));
            }
            let mut key = [0u8; 32];
            for i in 0..32 {
                key[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                    .map_err(|_| ConfigError::Invalid(env_name.into(), "invalid hex".into()))?;
            }
            Ok(Some(key))
        }
        _ => Ok(None),
    }
}

fn validate_rpc_url(url: &str) -> Result<(), ConfigError> {
    let lower = url.to_lowercase();
    if lower.starts_with("https://") {
        return Ok(());
    }
    // Allow http:// only for localhost/dev
    if lower.starts_with("http://") {
        let host_part = lower.trim_start_matches("http://");
        if host_part.starts_with("localhost")
            || host_part.starts_with("127.0.0.1")
            || host_part.starts_with("[::1]")
        {
            return Ok(());
        }
        return Err(ConfigError::Invalid(
            "STARKNET_RPC_URL".into(),
            "must use HTTPS for non-localhost URLs".into(),
        ));
    }
    Err(ConfigError::Invalid(
        "STARKNET_RPC_URL".into(),
        "must start with https:// (or http:// for localhost)".into(),
    ))
}

fn validate_hex(value: &str, name: &str) -> Result<(), ConfigError> {
    let s = value.strip_prefix("0x").unwrap_or(value);
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ConfigError::Invalid(
            name.into(),
            "must be a valid hex string (0x-prefixed)".into(),
        ));
    }
    Ok(())
}

#[derive(Debug)]
pub enum ConfigError {
    Missing(String),
    Invalid(String, String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Missing(name) => write!(f, "missing required env var: {name}"),
            ConfigError::Invalid(name, reason) => {
                write!(f, "invalid env var {name}: {reason}")
            }
        }
    }
}

impl std::error::Error for ConfigError {}
