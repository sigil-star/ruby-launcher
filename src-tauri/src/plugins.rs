//! Plugin storage for Ruby.
//!
//! A plugin is a folder under `data_dir/plugins/<id>/` with a `plugin.json` manifest and a
//! JavaScript entry file. Ruby only reads these files and hands the enabled ones' code to the
//! frontend plugin host (see `src/lib/plugins.ts`); it never executes them itself. Plugins are
//! off until the user turns them on, and the set of enabled ids lives in `plugins/enabled.json`.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    id: String,
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_entry")]
    entry: String,
}

fn default_entry() -> String {
    "index.js".into()
}

fn plugins_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("plugins")
}

fn enabled_path(state: &AppState) -> PathBuf {
    plugins_dir(state).join("enabled.json")
}

fn read_enabled(state: &AppState) -> Vec<String> {
    std::fs::read_to_string(enabled_path(state)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_enabled(state: &AppState, ids: &[String]) {
    let _ = std::fs::create_dir_all(plugins_dir(state));
    let _ = std::fs::write(enabled_path(state), serde_json::to_string(ids).unwrap_or_default());
}

/// A plugin id is a safe folder name: lowercase letters, digits, dot and dash only.
fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.') && !id.contains("..")
}

fn load_manifest(dir: &Path) -> Option<Manifest> {
    let raw = std::fs::read_to_string(dir.join("plugin.json")).ok()?;
    let m: Manifest = serde_json::from_str(&raw).ok()?;
    if !safe_id(&m.id) || m.name.trim().is_empty() {
        return None;
    }
    // The entry must stay inside the plugin folder.
    if m.entry.contains("..") || m.entry.starts_with('/') || m.entry.contains('\\') {
        return None;
    }
    Some(m)
}

/// Every installed plugin, each with its manifest, whether it's enabled, and (when enabled) its
/// JavaScript source so the frontend host can run it. Disabled plugins ship no code.
pub fn list(state: &Arc<AppState>) -> Value {
    let dir = plugins_dir(state);
    let _ = std::fs::create_dir_all(&dir);
    let enabled = read_enabled(state);
    let mut out = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten().filter(|e| e.path().is_dir()) {
            let Some(m) = load_manifest(&e.path()) else { continue };
            let on = enabled.contains(&m.id);
            let code = if on { std::fs::read_to_string(e.path().join(&m.entry)).ok() } else { None };
            // A plugin whose entry file is missing can't be run.
            if on && code.is_none() {
                continue;
            }
            out.push(json!({
                "id": m.id,
                "name": m.name,
                "version": m.version,
                "author": m.author,
                "description": m.description,
                "enabled": on,
                "code": code,
            }));
        }
    }
    json!({ "plugins": out, "dir": dir.to_string_lossy() })
}

pub fn set_enabled(state: &Arc<AppState>, id: &str, on: bool) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("bad plugin id".into());
    }
    let mut ids = read_enabled(state);
    ids.retain(|x| x != id);
    if on {
        // Only enable something that actually exists and parses.
        if load_manifest(&plugins_dir(state).join(id)).is_none() {
            return Err("plugin not found".into());
        }
        ids.push(id.to_string());
    }
    write_enabled(state, &ids);
    Ok(list(state))
}

pub fn remove(state: &Arc<AppState>, id: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("bad plugin id".into());
    }
    let dir = plugins_dir(state).join(id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let ids: Vec<String> = read_enabled(state).into_iter().filter(|x| x != id).collect();
    write_enabled(state, &ids);
    Ok(list(state))
}

/// Install a plugin from a folder the user picked (copies its files into the plugins folder).
/// The folder must hold a valid `plugin.json`. The plugin is installed disabled.
pub fn install_from_dir(state: &Arc<AppState>, src: &str) -> Result<Value, String> {
    let src = PathBuf::from(src);
    let m = load_manifest(&src).ok_or("that folder has no valid plugin.json")?;
    let dest = plugins_dir(state).join(&m.id);
    let _ = std::fs::create_dir_all(&dest);
    copy_shallow(&src, &dest, 0)?;
    // New installs start disabled; the user turns them on after reviewing.
    Ok(list(state))
}

/// Copy a plugin's files, staying within a small, flat tree (no huge or deep payloads).
fn copy_shallow(src: &Path, dest: &Path, depth: u8) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }
    for e in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        let name = e.file_name();
        let to = dest.join(&name);
        if p.is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            copy_shallow(&p, &to, depth + 1)?;
        } else {
            // Skip anything implausibly large for a plugin (10 MB cap per file).
            if std::fs::metadata(&p).map(|md| md.len() > 10 * 1024 * 1024).unwrap_or(true) {
                continue;
            }
            let _ = std::fs::copy(&p, &to);
        }
    }
    Ok(())
}

pub fn open_folder(state: &Arc<AppState>) -> Result<Value, String> {
    let dir = plugins_dir(state);
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    }
    Ok(json!({ "ok": true, "dir": dir.to_string_lossy() }))
}
