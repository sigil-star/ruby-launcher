//! Roblox client mods, applied to every installed player build and re-applied before launch:
//!
//! * UI tint     – Roblox's in-game UI textures (top bar, menus, emote wheel, chat, backpack,
//!                 voice, loading) recoloured to one colour.
//! * Ruby logo   – Roblox's logo PNGs and the "tilt"/"roblox-classic" glyphs in the
//!                 BuilderIcons icon font (what the in-game menu button draws) become Ruby's.
//! * Force field – the spawn force field textures (DDS) recoloured.
//! * Skybox      – a skybox pack's .tex files over Roblox's default sky.
//! * Custom font – every Roblox font family pointed at a font you choose (Bloxstrap-style).
//!
//! Every file is backed up (per Roblox version) before it is first changed and each apply is
//! rebuilt from those originals, so re-applying never compounds and turning a mod off restores
//! the exact original file.

use crate::roblox::{dds, fontpatch, micpacks, packs, userpacks};
use std::cell::RefCell;
use std::collections::HashSet;
use crate::state::AppState;
use base64::Engine;
use image::{imageops::FilterType, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Bump when the apply logic changes so existing installs get re-applied.
const REV: u32 = 6;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeSettings {
    /// UI tint on/off.
    pub enabled: bool,
    /// "#rrggbb"
    pub color: String,
    /// Replace Roblox logos (PNGs + icon-font glyphs) with Ruby's.
    pub ruby_logos: bool,
    /// Force field colour ("#rrggbb"), or None for Roblox's default.
    pub force_field: Option<String>,
    /// Skybox pack folder, or None for Roblox's default sky.
    pub skybox: Option<String>,
    /// Use the custom font saved with setCustomFont.
    pub custom_font: bool,
    /// Cursor pack id (see packs::CURSORS), or None for Roblox's cursor.
    pub cursor: Option<String>,
    /// Optional colour for the cursor's fill.
    pub cursor_color: Option<String>,
    /// Shift-lock reticle: None = match the chosen cursor, "roblox" = Roblox's, or a style id.
    pub shift_lock: Option<String>,
    /// Emote wheel style id (see packs::WHEELS), or None for Roblox's.
    pub emote_wheel: Option<String>,
    /// Imported texture mods that are switched on (by pack name).
    pub extra_mods: Vec<String>,
    /// One of the fonts Roblox ships (file name in content/fonts), used for all text.
    pub font_preset: Option<String>,
    /// Voice-chat mic icons: a built-in pack id, or "user:<name>" for an imported one.
    pub mic_pack: Option<String>,
    /// "dark" | "pixel": restyles the local plastic + stud textures.
    #[serde(default)]
    pub surface: Option<String>,
    /// Death sound: None = Roblox's, "oof" = the classic oof, "custom" = the file saved with setDeathSound.
    #[serde(default)]
    pub death_sound: Option<String>,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        // The Ruby logo is on by default; everything else is opt-in.
        Self { enabled: false, color: "#e0245e".into(), ruby_logos: true, force_field: None, skybox: None, custom_font: false, cursor: None, cursor_color: None, shift_lock: None, emote_wheel: None, extra_mods: vec![], font_preset: None, mic_pack: None, surface: None, death_sound: None }
    }
}

/// Folders (searched recursively) whose UI images get tinted.
const TINT_DIRS: &[&str] = &[
    "content/textures/ui/TopBar",
    "content/textures/ui/MenuBar",
    "content/textures/MenuBar",
    "content/textures/ui/Settings",
    "content/textures/ui/PlayerList",
    "content/textures/ui/PurchasePrompt",
    "content/textures/ui/Menu",
    "content/textures/ui/ErrorPrompt",
    "content/textures/ui/Scroll",
    "content/textures/ui/PerformanceStats",
    "content/textures/ui/NetworkPause",
    "content/textures/ui/LoadingScreen",
    "content/textures/ui/Capture",
    "content/textures/ui/Camera",
    "content/textures/ui/Lobby",
    "content/textures/ui/Input",
    "content/textures/ui/VirtualCursor",
    "content/textures/ui/common",
    "content/textures/ui/Emotes",
    "content/textures/ui/Chat",
    "content/textures/ui/Backpack",
    "content/textures/ui/VoiceChat",
    "content/textures/ui/Keyboard",
    "content/textures/ui/InGameMenu",
    "content/textures/ui/InspectMenu",
    "content/textures/ui/ScreenshotHud",
    "content/textures/SelfView",
    "content/textures/loading",
    "ExtraContent/textures/ui/InGameMenu",
];

/// Roblox logo images that become Ruby's logo.
const LOGO_FILES: &[&str] = &[
    "content/textures/ui/TopBar/coloredlogo.png",
    "content/textures/ui/TopBar/coloredlogo@2x.png",
    "content/textures/ui/TopBar/coloredlogo@3x.png",
    "content/textures/loading/robloxlogo.png",
    "content/textures/ui/ScreenshotHud/RobloxLogo.png",
    "content/textures/ui/ScreenshotHud/RobloxLogo@2x.png",
    "content/textures/ui/ScreenshotHud/RobloxLogo@3x.png",
    "ExtraContent/textures/ui/InGameMenu/roblox_logo.png",
    "PlatformContent/pc/textures/ui/Shell/Icons/PlatformLogo.png",
    "PlatformContent/pc/textures/ui/Shell/Icons/PlatformLogo@2x.png",
    "PlatformContent/pc/textures/ui/Shell/Icons/PlatformLogo@3x.png",
];

/// The icon font the new in-game UI draws its icons (and the Roblox logo) from.
const BUILDER_ICONS_FONT_DIR: &str = "ExtraContent/LuaPackages/Packages/_Index/BuilderIcons/BuilderIcons/Font";
/// "tilt" (the Roblox logo on the menu button) and "roblox-classic".
const LOGO_GLYPHS: &[u32] = &[0xF200, 0xF408];

const PARTICLES_DIR: &str = "content/textures/particles";
const SKY_DIR: &str = "PlatformContent/pc/textures/sky";
const FONT_FAMILIES_DIR: &str = "content/fonts/families";

const RUBY_LOGO: &[u8] = include_bytes!("../../icons/128x128@2x.png");

/// Full-screen overlays, shadows and bars look wrong tinted.
fn skip_tint(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    ["overlay", "shadow", "healthbar", "hurt"].iter().any(|k| n.contains(k))
}

fn settings_path(state: &AppState) -> PathBuf {
    state.data_dir.join("ingame-theme.json")
}

pub fn load(state: &AppState) -> ThemeSettings {
    std::fs::read_to_string(settings_path(state)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(state: &AppState, s: &ThemeSettings) {
    let _ = std::fs::write(settings_path(state), serde_json::to_string_pretty(s).unwrap_or_default());
}

fn parse_hex(hex: &str) -> [u8; 3] {
    let h = hex.trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
    [p(0), p(2), p(4)]
}

fn backup_root(state: &AppState, version_dir: &Path) -> PathBuf {
    let name = version_dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "unknown".into());
    state.data_dir.join("texture-backup").join(name)
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, out);
        } else {
            out.push(p);
        }
    }
}

fn rel_of(version_dir: &Path, p: &Path) -> String {
    p.strip_prefix(version_dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

fn custom_font_file(state: &AppState) -> Option<PathBuf> {
    ["ttf", "otf"].iter().map(|e| state.data_dir.join(format!("custom-font.{e}"))).find(|p| p.is_file())
}

/// One version's backups: copy the original once, then always build from it.
struct Backups {
    root: PathBuf,
    version: PathBuf,
    /// Files the built-in mods wrote or restored during this apply.
    touched: RefCell<HashSet<String>>,
}

impl Backups {
    /// The untouched original of `rel` (backing it up first if needed).
    fn original(&self, rel: &str) -> Option<PathBuf> {
        let orig = self.root.join(rel);
        if !orig.is_file() {
            let live = self.version.join(rel);
            if !live.is_file() {
                return None;
            }
            std::fs::create_dir_all(orig.parent()?).ok()?;
            std::fs::copy(&live, &orig).ok()?;
        }
        Some(orig)
    }
    /// Put the original back (no-op if it was never changed).
    fn restore(&self, rel: &str) -> bool {
        self.touched.borrow_mut().insert(rel.to_string());
        let orig = self.root.join(rel);
        orig.is_file() && std::fs::copy(&orig, self.version.join(rel)).is_ok()
    }
    fn write(&self, rel: &str, bytes: &[u8]) -> bool {
        self.touched.borrow_mut().insert(rel.to_string());
        let live = self.version.join(rel);
        // Roblox ships some files read-only.
        if let Ok(meta) = std::fs::metadata(&live) {
            let mut perm = meta.permissions();
            if perm.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                perm.set_readonly(false);
                let _ = std::fs::set_permissions(&live, perm);
            }
        }
        std::fs::write(live, bytes).is_ok()
    }
}

/// White becomes the colour, greys become shades of it, black stays black; alpha is kept.
fn tint(img: &mut RgbaImage, rgb: [u8; 3]) {
    for p in img.pixels_mut() {
        let [r, g, b, a] = p.0;
        if a == 0 {
            continue;
        }
        let l = (0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32) / 255.0;
        p.0 = [(rgb[0] as f32 * l) as u8, (rgb[1] as f32 * l) as u8, (rgb[2] as f32 * l) as u8, a];
    }
}

fn png_bytes(img: &RgbaImage) -> Option<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

fn ruby_logo_sized(w: u32, h: u32) -> Option<RgbaImage> {
    let logo = image::load_from_memory_with_format(RUBY_LOGO, ImageFormat::Png).ok()?.to_rgba8();
    let side = w.min(h).max(1);
    let scaled = image::imageops::resize(&logo, side, side, FilterType::Lanczos3);
    let mut canvas = RgbaImage::new(w.max(1), h.max(1));
    image::imageops::overlay(&mut canvas, &scaled, ((w - side) / 2) as i64, ((h - side) / 2) as i64);
    Some(canvas)
}

fn ui_textures(b: &Backups, s: &ThemeSettings) -> usize {
    let mut files = vec![];
    for d in TINT_DIRS {
        walk(&b.version.join(d), &mut files);
    }
    let rgb = parse_hex(&s.color);
    let mut n = 0;
    let mut rels: Vec<String> = files
        .iter()
        .filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("png")).unwrap_or(false))
        .filter(|p| !skip_tint(&p.file_name().unwrap_or_default().to_string_lossy()))
        .map(|p| rel_of(&b.version, p))
        .collect();
    for f in LOGO_FILES {
        if b.version.join(f).is_file() && !rels.iter().any(|r| r == f) {
            rels.push(f.to_string());
        }
    }
    let wheel_style = s.emote_wheel.as_deref().and_then(packs::wheel);
    for rel in rels {
        let is_logo = LOGO_FILES.contains(&rel.as_str());
        if let (Some(style), Some(layer)) = (wheel_style, packs::wheel_layer(&rel)) {
            let Some(orig) = b.original(&rel) else { continue };
            let Ok(src) = image::open(&orig) else { continue };
            let mut img = src.to_rgba8();
            packs::recolor_wheel(&mut img, style, layer);
            if png_bytes(&img).map(|bytes| b.write(&rel, &bytes)).unwrap_or(false) {
                n += 1;
            }
            continue;
        }
        let logo = is_logo && s.ruby_logos;
        let tinted = s.enabled && !is_logo;
        if !logo && !tinted {
            n += b.restore(&rel) as usize;
            continue;
        }
        let Some(orig) = b.original(&rel) else { continue };
        let Ok(src) = image::open(&orig) else { continue };
        let mut img = src.to_rgba8();
        if logo {
            match ruby_logo_sized(img.width(), img.height()) {
                Some(l) => img = l,
                None => continue,
            }
        } else {
            tint(&mut img, rgb);
        }
        if png_bytes(&img).map(|bytes| b.write(&rel, &bytes)).unwrap_or(false) {
            n += 1;
        }
    }
    n
}

/// A restyled BuilderIcons set (e.g. Ruby's "minimal" icons) used in place of Roblox's own.
fn icon_font_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("icon-font")
}

fn icon_font_stamp(state: &AppState) -> Option<String> {
    let dir = icon_font_dir(state);
    let mut v: Vec<String> = std::fs::read_dir(&dir).ok()?.flatten()
        .filter_map(|e| Some(format!("{}:{:?}", e.file_name().to_string_lossy(), e.metadata().ok()?.modified().ok()?)))
        .collect();
    v.sort();
    (!v.is_empty()).then(|| v.join(","))
}

fn icon_font(state: &AppState, b: &Backups, s: &ThemeSettings) -> usize {
    let custom = icon_font_dir(state);
    let mut files = vec![];
    walk(&b.version.join(BUILDER_ICONS_FONT_DIR), &mut files);
    let shape = fontpatch::ruby_logo_shape();
    let mut n = 0;
    for p in files.iter().filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("ttf")).unwrap_or(false)) {
        let rel = rel_of(&b.version, p);
        let restyled = p.file_name().map(|f| custom.join(f)).filter(|c| c.is_file());
        if !s.ruby_logos && restyled.is_none() {
            n += b.restore(&rel) as usize;
            continue;
        }
        let Some(orig) = b.original(&rel) else { continue };
        let Ok(bytes) = std::fs::read(restyled.as_ref().unwrap_or(&orig)) else { continue };
        let out = if s.ruby_logos { fontpatch::replace_glyphs(&bytes, LOGO_GLYPHS, &shape) } else { Some(bytes) };
        match out {
            Some(patched) if b.write(&rel, &patched) => n += 1,
            Some(_) => {}
            None => tracing::warn!("couldn't patch {rel}"),
        }
    }
    n
}

/// Textures Roblox still ships with the client (most materials now stream from the cloud).
const SURFACE_FILES: &[&str] = &["PlatformContent/pc/textures/plastic/diffuse.dds", "PlatformContent/pc/textures/studs.dds"];

fn surfaces(b: &Backups, s: &ThemeSettings) -> usize {
    let mut n = 0;
    for rel in SURFACE_FILES {
        let Some(style) = s.surface.as_deref() else {
            n += b.restore(rel) as usize;
            continue;
        };
        let Some(orig) = b.original(rel) else { continue };
        let Ok(bytes) = std::fs::read(&orig) else { continue };
        let out = match style {
            // Darker, lower-contrast surfaces: easier on the eyes in bright games.
            "dark" => dds::transform(&bytes, |px, _, _| {
                for p in px.chunks_exact_mut(4) {
                    for c in &mut p[..3] {
                        *c = ((*c as u32) * 45 / 100) as u8;
                    }
                }
            }),
            // Chunky blocks: each texture becomes a 16×16 grid with flat cells and a little grain.
            "pixel" => dds::transform(&bytes, |px, w, h| {
                let cell = (w / 16).max(1);
                let cellh = (h / 16).max(1);
                for cy in (0..h).step_by(cellh) {
                    for cx in (0..w).step_by(cell) {
                        let (sx, sy) = ((cx + cell / 2).min(w - 1), (cy + cellh / 2).min(h - 1));
                        let i = (sy * w + sx) * 4;
                        let src = [px[i], px[i + 1], px[i + 2], px[i + 3]];
                        // Deterministic per-cell grain so it reads as "blocky", not flat.
                        let grain = (((cx * 7 + cy * 13) ^ (cx * cy)) % 9) as i32 - 4;
                        for y in cy..(cy + cellh).min(h) {
                            for x in cx..(cx + cell).min(w) {
                                let j = (y * w + x) * 4;
                                for k in 0..3 {
                                    px[j + k] = (src[k] as i32 + grain * 3).clamp(0, 255) as u8;
                                }
                                px[j + 3] = src[3];
                            }
                        }
                    }
                }
            }),
            _ => None,
        };
        if let Some(o) = out {
            n += b.write(rel, &o) as usize;
        }
    }
    n
}

fn force_field(b: &Backups, s: &ThemeSettings) -> usize {
    let mut files = vec![];
    walk(&b.version.join(PARTICLES_DIR), &mut files);
    let mut n = 0;
    for p in files {
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
        if !name.starts_with("forcefield") || !name.ends_with(".dds") || name.contains("alpha") {
            continue;
        }
        let rel = rel_of(&b.version, &p);
        let Some(color) = s.force_field.as_deref() else {
            n += b.restore(&rel) as usize;
            continue;
        };
        let Some(orig) = b.original(&rel) else { continue };
        let Ok(bytes) = std::fs::read(&orig) else { continue };
        // Colour layers take the colour outright; the glow keeps its brightness falloff.
        let mode = if name.contains("_color") || name.contains("vortex_main") { dds::Mode::Replace } else { dds::Mode::Brightness };
        if let Some(out) = dds::recolor(&bytes, dds::Paint::parse(color, parse_hex), mode) {
            n += b.write(&rel, &out) as usize;
        }
    }
    n
}

fn tex_files(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .map(|r| r.flatten().map(|e| e.path()).filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("tex")).unwrap_or(false)).collect())
        .unwrap_or_default()
}

fn skybox(b: &Backups, s: &ThemeSettings) -> usize {
    let sky = b.version.join(SKY_DIR);
    let installed = tex_files(&sky);
    let pack: Vec<PathBuf> = s.skybox.as_deref().map(|d| tex_files(Path::new(d))).unwrap_or_default();
    let mut n = 0;
    for live in installed {
        let name = live.file_name().unwrap_or_default().to_string_lossy().to_string();
        let rel = rel_of(&b.version, &live);
        let replacement = pack.iter().find(|p| p.file_name().map(|f| f.to_string_lossy().eq_ignore_ascii_case(&name)).unwrap_or(false));
        match replacement {
            Some(src) => {
                if b.original(&rel).is_some() {
                    if let Ok(bytes) = std::fs::read(src) {
                        n += b.write(&rel, &bytes) as usize;
                    }
                }
            }
            None => n += b.restore(&rel) as usize,
        }
    }
    n
}

fn custom_font(state: &AppState, b: &Backups, s: &ThemeSettings) -> usize {
    let font = if s.custom_font { custom_font_file(state) } else { None };
    let mut n = 0;
    let mut target_name = font.as_ref().and_then(|f| f.extension()).map(|e| format!("CustomFont.{}", e.to_string_lossy()));
    if let (Some(src), Some(name)) = (&font, &target_name) {
        let _ = std::fs::copy(src, b.version.join("content/fonts").join(name));
    }
    // A Roblox font chosen from the list (only if that build has it).
    if target_name.is_none() {
        if let Some(preset) = s.font_preset.as_deref().filter(|f| !f.contains('/') && !f.contains('\\')) {
            if let Some(bytes) = bundled_font(preset) {
                let _ = std::fs::write(b.version.join("content/fonts").join(preset), bytes);
            }
            if b.version.join("content/fonts").join(preset).is_file() {
                target_name = Some(preset.to_string());
            }
        }
    }
    let Ok(entries) = std::fs::read_dir(b.version.join(FONT_FAMILIES_DIR)) else { return 0 };
    for e in entries.flatten() {
        let p = e.path();
        if !p.extension().map(|x| x.eq_ignore_ascii_case("json")).unwrap_or(false) {
            continue;
        }
        let rel = rel_of(&b.version, &p);
        let Some(name) = &target_name else {
            n += b.restore(&rel) as usize;
            continue;
        };
        let Some(orig) = b.original(&rel) else { continue };
        let Some(mut json) = std::fs::read_to_string(&orig).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
        if let Some(faces) = json.get_mut("faces").and_then(|f| f.as_array_mut()) {
            for face in faces {
                face["assetId"] = json!(format!("rbxasset://fonts/{name}"));
            }
        }
        n += b.write(&rel, json.to_string().as_bytes()) as usize;
    }
    n
}

const CURSOR_DIR: &str = "content/textures/Cursors/KeyboardMouse";

/// Every in-game cursor, kept as one matching set: normal, hover, text, shift lock and the
/// drag hands, in both places Roblox keeps them. Restored when no cursor style is chosen.
fn cursors(b: &Backups, s: &ThemeSettings) -> usize {
    let user = s.cursor.as_deref().map(|c| c.starts_with("user:")).unwrap_or(false);
    let pack = s.cursor.as_deref().and_then(packs::cursor);
    let color = s.cursor_color.as_deref().map(parse_hex);
    // RedGlow's extras match its red unless you picked a colour.
    let extra_color = color.or_else(|| (pack.map(|p| p.id) == Some("redglow")).then_some([255, 48, 64]));
    let lock_art: Option<&[u8]> = match s.shift_lock.as_deref() {
        Some("roblox") => None,
        Some(id) => packs::shift_lock_art(id).or(pack.map(|p| p.lock)),
        None => pack.map(|p| p.lock),
    };
    let mut n = 0;
    let dirs = [CURSOR_DIR, "content/textures"];
    for dir in dirs {
        for (file, kind) in [("ArrowFarCursor.png", 0), ("ArrowCursor.png", 1), ("IBeamCursor.png", 2)] {
            let rel = format!("{dir}/{file}");
            if !b.version.join(&rel).is_file() {
                continue;
            }
            // Imported cursor packs supply their own normal/hover; the text cursor still matches.
            if user && kind < 2 {
                continue;
            }
            let img = match (pack, kind) {
                (Some(p), 0) => packs::compose_cursor(p.normal, p.centered, color),
                (Some(p), 1) => packs::compose_cursor(p.hover, p.centered, color),
                (Some(_), _) => packs::compose_centered(packs::TEXT_CURSOR, extra_color, 64, 64, 0.42),
                (None, _) => None,
            };
            n += write_cursor(b, &rel, img);
        }
    }
    // Shift lock (works even with no cursor style: you can pick just a reticle).
    let rel = "content/textures/MouseLockedCursor.png".to_string();
    if b.version.join(&rel).is_file() {
        let img = match lock_art {
            Some(art) if b.original(&rel).is_some() => image::image_dimensions(b.root.join(&rel)).ok().and_then(|(w, h)| packs::compose_centered(art, extra_color, w, h, 0.8)),
            _ => None,
        };
        n += write_cursor(b, &rel, img);
    }
    // Drag hands.
    for (file, open) in [("HoverCursor.png", true), ("ActivatedCursor.png", false)] {
        let rel = format!("content/textures/Cursors/DragDetector/{file}");
        if !b.version.join(&rel).is_file() {
            continue;
        }
        let img = match pack {
            Some(p) if b.original(&rel).is_some() => image::image_dimensions(b.root.join(&rel))
                .ok()
                .and_then(|(w, h)| packs::compose_centered(if open { p.drag_open } else { p.drag_closed }, extra_color, w, h, 0.95)),
            _ => None,
        };
        n += write_cursor(b, &rel, img);
    }
    n
}

/// Write a cursor (backing up the original first) or, with None, put Roblox's back.
fn write_cursor(b: &Backups, rel: &str, img: Option<RgbaImage>) -> usize {
    match img {
        Some(img) => {
            if b.original(rel).is_none() {
                return 0;
            }
            png_bytes(&img).map(|bytes| b.write(rel, &bytes) as usize).unwrap_or(0)
        }
        None => b.restore(rel) as usize,
    }
}

/// Voice-chat mic icons: every Muted/Unmuted* frame in each mic folder, drawn at its own size.
fn mic(state: &AppState, b: &Backups, s: &ThemeSettings) -> usize {
    let builtin = s.mic_pack.as_deref().and_then(micpacks::pack);
    let user_dir = s.mic_pack.as_deref().and_then(|m| m.strip_prefix("user:")).map(|n| userpacks::mods_dir(state).join(n).join("mic"));
    // Imported pictures (muted / quiet / talking), loaded once.
    let stages = user_dir.as_deref().map(micpacks::load_user_stages).unwrap_or_default();
    let mut n = 0;
    for d in micpacks::MIC_DIRS {
        let Ok(list) = std::fs::read_dir(b.version.join(d)) else { continue };
        for e in list.flatten() {
            let p = e.path();
            if !p.is_file() {
                continue;
            }
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            let Some(stem) = name.strip_suffix(".png") else { continue };
            let base = stem.split('@').next().unwrap_or(stem);
            let Some(stage) = micpacks::stage_of(base) else { continue };
            let rel = rel_of(&b.version, &p);
            let frame: Option<RgbaImage> = if let Some(pk) = builtin {
                let Some(orig) = b.original(&rel) else { continue };
                let Ok((w, h)) = image::image_dimensions(&orig) else { continue };
                micpacks::render_svg(&(pk.draw)(stage.draw_level()), w, h)
            } else if user_dir.is_some() {
                // No muted picture in the pack: Roblox's own muted icon stays.
                match stages.get(&stage) {
                    Some(src) => {
                        let Some(orig) = b.original(&rel) else { continue };
                        let Ok((w, h)) = image::image_dimensions(&orig) else { continue };
                        Some(micpacks::fit_image(src, w, h))
                    }
                    None => None,
                }
            } else {
                None
            };
            match frame.and_then(|img| png_bytes(&img)) {
                Some(bytes) => n += b.write(&rel, &bytes) as usize,
                None => n += b.restore(&rel) as usize,
            }
        }
    }
    n
}

/// Imported packs: the chosen cursor/wheel pack plus every switched-on texture mod, copied over
/// whatever the built-in mods did. Files a pack wrote last time but no active pack provides now
/// go back to the original (unless a built-in mod already handled them this run).
fn user_packs(state: &AppState, b: &Backups, s: &ThemeSettings) -> usize {
    let mut active: Vec<String> = s.extra_mods.clone();
    for pick in [s.cursor.as_deref(), s.emote_wheel.as_deref()].into_iter().flatten() {
        if let Some(name) = pick.strip_prefix("user:") {
            active.push(name.to_string());
        }
    }
    let ledger = b.root.join(".user-pack-files.json");
    let previous: Vec<String> = std::fs::read_to_string(&ledger).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let mut written: Vec<String> = vec![];
    let mut n = 0;
    for pack in userpacks::installed(state).into_iter().filter(|p| active.contains(&p.name)) {
        for rel in userpacks::files(&pack.dir) {
            if !b.version.join(&rel).is_file() || b.original(&rel).is_none() {
                continue; // only replace files Roblox actually has
            }
            if let Ok(bytes) = std::fs::read(pack.dir.join(&rel)) {
                if b.write(&rel, &bytes) {
                    n += 1;
                    written.push(rel);
                }
            }
        }
    }
    for rel in previous {
        if !written.contains(&rel) && !b.touched.borrow().contains(&rel) {
            n += b.restore(&rel) as usize;
        }
    }
    let _ = std::fs::create_dir_all(&b.root);
    let _ = std::fs::write(ledger, serde_json::to_string(&written).unwrap_or_default());
    n
}

/// Apply every mod (on or off) to one Roblox version folder. Each mod remembers what it last
/// applied, so only the mods whose settings changed are redone.
pub fn apply_to_version(state: &AppState, version_dir: &Path, s: &ThemeSettings) -> Result<usize, String> {
    let started = std::time::Instant::now();
    let b = Backups { root: backup_root(state, version_dir), version: version_dir.to_path_buf(), touched: RefCell::new(HashSet::new()) };
    let marker = b.root.join(".applied.json");
    let font_stamp = custom_font_file(state).and_then(|p| std::fs::metadata(p).ok()).and_then(|m| m.modified().ok()).map(|t| format!("{t:?}"));
    let pack_stamp: Vec<String> = userpacks::installed(state).iter().map(|p| p.name.clone()).collect();
    let builtin_wheel = s.emote_wheel.as_deref().filter(|w| !w.starts_with("user:"));
    let builtin_cursor = s.cursor.as_deref().filter(|c| !c.starts_with("user:"));
    let want = json!({
        "rev": REV,
        "ui": [s.enabled, json!(s.color), json!(s.ruby_logos), json!(builtin_wheel)],
        "icons": [json!(s.ruby_logos), json!(icon_font_stamp(state))],
        "ff": s.force_field,
        "surf": s.surface,
        "sky": s.skybox,
        "oof": [json!(s.death_sound), json!(death_sound_stamp(state))],
        "font": [json!(s.custom_font), json!(font_stamp), json!(s.font_preset)],
        "cursor": [json!(builtin_cursor), json!(s.cursor_color), json!(s.shift_lock)],
        "user": [json!(s.extra_mods), json!(s.cursor), json!(s.emote_wheel), json!(pack_stamp)],
        "mic": [json!(s.mic_pack), json!(pack_stamp)],
    });
    let had: Value = std::fs::read_to_string(&marker).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
    let changed = |k: &str| had.get("rev") != want.get("rev") || had.get(k) != want.get(k);
    let mut n = 0;
    let mut any = false;
    if changed("ui") { n += ui_textures(&b, s); any = true; }
    if changed("icons") { n += icon_font(state, &b, s); any = true; }
    if changed("surf") { n += surfaces(&b, s); any = true; }
    if changed("ff") { n += force_field(&b, s); any = true; }
    if changed("sky") { n += skybox(&b, s); any = true; }
    if changed("oof") { n += death_sound(state, &b, s); any = true; }
    if changed("font") { n += custom_font(state, &b, s); any = true; }
    if changed("cursor") { n += cursors(&b, s); any = true; }
    // After the tint, which also touches the voice-chat folder.
    if changed("mic") || changed("ui") { n += mic(state, &b, s); any = true; }
    // Imported packs sit on top of the built-in mods, so re-lay them whenever anything moved.
    if any || changed("user") { n += user_packs(state, &b, s); }
    let _ = std::fs::create_dir_all(&b.root);
    let _ = std::fs::write(&marker, want.to_string());
    if n > 0 {
        tracing::info!(version = %version_dir.display(), files = n, ms = started.elapsed().as_millis() as u64, "client mods applied");
    }
    Ok(n)
}

/// Every installed player folder (Roblox's own versions, plus weblauncher's pinned build).
/// Uninstall: put every installed Roblox build back exactly as Roblox shipped it.
/// Your saved mod choices are kept (so reinstalling brings them back); only Roblox's files change.
pub fn restore_all(state: &AppState) -> usize {
    // A restyled icon set would otherwise be re-applied: set it aside while restoring.
    let icons = state.data_dir.join("icon-font");
    let parked = state.data_dir.join("icon-font.parked");
    let moved = icons.is_dir() && std::fs::rename(&icons, &parked).is_ok();
    let stock = ThemeSettings { enabled: false, ruby_logos: false, ..Default::default() };
    let n = player_dirs().iter().map(|d| apply_to_version(state, d, &stock).unwrap_or(0)).sum();
    if moved {
        let _ = std::fs::rename(&parked, &icons);
    }
    n
}

fn player_dirs() -> Vec<PathBuf> {
    let mut out = vec![];
    if let Some(v) = crate::roblox::bootstrap::versions_dir() {
        if let Ok(entries) = std::fs::read_dir(v) {
            for e in entries.flatten() {
                if e.path().join("RobloxPlayerBeta.exe").is_file() {
                    out.push(e.path());
                }
            }
        }
    }
    if let Some(p) = crate::roblox::bootstrap::weblauncher_player().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        out.push(p);
    }
    out
}

pub fn get(state: &AppState) -> Value {
    let mut v = serde_json::to_value(load(state)).unwrap_or(json!({}));
    v["customFontName"] = json!(std::fs::read_to_string(state.data_dir.join("custom-font.name")).ok());
    v
}

/// Save and apply to every installed player.
pub async fn set(state: &Arc<AppState>, s: ThemeSettings) -> Result<Value, String> {
    save(state, &s);
    let st = Arc::clone(state);
    // Every installed build at once (they're independent folders).
    let count = tokio::task::spawn_blocking(move || {
        std::thread::scope(|scope| {
            let jobs: Vec<_> = player_dirs().into_iter().map(|d| {
                let st = &st;
                let s = &s;
                scope.spawn(move || apply_to_version(st, &d, s).unwrap_or(0))
            }).collect();
            jobs.into_iter().map(|j| j.join().unwrap_or(0)).sum::<usize>()
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "files": count }))
}

/// Called right before launching: make sure the exe's version has the current mods.
pub async fn ensure_for_exe(state: &Arc<AppState>, exe: &Path) {
    let s = load(state);
    let Some(dir) = exe.parent().map(|d| d.to_path_buf()) else { return };
    let st = Arc::clone(state);
    let _ = tokio::task::spawn_blocking(move || apply_to_version(&st, &dir, &s)).await;
}

/// Roblox updates itself in the background (and its own app can start a game on the new build),
/// so every installed build is checked regularly; only builds missing the current mods are touched.
pub async fn keep_all_versions(state: &Arc<AppState>) {
    let s = load(state);
    let st = Arc::clone(state);
    let _ = tokio::task::spawn_blocking(move || {
        for dir in player_dirs() {
            // Leave a build alone while Roblox may still be unpacking it.
            let settled = std::fs::metadata(dir.join("RobloxPlayerBeta.exe"))
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 60);
            if settled {
                let _ = apply_to_version(&st, &dir, &s);
            }
        }
    })
    .await;
}

/// Roblox's own installed fonts (from the current build), for the font picker.

const OUCH: &str = "content/sounds/ouch.ogg";
/// Death sounds that ship with Ruby (more can be added here as (id, name, bytes)).
const DEATH_SOUNDS: &[(&str, &str, &[u8])] = &[
    ("oof", "Classic oof", include_bytes!("../../assets/classic-oof.ogg")),
    ("rings", "Ring loss", include_bytes!("../../assets/rings.ogg")),
    ("return-by-death", "Return by Death (Re:Zero)", include_bytes!("../../assets/return-by-death.ogg")),
    ("totem", "Totem of Undying (Minecraft)", include_bytes!("../../assets/totem-of-undying.ogg")),
    ("minecraft-hurt", "Minecraft damage", include_bytes!("../../assets/minecraft-damage.ogg")),
    ("pacman", "Pac-Man death", include_bytes!("../../assets/pacman-death.ogg")),
    ("discord-leave", "Discord disconnect", include_bytes!("../../assets/discord-disconnect.ogg")),
];

pub fn death_sound_list(state: &AppState) -> Value {
    let enc = |b: &[u8]| format!("data:audio/ogg;base64,{}", base64::engine::general_purpose::STANDARD.encode(b));
    // Roblox's own sound: the backed-up original, or the live file if Ruby never touched it.
    let roblox = player_dirs().into_iter().find_map(|d| {
        let backup = backup_root(state, &d).join(OUCH);
        std::fs::read(if backup.is_file() { backup } else { d.join(OUCH) }).ok()
    });
    let mut out: Vec<Value> = DEATH_SOUNDS.iter().map(|(id, name, b)| json!({ "id": id, "name": name, "url": enc(b) })).collect();
    if let Ok(b) = std::fs::read(death_sound_file(state)) {
        out.push(json!({ "id": "custom", "name": "Your sound", "url": enc(&b) }));
    }
    json!({ "sounds": out, "roblox": roblox.map(|b| enc(&b)) })
}

fn death_sound_file(state: &AppState) -> PathBuf {
    state.data_dir.join("death-sound.ogg")
}

fn death_sound_stamp(state: &AppState) -> u64 {
    std::fs::metadata(death_sound_file(state)).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn death_sound(state: &AppState, b: &Backups, s: &ThemeSettings) -> usize {
    let bytes = match s.death_sound.as_deref() {
        Some("custom") => std::fs::read(death_sound_file(state)).ok(),
        Some(id) => DEATH_SOUNDS.iter().find(|(i, _, _)| *i == id).map(|(_, _, b)| b.to_vec()),
        None => None,
    };
    // Roblox has played the death sound from both files over the years (ouch.ogg, and oof.ogg
    // since the classic oof came back), so the chosen sound goes in both.
    DEATH_SOUND_FILES
        .iter()
        .filter(|rel| b.version.join(rel).is_file())
        .map(|rel| match &bytes {
            Some(bytes) => b.write(rel, bytes) as usize,
            None => b.restore(rel) as usize,
        })
        .sum()
}

const DEATH_SOUND_FILES: [&str; 2] = [OUCH, "content/sounds/oof.ogg"];

/// Save an .ogg (base64) as the custom death sound. Roblox only plays Ogg Vorbis here.
pub fn set_death_sound(state: &AppState, b64: &str) -> Result<Value, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"OggS") {
        return Err("Roblox needs an .ogg sound file. Convert it to .ogg first.".into());
    }
    if bytes.len() > 5_000_000 {
        return Err("That sound is too big (5 MB max).".into());
    }
    std::fs::write(death_sound_file(state), bytes).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

/// Free fonts bundled with Ruby (Google Fonts, OFL / Apache 2.0; see assets/fonts/LICENSE.txt).
/// They're written into the Roblox build as "Ruby-<file>" when picked.
const BUNDLED_FONTS: &[(&str, &str, &[u8])] = &[
    ("Ruby-Bangers-Regular.ttf", "Bangers", include_bytes!("../../assets/fonts/Bangers-Regular.ttf")),
    ("Ruby-Bungee-Regular.ttf", "Bungee", include_bytes!("../../assets/fonts/Bungee-Regular.ttf")),
    ("Ruby-ComicNeue-Bold.ttf", "Comic Neue", include_bytes!("../../assets/fonts/ComicNeue-Bold.ttf")),
    ("Ruby-Creepster-Regular.ttf", "Creepster", include_bytes!("../../assets/fonts/Creepster-Regular.ttf")),
    ("Ruby-Lobster-Regular.ttf", "Lobster", include_bytes!("../../assets/fonts/Lobster-Regular.ttf")),
    ("Ruby-LuckiestGuy-Regular.ttf", "Luckiest Guy", include_bytes!("../../assets/fonts/LuckiestGuy-Regular.ttf")),
    ("Ruby-PatrickHand-Regular.ttf", "Patrick Hand", include_bytes!("../../assets/fonts/PatrickHand-Regular.ttf")),
    ("Ruby-PermanentMarker-Regular.ttf", "Permanent Marker", include_bytes!("../../assets/fonts/PermanentMarker-Regular.ttf")),
    ("Ruby-Poppins-SemiBold.ttf", "Poppins", include_bytes!("../../assets/fonts/Poppins-SemiBold.ttf")),
    ("Ruby-PressStart2P-Regular.ttf", "Press Start 2P", include_bytes!("../../assets/fonts/PressStart2P-Regular.ttf")),
    ("Ruby-Righteous-Regular.ttf", "Righteous", include_bytes!("../../assets/fonts/Righteous-Regular.ttf")),
    ("Ruby-Silkscreen-Regular.ttf", "Silkscreen", include_bytes!("../../assets/fonts/Silkscreen-Regular.ttf")),
    ("Ruby-TitanOne-Regular.ttf", "Titan One", include_bytes!("../../assets/fonts/TitanOne-Regular.ttf")),
    ("Ruby-VT323-Regular.ttf", "VT323", include_bytes!("../../assets/fonts/VT323-Regular.ttf")),
];

fn bundled_font(file: &str) -> Option<&'static [u8]> {
    BUNDLED_FONTS.iter().find(|(f, _, _)| *f == file).map(|(_, _, b)| *b)
}

pub fn list_fonts() -> Value {
    let bundled = BUNDLED_FONTS.iter().map(|(f, n, _)| json!({ "file": f, "name": n }));
    let Some(dir) = player_dirs().into_iter().find(|d| d.join("content/fonts").is_dir()) else { return json!({ "fonts": bundled.collect::<Vec<_>>() }) };
    let mut fonts: Vec<Value> = std::fs::read_dir(dir.join("content/fonts"))
        .map(|r| {
            r.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|f| {
                    let l = f.to_ascii_lowercase();
                    (l.ends_with(".ttf") || l.ends_with(".otf"))
                        && l.contains("regular")
                        && !l.starts_with("customfont")
                        && !l.starts_with("ruby-")
                        && !["emoji", "icon", "symbol", "mono"].iter().any(|k| l.contains(k))
                })
                .map(|f| {
                    let name = f.split('-').next().unwrap_or(&f).replace('_', " ");
                    // "FredokaOne" -> "Fredoka One"
                    let mut pretty = String::new();
                    for (i, c) in name.chars().enumerate() {
                        if i > 0 && c.is_uppercase() && !name.chars().nth(i - 1).map(|p| p.is_uppercase() || p == ' ').unwrap_or(true) {
                            pretty.push(' ');
                        }
                        pretty.push(c);
                    }
                    json!({ "file": f, "name": pretty })
                })
                .collect()
        })
        .unwrap_or_default();
    fonts.extend(bundled);
    fonts.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    json!({ "fonts": fonts })
}

/// A Roblox font file as a data URL, so the picker can show each name in its own font.
pub fn font_preview(file: &str) -> Result<Value, String> {
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return Err("bad font".into());
    }
    if let Some(bytes) = bundled_font(file) {
        return Ok(json!({ "url": format!("data:font/ttf;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) }));
    }
    let dir = player_dirs().into_iter().find(|d| d.join("content/fonts").join(file).is_file()).ok_or("font not found")?;
    let bytes = std::fs::read(dir.join("content/fonts").join(file)).map_err(|e| e.to_string())?;
    let mime = if file.to_ascii_lowercase().ends_with(".otf") { "font/otf" } else { "font/ttf" };
    Ok(json!({ "url": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) }))
}

/// Builder Sans for Ruby's own interface, read from the user's Roblox install (Roblox's license
/// doesn't allow shipping it with Ruby). Uses Ruby's backup of the original if a font mod
/// replaced it, so the launcher never picks up a modded font. Empty until Roblox is installed.
pub fn ui_fonts() -> Value {
    const FILES: &[(&str, u16)] = &[("BuilderSans-Regular.otf", 400), ("BuilderSans-Medium.otf", 500), ("BuilderSans-Bold.otf", 700), ("BuilderSans-ExtraBold.otf", 800)];
    let backup_root = dirs::data_dir().map(|d| d.join("com.rubylauncher.tauri").join("texture-backup"));
    for dir in player_dirs() {
        let mut faces = vec![];
        for (file, weight) in FILES {
            let rel = format!("content/fonts/{file}");
            let backup = backup_root.as_ref().map(|b| b.join(dir.file_name().unwrap_or_default()).join(&rel)).filter(|p| p.is_file());
            let Ok(bytes) = std::fs::read(backup.unwrap_or_else(|| dir.join(&rel))) else { continue };
            if !bytes.starts_with(b"OTTO") {
                continue;
            }
            faces.push(json!({ "weight": weight, "url": format!("data:font/otf;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)) }));
        }
        if !faces.is_empty() {
            return json!({ "faces": faces });
        }
    }
    json!({ "faces": [] })
}

pub const FORCE_FIELD_PRESETS: &[(&str, &str)] = &[
    ("Ruby", "#ff2d55"),
    ("Ice", "#8fe9ff"),
    ("Toxic", "#7dff3d"),
    ("Gold", "#ffc93c"),
    ("Void", "#9b4dff"),
    ("Sakura", "#ff9ad5"),
    ("Ember", "#ff6a00"),
    ("Ghost", "#f2f2f2"),
    ("Rainbow", "rainbow"),
];

/// Preview of the force field in a colour, made from this install's own textures and drawn the
/// way Roblox draws it: the glow sphere and the sparkle ring are added on as light (their alpha is
/// nearly zero, so blending them like a normal picture leaves them invisible).
pub fn force_field_preview(color: &str) -> Result<Value, String> {
    let dir = player_dirs().into_iter().next().ok_or("Roblox isn't installed")?;
    // Read the untouched originals if Ruby has backed them up, so previews never compound.
    let read = |name: &str| -> Option<Vec<u8>> {
        let rel = format!("{PARTICLES_DIR}/{name}");
        let backup = dirs::data_dir().map(|d| d.join("com.rubylauncher.tauri").join("texture-backup").join(dir.file_name().unwrap_or_default()).join(&rel));
        std::fs::read(backup.filter(|p| p.is_file()).unwrap_or_else(|| dir.join(&rel))).ok()
    };
    let paint = dds::Paint::parse(color, parse_hex);
    let glow = read("forcefield_glow_main.dds").and_then(|b| dds::decode(&b)).ok_or("couldn't read the force field texture")?;
    let (w, h) = (glow.width(), glow.height());

    // A dark stage with a faint floor light, so the glow has something to sit in.
    let mut acc = vec![[0f32; 3]; (w * h) as usize];
    for y in 0..h {
        for x in 0..w {
            let dx = x as f32 / w as f32 - 0.5;
            let dy = y as f32 / h as f32 - 0.42;
            let v = 22.0 - (dx * dx + dy * dy).sqrt() * 22.0;
            acc[(y * w + x) as usize] = [v * 0.75 + 8.0, v * 0.8 + 9.0, v + 13.0];
        }
    }
    // Additive light: brightness of the original texture, in the chosen colour.
    let mut add = |img: &RgbaImage, ox: i64, oy: i64, gain: f32, use_alpha: bool| {
        for (x, y, p) in img.enumerate_pixels() {
            let (tx, ty) = (x as i64 + ox, y as i64 + oy);
            if tx < 0 || ty < 0 || tx >= w as i64 || ty >= h as i64 {
                continue;
            }
            let l = if use_alpha { p[3] as f32 / 255.0 * (p[0].max(p[1]).max(p[2]) as f32 / 255.0).max(0.6) } else { p[0].max(p[1]).max(p[2]) as f32 / 255.0 };
            let c = paint.at(tx as usize, ty as usize, w as usize, h as usize);
            let a = &mut acc[(ty as u32 * w + tx as u32) as usize];
            for i in 0..3 {
                a[i] += c[i] as f32 * l * gain;
            }
        }
    };
    add(&glow, 0, 0, 1.15, false);
    // The sparkle ring that spins inside the bubble, scaled to sit just inside the glow.
    if let Some(v) = read("forcefield_vortex_main.dds").and_then(|b| dds::decode(&b)) {
        let size = (w as f32 * 0.78) as u32;
        let v = image::imageops::resize(&v, size, size, FilterType::Triangle);
        add(&v, ((w - size) / 2) as i64, ((h - size) / 2) as i64, 1.0, true);
    }
    let canvas = RgbaImage::from_fn(w, h, |x, y| {
        let a = acc[(y * w + x) as usize];
        image::Rgba([a[0].min(255.0) as u8, a[1].min(255.0) as u8, a[2].min(255.0) as u8, 255])
    });
    let thumb = image::imageops::resize(&canvas, 128, 128, FilterType::Triangle);
    let png = png_bytes(&thumb).ok_or("encode failed")?;
    Ok(json!({ "url": format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)) }))
}

/// Every mic pack with its 7 frames as small data URLs (the picker animates them).
pub fn mic_catalog(state: &AppState) -> Value {
    let url = |img: &RgbaImage| png_bytes(img).map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)));
    let mut out: Vec<Value> = micpacks::MIC_PACKS
        .iter()
        .map(|p| {
            let frames: Vec<Option<String>> = micpacks::Stage::ALL.iter().map(|s| micpacks::render_svg(&(p.draw)(s.draw_level()), 96, 96).and_then(|i| url(&i))).collect();
            json!({ "id": p.id, "name": p.name, "frames": frames, "imported": false })
        })
        .collect();
    for pk in userpacks::installed(state).into_iter().filter(|p| p.kind == "mic") {
        let stages = micpacks::load_user_stages(&pk.dir.join("mic"));
        let frames: Vec<Option<String>> = micpacks::Stage::ALL.iter().map(|s| stages.get(s).map(|i| micpacks::fit_image(i, 96, 96)).and_then(|i| url(&i))).collect();
        out.push(json!({ "id": format!("user:{}", pk.name), "name": pk.name, "frames": frames, "imported": true }));
    }
    json!({ "packs": out })
}

/// Save a font file (base64) as the custom font.
pub fn set_custom_font(state: &AppState, name: &str, b64: &str) -> Result<Value, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
    let ext = if bytes.starts_with(b"OTTO") { "otf" } else { "ttf" };
    if !(bytes.starts_with(b"OTTO") || bytes.starts_with(&[0, 1, 0, 0]) || bytes.starts_with(b"true")) {
        return Err("That doesn't look like a .ttf or .otf font".into());
    }
    for e in ["ttf", "otf"] {
        let _ = std::fs::remove_file(state.data_dir.join(format!("custom-font.{e}")));
    }
    std::fs::write(state.data_dir.join(format!("custom-font.{ext}")), bytes).map_err(|e| e.to_string())?;
    let _ = std::fs::write(state.data_dir.join("custom-font.name"), name);
    Ok(json!({ "ok": true }))
}

/// Where skybox packs come from: Ruby's own folder, plus packs from an earlier Ruby install if present.
fn skybox_roots(state: &AppState) -> Vec<PathBuf> {
    let mut roots = vec![state.data_dir.join("skyboxes")];
    // The skyboxes that ship with Ruby, unpacked next to it by the installer.
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("skyboxes"))) {
        roots.push(dir);
    }
    if let Some(docs) = dirs::document_dir() {
        roots.push(docs.join("RubyLauncher").join("assets").join("EngineAssets").join("skybox"));
    }
    roots
}

/// A pack is a folder holding .tex files (directly, or in its single subfolder).
pub fn list_skyboxes(state: &AppState) -> Value {
    let _ = std::fs::create_dir_all(state.data_dir.join("skyboxes"));
    let mut packs = vec![];
    for root in skybox_roots(state) {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for e in entries.flatten() {
            let mut dir = e.path();
            if !dir.is_dir() {
                continue;
            }
            if tex_files(&dir).is_empty() {
                let subs: Vec<PathBuf> = std::fs::read_dir(&dir).map(|r| r.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default();
                match subs.as_slice() {
                    [only] if !tex_files(only).is_empty() => dir = only.clone(),
                    _ => continue,
                }
            }
            packs.push(json!({ "id": dir.to_string_lossy(), "name": e.file_name().to_string_lossy() }));
        }
    }
    packs.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
    json!({ "packs": packs, "folder": state.data_dir.join("skyboxes").to_string_lossy() })
}

/// A small preview for a pack (its preview image, else its "front" face), cached as a data URL.
pub fn skybox_thumb(state: &AppState, id: &str) -> Result<Value, String> {
    let dir = PathBuf::from(id);
    if !skybox_roots(state).iter().any(|r| dir.starts_with(r)) {
        return Err("unknown skybox".into());
    }
    let key = format!("{:x}", md5_like(id));
    let cache = state.data_dir.join("skybox-thumbs").join(format!("{key}.png"));
    if !cache.is_file() {
        let files: Vec<PathBuf> = std::fs::read_dir(&dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        let has_ext = |p: &PathBuf, exts: &[&str]| p.extension().is_some_and(|e| exts.iter().any(|x| e.eq_ignore_ascii_case(x)));
        // The pack's own preview picture, else its front face (packs that ship with Ruby only
        // have the six faces). Faces are .tex files holding a PNG or a DDS texture.
        let img = match files.iter().find(|p| has_ext(p, &["png", "jpg", "jpeg"])) {
            Some(p) => image::open(p).map_err(|e| e.to_string())?,
            None => {
                let face = ["_ft", "_bk", "_lf", "_rt"]
                    .iter()
                    .find_map(|s| files.iter().find(|p| has_ext(p, &["tex"]) && p.file_stem().is_some_and(|n| n.to_string_lossy().to_lowercase().ends_with(s))))
                    .or_else(|| files.iter().find(|p| has_ext(p, &["tex"])))
                    .ok_or("no preview")?;
                let bytes = std::fs::read(face).map_err(|e| e.to_string())?;
                match image::load_from_memory(&bytes) {
                    Ok(i) => i,
                    Err(_) => image::DynamicImage::ImageRgba8(crate::roblox::dds::decode(&bytes).ok_or("unreadable sky texture")?),
                }
            }
        };
        let thumb = img.resize_to_fill(240, 140, FilterType::Triangle).to_rgba8();
        std::fs::create_dir_all(cache.parent().unwrap()).map_err(|e| e.to_string())?;
        thumb.save_with_format(&cache, ImageFormat::Png).map_err(|e| e.to_string())?;
    }
    let bytes = std::fs::read(&cache).map_err(|e| e.to_string())?;
    Ok(json!({ "url": format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)) }))
}

/// Tiny stable hash for cache file names (not security sensitive).
fn md5_like(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RUBY_FF_OUT=<dir> cargo test ff_preview_dump -- --nocapture  (writes each preset preview)
    #[test]
    fn ff_preview_dump() {
        let Ok(out) = std::env::var("RUBY_FF_OUT") else { return };
        for (name, color) in FORCE_FIELD_PRESETS {
            let v = force_field_preview(color).expect("preview");
            let url = v["url"].as_str().unwrap();
            let png = base64::engine::general_purpose::STANDARD.decode(url.split(",").nth(1).unwrap()).unwrap();
            std::fs::write(format!("{out}/{name}.png"), png).unwrap();
        }
    }
    /// RUBY_TEST_VERSION=<fake version dir> cargo test theme -- --nocapture
    #[test]
    fn tint_fake_version() {
        let Ok(dir) = std::env::var("RUBY_TEST_VERSION") else { return };
        let dir = PathBuf::from(dir);
        let b = Backups { root: dir.join("_backup"), version: dir.clone(), touched: RefCell::new(HashSet::new()) };
        let s = ThemeSettings { enabled: true, color: "#00ff00".into(), ruby_logos: true, ..Default::default() };
        println!("tinted {} files", ui_textures(&b, &s));
        let off = ThemeSettings { enabled: false, ruby_logos: false, ..Default::default() };
        let snapshot = std::fs::read(dir.join("content/textures/ui/Emotes/Large/SegmentedCircle.png")).unwrap();
        std::fs::write(dir.join("tinted-wheel.png"), &snapshot).unwrap();
        println!("restored {} files", ui_textures(&b, &off));
    }
}
