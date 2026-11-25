//! Bundled customisation packs: cursors and emote wheel styles.
//!
//! Cursors: Kenney's "Cursor Pack" (CC0, kenney.nl) and "RedGlow" by Shira (CC BY,
//! rw-designer.com). Roblox centres its cursor image on the mouse, so each source cursor is
//! fitted into a 64×64 canvas with its tip (or centre, for crosshairs) on the middle pixel.
//!
//! Emote wheels: Ruby's own styles, made by recolouring Roblox's own wheel layers, so the
//! geometry always matches the client exactly.

use base64::Engine;
use image::{imageops::FilterType, ImageFormat, RgbaImage};
use serde_json::{json, Value};

macro_rules! k {
    ($f:literal) => {
        include_bytes!(concat!("../../assets/cursors/kenney/", $f, ".png"))
    };
}

pub struct CursorPack {
    pub id: &'static str,
    pub name: &'static str,
    pub credit: &'static str,
    /// Normal arrow (ArrowFarCursor) and over-a-button pointer (ArrowCursor).
    pub normal: &'static [u8],
    pub hover: &'static [u8],
    /// Crosshairs/dots: the centre is the hotspot, not the top-left tip.
    pub centered: bool,
    /// Matching extras, so the whole set changes together: shift-lock reticle, and the
    /// open/closed hands for dragging.
    pub lock: &'static [u8],
    pub drag_open: &'static [u8],
    pub drag_closed: &'static [u8],
}

/// The text (I-beam) cursor every style shares, tinted with the cursor colour.
pub const TEXT_CURSOR: &[u8] = k!("bracket_a_vertical");

/// Shift-lock reticles you can pick on their own ("Match cursor" uses the style's own).
pub const SHIFT_LOCKS: &[(&str, &str)] = &[("crosshair", "Crosshair"), ("cross", "X"), ("ring", "Ring"), ("dot", "Dot")];

pub fn shift_lock_art(id: &str) -> Option<&'static [u8]> {
    Some(match id {
        "cross" => k!("cross_small"),
        "crosshair" => k!("target_a"),
        "ring" => k!("target_round_a"),
        "dot" => k!("dot_small"),
        _ => return None,
    })
}

const KENNEY: &str = "Kenney · CC0";

pub const CURSORS: &[CursorPack] = &[
    CursorPack { id: "classic", name: "Classic", credit: KENNEY, normal: k!("pointer_a"), hover: k!("hand_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "sharp", name: "Sharp", credit: KENNEY, normal: k!("pointer_b"), hover: k!("hand_small_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "rounded", name: "Rounded", credit: KENNEY, normal: k!("pointer_c"), hover: k!("hand_thin_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "toon", name: "Toon", credit: KENNEY, normal: k!("pointer_toon_a"), hover: k!("pointer_toon_b"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "scifi", name: "Sci-fi", credit: KENNEY, normal: k!("pointer_scifi_a"), hover: k!("pointer_scifi_b"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "gauntlet", name: "Gauntlet", credit: KENNEY, normal: k!("gauntlet_default"), hover: k!("gauntlet_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "sword", name: "Sword", credit: KENNEY, normal: k!("tool_sword_a"), hover: k!("tool_sword_b"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "wand", name: "Wand", credit: KENNEY, normal: k!("tool_wand"), hover: k!("tool_wand"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "crosshair", name: "Crosshair", credit: KENNEY, normal: k!("target_a"), hover: k!("target_b"), centered: true, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "target", name: "Target", credit: KENNEY, normal: k!("target_round_a"), hover: k!("target_round_b"), centered: true, lock: k!("target_round_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "arrow-d", name: "Triangle", credit: KENNEY, normal: k!("pointer_d"), hover: k!("hand_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "arrow-e", name: "Bold", credit: KENNEY, normal: k!("pointer_e"), hover: k!("hand_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "arrow-f", name: "Chunky", credit: KENNEY, normal: k!("pointer_f"), hover: k!("hand_small_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "arrow-g", name: "Slim", credit: KENNEY, normal: k!("pointer_g"), hover: k!("hand_small_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "arrow-h", name: "Big", credit: KENNEY, normal: k!("pointer_h"), hover: k!("hand_thin_point"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "axe", name: "Axe", credit: KENNEY, normal: k!("tool_axe"), hover: k!("tool_axe"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "pickaxe", name: "Pickaxe", credit: KENNEY, normal: k!("tool_pickaxe"), hover: k!("tool_pickaxe"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "hammer", name: "Hammer", credit: KENNEY, normal: k!("tool_hammer"), hover: k!("tool_hammer"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "bow", name: "Bow", credit: KENNEY, normal: k!("tool_bow"), hover: k!("tool_bow"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "torch", name: "Torch", credit: KENNEY, normal: k!("tool_torch"), hover: k!("tool_torch"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "wrench", name: "Wrench", credit: KENNEY, normal: k!("tool_wrench"), hover: k!("tool_wrench"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "pencil", name: "Pencil", credit: KENNEY, normal: k!("drawing_pencil"), hover: k!("drawing_pencil"), centered: false, lock: k!("target_a"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack { id: "dot", name: "Dot", credit: KENNEY, normal: k!("dot_small"), hover: k!("dot_large"), centered: true, lock: k!("dot_small"), drag_open: k!("hand_open"), drag_closed: k!("hand_closed") },
    CursorPack {
        id: "redglow",
        name: "RedGlow",
        credit: "Shira · CC BY",
        normal: include_bytes!("../../assets/cursors/redglow/ArrowFarCursor.png"),
        hover: include_bytes!("../../assets/cursors/redglow/ArrowCursor.png"),
        centered: false,
        lock: k!("dot_small"),
        drag_open: k!("hand_open"),
        drag_closed: k!("hand_closed"),
    },
];

pub fn cursor(id: &str) -> Option<&'static CursorPack> {
    CURSORS.iter().find(|c| c.id == id)
}

/// Fit cursor art into a w×h file with its centre as the hotspot (shift lock, drag hands, text).
pub fn compose_centered(src: &[u8], color: Option<[u8; 3]>, w: u32, h: u32, fill: f32) -> Option<RgbaImage> {
    let img = image::load_from_memory(src).ok()?.to_rgba8();
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, p) in img.enumerate_pixels() {
        if p[3] > 24 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    if x0 > x1 {
        return None;
    }
    let cropped = image::imageops::crop_imm(&img, x0, y0, x1 - x0 + 1, y1 - y0 + 1).to_image();
    let box_ = (w.min(h) as f32 * fill).max(1.0);
    let scale = box_ / cropped.width().max(cropped.height()) as f32;
    let (sw, sh) = (((cropped.width() as f32 * scale).round() as u32).max(1), ((cropped.height() as f32 * scale).round() as u32).max(1));
    let mut scaled = image::imageops::resize(&cropped, sw, sh, FilterType::Lanczos3);
    if let Some(rgb) = color {
        for p in scaled.pixels_mut() {
            let l = (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0;
            p.0 = [(rgb[0] as f32 * l) as u8, (rgb[1] as f32 * l) as u8, (rgb[2] as f32 * l) as u8, p[3]];
        }
    }
    let mut canvas = RgbaImage::new(w.max(1), h.max(1));
    image::imageops::overlay(&mut canvas, &scaled, (w as i64 - sw as i64) / 2, (h as i64 - sh as i64) / 2);
    Some(canvas)
}

/// Fit a cursor into Roblox's 64×64 canvas with its hotspot on the centre pixel.
pub fn compose_cursor(src: &[u8], centered: bool, color: Option<[u8; 3]>) -> Option<RgbaImage> {
    let img = image::load_from_memory(src).ok()?.to_rgba8();
    // Crop to what's visible.
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, p) in img.enumerate_pixels() {
        if p[3] > 24 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    if x0 > x1 {
        return None;
    }
    let cropped = image::imageops::crop_imm(&img, x0, y0, x1 - x0 + 1, y1 - y0 + 1).to_image();
    // About the size of Roblox's own arrow; crosshairs a little smaller.
    let target = if centered { 26.0 } else { 30.0 };
    let scale = target / cropped.width().max(cropped.height()) as f32;
    let (w, h) = (((cropped.width() as f32 * scale).round() as u32).max(1), ((cropped.height() as f32 * scale).round() as u32).max(1));
    let mut scaled = image::imageops::resize(&cropped, w, h, FilterType::Lanczos3);
    if let Some(rgb) = color {
        // Light fill takes the colour; dark outlines stay dark.
        for p in scaled.pixels_mut() {
            let l = (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0;
            p.0 = [(rgb[0] as f32 * l) as u8, (rgb[1] as f32 * l) as u8, (rgb[2] as f32 * l) as u8, p[3]];
        }
    }
    let (hx, hy) = if centered {
        (w / 2, h / 2)
    } else {
        // Tip: the top-most visible pixel (left-most within that row).
        scaled.enumerate_pixels().find(|(_, _, p)| p[3] > 96).map(|(x, y, _)| (x, y)).unwrap_or((0, 0))
    };
    let mut canvas = RgbaImage::new(64, 64);
    image::imageops::overlay(&mut canvas, &scaled, 32 - hx as i64, 32 - hy as i64);
    Some(canvas)
}

pub struct WheelStyle {
    pub id: &'static str,
    pub name: &'static str,
    /// Background disc colour and how opaque it is (multiplies the original alpha).
    pub bg: [u8; 3],
    pub bg_alpha: f32,
    /// Segment lines and outer ring.
    pub lines: [u8; 3],
    /// The highlighted slice (gradient + line).
    pub selected: [u8; 3],
}

pub const WHEELS: &[WheelStyle] = &[
    WheelStyle { id: "ruby", name: "Ruby", bg: [42, 7, 16], bg_alpha: 1.1, lines: [255, 59, 92], selected: [255, 59, 92] },
    WheelStyle { id: "midnight", name: "Midnight", bg: [11, 15, 30], bg_alpha: 1.15, lines: [108, 140, 255], selected: [159, 179, 255] },
    WheelStyle { id: "neon", name: "Neon", bg: [8, 2, 16], bg_alpha: 1.15, lines: [255, 43, 214], selected: [0, 240, 255] },
    WheelStyle { id: "glass", name: "Glass", bg: [255, 255, 255], bg_alpha: 0.35, lines: [255, 255, 255], selected: [255, 255, 255] },
    WheelStyle { id: "mint", name: "Mint", bg: [6, 32, 24], bg_alpha: 1.1, lines: [61, 220, 132], selected: [61, 220, 132] },
    WheelStyle { id: "sunset", name: "Sunset", bg: [36, 12, 4], bg_alpha: 1.1, lines: [255, 122, 0], selected: [255, 214, 10] },
    // Light: the opposite of Roblox's dark wheel, so it's obvious at a glance.
    WheelStyle { id: "light", name: "Light", bg: [245, 246, 250], bg_alpha: 1.25, lines: [40, 42, 50], selected: [51, 95, 255] },
];

pub fn wheel(id: &str) -> Option<&'static WheelStyle> {
    WHEELS.iter().find(|w| w.id == id)
}

#[derive(Clone, Copy, PartialEq)]
pub enum WheelLayer {
    Background,
    Lines,
    Selected,
}

/// Which wheel layer a file under content/textures/ui/Emotes is, if any.
pub fn wheel_layer(rel: &str) -> Option<WheelLayer> {
    let name = rel.rsplit('/').next()?.to_ascii_lowercase();
    if !rel.contains("ui/Emotes/") {
        return None;
    }
    if name.starts_with("circlebackground") || name.starts_with("wheel") {
        Some(WheelLayer::Background)
    } else if name.starts_with("segmentedcircle") {
        Some(WheelLayer::Lines)
    } else if name.starts_with("selectedgradient") || name.starts_with("selectedline") || name.starts_with("orangehighlight") {
        Some(WheelLayer::Selected)
    } else {
        None
    }
}

pub fn recolor_wheel(img: &mut RgbaImage, style: &WheelStyle, layer: WheelLayer) {
    for p in img.pixels_mut() {
        let [r, g, b, a] = p.0;
        if a == 0 {
            continue;
        }
        match layer {
            WheelLayer::Background => {
                p.0 = [style.bg[0], style.bg[1], style.bg[2], ((a as f32 * style.bg_alpha).min(255.0)) as u8];
            }
            WheelLayer::Lines | WheelLayer::Selected => {
                let c = if layer == WheelLayer::Lines { style.lines } else { style.selected };
                let l = (0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32) / 255.0;
                // Keep them bright: lift the brightness so thin lines don't go dim.
                let l = (l * 1.15).min(1.0);
                p.0 = [(c[0] as f32 * l) as u8, (c[1] as f32 * l) as u8, (c[2] as f32 * l) as u8, a];
            }
        }
    }
}

fn data_url(img: &RgbaImage) -> String {
    let mut out = std::io::Cursor::new(Vec::new());
    let _ = img.write_to(&mut out, ImageFormat::Png);
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner()))
}

/// Everything the Mods page lists, with previews.
pub fn catalog(cursor_color: Option<[u8; 3]>) -> Value {
    let cursors: Vec<Value> = CURSORS
        .iter()
        .map(|c| {
            let preview = compose_cursor(c.normal, c.centered, cursor_color).map(|i| data_url(&i));
            // The whole matching set, for the "this changes too" strip.
            let extra = cursor_color.or_else(|| (c.id == "redglow").then_some([255, 48, 64]));
            let set = json!({
                "hover": compose_cursor(c.hover, c.centered, cursor_color).map(|i| data_url(&i)),
                "text": compose_centered(TEXT_CURSOR, extra, 64, 64, 0.42).map(|i| data_url(&i)),
                "lock": compose_centered(c.lock, extra, 64, 64, 0.5).map(|i| data_url(&i)),
                "dragOpen": compose_centered(c.drag_open, extra, 64, 64, 0.55).map(|i| data_url(&i)),
                "dragClosed": compose_centered(c.drag_closed, extra, 64, 64, 0.55).map(|i| data_url(&i)),
            });
            json!({ "id": c.id, "name": c.name, "credit": c.credit, "preview": preview, "set": set })
        })
        .collect();
    let wheels: Vec<Value> = WHEELS
        .iter()
        .map(|w| json!({ "id": w.id, "name": w.name, "bg": format!("#{:02x}{:02x}{:02x}", w.bg[0], w.bg[1], w.bg[2]), "lines": format!("#{:02x}{:02x}{:02x}", w.lines[0], w.lines[1], w.lines[2]), "selected": format!("#{:02x}{:02x}{:02x}", w.selected[0], w.selected[1], w.selected[2]), "bgAlpha": w.bg_alpha }))
        .collect();
    let shift_locks: Vec<Value> = SHIFT_LOCKS
        .iter()
        .map(|(id, name)| json!({ "id": id, "name": name, "preview": shift_lock_art(id).and_then(|a| compose_centered(a, cursor_color, 64, 64, 0.5)).map(|i| data_url(&i)) }))
        .collect();
    json!({ "cursors": cursors, "wheels": wheels, "shiftLocks": shift_locks })
}

#[cfg(test)]
mod tests {
    use super::*;
    /// RUBY_TEST_PACKS=<out dir> [RUBY_TEST_EMOTES=<…/ui/Emotes/Large>] cargo test packs -- --nocapture
    #[test]
    fn render_previews() {
        let Ok(out) = std::env::var("RUBY_TEST_PACKS") else { return };
        let out = std::path::PathBuf::from(out);
        // Cursor sheet: each cell is Roblox's 64×64 canvas on grey; red dot = hotspot (centre).
        let mut sheet = RgbaImage::from_pixel(64 * CURSORS.len() as u32, 128, image::Rgba([70, 70, 80, 255]));
        for (i, c) in CURSORS.iter().enumerate() {
            for (row, src) in [c.normal, c.hover].iter().enumerate() {
                let cell = compose_cursor(src, c.centered, None).expect("cursor");
                image::imageops::overlay(&mut sheet, &cell, i as i64 * 64, row as i64 * 64);
                sheet.put_pixel(i as u32 * 64 + 32, row as u32 * 64 + 32, image::Rgba([255, 0, 0, 255]));
            }
        }
        sheet.save(out.join("cursors.png")).unwrap();
        if let Ok(dir) = std::env::var("RUBY_TEST_EMOTES") {
            let dir = std::path::PathBuf::from(dir);
            for st in WHEELS {
                let style = st.id;
                let mut bg = image::open(dir.join("CircleBackground.png")).unwrap().to_rgba8();
                recolor_wheel(&mut bg, st, WheelLayer::Background);
                let mut lines = image::open(dir.join("SegmentedCircle.png")).unwrap().to_rgba8();
                recolor_wheel(&mut lines, st, WheelLayer::Lines);
                let mut canvas = RgbaImage::from_pixel(bg.width(), bg.height(), image::Rgba([110, 140, 90, 255]));
                image::imageops::overlay(&mut canvas, &bg, 0, 0);
                let off = ((bg.width() as i64 - lines.width() as i64) / 2, (bg.height() as i64 - lines.height() as i64) / 2);
                image::imageops::overlay(&mut canvas, &lines, off.0, off.1);
                canvas.save(out.join(format!("wheel-{style}.png"))).unwrap();
            }
        }
        println!("rendered");
    }
}

#[cfg(test)]
mod set_tests {
    use super::*;
    /// RUBY_TEST_PACKS=<out dir> cargo test set_tests -- --nocapture
    #[test]
    fn render_sets() {
        let Ok(out) = std::env::var("RUBY_TEST_PACKS") else { return };
        // Columns: normal, hover, text (64), shift lock (32), drag open, drag closed (23x25). Real sizes.
        let mut sheet = RgbaImage::from_pixel(64 * 3 + 40 * 3, 64 * CURSORS.len() as u32, image::Rgba([70, 70, 80, 255]));
        for (row, c) in CURSORS.iter().enumerate() {
            let y = row as i64 * 64;
            let cells = [
                compose_cursor(c.normal, c.centered, None),
                compose_cursor(c.hover, c.centered, None),
                compose_centered(TEXT_CURSOR, None, 64, 64, 0.42),
                compose_centered(c.lock, None, 32, 32, 0.8),
                compose_centered(c.drag_open, None, 23, 25, 0.95),
                compose_centered(c.drag_closed, None, 23, 25, 0.95),
            ];
            let mut x = 0i64;
            for (i, cell) in cells.into_iter().enumerate() {
                let img = cell.expect("cursor");
                image::imageops::overlay(&mut sheet, &img, x, y + (64 - img.height() as i64) / 2);
                x += if i < 3 { 64 } else { 40 };
            }
        }
        sheet.save(std::path::Path::new(&out).join("cursor-sets.png")).unwrap();
        println!("rendered sets");
    }
}
