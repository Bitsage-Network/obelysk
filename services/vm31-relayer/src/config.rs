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

    // Auth
    pub api_keys: Vec<String>,

    // Redis (optional)
    pub redis_url: Option<String>,

    // Rate limiting
    pub rate_limit_per_min: u32,

    // CORS
    pub allowed_origins: Vec<String>,
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
            api_keys,
            redis_url,
            rate_limit_per_min,
            allowed_origins,
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
