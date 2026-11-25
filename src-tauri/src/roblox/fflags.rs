//! Graphics FastFlags. Since Sept 2025 Roblox only honours flags on its allowlist, so Ruby only
//! ever writes those: a quality level, texture quality, anti-aliasing, graphics API, grass,
//! mesh detail and a few toggles. Flags Ruby set before are removed when turned off, and any
//! flags the user (or another launcher) added by hand are left alone.

use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

/// Roblox's published allowlist (devforum "Allowlist for local client configuration via Fast Flags").
pub const ALLOWLIST: &[&str] = &[
    "DFIntCSGLevelOfDetailSwitchingDistance",
    "DFIntCSGLevelOfDetailSwitchingDistanceL12",
    "DFIntCSGLevelOfDetailSwitchingDistanceL23",
    "DFIntCSGLevelOfDetailSwitchingDistanceL34",
    "FFlagHandleAltEnterFullscreenManually",
    "DFFlagTextureQualityOverrideEnabled",
    "DFIntTextureQualityOverride",
    "FIntDebugForceMSAASamples",
    "DFFlagDisableDPIScale",
    "FFlagDebugGraphicsPreferD3D11",
    "FFlagDebugSkyGray",
    "DFFlagDebugPauseVoxelizer",
    "DFIntDebugFRMQualityLevelOverride",
    "FIntFRMMaxGrassDistance",
    "FIntFRMMinGrassDistance",
    "FFlagDebugGraphicsPreferVulkan",
    "FFlagDebugGraphicsPreferOpenGL",
    "FIntGrassMovementReducedMotionFactor",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GraphicsFlags {
    /// 0 = let Roblox decide; 1..=10 = fixed quality (like the in-game slider, but locked).
    pub quality: u8,
    /// "auto" | "lowest" | "low" | "medium" | "high"
    pub textures: String,
    /// 0 = auto, 1/2/4/8 samples
    pub msaa: u8,
    /// "auto" | "d3d11" | "vulkan" | "opengl"
    pub api: String,
    pub no_grass: bool,
    pub low_detail_meshes: bool,
    pub gray_sky: bool,
    pub no_dpi_scale: bool,
    pub alt_enter_fullscreen: bool,
    pub pause_voxelizer: bool,
}

impl Default for GraphicsFlags {
    fn default() -> Self {
        Self {
            quality: 0,
            textures: "auto".into(),
            msaa: 0,
            api: "auto".into(),
            no_grass: false,
            low_detail_meshes: false,
            gray_sky: false,
            no_dpi_scale: false,
            alt_enter_fullscreen: false,
            pause_voxelizer: false,
        }
    }
}

fn path(state: &AppState) -> PathBuf {
    state.data_dir.join("graphics-flags.json")
}

pub fn load(state: &AppState) -> GraphicsFlags {
    std::fs::read_to_string(path(state)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// The flags these settings turn into (only allowlisted names).
pub fn flags(g: &GraphicsFlags) -> Map<String, Value> {
    let mut m = Map::new();
    if (1..=10).contains(&g.quality) {
        // Roblox's renderer has 21 levels; the user-facing slider is 1–10.
        let level = ((g.quality as u32) * 21 + 9) / 10;
        m.insert("DFIntDebugFRMQualityLevelOverride".into(), json!(level.clamp(1, 21)));
    }
    let tex = match g.textures.as_str() {
        "lowest" => Some(0),
        "low" => Some(1),
        "medium" => Some(2),
        "high" => Some(3),
        _ => None,
    };
    if let Some(t) = tex {
        m.insert("DFFlagTextureQualityOverrideEnabled".into(), json!(true));
        m.insert("DFIntTextureQualityOverride".into(), json!(t));
    }
    if matches!(g.msaa, 1 | 2 | 4 | 8) {
        m.insert("FIntDebugForceMSAASamples".into(), json!(g.msaa));
    }
    match g.api.as_str() {
        "d3d11" => {
            m.insert("FFlagDebugGraphicsPreferD3D11".into(), json!(true));
        }
        "vulkan" => {
            m.insert("FFlagDebugGraphicsPreferVulkan".into(), json!(true));
        }
        "opengl" => {
            m.insert("FFlagDebugGraphicsPreferOpenGL".into(), json!(true));
        }
        _ => {}
    }
    if g.no_grass {
        m.insert("FIntFRMMinGrassDistance".into(), json!(0));
        m.insert("FIntFRMMaxGrassDistance".into(), json!(0));
        m.insert("FIntGrassMovementReducedMotionFactor".into(), json!(0));
    }
    if g.low_detail_meshes {
        for k in ["DFIntCSGLevelOfDetailSwitchingDistance", "DFIntCSGLevelOfDetailSwitchingDistanceL12", "DFIntCSGLevelOfDetailSwitchingDistanceL23", "DFIntCSGLevelOfDetailSwitchingDistanceL34"] {
            m.insert(k.into(), json!(0));
        }
    }
    if g.gray_sky {
        m.insert("FFlagDebugSkyGray".into(), json!(true));
    }
    if g.no_dpi_scale {
        m.insert("DFFlagDisableDPIScale".into(), json!(true));
    }
    if g.alt_enter_fullscreen {
        m.insert("FFlagHandleAltEnterFullscreenManually".into(), json!(false));
    }
    if g.pause_voxelizer {
        m.insert("DFFlagDebugPauseVoxelizer".into(), json!(true));
    }
    debug_assert!(m.keys().all(|k| ALLOWLIST.contains(&k.as_str())));
    m
}

fn settings_files() -> Vec<PathBuf> {
    let Some(local) = dirs::data_local_dir() else { return vec![] };
    let root = local.join("Roblox");
    let mut v = vec![root.join("ClientSettings").join("ClientAppSettings.json")];
    if let Ok(entries) = std::fs::read_dir(root.join("Versions")) {
        for e in entries.flatten() {
            let p = e.path();
            if p.join("RobloxPlayerBeta.exe").is_file() {
                v.push(p.join("ClientSettings").join("ClientAppSettings.json"));
            }
        }
    }
    v
}

/// Write the current flags into every ClientAppSettings.json Roblox reads.
pub fn apply(state: &AppState) -> usize {
    // Never touch the files until the user has set graphics in Ruby at least once.
    if !path(state).is_file() {
        return 0;
    }
    let want = flags(&load(state));
    let mut n = 0;
    for file in settings_files() {
        let mut cur: Map<String, Value> = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let before = cur.clone();
        // Ruby owns the allowlisted names; everything else in the file is someone else's.
        cur.retain(|k, _| !ALLOWLIST.contains(&k.as_str()));
        cur.extend(want.clone());
        if cur != before {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if std::fs::write(&file, serde_json::to_string_pretty(&Value::Object(cur)).unwrap_or_default()).is_ok() {
                n += 1;
            }
        }
    }
    n
}

/// Uninstall: take Ruby's flags out of Roblox's settings files, keeping your saved choices.
pub fn clear_files() {
    for file in settings_files() {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let Ok(mut cur) = serde_json::from_str::<Map<String, Value>>(&text) else { continue };
        let before = cur.len();
        cur.retain(|k, _| !ALLOWLIST.contains(&k.as_str()));
        if cur.len() != before {
            let _ = std::fs::write(&file, serde_json::to_string_pretty(&Value::Object(cur)).unwrap_or_default());
        }
    }
}

pub fn get(state: &AppState) -> Value {
    let g = load(state);
    json!({ "settings": g, "flags": flags(&g), "allowlist": ALLOWLIST })
}

pub fn set(state: &AppState, v: Value) -> Result<Value, String> {
    let g: GraphicsFlags = serde_json::from_value(v).map_err(|e| e.to_string())?;
    std::fs::write(path(state), serde_json::to_string_pretty(&g).unwrap_or_default()).map_err(|e| e.to_string())?;
    let files = apply(state);
    Ok(json!({ "ok": true, "files": files, "flags": flags(&g) }))
}
