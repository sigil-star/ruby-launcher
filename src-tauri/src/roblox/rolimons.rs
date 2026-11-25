//! Rolimons' public item values (value, demand, trend, projected…). No Roblox cookie is ever sent.

use std::time::{Duration, Instant};

static CACHE: once_cell::sync::Lazy<parking_lot::Mutex<Option<(Instant, serde_json::Value)>>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(None));

pub async fn items() -> Result<serde_json::Value, String> {
    if let Some((t, v)) = CACHE.lock().as_ref() {
        if t.elapsed() < Duration::from_secs(300) {
            return Ok(v.clone());
        }
    }
    let r = reqwest::Client::builder()
        .user_agent("RubyLauncher")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .get("https://api.rolimons.com/items/v1/itemdetails")
        .send()
        .await
        .map_err(|e| format!("Rolimons is unreachable: {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Rolimons answered {}", r.status()));
    }
    let v: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    let items = v.get("items").cloned().unwrap_or_default();
    *CACHE.lock() = Some((Instant::now(), items.clone()));
    Ok(items)
}
