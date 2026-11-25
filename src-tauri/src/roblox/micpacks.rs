//! Voice-chat mic icons. Roblox swaps its mic image by how loud you are (Muted, Unmuted0, 20,
//! 40, 60, 80, 100), so a character whose mouth opens wider each step "talks" when you do.
//!
//! Imported packs (your own frames) are resized to the exact size of each Roblox file.

use image::{imageops::FilterType, RgbaImage};

/// Roblox's frames, in order.
#[allow(dead_code)] // tests + documentation of what Roblox ships
pub const FRAMES: [&str; 7] = ["Muted", "Unmuted0", "Unmuted20", "Unmuted40", "Unmuted60", "Unmuted80", "Unmuted100"];

/// The voice-chat folders that hold those frames (the Speaker* sets are other people's icons).
pub const MIC_DIRS: &[&str] = &[
    "content/textures/ui/VoiceChat",
    "content/textures/ui/VoiceChat/MicDark",
    "content/textures/ui/VoiceChat/MicLight",
    "content/textures/ui/VoiceChat/New",
];

pub struct MicPack {
    pub id: &'static str,
    pub name: &'static str,
    pub draw: fn(level: Option<u8>) -> String,
}

/// Built-in packs. None ship right now: mic icons come from packs you import.
pub const MIC_PACKS: &[MicPack] = &[];

pub fn pack(id: &str) -> Option<&'static MicPack> {
    MIC_PACKS.iter().find(|p| p.id == id)
}

/// The three pictures a pack has. Roblox's six volume steps collapse onto these, so the mouth
/// just pops open when you talk instead of flickering through in-between frames.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Stage {
    Muted,
    Quiet,
    Talking,
}

impl Stage {
    pub const ALL: [Stage; 3] = [Stage::Muted, Stage::Quiet, Stage::Talking];
    /// What a built-in pack draws for this stage.
    pub fn draw_level(self) -> Option<u8> {
        match self {
            Stage::Muted => None,
            Stage::Quiet => Some(0),
            Stage::Talking => Some(70),
        }
    }
}

/// Which stage a Roblox frame (Muted, Unmuted0…100) shows.
pub fn stage_of(frame: &str) -> Option<Stage> {
    match level_of(frame)? {
        None => Some(Stage::Muted),
        Some(0) => Some(Stage::Quiet),
        Some(_) => Some(Stage::Talking),
    }
}

/// An imported pack's three pictures. Older 7-frame packs still work: talking uses their
/// middle-loud frame (60), falling back to whatever louder/quieter one exists.
pub fn load_user_stages(dir: &std::path::Path) -> std::collections::HashMap<Stage, RgbaImage> {
    let open = |n: &str| image::open(dir.join(format!("{n}.png"))).ok().map(|i| i.to_rgba8());
    let mut out = std::collections::HashMap::new();
    if let Some(i) = open("Muted") {
        out.insert(Stage::Muted, i);
    }
    if let Some(i) = open("Quiet").or_else(|| open("Unmuted0")) {
        out.insert(Stage::Quiet, i);
    }
    if let Some(i) = ["Talking", "Unmuted60", "Unmuted80", "Unmuted100", "Unmuted40", "Unmuted20"].iter().find_map(|n| open(n)) {
        out.insert(Stage::Talking, i);
    }
    // A pack with only a talking frame still gets a quiet one (and vice versa).
    if !out.contains_key(&Stage::Quiet) {
        if let Some(t) = out.get(&Stage::Talking).cloned() {
            out.insert(Stage::Quiet, t);
        }
    }
    if !out.contains_key(&Stage::Talking) {
        if let Some(q) = out.get(&Stage::Quiet).cloned() {
            out.insert(Stage::Talking, q);
        }
    }
    out
}

/// Frame name → level (None = Muted).
pub fn level_of(frame: &str) -> Option<Option<u8>> {
    if frame == "Muted" {
        return Some(None);
    }
    frame.strip_prefix("Unmuted").and_then(|n| n.parse::<u8>().ok()).map(Some)
}

/// Render an SVG at w×h (fitted, centred, transparent around it).
pub fn render_svg(svg: &str, w: u32, h: u32) -> Option<RgbaImage> {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).ok()?;
    let mut pix = resvg::tiny_skia::Pixmap::new(w.max(1), h.max(1))?;
    let size = tree.size();
    let scale = (w as f32 / size.width()).min(h as f32 / size.height());
    let (dx, dy) = ((w as f32 - size.width() * scale) / 2.0, (h as f32 - size.height() * scale) / 2.0);
    resvg::render(&tree, resvg::tiny_skia::Transform::from_row(scale, 0.0, 0.0, scale, dx, dy), &mut pix.as_mut());
    // tiny-skia is premultiplied; image wants straight alpha.
    let mut out = RgbaImage::new(w.max(1), h.max(1));
    for (i, p) in pix.pixels().iter().enumerate() {
        let c = p.demultiply();
        out.as_mut()[i * 4..i * 4 + 4].copy_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    Some(out)
}

/// An imported frame fitted to w×h (kept square-ish and centred).
pub fn fit_image(src: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    let scale = (w as f32 / src.width() as f32).min(h as f32 / src.height() as f32);
    let (sw, sh) = (((src.width() as f32 * scale).round() as u32).max(1), ((src.height() as f32 * scale).round() as u32).max(1));
    let scaled = image::imageops::resize(src, sw, sh, FilterType::Lanczos3);
    let mut canvas = RgbaImage::new(w.max(1), h.max(1));
    image::imageops::overlay(&mut canvas, &scaled, ((w - sw) / 2) as i64, ((h - sh) / 2) as i64);
    canvas
}

#[cfg(test)]
mod tests {
    use super::*;
    /// RUBY_TEST_MIC=<out dir> cargo test micpacks -- --nocapture
    #[test]
    fn render_sheet() {
        let Ok(out) = std::env::var("RUBY_TEST_MIC") else { return };
        let cell = 96u32;
        let mut sheet = RgbaImage::from_pixel(cell * 7, cell * MIC_PACKS.len() as u32, image::Rgba([40, 42, 50, 255]));
        for (row, p) in MIC_PACKS.iter().enumerate() {
            for (col, f) in FRAMES.iter().enumerate() {
                let img = render_svg(&(p.draw)(level_of(f).unwrap()), cell, cell).expect("render");
                image::imageops::overlay(&mut sheet, &img, (col as u32 * cell) as i64, (row as u32 * cell) as i64);
            }
        }
        sheet.save(std::path::Path::new(&out).join("mic-sheet.png")).unwrap();
        println!("rendered {} packs", MIC_PACKS.len());
    }

    #[test]
    fn names() {
        use crate::roblox::userpacks::mic_frame;
        assert_eq!(mic_frame("MouthMute.png"), Some("Muted"));
        assert_eq!(mic_frame("PikachuMouthClosed.png"), Some("Quiet"));
        assert_eq!(mic_frame("Mouth60.png"), Some("Unmuted60"));
        assert_eq!(mic_frame("Mouth100.png"), Some("Unmuted100"));
        assert_eq!(mic_frame("x/Unmuted20@3x.png"), Some("Unmuted20"));
        assert_eq!(mic_frame("Muted@2x.png"), Some("Muted"));
        assert_eq!(mic_frame("Unmuted0.png"), Some("Quiet"));
        assert_eq!(mic_frame("photo.png"), None);
    }
}
