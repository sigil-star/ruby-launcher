//! Session / multi-account auth + Roblox app cookie bootstrap.

use crate::roblox::app_session::RobloxAppSession;
use crate::state::{AppState, RobloxUserData, SavedAccount};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Pending offer from Roblox desktop app cookies (for useRobloxAppSession).
pub static PENDING_APP_SESSION: once_cell::sync::Lazy<Mutex<Option<RobloxAppSession>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

pub async fn get_user_data(state: &Arc<AppState>) -> Value {
    if state.cookie.read().is_some() && state.user.read().id.is_none() {
        let _ = refresh_user_data(state).await;
    }
    state.user_json()
}

pub async fn refresh_user_data(state: &Arc<AppState>) -> Result<Value, String> {
    let cookie = state.cookie.read().clone();
    let Some(cookie) = cookie else {
        return Ok(json!({}));
    };
    let res = state
        .http
        .get("https://users.roblox.com/v1/users/authenticated")
        .header("Cookie", format!(".ROBLOSECURITY={cookie}"))
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        state.session_debug.write().cookie_status = format!("http_{}", res.status());
        tracing::warn!(code, "user check failed");
        // 429 / 5xx say nothing about the cookie. Keep going as the saved account it belongs
        // to, so a rate-limited Roblox doesn't leave Ruby stuck on its loading screen.
        if code != 401 && code != 403 {
            if let Some(acc) = state.accounts.read().iter().find(|a| a.cookie == cookie).cloned() {
                if acc.user_id > 0 {
                    let mut user = state.user.read().clone();
                    if user.id != Some(acc.user_id) {
                        user = RobloxUserData::default();
                        user.id = Some(acc.user_id);
                        user.name = Some(acc.username.clone());
                        user.display_name = acc.display_name.clone().or(Some(acc.username.clone()));
                    }
                    *state.user.write() = user;
                    state.login_bar_visible.store(false, Ordering::SeqCst);
                    return Ok(state.user_json());
                }
            }
        }
        return Ok(json!({}));
    }
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let uid = body.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
    if uid <= 0 {
        return Ok(json!({}));
    }

    let headshot_url = format!(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={uid}&size=150x150&format=Png&isCircular=false"
    );
    let full_url = format!(
        "https://thumbnails.roblox.com/v1/users/avatar?userIds={uid}&size=420x420&format=Png&isCircular=false"
    );
    let premium_url = format!(
        "https://premiumfeatures.roblox.com/v1/users/{uid}/validate-membership"
    );
    let (avatar_data, full_body_data, robux_data, premium_data) = tokio::join!(
        crate::roblox::http::fetch_json_safe(state, &headshot_url),
        crate::roblox::http::fetch_json_safe(state, &full_url),
        crate::roblox::http::fetch_json_safe(state, "https://economy.roblox.com/v1/user/currency"),
        crate::roblox::http::fetch_json_safe(state, &premium_url),
    );

    let avatar = avatar_data
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .and_then(|e| e.get("imageUrl"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());
    let avatar_full = full_body_data
        .get("data")
        .and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .and_then(|e| e.get("imageUrl"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());
    let robux = robux_data.get("robux").and_then(|v| v.as_i64()).or(Some(0));
    let is_premium = match &premium_data {
        Value::Null => Some(false),
        Value::Bool(b) => Some(*b),
        Value::Object(o) if o.is_empty() => Some(true),
        Value::Object(_) => Some(true),
        _ => Some(true),
    };

    let mut user = RobloxUserData::default();
    user.id = Some(uid);
    user.name = body
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    user.display_name = body
        .get("displayName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    user.has_verified_badge = body.get("hasVerifiedBadge").and_then(|v| v.as_bool());
    user.avatar = avatar;
    user.avatar_full = avatar_full;
    user.robux = robux;
    user.is_premium = is_premium;
    *state.user.write() = user;
    state.login_bar_visible.store(false, Ordering::SeqCst);
    state.session_debug.write().cookie_status = "ok".into();
    state.session_debug.write().step = "authenticated".into();
    state.save_session();
    Ok(state.user_json())
}

pub fn get_auth_bootstrap_state(state: &Arc<AppState>) -> Value {
    json!({
        "ready": true,
        "initialCookieCheckDone": true,
        "hasKnownUser": state.user.read().id.is_some(),
        "isGuest": state.is_guest.load(Ordering::SeqCst),
        "loginBarVisible": state.login_bar_visible.load(Ordering::SeqCst),
        "sessionDebugState": &*state.session_debug.read(),
    })
}

pub fn get_session_debug(state: &Arc<AppState>) -> Value {
    serde_json::to_value(&*state.session_debug.read()).unwrap_or(json!({}))
}

pub fn list_saved_accounts(state: &Arc<AppState>) -> Value {
    let list: Vec<Value> = state
        .accounts
        .read()
        .iter()
        .map(|a| {
            json!({
                "id": a.id,
                "userId": a.user_id,
                "username": a.username,
                "displayName": a.display_name,
            })
        })
        .collect();
    json!(list)
}

pub async fn switch_saved_account(
    app: &AppHandle,
    state: &Arc<AppState>,
    account_id: &str,
) -> Result<Value, String> {
    let account = state
        .accounts
        .read()
        .iter()
        .find(|a| a.id == account_id)
        .cloned()
        .ok_or_else(|| "account not found".to_string())?;
    *state.cookie.write() = Some(account.cookie);
    state.is_guest.store(false, Ordering::SeqCst);
    let user = refresh_user_data(state).await?;
    let _ = app.emit("user-data", user.clone());
    let _ = app.emit("login-bar-visible", false);
    Ok(json!({ "ok": true, "user": user }))
}

pub fn remove_saved_account(state: &Arc<AppState>, account_id: &str) -> Result<Value, String> {
    state.accounts.write().retain(|a| a.id != account_id);
    state.save_accounts();
    Ok(json!({ "ok": true }))
}

pub fn sign_out_current_account(app: &AppHandle, state: &Arc<AppState>) -> Result<Value, String> {
    *state.cookie.write() = None;
    *state.user.write() = RobloxUserData::default();
    state.login_bar_visible.store(true, Ordering::SeqCst);
    state.is_guest.store(false, Ordering::SeqCst);
    state.save_session();
    let _ = app.emit("user-data", json!({}));
    let _ = app.emit("login-bar-visible", true);
    Ok(json!({ "ok": true }))
}

pub fn apply_cookie_session(
    app: &AppHandle,
    state: &Arc<AppState>,
    cookie: String,
    user_id: Option<i64>,
    username: Option<String>,
    display_name: Option<String>,
) {
    *state.cookie.write() = Some(cookie.clone());
    if let Some(id) = user_id {
        let mut user = RobloxUserData::default();
        user.id = Some(id);
        user.name = username.clone();
        user.display_name = display_name.clone().or(username.clone());
        *state.user.write() = user;

        let mut accounts = state.accounts.write();
        if let Some(existing) = accounts.iter_mut().find(|a| a.user_id == id) {
            existing.cookie = cookie.clone();
            if let Some(n) = username.clone() {
                existing.username = n;
            }
            existing.display_name = display_name.clone().or(username.clone());
        } else {
            accounts.push(SavedAccount {
                id: uuid::Uuid::new_v4().to_string(),
                user_id: id,
                username: username.clone().unwrap_or_default(),
                display_name: display_name.or(username),
                cookie: cookie.clone(),
            });
        }
        drop(accounts);
        state.save_accounts();
    }
    state.is_guest.store(false, Ordering::SeqCst);
    state.login_bar_visible.store(false, Ordering::SeqCst);
    state.session_debug.write().cookie_status = "ok".into();
    state.session_debug.write().step = "logged_in".into();
    state.save_session();

    // Enrich avatar/robux async so sidebar headshot appears without a full restart.
    let state2 = Arc::clone(state);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(user) = refresh_user_data(&state2).await {
            let _ = app2.emit("user-data", user);
            let _ = app2.emit("login-bar-visible", false);
        } else {
            let _ = app2.emit("user-data", state2.user_json());
            let _ = app2.emit("login-bar-visible", false);
        }
    });
}

pub fn set_cookie_from_embed(app: &AppHandle, state: &Arc<AppState>, cookie: String) {
    *state.cookie.write() = Some(cookie);
    state.login_bar_visible.store(false, Ordering::SeqCst);
    state.save_session();
    let state2 = Arc::clone(state);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(user) = refresh_user_data(&state2).await {
            if let Some(id) = state2.user.read().id {
                let username = state2.user.read().name.clone().unwrap_or_default();
                let display = state2.user.read().display_name.clone();
                let cookie = state2.cookie.read().clone().unwrap_or_default();
                let mut accounts = state2.accounts.write();
                if let Some(existing) = accounts.iter_mut().find(|a| a.user_id == id) {
                    existing.cookie = cookie;
                    existing.username = username;
                    existing.display_name = display;
                } else {
                    accounts.push(SavedAccount {
                        id: uuid::Uuid::new_v4().to_string(),
                        user_id: id,
                        username,
                        display_name: display,
                        cookie,
                    });
                }
                drop(accounts);
                state2.save_accounts();
            }
            let _ = app2.emit("user-data", user);
            let _ = app2.emit("login-bar-visible", false);
        }
    });
}

/// Bootstrap: reuse saved cookie, else import valid Roblox app session automatically.
pub async fn bootstrap_session(app: &AppHandle, state: &Arc<AppState>) {
    state.session_debug.write().step = "checking_session".into();
    let _ = app.emit("session-debug", get_session_debug(state));

    if state.cookie.read().is_some() {
        let saved = state.user.read().clone();
        let res = refresh_user_data(state).await;
        if let Ok(user) = &res {
            if state.user.read().id.is_some() {
                let _ = app.emit("user-data", user.clone());
                let _ = app.emit("login-bar-visible", false);
                return;
            }
        }
        // Only a real rejection (401/403) means the cookie is dead. Rate limits, timeouts and
        // server errors say nothing about it: keep the saved account instead of wiping it.
        let status = state.session_debug.read().cookie_status.clone();
        let rejected = status.starts_with("http_401") || status.starts_with("http_403");
        if !rejected && saved.id.is_some() {
            tracing::warn!(%status, "couldn't verify session; continuing with saved account");
            *state.user.write() = saved;
            let _ = app.emit("user-data", state.user_json());
            let _ = app.emit("login-bar-visible", false);
            return;
        }
        *state.cookie.write() = None;
        *state.user.write() = RobloxUserData::default();
    }

    state.session_debug.write().step = "checking_roblox_app_session".into();
    let _ = app.emit("session-debug", get_session_debug(state));
    if let Some(session) = crate::roblox::app_session::get_roblox_app_session(&state.http).await {
        apply_cookie_session(
            app,
            state,
            session.cookie_value,
            session.user_id,
            session.username.clone(),
            session.username,
        );
        *PENDING_APP_SESSION.lock() = None;
        tracing::info!("auto-applied Roblox app session");
        return;
    }

    state.login_bar_visible.store(true, Ordering::SeqCst);
    state.session_debug.write().step = "sign_in_screen".into();
    state.session_debug.write().cookie_status = "none".into();
    let _ = app.emit("user-data", json!({}));
    let _ = app.emit("login-bar-visible", true);
    let _ = app.emit("session-debug", get_session_debug(state));
}

pub async fn use_roblox_app_session(app: &AppHandle, state: &Arc<AppState>) -> Value {
    let pending = PENDING_APP_SESSION.lock().take();
    let Some(session) = pending else {
        if let Some(session) = crate::roblox::app_session::get_roblox_app_session(&state.http).await
        {
            apply_cookie_session(
                app,
                state,
                session.cookie_value,
                session.user_id,
                session.username.clone(),
                session.username,
            );
            return json!({ "ok": true });
        }
        return json!({ "ok": false, "error": "No pending session" });
    };
    apply_cookie_session(
        app,
        state,
        session.cookie_value,
        session.user_id,
        session.username.clone(),
        session.username,
    );
    json!({ "ok": true })
}

