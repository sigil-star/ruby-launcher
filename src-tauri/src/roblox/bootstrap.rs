//! Ruby's own Roblox bootstrapper + client info.
//!
//! When Roblox ships an update, the current version isn't installed yet. Launching an older
//! RobloxPlayerBeta makes it hand off to Roblox's own installer (that's the installer window
//! users saw, and the installer then launches the game itself so Ruby loses track of it).
//! Instead, Ruby installs the current version the same way Bloxstrap/weblauncher do: read the
//! package manifest from setup.rbxcdn.com and unpack the zips into Roblox's Versions folder.

use crate::state::AppState;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const SETUP: &str = "https://setup.rbxcdn.com";

/// Where each player package unpacks (same layout Roblox's installer produces).
fn package_dir(name: &str) -> &'static str {
    match name {
        "RobloxApp.zip" | "redist.zip" | "WebView2.zip" => "",
        "shaders.zip" => "shaders/",
        "ssl.zip" => "ssl/",
        "WebView2RuntimeInstaller.zip" => "WebView2RuntimeInstaller/",
        "content-avatar.zip" => "content/avatar/",
        "content-configs.zip" => "content/configs/",
        "content-fonts.zip" => "content/fonts/",
        "content-sky.zip" => "content/sky/",
        "content-sounds.zip" => "content/sounds/",
        "content-textures2.zip" => "content/textures/",
        "content-models.zip" => "content/models/",
        "content-textures3.zip" => "PlatformContent/pc/textures/",
        "content-terrain.zip" => "PlatformContent/pc/terrain/",
        "content-platform-fonts.zip" => "PlatformContent/pc/fonts/",
        "content-platform-dictionaries.zip" => "PlatformContent/pc/shared_compression_dictionaries/",
        "extracontent-luapackages.zip" => "ExtraContent/LuaPackages/",
        "extracontent-translations.zip" => "ExtraContent/translations/",
        "extracontent-models.zip" => "ExtraContent/models/",
        "extracontent-textures.zip" => "ExtraContent/textures/",
        "extracontent-places.zip" => "ExtraContent/places/",
        _ => "",
    }
}

const APP_SETTINGS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<Settings>\r\n\t<ContentFolder>content</ContentFolder>\r\n\t<BaseUrl>http://www.roblox.com</BaseUrl>\r\n</Settings>\r\n";

pub fn versions_dir() -> Option<PathBuf> {
    Some(dirs::data_local_dir()?.join("Roblox").join("Versions"))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("RubyLauncher")
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .unwrap_or_default()
}

/// The rollout channel the signed-in account is on ("" = the public LIVE channel).
pub static USER_CHANNEL: once_cell::sync::Lazy<parking_lot::Mutex<String>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(String::new()));

pub static CHANNEL_CHECKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Make sure USER_CHANNEL is known before building a launch link.
pub async fn ensure_channel(state: &Arc<AppState>) {
    if !CHANNEL_CHECKED.load(std::sync::atomic::Ordering::SeqCst) {
        let _ = current_version(state, "WindowsPlayer").await;
    }
}

/// The version Roblox ships *to this account* for a binary ("WindowsPlayer" / "WindowsStudio64").
///
/// Roblox rolls builds out per channel. If we start the public "LIVE" build while the account
/// is on a newer rollout, the client decides it is out of date and runs RobloxPlayerInstaller,
/// so ask which channel the signed-in user is on first, like the official bootstrapper does.
pub async fn current_version(state: &Arc<AppState>, binary: &str) -> Option<(String, String)> {
    let parse = |v: &Value| -> Option<(String, String)> {
        let guid = v.get("clientVersionUpload")?.as_str().filter(|g| g.starts_with("version-"))?.to_string();
        let ver = v.get("version").and_then(|x| x.as_str()).unwrap_or("").to_string();
        Some((guid, ver))
    };
    let authed = |url: String| async move {
        crate::roblox::http::fetch_roblox_api(state, &url, None).await.ok().and_then(|r| r.get("data").cloned())
    };
    if let Some(ch) = authed(format!("https://clientsettings.roblox.com/v2/user-channel?binaryType={binary}")).await {
        let name = ch.get("channelName").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        let custom = !name.is_empty() && !name.eq_ignore_ascii_case("live") && !name.eq_ignore_ascii_case("production");
        if binary == "WindowsPlayer" {
            *USER_CHANNEL.lock() = if custom { name.clone() } else { String::new() };
            CHANNEL_CHECKED.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        if custom {
            if let Some(v) = authed(format!("https://clientsettings.roblox.com/v2/client-version/{binary}/channel/{name}")).await.as_ref().and_then(parse) {
                tracing::info!("{binary}: channel {name} -> {}", v.0);
                return Some(v);
            }
        }
    }
    if let Some(v) = authed(format!("https://clientsettings.roblox.com/v2/client-version/{binary}")).await.as_ref().and_then(parse) {
        return Some(v);
    }
    let v: Value = client().get(format!("https://clientsettings.roblox.com/v2/client-version/{binary}")).send().await.ok()?.json().await.ok()?;
    parse(&v)
}

fn installed(exe: &str) -> Vec<Value> {
    let Some(dir) = versions_dir() else { return vec![] };
    let mut out = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path().join(exe);
            if p.is_file() {
                let modified = e
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                out.push(json!({ "guid": e.file_name().to_string_lossy(), "path": p.to_string_lossy(), "modified": modified }));
            }
        }
    }
    out.sort_by_key(|v| std::cmp::Reverse(v.get("modified").and_then(|m| m.as_u64()).unwrap_or(0)));
    out
}

pub fn player_exe_for(guid: &str) -> Option<PathBuf> {
    let p = versions_dir()?.join(guid).join("RobloxPlayerBeta.exe");
    p.is_file().then_some(p)
}

fn emit(app: &AppHandle, stage: &str, done: u64, total: u64, detail: &str) {
    let _ = app.emit("roblox-install-progress", json!({ "stage": stage, "done": done, "total": total, "detail": detail }));
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        // Roblox zips use backslashes; never write outside the version folder.
        let rel = f.name().map_err(|e| e.to_string())?.replace('\\', "/");
        if rel.starts_with('/') || rel.contains(':') || rel.split('/').any(|seg| seg == "..") {
            continue;
        }
        let out = dest.join(&rel);
        if f.is_dir() || rel.ends_with('/') {
            let _ = std::fs::create_dir_all(&out);
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

static INSTALLING: once_cell::sync::Lazy<tokio::sync::Mutex<()>> = once_cell::sync::Lazy::new(|| tokio::sync::Mutex::new(()));

/// Installs Roblox `guid` (player) into the Versions folder. Downloads into a temp folder and
/// renames at the end, so a half-finished install is never launched.
pub async fn install_player(app: &AppHandle, guid: &str) -> Result<PathBuf, String> {
    let _lock = INSTALLING.lock().await;
    if let Some(p) = player_exe_for(guid) {
        return Ok(p);
    }
    let versions = versions_dir().ok_or("no LocalAppData")?;
    let http = client();
    emit(app, "manifest", 0, 0, guid);
    let manifest = http
        .get(format!("{SETUP}/{guid}-rbxPkgManifest.txt"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    // Format: "v0", then 4 lines per package: name, md5, packed size, unpacked size.
    let lines: Vec<&str> = manifest.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    let mut packages: Vec<(String, u64)> = vec![];
    let mut i = 1;
    while i < lines.len() {
        let name = lines[i].to_string();
        let size = lines.get(i + 2).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        if name.ends_with(".zip") {
            packages.push((name, size));
        }
        i += 4;
    }
    if packages.is_empty() {
        return Err("Roblox's package manifest was empty".into());
    }
    let total: u64 = packages.iter().map(|(_, s)| *s).sum::<u64>().max(1);
    let staging = versions.join(format!("{guid}.ruby-tmp"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let mut done: u64 = 0;
    for (name, size) in &packages {
        emit(app, "download", done, total, name);
        let bytes = http
            .get(format!("{SETUP}/{guid}-{name}"))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        let dest = staging.join(package_dir(name));
        let bytes = bytes.to_vec();
        tokio::task::spawn_blocking(move || extract_zip(&bytes, &dest))
            .await
            .map_err(|e| e.to_string())??;
        done += size;
        emit(app, "download", done, total, name);
    }
    std::fs::write(staging.join("AppSettings.xml"), APP_SETTINGS).map_err(|e| e.to_string())?;
    let final_dir = versions.join(guid);
    let _ = std::fs::remove_dir_all(&final_dir);
    std::fs::rename(&staging, &final_dir).map_err(|e| e.to_string())?;
    emit(app, "done", total, total, guid);
    player_exe_for(guid).ok_or_else(|| "install finished but RobloxPlayerBeta.exe is missing".into())
}

fn source_file(state: &AppState) -> PathBuf {
    state.data_dir.join("client-source.json")
}

pub fn client_source(state: &AppState) -> Value {
    std::fs::read_to_string(source_file(state))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({ "source": "roblox" }))
}

/// A Roblox version hash like `version-0123456789abcdef`.
pub fn valid_version(guid: &str) -> bool {
    guid.len() == 24 && guid.starts_with("version-") && guid[8..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn set_client_source(state: &AppState, source: &str) -> Result<Value, String> {
    // "roblox" (latest), "weblauncher" (its pinned build), or "version:<hash>" (a specific build).
    let ok = source == "roblox" || source == "weblauncher" || source.strip_prefix("version:").map(valid_version).unwrap_or(false);
    if !ok {
        return Err("That isn't a valid Roblox version (it looks like version-0123456789abcdef).".into());
    }
    let v = json!({ "source": source });
    std::fs::write(source_file(state), v.to_string()).map_err(|e| e.to_string())?;
    Ok(v)
}

/// weblauncher (github.com/vnnaworks/weblauncher) keeps its own pinned Roblox build — synced to
/// an executor's supported version — under %APPDATA%\weblauncher\core.
pub fn weblauncher_info() -> Value {
    let Some(base) = dirs::config_dir().map(|d| d.join("weblauncher").join("core")) else {
        return json!({ "found": false });
    };
    let cfg: Option<Value> = std::fs::read_to_string(base.join("configuration.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
    let Some(cfg) = cfg else { return json!({ "found": false }) };
    let c = cfg.get("client").cloned().unwrap_or(json!({}));
    let hash = c.get("bootstrapper_hash").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let custom_dir = c.get("versions_dir").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(PathBuf::from);
    let dir = custom_dir.unwrap_or_else(|| base.join("roblox"));
    let exe = dir.join(&hash).join("RobloxPlayerBeta.exe");
    json!({
        "found": true,
        "appVersion": cfg.pointer("/app/installed_version"),
        "exploitSync": c.get("exploit_sync"),
        "channel": c.get("bootstrapper_channel"),
        "pinnedVersion": hash,
        "playerPath": exe.is_file().then(|| exe.to_string_lossy().to_string()),
        "multiInstance": cfg.pointer("/launch/multi_instance"),
    })
}

pub fn weblauncher_player() -> Option<PathBuf> {
    weblauncher_info().get("playerPath").and_then(|v| v.as_str()).map(PathBuf::from).filter(|p| p.is_file())
}

/// Everything the Roblox tab shows.
pub async fn client_info(state: &Arc<AppState>) -> Value {
    let (player, studio) = tokio::join!(current_version(state, "WindowsPlayer"), current_version(state, "WindowsStudio64"));
    let players = installed("RobloxPlayerBeta.exe");
    let studios = installed("RobloxStudioBeta.exe");
    let has = |list: &Vec<Value>, guid: &Option<(String, String)>| {
        guid.as_ref().map(|(g, _)| list.iter().any(|v| v.get("guid").and_then(|x| x.as_str()) == Some(g.as_str()))).unwrap_or(false)
    };
    json!({
        "player": {
            "current": player.as_ref().map(|(g, v)| json!({ "guid": g, "version": v })),
            "upToDate": has(&players, &player),
            "installed": players,
        },
        "studio": {
            "current": studio.as_ref().map(|(g, v)| json!({ "guid": g, "version": v })),
            "upToDate": has(&studios, &studio),
            "installed": studios,
        },
        "weblauncher": weblauncher_info(),
        "source": client_source(state).get("source").cloned().unwrap_or(json!("roblox")),
        "versionsDir": versions_dir().map(|p| p.to_string_lossy().to_string()),
    })
}
