//! Updates from dsk.wtf.
//!
//! Ruby asks https://dsk.wtf/ruby/latest.json for the newest version (no cookies, account or PC
//! details go with it). Installing an update downloads the installer, checks it against the
//! release's signature before running anything, then starts it in update mode and closes Ruby.
//!
//! The signature is Ed25519 over "ruby-update", the version, the installer's SHA-256 and its
//! size. Only the private key on the developer's PC can make one, so a tampered download, or a
//! tampered latest.json, is refused even if dsk.wtf itself were compromised.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const LATEST: &str = "https://dsk.wtf/ruby/latest.json";
const PAGE: &str = "https://dsk.wtf/ruby";
const PUBLIC_KEY: &str = "YYCpXWo/WrzeUN4J91DXu7zylacEKidlKEo4iE5mO2c=";
/// Where the installer may come from: dsk.wtf, which redirects to Cloudflare R2.
const DOWNLOAD_HOSTS: [&str; 2] = ["dsk.wtf", ".r2.cloudflarestorage.com"];

#[derive(Deserialize)]
struct Release {
    version: String,
    sha256: String,
    size: u64,
    url: String,
    signature: String,
    #[serde(default)]
    date: String,
    /// What's new, shown in the banner. Display text only: it isn't part of the signature and
    /// nothing is installed from it.
    #[serde(default)]
    notes: Vec<String>,
}

/// "1.2.3" -> [1, 2, 3]; anything that isn't a number counts as 0.
fn parts(v: &str) -> [u64; 3] {
    let mut out = [0; 3];
    for (i, p) in v.trim().trim_start_matches('v').split('.').take(3).enumerate() {
        out[i] = p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
    }
    out
}

fn signed_message(r: &Release) -> String {
    format!("ruby-update\n{}\n{}\n{}", r.version, r.sha256.to_ascii_lowercase(), r.size)
}

fn verify(r: &Release) -> Result<(), String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let key: [u8; 32] = b64.decode(PUBLIC_KEY).ok().and_then(|k| k.try_into().ok()).ok_or("bad public key")?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| "bad public key")?;
    let sig: [u8; 64] = b64.decode(r.signature.trim()).ok().and_then(|s| s.try_into().ok()).ok_or("The update isn't signed.")?;
    key.verify(signed_message(r).as_bytes(), &Signature::from_bytes(&sig))
        .map_err(|_| "The update's signature doesn't match. It wasn't installed.".to_string())
}

fn allowed_host(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().map(|h| DOWNLOAD_HOSTS.iter().any(|d| if d.starts_with('.') { h.ends_with(d) } else { h == *d })).unwrap_or(false)
}

/// A fresh client: no cookie jar, so nothing from Roblox can ride along, and redirects may
/// only lead to the hosts above.
fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("RubyLauncher")
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() > 5 || !allowed_host(a.url()) { a.stop() } else { a.follow() }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn latest() -> Result<Release, String> {
    let r: Release = client(Duration::from_secs(10))?
        .get(LATEST)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    verify(&r)?;
    Ok(r)
}

pub async fn check(current: &str) -> Value {
    match latest().await {
        Ok(r) => json!({
            "current": current,
            "latest": r.version,
            "date": r.date,
            "sizeMb": (r.size as f64 / 1_048_576.0).round(),
            "notes": r.notes.iter().take(8).map(|n| n.chars().take(160).collect::<String>()).collect::<Vec<_>>(),
            "newer": parts(&r.version) > parts(current),
            "page": PAGE,
        }),
        Err(e) => {
            tracing::info!("update check: {e}");
            json!({ "current": current, "newer": false, "error": e })
        }
    }
}

/// Download, verify and start the installer, then quit so it can replace Ruby.
pub async fn install(app: &AppHandle, current: &str) -> Result<Value, String> {
    let r = latest().await?;
    if parts(&r.version) <= parts(current) {
        return Err("You already have the newest Ruby.".into());
    }
    let url = reqwest::Url::parse(&r.url).map_err(|e| e.to_string())?;
    if !allowed_host(&url) {
        return Err("The update link isn't on dsk.wtf.".into());
    }

    let dir = std::env::temp_dir().join("RubyLauncherUpdate");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("Ruby-Launcher-Setup-{}.exe", r.version.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.', "")));

    let mut res = client(Duration::from_secs(30 * 60))?.get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut done: u64 = 0;
    let mut last_pct = u64::MAX;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("The download stopped: {e}"))? {
        done += chunk.len() as u64;
        if done > r.size {
            break;
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let pct = done * 100 / r.size.max(1);
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit("ruby-update-progress", json!({ "done": done, "total": r.size }));
        }
    }
    file.sync_all().ok();
    drop(file);

    let digest = hash.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    if done != r.size || !digest.eq_ignore_ascii_case(&r.sha256) {
        let _ = std::fs::remove_file(&path);
        return Err("The download didn't match the signed release, so it wasn't installed. Try again.".into());
    }

    let _ = app.emit("ruby-update-progress", json!({ "done": r.size, "total": r.size, "phase": "installing" }));
    std::process::Command::new(&path).arg("--update").spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    tracing::info!("update {} downloaded and verified; installer started", r.version);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        app.exit(0);
    });
    Ok(json!({ "ok": true, "version": r.version }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(parts("1.0.10") > parts("1.0.9"));
        assert!(parts("2.0.0") > parts("1.9.9"));
        assert!(parts("v1.1.0") > parts("1.0.0"));
        assert!(!(parts("1.0.0") > parts("1.0.0")));
    }

    #[test]
    fn download_hosts() {
        let ok = |u: &str| allowed_host(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://dsk.wtf/ruby/download"));
        assert!(ok("https://abc.r2.cloudflarestorage.com/ruby-downloads/x.exe"));
        assert!(!ok("http://dsk.wtf/ruby/download"));
        assert!(!ok("https://evil-dsk.wtf/x"));
        assert!(!ok("https://r2.cloudflarestorage.com.evil.com/x"));
    }

    #[test]
    fn rejects_unsigned_and_tampered() {
        let mut r = Release { version: "9.9.9".into(), sha256: "00".into(), size: 1, url: String::new(), signature: String::new(), date: String::new(), notes: vec![] };
        assert!(verify(&r).is_err());
        r.signature = base64::engine::general_purpose::STANDARD.encode([0u8; 64]);
        assert!(verify(&r).is_err());
    }

    /// RUBY_RELEASE_JSON=<release.json> cargo test signed_release -- checks a real signed release.
    #[test]
    fn signed_release() {
        let Ok(p) = std::env::var("RUBY_RELEASE_JSON") else { return };
        let mut r: Release = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        verify(&r).expect("signature verifies");
        r.size += 1;
        assert!(verify(&r).is_err(), "a changed size must fail");
    }
}
