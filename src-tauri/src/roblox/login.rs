//! Sign-in window: opens roblox.com/login in a private webview and captures
//! `.ROBLOSECURITY` once the user finishes signing in.

use crate::roblox::auth::set_cookie_from_embed;
use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "login";

/// A fresh, empty browser profile for each sign-in (the old one is wiped first).
fn login_profile_dir(state: &AppState) -> std::path::PathBuf {
    let dir = state.data_dir.join("login-profile");
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

pub fn open_login_window(app: &AppHandle, state: &Arc<AppState>) -> Result<Value, String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(json!({ "ok": true }));
    }

    let url: url::Url = "https://www.roblox.com/login"
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Sign in to Roblox")
        .inner_size(480.0, 720.0)
        .resizable(true)
        .center()
        // Private, and in its own browser profile: Ruby's other private windows share one cookie
        // store that holds the current session, which would sign this window straight back in.
        .incognito(true)
        .data_directory(login_profile_dir(state))
        .build()
        .map_err(|e| e.to_string())?;

    let app2 = app.clone();
    let state2 = Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        let roblox: url::Url = "https://www.roblox.com/".parse().expect("static url");
        // Only a session that appears after the window opened counts as signing in.
        let mut existing: Option<Option<String>> = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
            if app2.get_webview_window(LABEL).is_none() {
                let _ = app2.emit("login-window-closed", json!({ "signedIn": false }));
                break;
            }
            let Ok(cookies) = window.cookies_for_url(roblox.clone()) else {
                continue;
            };
            let current = cookies.iter().find(|c| c.name() == ".ROBLOSECURITY" && !c.value().is_empty()).map(|c| c.value().to_string());
            let before = existing.get_or_insert_with(|| current.clone()).clone();
            let Some(sec) = current.filter(|c| Some(c) != before.as_ref()) else {
                continue;
            };
            set_cookie_from_embed(&app2, &state2, sec);
            let _ = window.close();
            let _ = app2.emit("login-window-closed", json!({ "signedIn": true }));
            break;
        }
    });

    Ok(json!({ "ok": true }))
}
