use axum::{http::StatusCode, response::IntoResponse, Json};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Duplicate key")]
    Duplicate,

    #[error("Not found")]
    NotFound,

    /// 409 with why the request does not fit the current state — e.g. a shift
    /// swap that is no longer awaiting that decision, or whose roster changed.
    #[error("{0}")]
    Conflict(String),

    /// 401 with the part of the token that was missing or unusable.
    #[error("{0}")]
    Unauthorized(String),

    /// 403 with a reason the client can show — e.g. why a shift wish was refused.
    #[error("{0}")]
    Forbidden(String),

    /// 503 with what is not configured or not reachable — e.g. the Keycloak
    /// admin API the user-management endpoints depend on.
    #[error("{0}")]
    Unavailable(String),

    /// 428 — the change touches a frozen or locked part of a published roster
    /// and needs a reason (`X-Change-Reason`). The body carries
    /// `code: reason_required` so a client can ask for one and retry.
    #[error("{0}")]
    ReasonRequired(String),

    #[error("Database error")]
    DbError,

    #[error("Internal error")]
    Internal,
}

impl From<diesel::result::Error> for AppError {
    fn from(e: diesel::result::Error) -> Self {
        match e {
            diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => AppError::Duplicate,
            diesel::result::Error::NotFound => AppError::NotFound,
            _ => AppError::DbError,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        if let AppError::ReasonRequired(msg) = self {
            return (
                StatusCode::PRECONDITION_REQUIRED,
                Json(json!({ "error": msg, "code": "reason_required" })),
            )
                .into_response();
        }
        let (status, message) = match self {
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, msg),
            AppError::Duplicate => (StatusCode::CONFLICT, self.to_string()),
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
            AppError::Unavailable(msg) => (StatusCode::SERVICE_UNAVAILABLE, msg),
            AppError::ReasonRequired(msg) => (StatusCode::PRECONDITION_REQUIRED, msg),
            AppError::DbError => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            AppError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}