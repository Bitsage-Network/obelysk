mod batch_queue;
mod bridge;
mod config;
mod error;
mod prover;
mod routes;
mod store;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::{header, HeaderValue};
use axum::Router;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

use stwo_ml::privacy::pool_client::{PoolClient, PoolClientConfig};
use stwo_ml::privacy::relayer::SncastVm31Backend;

use crate::batch_queue::BatchQueue;
use crate::bridge::BridgeService;
use crate::config::RelayerConfig;
use crate::prover::ProverService;
use crate::routes::AppState;
use crate::store::build_store;

#[tokio::main]
async fn main() {
    // Initialize tracing (env-filter: RUST_LOG=vm31_relayer=debug,info)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vm31_relayer=info,tower_http=info".into()),
        )
        .init();

    // Load and validate config
    let config = match RelayerConfig::from_env() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[vm31-relayer] configuration error: {e}");
            std::process::exit(1);
        }
    };

    // CORS: require explicit origins in release builds
    if config.allowed_origins.is_empty() {
        if cfg!(debug_assertions) {
            warn!("VM31_ALLOWED_ORIGINS not set — using permissive CORS (dev mode only)");
        } else {
            eprintln!(
                "[vm31-relayer] FATAL: VM31_ALLOWED_ORIGINS must be set in production builds"
            );
            std::process::exit(1);
        }
    }

    info!(
        host = %config.host,
        port = config.port,
        batch_max_size = config.batch_max_size,
        batch_timeout_secs = config.batch_timeout_secs,
        redis = config.redis_url.is_some(),
        origins = config.allowed_origins.len(),
        "starting vm31-relayer"
    );

    // Build store + start eviction task
    let store = build_store(&config);
    store.spawn_eviction_task();

    // Build batch queue
    let (queue, rx) = BatchQueue::new(config.batch_max_size, config.batch_timeout_secs, 32);
    queue.spawn_timeout_loop();

    // Build SncastVm31Backend
    let backend = SncastVm31Backend::new(
        &config.account,
        &config.rpc_url,
        &config.verifier_contract,
        &config.pool_contract,
    );

    // Build PoolClient for on-chain queries
    let pool_config = PoolClientConfig {
        rpc_url: config.rpc_url.clone(),
        pool_address: config.pool_contract.clone(),
        network: "sepolia".to_string(),
        verify_rpc_urls: vec![],
    };
    let pool_client = PoolClient::new(pool_config);

    // Build BridgeService
    let bridge = BridgeService::new(
        config.account.clone(),
        config.rpc_url.clone(),
        config.bridge_contract.clone(),
    );

    // Build ProverService and spawn batch processor
    let prover = ProverService::new(
        backend,
        pool_client,
        store.clone(),
        config.chunk_size,
        bridge,
    );
    tokio::spawn(async move {
        prover.run(rx).await;
    });

    // Build CORS layer
    let cors = if config.allowed_origins.is_empty() {
        CorsLayer::permissive()
    } else {
        let origins: Vec<_> = config
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
            .allow_headers([
                header::CONTENT_TYPE,
                header::AUTHORIZATION,
                "x-api-key".parse().unwrap(),
            ])
    };

    // Build router with state for ConnectInfo extraction
    let state = Arc::new(AppState {
        queue,
        store,
        config: config.clone(),
    });

    let app = Router::new()
        .route("/health", axum::routing::get(routes::health))
        .route("/status", axum::routing::get(routes::status))
        .route("/submit", axum::routing::post(routes::submit))
        .route("/batch/{id}", axum::routing::get(routes::get_batch))
        .route("/prove", axum::routing::post(routes::force_prove))
        .layer(RequestBodyLimitLayer::new(100 * 1024)) // 100KB
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Security headers (matching audit-relay pattern)
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            "Referrer-Policy".parse::<header::HeaderName>().unwrap(),
            HeaderValue::from_static("no-referrer"),
        ))
        .with_state(state.clone());

    // Bind and serve
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("invalid listen address");

    info!(addr = %addr, "vm31-relayer listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind");

    // Use into_make_service_with_connect_info for ConnectInfo extraction
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(state))
    .await
    .expect("server error");

    info!("vm31-relayer shut down");
}

async fn shutdown_signal(state: Arc<AppState>) {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to listen for ctrl+c");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to listen for SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("received SIGINT, shutting down"),
        _ = terminate => info!("received SIGTERM, shutting down"),
    }

    // Drain the batch queue before shutdown
    let pending = state.queue.pending_count().await;
    if pending > 0 {
        info!(pending, "draining batch queue before shutdown");
        if let Some(batch_id) = state.queue.force_flush().await {
            info!(batch_id = %batch_id, pending, "flushed pending transactions");
        }
    }
}
