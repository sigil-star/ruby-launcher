//! Web launches: Ruby registers itself as the `roblox-player:` handler, so "Play" on roblox.com
//! goes through Ruby (mods applied, session tracked, overlay ready) and then on to Roblox.
//! The previous handler is saved so it can be put back.

use crate::state::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

const KEY: &str = r"HKCU\Software\Classes\roblox-player";
const CMD_KEY: &str = r"HKCU\Software\Classes\roblox-player\shell\open\command";

static STARTUP_URI: Mutex<Option<String>> = Mutex::new(None);

/// Whether Ruby should own web launches (on unless the user turned it off).
pub fn enabled(state: &AppState) -> bool {
    state.behavior.read().extra.get("handleWebLaunches").and_then(Value::as_bool).unwrap_or(true)
}

/// A `roblox-player:` URI from a command line (`--protocol <uri>` or the bare URI).
pub fn uri_arg<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let i = args.iter().position(|a| a.as_ref() == "--protocol");
    let cand = match i {
        Some(i) => args.get(i + 1).map(|a| a.as_ref().to_string()),
        None => args.iter().map(|a| a.as_ref().to_string()).find(|a| a.to_ascii_lowercase().starts_with("roblox-player:")),
    }?;
    sanitize(&cand)
}

/// Only well-formed launch URIs pass: right scheme, bounded size, no characters that could
/// break out of an argument or carry anything but the URI's own encoded fields.
fn sanitize(uri: &str) -> Option<String> {
    let u = uri.trim();
    if u.len() > 8192 || !u.to_ascii_lowercase().starts_with("roblox-player:") {
        return None;
    }
    let ok = u.chars().all(|c| c.is_ascii_alphanumeric() || "-_.~:+%=&/?,;!*@$#".contains(c));
    ok.then(|| u.to_string())
}

pub fn remember_startup_uri() {
    let args: Vec<String> = std::env::args().collect();
    *STARTUP_URI.lock().unwrap() = uri_arg(&args);
}

pub fn take_startup_uri() -> Option<String> {
    STARTUP_URI.lock().unwrap().take()
}

/// Place id carried in the URI (placelauncherurl is percent-encoded), when present.
pub fn place_of(uri: &str) -> Option<u64> {
    let decoded = uri.replace("%3D", "=").replace("%3d", "=").replace("%26", "&");
    let low = decoded.to_ascii_lowercase();
    let i = low.find("placeid=")? + "placeid=".len();
    let digits: String = low[i..].chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(windows)]
fn reg(args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(args);
    crate::win_process::hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

#[cfg(windows)]
fn current_command() -> Option<String> {
    let out = reg(&["query", CMD_KEY, "/ve"])?;
    let line = out.lines().find(|l| l.contains("REG_SZ"))?;
    Some(line.split("REG_SZ").nth(1)?.trim().to_string())
}

fn saved_path(state: &AppState) -> PathBuf {
    state.data_dir.join("protocol-original.txt")
}

fn our_command() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(format!("\"{}\" --protocol \"%1\"", exe.display()))
}

/// Make Ruby the handler (Roblox's installer re-registers itself on updates, so this runs
/// at every start and launch).
pub fn register(state: &AppState) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let ours = our_command().ok_or("can't find Ruby's exe")?;
        let cur = current_command();
        if cur.as_deref() == Some(ours.as_str()) {
            return Ok(json!({ "ok": true, "changed": false }));
        }
        if let Some(c) = cur.filter(|c| !c.contains("--protocol")) {
            let _ = std::fs::write(saved_path(state), c);
        }
        reg(&["add", KEY, "/ve", "/d", "URL: Roblox Protocol", "/f"]).ok_or("couldn't register")?;
        reg(&["add", KEY, "/v", "URL Protocol", "/d", "", "/f"]).ok_or("couldn't register")?;
        reg(&["add", CMD_KEY, "/ve", "/d", &ours, "/f"]).ok_or("couldn't register")?;
        tracing::info!("roblox-player: now handled by Ruby");
        Ok(json!({ "ok": true, "changed": true }))
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err("Windows-only".into())
    }
}

/// Hand web launches back to Roblox.
pub fn unregister(state: &AppState) -> Result<Value, String> {
    #[cfg(windows)]
    {
        let cur = current_command().unwrap_or_default();
        if !cur.contains("--protocol") {
            return Ok(json!({ "ok": true }));
        }
        let original = std::fs::read_to_string(saved_path(state)).ok().filter(|s| !s.trim().is_empty()).or_else(|| {
            // Fall back to the current Roblox player install.
            crate::roblox::launch::find_roblox_player().map(|p| format!("\"{}\" %1", p.display()))
        });
        match original {
            Some(o) => reg(&["add", CMD_KEY, "/ve", "/d", o.trim(), "/f"]).map(|_| json!({ "ok": true })).ok_or("couldn't restore".into()),
            None => Err("Roblox isn't installed, so there's nothing to hand launches back to.".into()),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err("Windows-only".into())
    }
}

/// Keep registration in line with the setting.
pub fn sync(state: &AppState) {
    let r = if enabled(state) { register(state) } else { unregister(state) };
    if let Err(e) = r {
        tracing::warn!("protocol sync: {e}");
    }
}

/// A web launch reached Ruby: start Roblox with the same URI (its auth ticket, private
/// server, follow, etc.), with mods applied and the session tracked.
pub async fn handle(app: &AppHandle, state: &Arc<AppState>, uri: String) {
    let Some(uri) = sanitize(&uri) else {
        tracing::warn!("ignored malformed roblox-player URI");
        return;
    };
    if let Err(e) = crate::roblox::launch::launch_uri(app, state, &uri, place_of(&uri)).await {
        tracing::warn!("web launch failed: {e}");
    }
}

/// `--restore-protocol` (run by the uninstaller): put the saved Roblox handler back and exit.
/// Works without the app's state, since Ruby isn't really starting.
pub fn restore_from_args() -> bool {
    if !std::env::args().any(|a| a == "--restore-protocol") {
        return false;
    }
    #[cfg(windows)]
    {
        let saved = dirs::data_dir().map(|d| d.join("com.rubylauncher.tauri").join("protocol-original.txt"));
        let original = saved
            .and_then(|p| std::fs::read_to_string(p).ok())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| crate::roblox::launch::find_roblox_player().map(|p| format!("\"{}\" %1", p.display())));
        let cur = current_command().unwrap_or_default();
        if cur.contains("--protocol") {
            match original {
                Some(o) => {
                    let _ = reg(&["add", CMD_KEY, "/ve", "/d", o.trim(), "/f"]);
                }
                // No Roblox install to hand back to: remove Ruby's handler entirely.
                None => {
                    let _ = reg(&["delete", KEY, "/f"]);
                }
            }
        }
        // Undo Ruby's changes to Roblox itself: modded files and graphics flags.
        if let Some(dir) = dirs::data_dir().map(|d| d.join("com.rubylauncher.tauri")).filter(|d| d.is_dir()) {
            let state = crate::state::AppState::new(dir);
            let files = crate::roblox::theme::restore_all(&state);
            crate::roblox::fflags::clear_files();
            tracing::info!("uninstall: restored {files} Roblox files and cleared Ruby's graphics flags");
        }
    }
    true
}
