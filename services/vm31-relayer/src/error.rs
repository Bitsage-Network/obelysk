use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use tracing::error;

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized,
    RateLimited,
    BatchFull,
    ProverError(String),
    RelayerError(String),
    BridgeError(String),
    Internal(String),
}

impl AppError {
    fn status_code(&self) -> StatusCode {
        match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::BatchFull => StatusCode::SERVICE_UNAVAILABLE,
            AppError::ProverError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::RelayerError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::BridgeError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_code(&self) -> &'static str {
        match self {
            AppError::BadRequest(_) => "BAD_REQUEST",
            AppError::Unauthorized => "UNAUTHORIZED",
            AppError::RateLimited => "RATE_LIMITED",
            AppError::BatchFull => "BATCH_FULL",
            AppError::ProverError(_) => "PROVER_ERROR",
            AppError::RelayerError(_) => "RELAYER_ERROR",
            AppError::BridgeError(_) => "BRIDGE_ERROR",
            AppError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    /// Returns the sanitized message shown to clients.
    /// Internal details are logged server-side only.
    fn public_message(&self) -> &'static str {
        match self {
            AppError::BadRequest(_) => "invalid request",
            AppError::Unauthorized => "unauthorized",
            AppError::RateLimited => "rate limited",
            AppError::BatchFull => "service at capacity, try again later",
            AppError::ProverError(_) => "processing failed",
            AppError::RelayerError(_) => "submission failed",
            AppError::BridgeError(_) => "bridge operation failed",
            AppError::Internal(_) => "internal error",
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::BadRequest(msg) => write!(f, "bad request: {msg}"),
            AppError::Unauthorized => write!(f, "unauthorized"),
            AppError::RateLimited => write!(f, "rate limited"),
            AppError::BatchFull => write!(f, "batch queue is full"),
            AppError::ProverError(msg) => write!(f, "prover error: {msg}"),
            AppError::RelayerError(msg) => write!(f, "relayer error: {msg}"),
            AppError::BridgeError(msg) => write!(f, "bridge error: {msg}"),
            AppError::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Log the full error server-side for debugging.
        // SECURITY: Never expose internal details to clients.
        match &self {
            AppError::ProverError(_)
            | AppError::RelayerError(_)
            | AppError::BridgeError(_)
            | AppError::Internal(_) => {
                error!(error = %self, "request failed");
            }
            _ => {}
        }

        let status = self.status_code();
        let body = json!({
            "error": self.public_message(),
            "code": self.error_code(),
        });
        (status, axum::Json(body)).into_response()
    }
}
