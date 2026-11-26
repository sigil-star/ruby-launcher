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
    /// Optional icon file in the plugin folder (png, svg or webp, up to 256 KB).
    #[serde(default)]
    icon: String,
}

fn default_entry() -> String {
    "index.js".into()
}

/// Marker Ruby writes next to a plugin installed from the signed featured list.
const SOURCE_FILE: &str = ".ruby-source.json";

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

const MAX_ICON: u64 = 256 * 1024;

fn icon_mime(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".svg") {
        Some("image/svg+xml")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
    } else {
        None
    }
}

/// A plugin's icon as a data: URL (shown in <img>, where SVG scripts never run).
fn icon_data_url(dir: &Path, icon: &str) -> Option<String> {
    if icon.is_empty() || !entry_ok(icon) {
        return None;
    }
    let mime = icon_mime(icon)?;
    let p = dir.join(icon);
    if std::fs::metadata(&p).ok()?.len() > MAX_ICON {
        return None;
    }
    let bytes = std::fs::read(&p).ok()?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
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
                "icon": icon_data_url(&e.path(), &m.icon),
                "source": if source_of(state, &m.id).is_some_and(|s| s["source"] == "featured") { "featured" } else { "local" },
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
    let id = write_plugin(state, &items)?;
    // A plugin installed by hand is not the reviewed version, even if it shares an id.
    let _ = std::fs::remove_file(plugins_dir(state).join(&id).join(SOURCE_FILE));
    Ok(list(state))
}

/// Validate a set of plugin files and write them to `plugins/<id>/` (replacing any older copy).
/// Returns the plugin id. Shared by hand installs and verified featured installs.
fn write_plugin(state: &AppState, items: &[(String, Vec<u8>)]) -> Result<String, String> {
    if items.is_empty() || items.len() > 200 {
        return Err("a plugin needs between 1 and 200 files".into());
    }
    // A zip often wraps everything in one top folder; drop a shared leading segment.
    let strip = common_prefix(items);
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
    // Start clean so files removed in a new version don't linger.
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for (p, bytes) in items {
        let rel = p.replace('\\', "/");
        let rel = rel.trim_start_matches(&strip as &str).trim_start_matches('/');
        let Some(safe) = safe_rel(rel) else { continue };
        if safe == SOURCE_FILE {
            continue; // only Ruby writes the reviewed-source marker
        }
        let to = dest.join(&safe);
        if let Some(d) = to.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        std::fs::write(&to, bytes).map_err(|e| e.to_string())?;
    }
    if !dest.join(&m.entry).is_file() {
        let _ = std::fs::remove_dir_all(&dest);
        return Err("the plugin's entry file is missing".into());
    }
    Ok(m.id)
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

// ---------------------------------------------------------------------------------------------
// Featured plugins: a list Ruby trusts because it is signed with Ruby's release key.
//
// The list lives at dsk.wtf/ruby/plugins.json as `{ payload, signature }`, where `signature`
// signs "ruby-plugins\n" + payload. Every file in it points at a reviewed plugin in the
// sigil-star/ruby-plugins repo, pinned to an exact commit, with its SHA-256 and size. Ruby
// downloads each file, checks size and hash, and only then installs. A tampered list, a moved
// file or a changed byte is refused.
// ---------------------------------------------------------------------------------------------

const REGISTRY_URL: &str = "https://dsk.wtf/ruby/plugins.json";
const REPO_RAW: &str = "https://raw.githubusercontent.com/sigil-star/ruby-plugins/";
const MAX_FILE: u64 = 10 * 1024 * 1024;

#[derive(Deserialize)]
struct SignedRegistry {
    payload: String,
    signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegFile {
    path: String,
    url: String,
    sha256: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegEntry {
    id: String,
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    featured: bool,
    #[serde(default)]
    icon: String,
    files: Vec<RegFile>,
}

#[derive(Debug, Deserialize)]
struct Registry {
    commit: String,
    plugins: Vec<RegEntry>,
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn registry_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("RubyLauncher")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            let ok = a.url().scheme() == "https" && matches!(a.url().host_str(), Some("dsk.wtf") | Some("raw.githubusercontent.com"));
            if a.previous().len() > 3 || !ok { a.stop() } else { a.follow() }
        }))
        .build()
        .map_err(|e| e.to_string())
}

/// An entry is only usable if every file sits in its own reviewed folder at the pinned commit.
fn entry_valid(e: &RegEntry, commit: &str) -> bool {
    safe_id(&e.id)
        && !e.name.trim().is_empty()
        && !e.files.is_empty()
        && e.files.len() <= 200
        && e.files.iter().any(|f| f.path == "plugin.json")
        && (e.icon.is_empty() || (icon_mime(&e.icon).is_some() && e.files.iter().any(|f| f.path == e.icon && f.size <= MAX_ICON)))
        && e.files.iter().all(|f| {
            safe_rel(&f.path).as_deref() == Some(f.path.as_str())
                && is_hex(&f.sha256, 64)
                && f.size <= MAX_FILE
                && f.url == format!("{REPO_RAW}{commit}/plugins/{}/{}", e.id, f.path)
        })
}

async fn fetch_registry() -> Result<Registry, String> {
    let signed: SignedRegistry = registry_client()?
        .get(REGISTRY_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|_| "The plugin list couldn't be read.".to_string())?;
    crate::updates::verify_signed(&format!("ruby-plugins\n{}", signed.payload), &signed.signature)
        .map_err(|_| "The plugin list's signature doesn't match, so Ruby won't use it.".to_string())?;
    let mut reg: Registry = serde_json::from_str(&signed.payload).map_err(|_| "The plugin list isn't valid.".to_string())?;
    if !is_hex(&reg.commit, 40) {
        return Err("The plugin list isn't pinned to a commit.".into());
    }
    let commit = reg.commit.clone();
    reg.plugins.retain(|e| entry_valid(e, &commit));
    Ok(reg)
}

fn source_of(state: &AppState, id: &str) -> Option<Value> {
    std::fs::read_to_string(plugins_dir(state).join(id).join(SOURCE_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// Verified featured icons, by URL (they're pinned to a commit, so they never change).
static ICONS: once_cell::sync::Lazy<parking_lot::Mutex<std::collections::HashMap<String, String>>> = once_cell::sync::Lazy::new(Default::default);

/// Download a featured plugin's icon, check its size and SHA-256 against the signed list, and
/// return it as a data: URL the page can show without loading anything itself.
async fn featured_icon(client: &reqwest::Client, f: &RegFile) -> Option<String> {
    if let Some(hit) = ICONS.lock().get(&f.url).cloned() {
        return Some(hit);
    }
    let mime = icon_mime(&f.path)?;
    if f.size > MAX_ICON {
        return None;
    }
    let bytes = client.get(&f.url).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
    if bytes.len() as u64 != f.size {
        return None;
    }
    use sha2::{Digest, Sha256};
    if !format!("{:x}", Sha256::digest(&bytes)).eq_ignore_ascii_case(&f.sha256) {
        return None;
    }
    let url = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
    ICONS.lock().insert(f.url.clone(), url.clone());
    Some(url)
}

/// The signed featured list, each entry marked with what's installed here.
pub async fn registry(state: &Arc<AppState>) -> Value {
    match fetch_registry().await {
        Ok(reg) => {
            let client = registry_client().ok();
            // Icons are small and cached after the first fetch, so one at a time is fine.
            let mut icons: Vec<Option<String>> = Vec::with_capacity(reg.plugins.len());
            for e in &reg.plugins {
                let file = e.files.iter().find(|f| !e.icon.is_empty() && f.path == e.icon);
                icons.push(match (&client, file) {
                    (Some(c), Some(f)) => featured_icon(c, f).await,
                    _ => None,
                });
            }
            let plugins: Vec<Value> = reg
                .plugins
                .iter()
                .zip(icons)
                .map(|(e, icon)| {
                    let local = load_manifest(&plugins_dir(state).join(&e.id));
                    let reviewed = source_of(state, &e.id).is_some_and(|s| s["source"] == "featured");
                    json!({
                        "id": e.id,
                        "name": e.name,
                        "version": e.version,
                        "author": e.author,
                        "description": e.description,
                        "featured": e.featured,
                        "iconUrl": icon,
                        "installed": local.is_some(),
                        "installedVersion": local.map(|m| m.version),
                        "installedReviewed": reviewed,
                    })
                })
                .collect();
            json!({ "plugins": plugins })
        }
        Err(e) => json!({ "plugins": [], "error": e }),
    }
}

/// Install (or update) a featured plugin: download every file, check its size and SHA-256 against
/// the signed list, and only then write it. Installed disabled, like any plugin.
pub async fn install_featured(state: &Arc<AppState>, id: &str) -> Result<Value, String> {
    if !safe_id(id) {
        return Err("bad plugin id".into());
    }
    let reg = fetch_registry().await?;
    let entry = reg.plugins.iter().find(|e| e.id == id).ok_or("That plugin isn't in the featured list.")?;
    let client = registry_client()?;
    let mut items: Vec<(String, Vec<u8>)> = vec![];
    for f in &entry.files {
        let mut res = client.get(&f.url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
        let mut bytes: Vec<u8> = vec![];
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            bytes.extend_from_slice(&chunk);
            if bytes.len() as u64 > f.size {
                return Err(format!("{} is bigger than the list says. Not installed.", f.path));
            }
        }
        if bytes.len() as u64 != f.size {
            return Err(format!("{} isn't the size the list says. Not installed.", f.path));
        }
        use sha2::{Digest, Sha256};
        let got = format!("{:x}", Sha256::digest(&bytes));
        if !got.eq_ignore_ascii_case(&f.sha256) {
            return Err(format!("{} doesn't match its reviewed hash. Not installed.", f.path));
        }
        items.push((f.path.clone(), bytes));
    }
    let written = write_plugin(state, &items)?;
    if written != entry.id {
        let _ = std::fs::remove_dir_all(plugins_dir(state).join(&written));
        return Err("The plugin's files don't match its listing. Not installed.".into());
    }
    let marker = json!({ "source": "featured", "version": entry.version, "commit": reg.commit });
    let _ = std::fs::write(plugins_dir(state).join(&entry.id).join(SOURCE_FILE), marker.to_string());
    Ok(list(state))
}

#[cfg(test)]
mod tests {
    use super::{entry_ok, safe_id, safe_rel};

    /// Live check against dsk.wtf: fetch the signed featured list, verify it, and install the
    /// first plugin into a throwaway folder. Run with: cargo test --release live_registry -- --ignored
    #[test]
    #[ignore]
    fn live_registry() {
        let dir = std::env::temp_dir().join(format!("ruby-plugin-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = crate::state::AppState::new(dir.clone());
        tauri::async_runtime::block_on(async {
            let reg = super::fetch_registry().await.expect("registry");
            assert!(!reg.plugins.is_empty(), "no plugins listed");
            let id = reg.plugins[0].id.clone();
            super::install_featured(&state, &id).await.expect("install");
            let listed = super::list(&state);
            let p = listed["plugins"].as_array().unwrap().iter().find(|p| p["id"] == id.as_str()).expect("installed").clone();
            assert_eq!(p["source"], "featured");
            assert_eq!(p["enabled"], false, "featured installs must start disabled");
            println!("installed {id} from the signed list: {p}");
        });
        let _ = std::fs::remove_dir_all(&dir);
    }

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
