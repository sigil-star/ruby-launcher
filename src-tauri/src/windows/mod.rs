//! Main window chrome helpers.

pub mod embed;

use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

pub fn minimize(app: &AppHandle) -> Result<Value, String> {
    if let Some(w) = app.get_window("main") {
        w.minimize().map_err(|e| e.to_string())?;
    }
    Ok(json!(null))
}

pub fn maximize(app: &AppHandle) -> Result<Value, String> {
    if let Some(w) = app.get_window("main") {
        if w.is_maximized().unwrap_or(false) {
            w.unmaximize().map_err(|e| e.to_string())?;
        } else {
            w.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(json!(null))
}

/// The X button: off to the tray (Ruby keeps running for notifications and web launches),
/// or quit when "Minimize to tray" is off.
pub fn close(app: &AppHandle, state: &AppState) -> Result<Value, String> {
    if !state.behavior.read().minimize_to_tray {
        tracing::info!("close: quitting (tray off)");
        app.exit(0);
        return Ok(json!(null));
    }
    let w = app.get_window("main").ok_or("main window missing")?;
    w.hide().map_err(|e| {
        tracing::warn!("close: hide failed: {e}");
        e.to_string()
    })?;
    tracing::info!("close: hidden to tray");
    Ok(json!(null))
}

pub fn is_maximized(app: &AppHandle) -> Result<Value, String> {
    let v = app
        .get_window("main")
        .and_then(|w| w.is_maximized().ok())
        .unwrap_or(false);
    Ok(json!(v))
}

pub fn main_renderer_ready(app: &AppHandle, state: &AppState) -> Result<Value, String> {
    state
        .main_ready
        .store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(json!({ "ok": true }))
}

pub fn open_external(app: &AppHandle, url: &str) -> Result<Value, String> {
    let _ = app;
    open::that(url).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn open_ruby_log(state: &Arc<AppState>) -> Result<Value, String> {
    let path = state.log_path();
    if !path.exists() {
        let _ = std::fs::write(&path, "");
    }
    open::that(&path).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

const WEB_LABEL: &str = "robloxweb";

/// Adds `.ROBLOSECURITY` for the whole `.roblox.com` domain. Tauri's `set_cookie` goes through
/// the `cookie` crate, which drops the leading dot, so WebView2 would make a host-only cookie
/// for "roblox.com" that www/apis/economy never see.
#[cfg(windows)]
fn set_domain_cookie(window: &tauri::WebviewWindow, value: String) {
    let res = window.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
        use windows::core::{Interface, HSTRING};
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let Ok(core2) = core.cast::<ICoreWebView2_2>() else { return };
        let Ok(mgr) = core2.CookieManager() else { return };
        match mgr.CreateCookie(&HSTRING::from(".ROBLOSECURITY"), &HSTRING::from(value), &HSTRING::from(".roblox.com"), &HSTRING::from("/")) {
            Ok(c) => {
                let _ = c.SetIsSecure(true);
                let _ = c.SetIsHttpOnly(true);
                if let Err(e) = mgr.AddOrUpdateCookie(&c) {
                    tracing::warn!("roblox web popup: AddOrUpdateCookie failed: {e}");
                }
            }
            Err(e) => tracing::warn!("roblox web popup: CreateCookie failed: {e}"),
        }
    });
    if let Err(e) = res {
        tracing::warn!("roblox web popup: with_webview failed: {e}");
    }
}

#[cfg(not(windows))]
fn set_domain_cookie(window: &tauri::WebviewWindow, value: String) {
    let c = tauri::webview::Cookie::build((".ROBLOSECURITY", value)).domain("roblox.com").path("/").secure(true).http_only(true).build();
    let _ = window.set_cookie(c);
}

fn is_roblox_https(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .map(|h| h == "roblox.com" || h.ends_with(".roblox.com"))
            .unwrap_or(false)
}

/// Opens a roblox.com page in a popup window that's already signed in as the current
/// account: Ruby copies its session cookie into a private webview, so purchases, gift-card
/// redeeming and reports happen on Roblox's own pages (payment details stay with Roblox).
pub fn open_roblox_web(app: &AppHandle, state: &Arc<AppState>, url: &str, title: &str) -> Result<Value, String> {
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
    let target: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    if !is_roblox_https(&target) {
        return Err("only roblox.com pages can open here".into());
    }
    let cookie = state.cookie.read().clone().ok_or("not signed in")?;

    if let Some(w) = app.get_webview_window(WEB_LABEL) {
        let _ = w.navigate(target);
        let _ = w.set_title(title);
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(json!({ "ok": true }));
    }

    // Open on a blank page first: the session cookie has to be in place before Roblox's page
    // loads, otherwise it renders signed out.
    let blank: url::Url = "about:blank".parse().map_err(|e: url::ParseError| e.to_string())?;
    let window = WebviewWindowBuilder::new(app, WEB_LABEL, WebviewUrl::External(blank))
        .title(title)
        .inner_size(1040.0, 780.0)
        .min_inner_size(420.0, 520.0)
        .resizable(true)
        .center()
        // Private: the session lives only in this window and is gone when it closes.
        .incognito(true)
        .build()
        .map_err(|e| e.to_string())?;
    set_domain_cookie(&window, cookie.clone());
    // WebView2 adds cookies asynchronously; wait until it's really there, then go to the page.
    let w2 = window.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(home) = "https://www.roblox.com/".parse::<url::Url>() else { return };
        for attempt in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            let has = w2
                .cookies_for_url(home.clone())
                .map(|c| c.iter().any(|c| c.name() == ".ROBLOSECURITY" && !c.value().is_empty()))
                .unwrap_or(false);
            if has {
                break;
            }
            if attempt == 9 {
                tracing::warn!("roblox web popup: session cookie never appeared; opening anyway");
            }
            set_domain_cookie(&w2, cookie.clone());
        }
        let _ = w2.navigate(target);
    });

    // Tell the app when it closes so balances/notifications refresh after a purchase.
    let app2 = app.clone();
    window.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::Destroyed) {
            let _ = app2.emit("roblox-web-closed", json!({}));
        }
    });
    Ok(json!({ "ok": true }))
}
