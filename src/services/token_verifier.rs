use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use tokio::sync::RwLock;

/// How long a fetched key set is trusted before it is fetched again.
const JWKS_TTL: Duration = Duration::from_secs(600);
/// Minimum gap between refetches caused by an unknown `kid`, so a stream of
/// forged tokens cannot turn into a stream of requests to Keycloak.
const JWKS_MIN_REFETCH: Duration = Duration::from_secs(30);

/// Asymmetric algorithms only: accepting HS* would let the public key act as a
/// shared secret, and `none` is never accepted.
const ALLOWED_ALGORITHMS: [Algorithm; 7] = [
    Algorithm::RS256,
    Algorithm::RS384,
    Algorithm::RS512,
    Algorithm::PS256,
    Algorithm::PS384,
    Algorithm::PS512,
    Algorithm::ES256,
];

#[derive(Debug)]
pub enum TokenError {
    /// The token is malformed, expired, not yet valid, issued in the future or wrongly signed.
    Invalid(String),
    /// The signing keys could not be fetched; nothing can be verified.
    KeysUnavailable(String),
}

struct CachedKeys {
    keys: JwkSet,
    fetched_at: Instant,
}

/// Verifies access tokens (signature, `exp`, `nbf`, `iat`) against the identity
/// provider's JWKS. The issuer is deliberately not checked.
pub struct TokenVerifier {
    jwks_url: String,
    http: reqwest::Client,
    cache: RwLock<Option<CachedKeys>>,
}

impl TokenVerifier {
    pub fn new(jwks_url: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        Self { jwks_url, http, cache: RwLock::new(None) }
    }

    /// The verified claims of `token` (an optional `Bearer ` prefix is accepted).
    pub async fn verify(&self, token: &str) -> Result<serde_json::Value, TokenError> {
        let token = token.strip_prefix("Bearer ").unwrap_or(token);
        let header = decode_header(token).map_err(|e| TokenError::Invalid(format!("bad header: {e}")))?;
        if !ALLOWED_ALGORITHMS.contains(&header.alg) {
            return Err(TokenError::Invalid(format!("algorithm {:?} is not accepted", header.alg)));
        }
        let kid = header.kid.ok_or_else(|| TokenError::Invalid("no key id (kid) in the token header".into()))?;

        let key = self.key_for(&kid).await?;

        let mut validation = Validation::new(header.alg);
        validation.leeway = 30;
        validation.validate_nbf = true;
        // Keycloak access tokens carry client-specific audiences ("account").
        validation.validate_aud = false;
        validation.set_required_spec_claims(&["exp"]);

        let claims = decode::<serde_json::Value>(token, &key, &validation)
            .map(|data| data.claims)
            .map_err(|e| TokenError::Invalid(e.to_string()))?;

        if let Some(iat) = claims.get("iat").and_then(|v| v.as_i64()) {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
            if iat > now + validation.leeway as i64 {
                return Err(TokenError::Invalid("issued in the future (iat)".into()));
            }
        }
        Ok(claims)
    }

    async fn key_for(&self, kid: &str) -> Result<DecodingKey, TokenError> {
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.as_ref() {
                if let Some(jwk) = cached.keys.find(kid) {
                    if cached.fetched_at.elapsed() < JWKS_TTL {
                        return DecodingKey::from_jwk(jwk).map_err(|e| TokenError::Invalid(e.to_string()));
                    }
                } else if cached.fetched_at.elapsed() < JWKS_MIN_REFETCH {
                    return Err(TokenError::Invalid("unknown signing key".into()));
                }
            }
        }

        let keys = self.fetch_keys().await?;
        let result = match keys.find(kid) {
            Some(jwk) => DecodingKey::from_jwk(jwk).map_err(|e| TokenError::Invalid(e.to_string())),
            None => Err(TokenError::Invalid("unknown signing key".into())),
        };
        *self.cache.write().await = Some(CachedKeys { keys, fetched_at: Instant::now() });
        result
    }

    async fn fetch_keys(&self) -> Result<JwkSet, TokenError> {
        let response = self
            .http
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| TokenError::KeysUnavailable(format!("JWKS unreachable: {e}")))?;
        if !response.status().is_success() {
            return Err(TokenError::KeysUnavailable(format!("JWKS endpoint answered {}", response.status())));
        }
        response
            .json::<JwkSet>()
            .await
            .map_err(|e| TokenError::KeysUnavailable(format!("JWKS is not valid: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};

    fn unsigned(alg: &str) -> String {
        let enc = |v: &str| general_purpose::URL_SAFE_NO_PAD.encode(v.as_bytes());
        format!("{}.{}.sig", enc(&format!(r#"{{"alg":"{alg}","typ":"JWT","kid":"k"}}"#)), enc(r#"{"tenant":["a"]}"#))
    }

    #[tokio::test]
    async fn refuses_symmetric_and_unsigned_algorithms_without_fetching_keys() {
        let verifier = TokenVerifier::new("http://127.0.0.1:1/jwks".into());
        for alg in ["HS256", "none"] {
            let err = verifier.verify(&unsigned(alg)).await.unwrap_err();
            assert!(matches!(err, TokenError::Invalid(_)), "{alg}: {err:?}");
        }
    }

    #[tokio::test]
    async fn a_forged_rs256_token_fails_when_keys_are_unreachable() {
        let verifier = TokenVerifier::new("http://127.0.0.1:1/jwks".into());
        let err = verifier.verify(&unsigned("RS256")).await.unwrap_err();
        assert!(matches!(err, TokenError::KeysUnavailable(_)));
    }
}
