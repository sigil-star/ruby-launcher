//! Authenticated Roblox HTTP proxy (cookie jar + CSRF retry).

use crate::state::AppState;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::Arc;

static CSRF_TOKEN: once_cell::sync::Lazy<Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

fn cookie_header(state: &AppState) -> Option<String> {
    state
        .cookie
        .read()
        .as_ref()
        .map(|c| format!(".ROBLOSECURITY={c}"))
}

fn remember_csrf(res: &reqwest::Response) {
    if let Some(tok) = res
        .headers()
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
    {
        if !tok.is_empty() {
            *CSRF_TOKEN.lock() = Some(tok);
        }
    }
}

pub async fn fetch_roblox_api(
    state: &Arc<AppState>,
    url: &str,
    options: Option<Value>,
) -> Result<Value, String> {
    fetch_roblox_api_inner(state, url, options, true).await
}

async fn fetch_roblox_api_inner(
    state: &Arc<AppState>,
    url: &str,
    options: Option<Value>,
    allow_csrf_retry: bool,
) -> Result<Value, String> {
    // The session cookie is attached to every request, so only ever talk to Roblox.
    let host = url::Url::parse(url)
        .map_err(|e| e.to_string())?
        .host_str()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !(host == "roblox.com" || host.ends_with(".roblox.com") || host.ends_with(".rbxcdn.com")) {
        return Err(format!("blocked non-Roblox host: {host}"));
    }
    let method = options
        .as_ref()
        .and_then(|o| o.get("method"))
        .and_then(|m| m.as_str())
        .unwrap_or("GET")
        .to_uppercase();
    let body = options.as_ref().and_then(|o| o.get("body").cloned());
    let headers = options
        .as_ref()
        .and_then(|o| o.get("headers"))
        .cloned()
        .unwrap_or(json!({}));

    let mut req = match method.as_str() {
        "POST" => state.http.post(url),
        "PUT" => state.http.put(url),
        "PATCH" => state.http.patch(url),
        "DELETE" => state.http.delete(url),
        _ => state.http.get(url),
    };

    if let Some(c) = cookie_header(state) {
        req = req.header("Cookie", c);
    }
    // Callers may replace these defaults (a header given in options wins).
    let custom = |name: &str| headers.as_object().is_some_and(|o| o.keys().any(|k| k.eq_ignore_ascii_case(name)));
    if !custom("User-Agent") {
        req = req.header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    }
    if !custom("Accept") {
        req = req.header("Accept", "application/json, text/plain, */*");
    }
    if !custom("Referer") {
        req = req.header("Referer", "https://www.roblox.com/");
    }
    // Writes are checked against the page they came from, like roblox.com's own requests.
    if method != "GET" && !custom("Origin") {
        req = req.header("Origin", "https://www.roblox.com");
    }

    if let Some(tok) = CSRF_TOKEN.lock().clone() {
        req = req.header("X-CSRF-TOKEN", tok);
    }
    if let Some(obj) = headers.as_object() {
        for (k, v) in obj {
            // Never let a caller-supplied header touch the session cookie.
            if k.eq_ignore_ascii_case("cookie") {
                continue;
            }
            if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
                req = req.header(k.as_str(), s);
            }
        }
    }
    if let Some(b) = body.clone().filter(|b| !b.is_null()) {
        if b.is_string() {
            req = req.body(b.as_str().unwrap_or("").to_string());
        } else {
            req = req
                .header("Content-Type", "application/json;charset=utf-8")
                .json(&b);
        }
    }

    // A POST/PATCH/DELETE without a body still needs a length, or Roblox's front door answers
    // 411/400 before the API sees it.
    if body.as_ref().map(|b| b.is_null()).unwrap_or(true) && method != "GET" {
        req = req.header(reqwest::header::CONTENT_LENGTH, "0").body(Vec::<u8>::new());
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    remember_csrf(&res);
    let status = res.status().as_u16();
    // Quiet by default; run with RUST_LOG=…=debug to trace proxy calls.
    tracing::debug!(
        "proxy {} {} -> {}",
        method,
        url.split('?').next().unwrap_or(url),
        status
    );

    // Rate limited reading: back off once and try again rather than failing the page.
    // Some lookups are POSTs that only read (names, presence, thumbnails, item details).
    let read_only_post = ["users.roblox.com/v1/users", "presence.roblox.com/v1/presence/users", "thumbnails.roblox.com/v1/batch", "catalog.roblox.com/v1/catalog/items/details", "omni-recommendation"]
        .iter()
        .any(|p| url.contains(p));
    if status == 429 && allow_csrf_retry && (method == "GET" || read_only_post) {
        let wait = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok()).unwrap_or(1).clamp(1, 5);
        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        return Box::pin(fetch_roblox_api_inner(state, url, options, false)).await;
    }
    if status == 403 && allow_csrf_retry && method != "GET" {
        if let Some(tok) = res
            .headers()
            .get("x-csrf-token")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
        {
            *CSRF_TOKEN.lock() = Some(tok);
            return Box::pin(fetch_roblox_api_inner(state, url, options, false)).await;
        }
    }

    let status_text = res.status().canonical_reason().unwrap_or("").to_string();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let headers_map: serde_json::Map<String, Value> = res
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|s| (k.to_string(), Value::String(s.to_string())))
        })
        .collect();
    // Meshes and textures are binary: sent back as base64 so they aren't mangled as text.
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let looks_like_json = content_type.contains("json")
        || content_type.starts_with("text/")
        || bytes
            .iter()
            .find(|b| !b.is_ascii_whitespace())
            .map(|b| *b == b'{' || *b == b'[')
            .unwrap_or(false);
    let data: Value = if looks_like_json {
        let text = String::from_utf8_lossy(&bytes);
        serde_json::from_str(text.trim()).unwrap_or_else(|_| Value::String(text.into_owned()))
    } else {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        json!({
            "__btrBinary": true,
            "base64": b64,
            "contentType": content_type,
            "byteLength": bytes.len(),
        })
    };

    // Profile edits are logged even when they succeed (status only), to trace saves that don't stick.
    if method != "GET" && (url.contains("thumbnail-customization") || url.ends_with("/v4/avatar")) {
        tracing::info!("roblox {} {} -> {}", method, url.split('?').next().unwrap_or(url), status);
    }
    // Failed requests are logged with Roblox's own error (never the query string or cookie),
    // so a bad request shows up in ruby.log instead of failing silently.
    if !(200..300).contains(&status) {
        let reason = data
            .get("errors")
            .and_then(|e| e.get(0))
            .map(|e| format!("{} {}", e.get("code").map(|c| c.to_string()).unwrap_or_default(), e.get("message").and_then(|m| m.as_str()).unwrap_or("")))
            .or_else(|| data.get("message").and_then(|m| m.as_str()).map(String::from))
            .or_else(|| data.as_str().map(|t| t.chars().take(120).collect()))
            .unwrap_or_default();
        tracing::warn!("roblox {} {} -> {} {}", method, url.split('?').next().unwrap_or(url), status, reason.chars().take(200).collect::<String>());
    }
    Ok(json!({
        "ok": (200..300).contains(&status),
        "status": status,
        "statusText": status_text,
        "headers": headers_map,
        "data": data,
    }))
}

pub async fn fetch_json_safe(state: &Arc<AppState>, url: &str) -> Value {
    match fetch_roblox_api(state, url, None).await {
        Ok(res) if res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) => {
            res.get("data").cloned().unwrap_or(json!(null))
        }
        _ => json!(null),
    }
}
