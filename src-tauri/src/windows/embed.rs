//! Roblox web pages embedded *inside* Ruby's window (Roblox Plus, gift-card redeeming, …).
//!
//! A child webview sits over the page's content area; the React page reports its rectangle
//! and Ruby keeps the webview glued to it. It's private (incognito), signed in with the
//! current account, and restyled so roblox.com's own header/footer disappear and its colours
//! match Ruby.

use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

const LABEL: &str = "embed-roblox";

/// A script to run on every page load while Roblox's verification challenge is open.
static PENDING_SCRIPT: once_cell::sync::Lazy<parking_lot::Mutex<Option<String>>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(None));
/// The session the embed is signed in with, so switching accounts re-signs it.
static LAST_COOKIE: once_cell::sync::Lazy<parking_lot::Mutex<Option<String>>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(None));
static LAST_TARGET: once_cell::sync::Lazy<parking_lot::Mutex<Option<String>>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(None));

const THEME_SCRIPT: &str = r#"
(() => {
  const CSS = `
    #header, .rbx-header, #navigation-container, #left-navigation-container, .rbx-left-col,
    footer, #footer-container, .container-footer, #chat-container, .chat-container,
    #rbx-gdpr-banner, .cookie-banner-wrapper, #cookie-banner-wrapper, .alert-container { display: none !important; }
    html, body, #wrap, #container-main, .content, #content, .container-main { background: #111216 !important; }
    #container-main, .container-main { margin: 0 auto !important; padding: 20px 32px 32px !important; box-sizing: border-box !important; }
    #wrap, .content { padding-top: 0 !important; margin-left: 0 !important; }
    body { color: #f7f7f8 !important; }
    .section-content, .rbx-tab-content, .card, .panel, .modal-content, .simplereact-content,
    [class*="bg-surface-100"], [class*="bg-shift-100"] { background-color: #1c1d21 !important; border-color: #2f3036 !important; }
    .btn-primary-md, .btn-primary-lg, .btn-cta-md, .btn-cta-lg, .btn-growth-md, .btn-growth-lg,
    [class*="bg-action-emphasis"] { background-color: #335fff !important; border-color: #335fff !important; }
    .input-field, input.form-control, .form-control { background: #232428 !important; border-color: #2f3036 !important; color: #f7f7f8 !important; }
    a.text-link, .text-link { color: #8fa8ff !important; }
    ::-webkit-scrollbar { width: 10px; } ::-webkit-scrollbar-thumb { background: #2d2e33; border-radius: 8px; }
  `;
  const apply = () => {
    if (document.body) {
      document.body.classList.add("dark-theme");
      document.body.classList.remove("light-theme");
    }
    if (document.getElementById("ruby-theme")) return;
    const s = document.createElement("style");
    s.id = "ruby-theme";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  };
  apply();
  document.addEventListener("DOMContentLoaded", apply);
  new MutationObserver(() => { if (!document.getElementById("ruby-theme")) apply(); }).observe(document.documentElement, { childList: true });
  document.addEventListener("DOMContentLoaded", () => document.head && new MutationObserver(() => { if (!document.getElementById("ruby-theme")) apply(); }).observe(document.head, { childList: true }));
})();
"#;

fn is_roblox_https(url: &url::Url) -> bool {
    url.scheme() == "https" && url.host_str().map(|h| h == "roblox.com" || h.ends_with(".roblox.com")).unwrap_or(false)
}

#[cfg(windows)]
fn set_domain_cookie(webview: &tauri::Webview, value: String) {
    let _ = webview.with_webview(move |wv| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
        use windows::core::{Interface, HSTRING};
        let Ok(core) = wv.controller().CoreWebView2() else { return };
        let Ok(core2) = core.cast::<ICoreWebView2_2>() else { return };
        let Ok(mgr) = core2.CookieManager() else { return };
        if let Ok(c) = mgr.CreateCookie(&HSTRING::from(".ROBLOSECURITY"), &HSTRING::from(value), &HSTRING::from(".roblox.com"), &HSTRING::from("/")) {
            let _ = c.SetIsSecure(true);
            let _ = c.SetIsHttpOnly(true);
            let _ = mgr.AddOrUpdateCookie(&c);
        }
    });
}

#[cfg(not(windows))]
fn set_domain_cookie(webview: &tauri::Webview, value: String) {
    let c = tauri::webview::Cookie::build((".ROBLOSECURITY", value)).domain("roblox.com").path("/").secure(true).http_only(true).build();
    let _ = webview.set_cookie(c);
}

fn has_session(webview: &tauri::Webview) -> bool {
    let Ok(home) = "https://www.roblox.com/".parse::<url::Url>() else { return false };
    webview
        .cookies_for_url(home)
        .map(|c| c.iter().any(|c| c.name() == ".ROBLOSECURITY" && !c.value().is_empty()))
        .unwrap_or(false)
}

/// Show `url` in the embed at `x,y,w,h` (logical pixels inside the main window).
pub fn show_embed(app: &AppHandle, state: &Arc<AppState>, url: &str, x: f64, y: f64, w: f64, h: f64) -> Result<Value, String> {
    let target: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    if !is_roblox_https(&target) {
        return Err("only roblox.com pages can be embedded".into());
    }
    let pos = LogicalPosition::new(x, y);
    let size = LogicalSize::new(w.max(1.0), h.max(1.0));

    let cookie = state.cookie.read().clone().ok_or("not signed in")?;
    if let Some(wv) = app.get_webview(LABEL) {
        let _ = wv.set_position(pos);
        let _ = wv.set_size(size);
        let _ = wv.show();
        // Signed in as someone else since it was made (account switch): re-sign, then load.
        if LAST_COOKIE.lock().as_deref() != Some(cookie.as_str()) {
            *LAST_TARGET.lock() = Some(target.to_string());
            sign_in_then_go(wv, cookie, target);
            return Ok(json!({ "ok": true }));
        }
        // Only navigate when Ruby asks for a different page, so links clicked inside survive re-shows.
        let mut last = LAST_TARGET.lock();
        if last.as_deref() != Some(target.as_str()) {
            *last = Some(target.to_string());
            let _ = wv.navigate(target);
        }
        return Ok(json!({ "ok": true }));
    }
    *LAST_TARGET.lock() = Some(target.to_string());
    create(app, cookie, target, pos, size)
}

/// Load the embed in the background soon after sign-in, so roblox.com's scripts are already
/// downloaded and the webview is running when a page is first opened (it was a cold start).
pub fn prewarm_embed(app: &AppHandle, state: &Arc<AppState>) -> Result<Value, String> {
    if app.get_webview(LABEL).is_some() {
        return Ok(json!({ "ok": true }));
    }
    let cookie = state.cookie.read().clone().ok_or("not signed in")?;
    let target: url::Url = "https://www.roblox.com/my/account".parse().map_err(|e: url::ParseError| e.to_string())?;
    create(app, cookie, target, LogicalPosition::new(-20000.0, -20000.0), LogicalSize::new(1000.0, 700.0))?;
    if let Some(wv) = app.get_webview(LABEL) {
        let _ = wv.hide();
    }
    Ok(json!({ "ok": true }))
}

fn sign_in_then_go(wv: tauri::Webview, cookie: String, target: url::Url) {
    *LAST_COOKIE.lock() = Some(cookie.clone());
    set_domain_cookie(&wv, cookie.clone());
    // The cookie lands asynchronously: wait until it's in, then load the page signed in.
    tauri::async_runtime::spawn(async move {
        for _ in 0..40 {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            if has_session(&wv) {
                break;
            }
            if retry_tick() {
                set_domain_cookie(&wv, cookie.clone());
            }
        }
        let _ = wv.navigate(target);
    });
}

/// Retry setting the cookie every ~200 ms while waiting.
fn retry_tick() -> bool {
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    N.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 8 == 7
}

fn create(app: &AppHandle, cookie: String, target: url::Url, pos: LogicalPosition<f64>, size: LogicalSize<f64>) -> Result<Value, String> {
    let window = app.get_window("main").ok_or("main window missing")?;
    let blank: url::Url = "about:blank".parse().map_err(|e: url::ParseError| e.to_string())?;
    let nav_app = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(blank))
        .incognito(true)
        .initialization_script(THEME_SCRIPT)
        // Roblox's challenge UI reports back by navigating to this marker URL; hand it to Ruby.
        .on_navigation(move |u| {
            if u.path() == "/ruby-challenge-done" && u.host_str() == Some("www.roblox.com") && PENDING_SCRIPT.lock().is_some() {
                use tauri::Emitter;
                let _ = nav_app.emit("roblox-challenge-done", u.fragment().unwrap_or("").to_string());
                return false;
            }
            true
        })
        // Belt and braces: also apply the theme once each page has loaded.
        .on_page_load(|wv, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = wv.eval(THEME_SCRIPT);
                if let Some(s) = PENDING_SCRIPT.lock().clone() {
                    let _ = wv.eval(&s);
                }
            }
        });
    let webview = window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
    sign_in_then_go(webview, cookie, target);
    Ok(json!({ "ok": true }))
}

/// Keep the embed on the page's rectangle (scrolling, resizing, sidebar toggles).
pub fn move_embed(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) -> Result<Value, String> {
    if let Some(wv) = app.get_webview(LABEL) {
        let _ = wv.set_position(LogicalPosition::new(x, y));
        let _ = wv.set_size(LogicalSize::new(w.max(1.0), h.max(1.0)));
    }
    Ok(json!({ "ok": true }))
}

/// Hide (kept loaded so coming back is instant). Ruby's own menus/popups call this so they
/// can draw over the page.
pub fn hide_embed(app: &AppHandle) -> Result<Value, String> {
    if let Some(wv) = app.get_webview(LABEL) {
        let _ = wv.hide();
        // hide() alone doesn't always take on Windows child webviews; park it off-screen too.
        let _ = wv.set_position(LogicalPosition::new(-20000.0, -20000.0));
    }
    Ok(json!({ "ok": true }))
}

/// Leaving the page: hide it and forget where it was, so opening it again starts fresh.
pub fn close_embed(app: &AppHandle) -> Result<Value, String> {
    // A purchase or redeemed card may have changed the balance.
    if LAST_TARGET.lock().take().is_some() {
        use tauri::Emitter;
        let _ = app.emit("roblox-web-closed", ());
    }
    hide_embed(app)
}

pub fn reload_embed(app: &AppHandle) -> Result<Value, String> {
    if let Some(wv) = app.get_webview(LABEL) {
        let _ = wv.reload();
    }
    Ok(json!({ "ok": true }))
}

/// Run a script in the embed now and after each load until cleared (empty script clears).
pub fn embed_script(app: &AppHandle, script: &str) -> Result<Value, String> {
    let s = script.trim();
    *PENDING_SCRIPT.lock() = if s.is_empty() { None } else { Some(s.to_string()) };
    if !s.is_empty() {
        if let Some(wv) = app.get_webview(LABEL) {
            let _ = wv.eval(s);
        }
    }
    Ok(json!({ "ok": true }))
}
