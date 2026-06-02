use std::{
    env,
    error::Error,
    path::{Path, PathBuf},
};

use axum::http::{HeaderMap, HeaderValue, StatusCode, header};

use crate::util::resolve_path_to_path_buf;

#[derive(Clone, Debug)]
pub struct SecurityConfig {
    allowed_origins: Vec<String>,
    session_token: Option<String>,
    media_roots: Vec<PathBuf>,
}

impl SecurityConfig {
    pub fn from_env() -> Self {
        let allowed_origins = env::var("FRAMESCRIPT_ALLOWED_ORIGINS")
            .ok()
            .map(parse_comma_list)
            .filter(|items| !items.is_empty())
            .unwrap_or_else(default_allowed_origins);

        let session_token = env::var("FRAMESCRIPT_BACKEND_TOKEN")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let media_roots = env::var_os("FRAMESCRIPT_MEDIA_ROOTS")
            .map(|value| env::split_paths(&value).collect::<Vec<_>>())
            .filter(|items| !items.is_empty())
            .unwrap_or_else(default_media_roots)
            .into_iter()
            .filter_map(|path| canonicalize_existing_root(&path))
            .collect::<Vec<_>>();

        Self {
            allowed_origins,
            session_token,
            media_roots,
        }
    }

    pub fn is_origin_trusted(&self, origin: &str) -> bool {
        self.allowed_origins
            .iter()
            .any(|allowed| allowed == "*" || allowed == origin)
    }

    pub fn origin_is_allowed(&self, headers: &HeaderMap) -> bool {
        let Some(origin) = origin_header(headers) else {
            return true;
        };
        self.is_origin_trusted(origin)
    }

    pub fn has_valid_token(&self, headers: &HeaderMap) -> bool {
        let Some(expected) = self.session_token.as_deref() else {
            return false;
        };

        if let Some(value) = headers
            .get("x-framescript-token")
            .and_then(|value| value.to_str().ok())
            && constant_time_eq(value.trim().as_bytes(), expected.as_bytes())
        {
            return true;
        }

        let Some(auth) = headers.get(header::AUTHORIZATION) else {
            return false;
        };
        let Ok(auth) = auth.to_str() else {
            return false;
        };
        let Some(token) = auth.trim().strip_prefix("Bearer ") else {
            return false;
        };
        constant_time_eq(token.trim().as_bytes(), expected.as_bytes())
    }

    pub fn authorize_origin(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        if self.origin_is_allowed(headers) || self.has_valid_token(headers) {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        }
    }

    pub fn authorize_media(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        if self.origin_is_allowed(headers) || self.has_valid_token(headers) {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        }
    }

    pub fn authorize_capability(&self, headers: &HeaderMap) -> Result<(), StatusCode> {
        self.authorize_origin(headers)?;
        if self.session_token.is_some() && !self.has_valid_token(headers) {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(())
    }

    pub fn resolve_media_path(&self, input: &str) -> Result<String, Box<dyn Error>> {
        let path = resolve_path_to_path_buf(input)?;
        let canonical = dunce::canonicalize(&path)?;

        if self.media_roots.is_empty() || self.path_is_in_media_roots(&canonical) {
            Ok(canonical.to_string_lossy().into_owned())
        } else {
            Err("path is outside allowed media roots".into())
        }
    }

    fn path_is_in_media_roots(&self, path: &Path) -> bool {
        self.media_roots.iter().any(|root| path.starts_with(root))
    }

    pub fn apply_cors(&self, request_headers: &HeaderMap, response_headers: &mut HeaderMap) {
        if let Some(origin) = origin_header(request_headers)
            && self.is_origin_trusted(origin)
        {
            if let Ok(value) = HeaderValue::from_str(origin) {
                response_headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            }
            response_headers.insert(
                header::VARY,
                HeaderValue::from_static("origin, access-control-request-headers"),
            );
        }

        response_headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET, OPTIONS, POST"),
        );
        response_headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type, authorization, x-framescript-token"),
        );
    }
}

fn origin_header(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn parse_comma_list(value: String) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn default_allowed_origins() -> Vec<String> {
    vec![
        "http://localhost:5173".to_string(),
        "http://127.0.0.1:5173".to_string(),
        "http://localhost:5174".to_string(),
        "http://127.0.0.1:5174".to_string(),
        "file://".to_string(),
        "null".to_string(),
    ]
}

fn default_media_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(root) = env::var("FRAMESCRIPT_PROJECT_ROOT") {
        roots.push(PathBuf::from(root));
    }
    if let Ok(cwd) = env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(home) = env::var("HOME") {
        roots.push(PathBuf::from(home));
    }
    roots
}

fn canonicalize_existing_root(path: &Path) -> Option<PathBuf> {
    dunce::canonicalize(path).ok()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right.iter())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_untrusted_origin() {
        let config = SecurityConfig {
            allowed_origins: vec!["http://localhost:5173".to_string()],
            session_token: Some("secret".to_string()),
            media_roots: vec![PathBuf::from("/")],
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://bad.example"),
        );

        assert_eq!(
            config.authorize_origin(&headers),
            Err(StatusCode::FORBIDDEN),
        );
    }

    #[test]
    fn accepts_bearer_token_for_native_requests() {
        let config = SecurityConfig {
            allowed_origins: Vec::new(),
            session_token: Some("secret".to_string()),
            media_roots: vec![PathBuf::from("/")],
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer secret"),
        );

        assert!(config.authorize_capability(&headers).is_ok());
    }

    #[test]
    fn rejects_mutation_without_configured_token() {
        let config = SecurityConfig {
            allowed_origins: vec!["http://localhost:5173".to_string()],
            session_token: Some("secret".to_string()),
            media_roots: vec![PathBuf::from("/")],
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("http://localhost:5173"),
        );

        assert_eq!(
            config.authorize_capability(&headers),
            Err(StatusCode::UNAUTHORIZED),
        );
    }

    #[test]
    fn checks_path_roots() {
        let root = dunce::canonicalize(env::temp_dir()).unwrap();
        let config = SecurityConfig {
            allowed_origins: Vec::new(),
            session_token: None,
            media_roots: vec![root.clone()],
        };
        assert!(config.path_is_in_media_roots(&root.join("example.mp4")));
        assert!(!config.path_is_in_media_roots(Path::new("/definitely-not-the-temp-root")));
    }
}
