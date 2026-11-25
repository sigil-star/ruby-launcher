//! Packs the user imports (zip or loose files): cursors, emote wheels, skyboxes, fonts and
//! Bloxstrap-style texture mods. Each is stored under data_dir/mods/<name>/ with its files at
//! the same relative paths they have inside a Roblox version folder, so applying one is a copy.

use crate::state::AppState;
use base64::Engine;
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

pub fn mods_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("mods")
}

pub fn inbox_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("packs-inbox")
}

const CURSOR_DIR: &str = "content/textures/Cursors/KeyboardMouse";
const WHEEL_NAMES: &[&str] = &["circlebackground", "segmentedcircle", "selectedgradient", "selectedline"];

/// A voice-chat frame name for a loose image: Roblox's own names (Muted, Unmuted0…100) or
/// mouth-style names like "MouthMute", "PikachuMouthClosed", "Mouth60".
pub fn mic_frame(file: &str) -> Option<&'static str> {
    let name = file.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    let stem = name.strip_suffix(".png")?;
    let stem = stem.split('@').next().unwrap_or(stem);
    if stem == "muted" || stem.ends_with("mute") || stem.ends_with("muted") && !stem.contains("unmuted") {
        return Some("Muted");
    }
    if stem.ends_with("closed") || stem.ends_with("mouth0") || stem.ends_with("quiet") || stem.ends_with("idle") {
        return Some("Quiet");
    }
    if stem.ends_with("talking") || stem.ends_with("talk") || stem.ends_with("open") || stem.ends_with("speaking") {
        return Some("Talking");
    }
    let digits: String = stem.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
    if (stem.starts_with("unmuted") || stem.contains("mouth")) && !digits.is_empty() {
        return match digits.as_str() {
            "0" => Some("Quiet"),
            "20" => Some("Unmuted20"),
            "40" => Some("Unmuted40"),
            "60" => Some("Unmuted60"),
            "80" => Some("Unmuted80"),
            "100" => Some("Unmuted100"),
            _ => None,
        };
    }
    None
}

/// Where a file from a pack belongs inside a Roblox version folder.
fn map_path(raw: &str) -> Option<String> {
    let p = raw.replace('\\', "/");
    if p.split('/').any(|s| s == "..") || p.starts_with('/') {
        return None;
    }
    let lower = p.to_ascii_lowercase();
    for root in ["content/", "extracontent/", "platformcontent/"] {
        if let Some(i) = lower.find(root) {
            if i == 0 || lower.as_bytes()[i - 1] == b'/' {
                return Some(p[i..].to_string());
            }
        }
    }
    let name = p.rsplit('/').next()?.to_string();
    let lname = name.to_ascii_lowercase();
    if lname == "arrowcursor.png" || lname == "arrowfarcursor.png" || lname == "ibeamcursor.png" {
        return Some(format!("{CURSOR_DIR}/{name}"));
    }
    if WHEEL_NAMES.iter().any(|w| lname.starts_with(w)) && lname.ends_with(".png") {
        return Some(format!("content/textures/ui/Emotes/Large/{name}"));
    }
    None
}

fn kind_of(rels: &[String]) -> &'static str {
    if rels.iter().all(|r| r.starts_with(CURSOR_DIR)) {
        "cursor"
    } else if rels.iter().all(|r| r.contains("ui/Emotes/")) {
        "wheel"
    } else {
        "mod"
    }
}

fn safe_name(s: &str) -> String {
    let base = s.rsplit(['/', '\\']).next().unwrap_or(s);
    let base = base.strip_suffix(".zip").unwrap_or(base);
    let cleaned: String = base.chars().map(|c| if c.is_alphanumeric() || " -_().".contains(c) { c } else { '_' }).collect();
    let t = cleaned.trim().trim_matches('.').to_string();
    if t.is_empty() { "Pack".into() } else { t.chars().take(60).collect() }
}

/// Read every file of a zip (or a single loose file) as (path, bytes).
fn entries(file_name: &str, bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    if !(bytes.starts_with(b"PK\x03\x04")) {
        return Ok(vec![(file_name.to_string(), bytes.to_vec())]);
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| format!("Not a valid zip: {e}"))?;
    let mut out = vec![];
    let mut total = 0usize;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let Some(name) = f.enclosed_name().map(|p| p.to_string_lossy().replace('\\', "/")) else { continue };
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        total += buf.len();
        if total > 1_500_000_000 {
            return Err("That pack is too big".into());
        }
        out.push((name, buf));
    }
    Ok(out)
}

/// Import a pack. Returns what it turned out to be.
pub fn import(state: &AppState, file_name: &str, bytes: &[u8]) -> Result<Value, String> {
    let files = entries(file_name, bytes)?;
    import_entries(state, &safe_name(file_name), files)
}

/// Several loose files picked together become one pack (zips inside are unpacked too).
pub fn import_files(state: &AppState, name: &str, list: Vec<(String, Vec<u8>)>) -> Result<Value, String> {
    let mut files = vec![];
    for (n, b) in list {
        files.extend(entries(&n, &b)?);
    }
    import_entries(state, &safe_name(name), files)
}

fn import_entries(state: &AppState, name: &str, files: Vec<(String, Vec<u8>)>) -> Result<Value, String> {
    let name = name.to_string();

    // Fonts: a single .ttf/.otf becomes the custom font.
    let fonts: Vec<&(String, Vec<u8>)> = files.iter().filter(|(p, _)| { let l = p.to_ascii_lowercase(); l.ends_with(".ttf") || l.ends_with(".otf") }).collect();
    let mapped: Vec<(String, &Vec<u8>)> = files.iter().filter_map(|(p, b)| map_path(p).map(|r| (r, b))).collect();
    let texes: Vec<&(String, Vec<u8>)> = files.iter().filter(|(p, _)| p.to_ascii_lowercase().ends_with(".tex")).collect();

    if !texes.is_empty() && mapped.iter().all(|(r, _)| r.contains("textures/sky")) {
        // Skybox: .tex files (+ an optional preview image) into the skybox folder.
        let dir = state.data_dir.join("skyboxes").join(&name);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        for (p, b) in &files {
            let l = p.to_ascii_lowercase();
            if l.ends_with(".tex") || l.ends_with(".png") || l.ends_with(".jpg") {
                let f = p.rsplit('/').next().unwrap_or(p);
                std::fs::write(dir.join(f), b).map_err(|e| e.to_string())?;
            }
        }
        return Ok(json!({ "kind": "skybox", "name": name, "id": dir.to_string_lossy() }));
    }
    // Mic frames (loose images named like Roblox's or "Mouth20"…), at least two of them.
    let mics: Vec<(&'static str, &Vec<u8>)> = files
        .iter()
        .filter(|(p, _)| !p.to_ascii_lowercase().contains("content/"))
        .filter_map(|(p, b)| mic_frame(p).map(|f| (f, b)))
        .collect();
    if mics.len() >= 2 {
        let dir = mods_dir(state).join(&name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("mic")).map_err(|e| e.to_string())?;
        // Several scales of one frame: keep the biggest.
        let mut best: std::collections::HashMap<&str, &Vec<u8>> = std::collections::HashMap::new();
        for (f, b) in &mics {
            if best.get(f).map(|cur| b.len() > cur.len()).unwrap_or(true) {
                best.insert(f, b);
            }
        }
        for (f, b) in &best {
            std::fs::write(dir.join("mic").join(format!("{f}.png")), b).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::write(dir.join(".ruby-pack.json"), json!({ "kind": "mic", "name": name }).to_string());
        return Ok(json!({ "kind": "mic", "name": name, "files": best.len() }));
    }
    if mapped.is_empty() && fonts.len() == 1 {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&fonts[0].1);
        crate::roblox::theme::set_custom_font(state, fonts[0].0.rsplit('/').next().unwrap_or(&name), &b64)?;
        return Ok(json!({ "kind": "font", "name": fonts[0].0.rsplit('/').next().unwrap_or(&name) }));
    }
    if mapped.is_empty() {
        return Err("Ruby didn't recognise anything in that pack. It needs Roblox texture paths (content/…), cursor or emote wheel images, .tex skybox files, or a font.".into());
    }
    let dir = mods_dir(state).join(&name);
    let _ = std::fs::remove_dir_all(&dir);
    for (rel, b) in &mapped {
        let dest = dir.join(rel);
        std::fs::create_dir_all(dest.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
        std::fs::write(dest, b).map_err(|e| e.to_string())?;
    }
    let rels: Vec<String> = mapped.iter().map(|(r, _)| r.clone()).collect();
    let kind = kind_of(&rels);
    let _ = std::fs::write(dir.join(".ruby-pack.json"), json!({ "kind": kind, "name": name }).to_string());
    Ok(json!({ "kind": kind, "name": name, "files": rels.len() }))
}

/// Mods folders of other Roblox bootstrappers (Bloxstrap and its forks) that exist on this PC.
pub fn other_bootstrappers() -> Value {
    let found: Vec<Value> = bootstrapper_dirs().into_iter().map(|(name, dir)| json!({ "name": name, "dir": dir.to_string_lossy() })).collect();
    json!({ "found": found })
}

fn bootstrapper_dirs() -> Vec<(&'static str, PathBuf)> {
    let Some(local) = dirs::data_local_dir() else { return vec![] };
    ["Bloxstrap", "Fishstrap", "Voidstrap", "Froststrap", "Lunastrap", "Plexity"]
        .into_iter()
        .map(|n| (n, local.join(n).join("Modifications")))
        .filter(|(_, d)| d.is_dir() && std::fs::read_dir(d).map(|mut r| r.next().is_some()).unwrap_or(false))
        .collect()
}

/// Copy another bootstrapper's Modifications folder in as one pack ("<name> mods").
pub fn import_bootstrapper(state: &AppState, which: &str) -> Result<Value, String> {
    let (name, dir) = bootstrapper_dirs().into_iter().find(|(n, _)| n.eq_ignore_ascii_case(which)).ok_or("Couldn't find that mods folder")?;
    let mut files = vec![];
    let mut total = 0usize;
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).map_err(|e| e.to_string())?.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let rel = p.strip_prefix(&dir).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            // Its FastFlags file isn't a texture; Ruby only applies the flags Roblox allows.
            if rel.to_ascii_lowercase().starts_with("clientsettings/") {
                continue;
            }
            let b = std::fs::read(&p).map_err(|e| e.to_string())?;
            total += b.len();
            if total > 1_500_000_000 {
                return Err("That mods folder is too big".into());
            }
            files.push((rel, b));
        }
    }
    import_entries(state, &format!("{name} mods"), files)
}

/// Zips dropped into the packs folder get imported (then moved out of the way).
pub fn import_inbox(state: &AppState) {
    let inbox = inbox_dir(state);
    let _ = std::fs::create_dir_all(&inbox);
    let Ok(list) = std::fs::read_dir(&inbox) else { return };
    for e in list.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let result = std::fs::read(&p).map_err(|e| e.to_string()).and_then(|b| import(state, &name, &b));
        let done = inbox.join(if result.is_ok() { "imported" } else { "failed" });
        let _ = std::fs::create_dir_all(&done);
        let _ = std::fs::rename(&p, done.join(&name));
        if let Err(err) = result {
            tracing::warn!(%name, %err, "pack import failed");
        }
    }
}

pub struct UserPack {
    pub name: String,
    pub kind: String,
    pub dir: PathBuf,
}

pub fn installed(state: &AppState) -> Vec<UserPack> {
    let Ok(list) = std::fs::read_dir(mods_dir(state)) else { return vec![] };
    let mut out: Vec<UserPack> = list
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let meta: Value = std::fs::read_to_string(e.path().join(".ruby-pack.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
            UserPack { name: e.file_name().to_string_lossy().to_string(), kind: meta["kind"].as_str().unwrap_or("mod").to_string(), dir: e.path() }
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Every file a pack provides, as version-relative paths.
pub fn files(pack_dir: &Path) -> Vec<String> {
    if pack_dir.join("mic").is_dir() {
        return vec![];
    }
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        let Ok(list) = std::fs::read_dir(dir) else { return };
        for e in list.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(root, &p, out);
            } else if p.file_name().map(|n| n != ".ruby-pack.json").unwrap_or(false) {
                if let Ok(r) = p.strip_prefix(root) {
                    out.push(r.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    let mut out = vec![];
    walk(pack_dir, pack_dir, &mut out);
    out
}

pub fn list(state: &AppState) -> Value {
    import_inbox(state);
    let packs: Vec<Value> = installed(state)
        .iter()
        .map(|p| {
            let preview = if p.kind == "cursor" {
                std::fs::read(p.dir.join(CURSOR_DIR).join("ArrowFarCursor.png"))
                    .or_else(|_| std::fs::read(p.dir.join(CURSOR_DIR).join("ArrowCursor.png")))
                    .ok()
                    .map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
            } else if p.kind == "wheel" {
                std::fs::read(p.dir.join("preview.png")).ok().map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
            } else {
                None
            };
            json!({ "name": p.name, "kind": p.kind, "files": files(&p.dir).len(), "preview": preview, "bundled": crate::roblox::bundled_packs::is_bundled(&p.name) })
        })
        .collect();
    json!({ "packs": packs, "inbox": inbox_dir(state).to_string_lossy() })
}

pub fn delete(state: &AppState, name: &str) -> Result<Value, String> {
    crate::roblox::bundled_packs::forget(state, &safe_name(name));
    let dir = mods_dir(state).join(safe_name(name));
    if !dir.starts_with(mods_dir(state)) || !dir.is_dir() {
        return Err("No such pack".into());
    }
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_pack_paths() {
        assert_eq!(map_path("MyMod/Modifications/content/textures/ui/TopBar/coloredlogo.png").as_deref(), Some("content/textures/ui/TopBar/coloredlogo.png"));
        assert_eq!(map_path("ArrowFarCursor.png").as_deref(), Some("content/textures/Cursors/KeyboardMouse/ArrowFarCursor.png"));
        assert_eq!(map_path("wheel/SegmentedCircle@2x.png").as_deref(), Some("content/textures/ui/Emotes/Large/SegmentedCircle@2x.png"));
        assert_eq!(map_path("PlatformContent/pc/textures/sky/sky512_bk.tex").as_deref(), Some("PlatformContent/pc/textures/sky/sky512_bk.tex"));
        assert_eq!(map_path("../evil/content/x.png"), None);
        assert_eq!(map_path("readme.txt"), None);
        assert_eq!(kind_of(&["content/textures/Cursors/KeyboardMouse/ArrowCursor.png".into()]), "cursor");
        assert_eq!(kind_of(&["content/textures/ui/Emotes/Large/SegmentedCircle.png".into()]), "wheel");
        assert_eq!(kind_of(&["content/textures/ui/TopBar/coloredlogo.png".into()]), "mod");
        assert_eq!(safe_name("C:/x/My Pack!.zip"), "My Pack_");
    }
}
