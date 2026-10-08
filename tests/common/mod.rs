//! Signed access tokens for the integration tests.
//!
//! The backend verifies every `x-access-token` against a JWKS (see
//! `services::token_verifier`), so a test that wants to act as a role needs a
//! token that verification accepts. `TestKeys::serve` publishes the public half
//! of a throwaway RSA key (`test_jwks.json`) on an ephemeral port, and
//! `TestKeys::sign` signs claims with the private half (`test_signing_key.pem`).
//! The key exists only for these tests and signs nothing else.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{routing::get, Json, Router};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::Value;

use shift::services::token_verifier::TokenVerifier;

const KEY_ID: &str = "shift-test";
const SIGNING_KEY: &[u8] = include_bytes!("test_signing_key.pem");
const JWKS: &str = include_str!("test_jwks.json");

pub struct TestKeys {
    pub jwks_url: String,
    key: EncodingKey,
}

impl TestKeys {
    /// Serves the JWKS on an ephemeral port for the rest of the test.
    pub async fn serve() -> Self {
        let jwks: Value = serde_json::from_str(JWKS).expect("test JWKS");
        let app = Router::new().route("/jwks", get(move || async move { Json(jwks) }));
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
            .await
            .expect("bind JWKS");
        let addr = listener.local_addr().expect("JWKS addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self {
            jwks_url: format!("http://{addr}/jwks"),
            key: EncodingKey::from_rsa_pem(SIGNING_KEY).expect("test signing key"),
        }
    }

    /// A verifier that trusts exactly this key.
    pub fn verifier(&self) -> Arc<TokenVerifier> {
        Arc::new(TokenVerifier::new(self.jwks_url.clone()))
    }

    /// `claims` signed, with an `exp` an hour ahead added if missing.
    pub fn sign(&self, mut claims: Value) -> String {
        if claims.get("exp").is_none() {
            claims["exp"] = Value::from(chrono::Utc::now().timestamp() + 3600);
        }
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(KEY_ID.to_string());
        encode(&header, &claims, &self.key).expect("sign test token")
    }
}
