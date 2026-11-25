//! Plugin storage for Ruby.
//!
//! A plugin is a folder under `data_dir/plugins/<id>/` with a `plugin.json` manifest and a
//! JavaScript entry file. Ruby only reads these files and hands the enabled ones' code to the
//! frontend plugin host (see `src/lib/plugins.ts`); it never executes them itself. Plugins are
//! off until the user turns them on, and the set of enabled ids lives in `plugins/enabled.json`.

use base64::Engine;
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
    if !entry_ok(&m.entry) {
        return None;
    }
    Some(m)
}

/// The entry must be a relative path staying inside the plugin folder. Reject anything that could
/// escape it or point at an absolute path (including Windows "C:\\..." / "C:/...").
fn entry_ok(entry: &str) -> bool {
    !entry.is_empty()
        && !entry.contains("..")
        && !entry.starts_with('/')
        && !entry.contains('\\')
        && !entry.contains(':')
        && !std::path::Path::new(entry).is_absolute()
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

/// A relative path inside a plugin that is safe to write (no escape, no absolute, shallow).
fn safe_rel(rel: &str) -> Option<String> {
    let p = rel.replace('\\', "/");
    let p = p.trim_start_matches("./");
    if p.is_empty() || p.starts_with('/') || p.contains("..") || p.contains(':') {
        return None;
    }
    if p.split('/').count() > 6 || p.len() > 256 {
        return None;
    }
    Some(p.to_string())
}

/// Install a plugin from files the user picked in Ruby (a folder, or a single `.zip`). `files` is
/// a JSON array of `[relativePath, base64Bytes]`. The set must contain a valid `plugin.json`.
/// Everything is written under `plugins/<id>/`, the plugin stays disabled until the user turns it
/// on, and paths that try to escape the folder are rejected.
pub fn install_files(state: &Arc<AppState>, files: Value) -> Result<Value, String> {
    let arr = files.as_array().ok_or("no files")?;
    // Gather (relpath, bytes). A lone .zip is unpacked first.
    let mut items: Vec<(String, Vec<u8>)> = vec![];
    for row in arr {
        let rel = row.get(0).and_then(|v| v.as_str()).unwrap_or("");
        let b64 = row.get(1).and_then(|v| v.as_str()).unwrap_or("");
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| "bad file data")?;
        if bytes.len() > 10 * 1024 * 1024 {
            return Err("a file is over 10 MB".into());
        }
        if rel.to_ascii_lowercase().ends_with(".zip") {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("not a valid zip: {e}"))?;
            for i in 0..zip.len() {
                let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
                if !f.is_file() {
                    continue;
                }
                // enclosed_name already rejects absolute paths and `..` escapes.
                let Some(name) = f.enclosed_name().map(|p| p.to_string_lossy().replace('\\', "/")) else { continue };
                let mut buf = Vec::new();
                std::io::Read::read_to_end(&mut f, &mut buf).map_err(|e| e.to_string())?;
                if buf.len() > 10 * 1024 * 1024 {
                    return Err("a file in the zip is over 10 MB".into());
                }
                items.push((name, buf));
            }
        } else {
            items.push((rel.to_string(), bytes));
        }
    }
    if items.len() > 200 {
        return Err("too many files for one plugin".into());
    }
    // A zip often wraps everything in one top folder; drop a shared leading segment.
    let strip = common_prefix(&items);
    // Find and validate the manifest.
    let manifest_raw = items
        .iter()
        .find(|(p, _)| p.replace('\\', "/").trim_start_matches(&strip as &str).trim_start_matches('/') == "plugin.json")
        .map(|(_, b)| b.clone())
        .ok_or("no plugin.json in what you picked")?;
    let m: Manifest = serde_json::from_slice(&manifest_raw).map_err(|_| "plugin.json isn't valid")?;
    if !safe_id(&m.id) || m.name.trim().is_empty() || !entry_ok(&m.entry) {
        return Err("plugin.json needs a valid id, name and entry".into());
    }
    let dest = plugins_dir(state).join(&m.id);
    let _ = std::fs::create_dir_all(&dest);
    for (p, bytes) in &items {
        let rel = p.replace('\\', "/");
        let rel = rel.trim_start_matches(&strip as &str).trim_start_matches('/');
        let Some(safe) = safe_rel(rel) else { continue };
        let to = dest.join(&safe);
        if let Some(d) = to.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(&to, bytes);
    }
    // Make sure the entry file exists after writing.
    if !dest.join(&m.entry).is_file() {
        let _ = std::fs::remove_dir_all(&dest);
        return Err("the plugin's entry file is missing".into());
    }
    Ok(list(state))
}

/// If every path shares a first folder segment (as zips often do), return it (with trailing /).
fn common_prefix(items: &[(String, Vec<u8>)]) -> String {
    let first = items.first().map(|(p, _)| p.replace('\\', "/"));
    let Some(first) = first else { return String::new() };
    let Some((seg, _)) = first.split_once('/') else { return String::new() };
    let prefix = format!("{seg}/");
    if items.iter().all(|(p, _)| p.replace('\\', "/").starts_with(&prefix)) {
        prefix
    } else {
        String::new()
    }
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

#[cfg(test)]
mod tests {
    use super::{entry_ok, safe_id, safe_rel};

    #[test]
    fn ids() {
        assert!(safe_id("hello-ruby"));
        assert!(safe_id("a.b-2"));
        assert!(!safe_id("")); // empty
        assert!(!safe_id("Hello")); // uppercase
        assert!(!safe_id("../escape"));
        assert!(!safe_id("a/b")); // slash
        assert!(!safe_id("a b")); // space
    }

    #[test]
    fn entries() {
        assert!(entry_ok("index.js"));
        assert!(entry_ok("src/main.js"));
        assert!(!entry_ok("")); // empty
        assert!(!entry_ok("../index.js")); // escape
        assert!(!entry_ok("/etc/passwd")); // absolute unix
        assert!(!entry_ok("C:/Windows/x.js")); // absolute windows (colon)
        assert!(!entry_ok("sub\\x.js")); // backslash
    }

    #[test]
    fn rel_paths() {
        assert_eq!(safe_rel("index.js").as_deref(), Some("index.js"));
        assert_eq!(safe_rel("./a/b.js").as_deref(), Some("a/b.js"));
        assert!(safe_rel("../escape.js").is_none());
        assert!(safe_rel("/abs.js").is_none());
        assert!(safe_rel("C:/x.js").is_none()); // colon
        assert!(safe_rel("a/../../b").is_none());
        assert!(safe_rel(&"x/".repeat(8)).is_none()); // too deep
    }
}
