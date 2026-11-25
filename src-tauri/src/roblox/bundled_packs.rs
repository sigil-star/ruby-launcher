//! Mic packs and emote wheels that ship with Ruby. On start, any that are missing are added to
//! the user's packs, exactly as if they had imported them (they can still delete them).
//! Generated from src-tauri/assets/micpacks and src-tauri/assets/wheelpacks.

use crate::state::AppState;

const FILES: &[(&str, &str, &[u8])] = &[
    ("Amy", ".ruby-pack.json", include_bytes!("../../assets/micpacks/Amy/.ruby-pack.json")),
    ("Amy", "mic/Muted.png", include_bytes!("../../assets/micpacks/Amy/mic/Muted.png")),
    ("Amy", "mic/Quiet.png", include_bytes!("../../assets/micpacks/Amy/mic/Quiet.png")),
    ("Amy", "mic/Talking.png", include_bytes!("../../assets/micpacks/Amy/mic/Talking.png")),
    ("Hello Kitty", ".ruby-pack.json", include_bytes!("../../assets/micpacks/Hello Kitty/.ruby-pack.json")),
    ("Hello Kitty", "mic/Muted.png", include_bytes!("../../assets/micpacks/Hello Kitty/mic/Muted.png")),
    ("Hello Kitty", "mic/Quiet.png", include_bytes!("../../assets/micpacks/Hello Kitty/mic/Quiet.png")),
    ("Hello Kitty", "mic/Talking.png", include_bytes!("../../assets/micpacks/Hello Kitty/mic/Talking.png")),
    ("Knuckles", ".ruby-pack.json", include_bytes!("../../assets/micpacks/Knuckles/.ruby-pack.json")),
    ("Knuckles", "mic/Muted.png", include_bytes!("../../assets/micpacks/Knuckles/mic/Muted.png")),
    ("Knuckles", "mic/Quiet.png", include_bytes!("../../assets/micpacks/Knuckles/mic/Quiet.png")),
    ("Knuckles", "mic/Talking.png", include_bytes!("../../assets/micpacks/Knuckles/mic/Talking.png")),
    ("Mic Glow", ".ruby-pack.json", include_bytes!("../../assets/micpacks/Mic Glow/.ruby-pack.json")),
    ("Mic Glow", "mic/Unmuted0.png", include_bytes!("../../assets/micpacks/Mic Glow/mic/Unmuted0.png")),
    ("Mic Glow", "mic/Unmuted100.png", include_bytes!("../../assets/micpacks/Mic Glow/mic/Unmuted100.png")),
    ("Mic Glow", "mic/Unmuted20.png", include_bytes!("../../assets/micpacks/Mic Glow/mic/Unmuted20.png")),
    ("Mic Glow", "mic/Unmuted40.png", include_bytes!("../../assets/micpacks/Mic Glow/mic/Unmuted40.png")),
    ("Mic Glow", "mic/Unmuted60.png", include_bytes!("../../assets/micpacks/Mic Glow/mic/Unmuted60.png")),
    ("Mic Glow", "mic/Unmuted80.png", include_bytes!("../../assets/micpacks/Mic Glow/mic/Unmuted80.png")),
    ("Pikachu", ".ruby-pack.json", include_bytes!("../../assets/micpacks/Pikachu/.ruby-pack.json")),
    ("Pikachu", "mic/Muted.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Muted.png")),
    ("Pikachu", "mic/Unmuted0.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Unmuted0.png")),
    ("Pikachu", "mic/Unmuted100.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Unmuted100.png")),
    ("Pikachu", "mic/Unmuted20.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Unmuted20.png")),
    ("Pikachu", "mic/Unmuted40.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Unmuted40.png")),
    ("Pikachu", "mic/Unmuted60.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Unmuted60.png")),
    ("Pikachu", "mic/Unmuted80.png", include_bytes!("../../assets/micpacks/Pikachu/mic/Unmuted80.png")),
    ("Sonic", ".ruby-pack.json", include_bytes!("../../assets/micpacks/Sonic/.ruby-pack.json")),
    ("Sonic", "mic/Muted.png", include_bytes!("../../assets/micpacks/Sonic/mic/Muted.png")),
    ("Sonic", "mic/Quiet.png", include_bytes!("../../assets/micpacks/Sonic/mic/Quiet.png")),
    ("Sonic", "mic/Talking.png", include_bytes!("../../assets/micpacks/Sonic/mic/Talking.png")),
    ("Rias Gremory", ".ruby-pack.json", include_bytes!("../../assets/wheelpacks/Rias Gremory/.ruby-pack.json")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/CircleBackground.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/CircleBackground.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/CircleBackground@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/CircleBackground@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/CircleBackground@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/CircleBackground@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SegmentedCircle.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SegmentedCircle.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SegmentedCircle@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SegmentedCircle@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SegmentedCircle@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SegmentedCircle@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SelectedGradient.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SelectedGradient.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SelectedGradient@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SelectedGradient@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SelectedGradient@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SelectedGradient@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SelectedLine.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SelectedLine.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SelectedLine@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SelectedLine@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Large/SelectedLine@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Large/SelectedLine@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/CircleBackground.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/CircleBackground.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/CircleBackground@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/CircleBackground@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/CircleBackground@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/CircleBackground@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SegmentedCircle.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SegmentedCircle.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SegmentedCircle@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SegmentedCircle@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SegmentedCircle@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SegmentedCircle@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SelectedGradient.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SelectedGradient.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SelectedGradient@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SelectedGradient@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SelectedGradient@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SelectedGradient@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SelectedLine.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SelectedLine.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SelectedLine@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SelectedLine@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/Small/SelectedLine@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/Small/SelectedLine@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/CircleBackground.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/CircleBackground.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/CircleBackground@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/CircleBackground@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/CircleBackground@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/CircleBackground@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SegmentedCircle.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SegmentedCircle.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SegmentedCircle@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SegmentedCircle@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SegmentedCircle@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SegmentedCircle@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SelectedGradient.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SelectedGradient.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SelectedGradient@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SelectedGradient@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SelectedGradient@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SelectedGradient@3x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SelectedLine.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SelectedLine.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SelectedLine@2x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SelectedLine@2x.png")),
    ("Rias Gremory", "content/textures/ui/Emotes/TenFoot/SelectedLine@3x.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/content/textures/ui/Emotes/TenFoot/SelectedLine@3x.png")),
    ("Rias Gremory", "preview.png", include_bytes!("../../assets/wheelpacks/Rias Gremory/preview.png")),
];

/// Adds bundled packs that aren't in the mods folder yet. Packs already there are left alone.
pub fn seed(state: &AppState) {
    let mods = crate::roblox::userpacks::mods_dir(state);
    let mut done = std::collections::HashSet::new();
    for (pack, _, _) in FILES {
        if !done.insert(*pack) || mods.join(pack).exists() || removed(state, pack) {
            continue;
        }
        for (p, rel, bytes) in FILES.iter().filter(|(p, _, _)| p == pack) {
            let path = mods.join(p).join(rel);
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(path, bytes);
        }
    }
}

/// Whether a pack ships with Ruby.
pub fn is_bundled(pack: &str) -> bool {
    FILES.iter().any(|(p, _, _)| *p == pack)
}

/// Packs the user deleted stay deleted.
fn removed(state: &AppState, pack: &str) -> bool {
    std::fs::read_to_string(state.data_dir.join("removed-bundled-packs.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .is_some_and(|v| v.iter().any(|x| x == pack))
}

/// Remember a bundled pack the user deleted, so it isn't added back.
pub fn forget(state: &AppState, pack: &str) {
    if !FILES.iter().any(|(p, _, _)| *p == pack) {
        return;
    }
    let path = state.data_dir.join("removed-bundled-packs.json");
    let mut v: Vec<String> = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    if !v.iter().any(|x| x == pack) {
        v.push(pack.to_string());
        let _ = std::fs::write(path, serde_json::to_string(&v).unwrap_or_default());
    }
}
