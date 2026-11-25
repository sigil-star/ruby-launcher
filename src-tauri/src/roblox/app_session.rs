//! Import .ROBLOSECURITY from the official Roblox Windows app (cookies.dat / DPAPI).

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn local_storage_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(local) = dirs::data_local_dir() {
        dirs.push(local.join("Roblox").join("LocalStorage"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = PathBuf::from(profile)
            .join("AppData")
            .join("Local")
            .join("Roblox")
            .join("LocalStorage");
        if !dirs.iter().any(|d| d == &p) {
            dirs.push(p);
        }
    }
    dirs
}

/// Decrypt the Roblox app's saved session in memory (Windows DPAPI, current user only).
/// Nothing decrypted is ever written to disk.
fn decrypt_dpapi_base64(b64: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    let plain = crate::state::secret::unprotect_user_blob(&bytes)?;
    String::from_utf8(plain).ok()
}

fn extract_roblox_security(decrypted: &str) -> Option<String> {
    let trimmed = decrypted.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(data) = serde_json::from_str::<Value>(decrypted) {
            if let Some(v) = data
                .get(".ROBLOSECURITY")
                .or_else(|| data.get("ROBLOSECURITY"))
                .or_else(|| data.get("cookie"))
                .and_then(|x| x.as_str())
            {
                if v.starts_with("_|WARNING:") || v.len() > 50 {
                    return Some(v.to_string());
                }
            }
            if let Some(list) = data
                .get("cookies")
                .or_else(|| data.get("Cookies"))
                .and_then(|x| x.as_array())
            {
                for c in list {
                    let name = c
                        .get("name")
                        .or_else(|| c.get("Name"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    if name == ".ROBLOSECURITY" {
                        if let Some(v) = c
                            .get("value")
                            .or_else(|| c.get("Value"))
                            .and_then(|x| x.as_str())
                        {
                            return Some(v.to_string());
                        }
                    }
                }
            }
        }
    }
    let re = regex::Regex::new(r"(_\|WARNING:[^|]*\|_[A-Za-z0-9_+/=.\-]+)").ok()?;
    if let Some(caps) = re.captures(trimmed) {
        let m = caps.get(1)?.as_str();
        if m.len() > 50 {
            return Some(m.to_string());
        }
    }
    None
}

fn normalize_cookie(mut cookie: String) -> String {
    if !cookie.starts_with("_|WARNING:")
        && cookie.len() < 800
        && cookie
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        cookie = format!(
            "_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_{cookie}"
        );
    }
    cookie
}

fn read_cookie_from_dat(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let data: Value = serde_json::from_str(trimmed).ok()?;
    if let Some(b64) = data.get("CookiesData").and_then(|v| v.as_str()) {
        if let Some(decrypted) = decrypt_dpapi_base64(b64) {
            if let Some(c) = extract_roblox_security(&decrypted) {
                return Some(normalize_cookie(c));
            }
        }
    }
    for key in [".ROBLOSECURITY", "ROBLOSECURITY", "cookie"] {
        if let Some(v) = data.get(key).and_then(|x| x.as_str()) {
            if v.starts_with("_|WARNING:") || v.len() > 50 {
                return Some(normalize_cookie(v.to_string()));
            }
        }
    }
    None
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct RobloxAppSession {
    pub cookie_value: String,
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub session_source: String,
}

/// Try LocalStorage cookies.dat (DPAPI).
pub fn try_read_roblox_app_cookie() -> Option<String> {
    let names = ["RobloxCookies.dat", "cookies.dat", "Cookies.dat"];
    for dir in local_storage_candidates() {
        for name in names {
            let p = dir.join(name);
            if p.is_file() {
                if let Some(c) = read_cookie_from_dat(&p) {
                    tracing::info!("roblox app cookie found via {}", p.display());
                    return Some(c);
                }
            }
        }
    }
    None
}

pub async fn validate_cookie(
    http: &reqwest::Client,
    cookie: &str,
) -> Option<(i64, String, Option<String>)> {
    let res = http
        .get("https://users.roblox.com/v1/users/authenticated")
        .header("Cookie", format!(".ROBLOSECURITY={cookie}"))
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        tracing::warn!("roblox app cookie auth failed: {}", res.status());
        return None;
    }
    let body: Value = res.json().await.ok()?;
    let id = body.get("id")?.as_i64()?;
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let display = body
        .get("displayName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some((id, name, display))
}

/// Full session probe: cookie from disk + authenticated user.
pub async fn get_roblox_app_session(http: &reqwest::Client) -> Option<RobloxAppSession> {
    let cookie = try_read_roblox_app_cookie()?;
    let (user_id, username, _display) = validate_cookie(http, &cookie).await?;
    Some(RobloxAppSession {
        cookie_value: cookie,
        user_id: Some(user_id),
        username: Some(username),
        session_source: "Roblox app on this device".into(),
    })
}
