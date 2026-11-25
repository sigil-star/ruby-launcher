//! Recolour DXT3/DXT5 (BC2/BC3) DDS textures in place, level by level (mipmaps included),
//! keeping the header untouched. Used for the force field colour.

use texpresso::{Format, Params};

#[derive(Clone, Copy)]
pub enum Mode {
    /// Solid colour, original alpha (the bubble's colour layers).
    Replace,
    /// Colour scaled by each pixel's brightness (glows keep their falloff).
    Brightness,
}

fn u32_at(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// What to paint with: one colour, or a rainbow that sweeps across the texture.
#[derive(Clone, Copy)]
pub enum Paint {
    Solid([u8; 3]),
    Rainbow,
}

impl Paint {
    pub fn parse(s: &str, hex: impl Fn(&str) -> [u8; 3]) -> Paint {
        if s.eq_ignore_ascii_case("rainbow") { Paint::Rainbow } else { Paint::Solid(hex(s)) }
    }
    pub fn at(self, x: usize, y: usize, w: usize, h: usize) -> [u8; 3] {
        match self {
            Paint::Solid(c) => c,
            Paint::Rainbow => {
                // Diagonal bands, a full spectrum across the texture, vivid but not neon.
                let t = (x as f32 / w.max(1) as f32 + y as f32 / h.max(1) as f32 * 0.6).fract();
                hsv(t * 360.0, 0.85, 1.0)
            }
        }
    }
}

fn hsv(h: f32, s: f32, v: f32) -> [u8; 3] {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let (r, g, b) = match (h / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    [((r + m) * 255.0) as u8, ((g + m) * 255.0) as u8, ((b + m) * 255.0) as u8]
}

/// Run `f(rgba, w, h)` on every mip level of a DXT texture and re-encode it.
pub fn transform(dds: &[u8], f: impl Fn(&mut [u8], usize, usize)) -> Option<Vec<u8>> {
    if dds.len() < 128 || &dds[0..4] != b"DDS " {
        return None;
    }
    let height = u32_at(dds, 12) as usize;
    let width = u32_at(dds, 16) as usize;
    let mips = (u32_at(dds, 28) as usize).max(1);
    let format = match &dds[84..88] {
        b"DXT3" => Format::Bc2,
        b"DXT5" => Format::Bc3,
        b"DXT1" => Format::Bc1,
        _ => return None,
    };
    let mut out = dds[..128].to_vec();
    let mut at = 128usize;
    for level in 0..mips {
        let (w, h) = ((width >> level).max(1), (height >> level).max(1));
        let size = format.compressed_size(w, h);
        let Some(block) = dds.get(at..at + size) else { break };
        let mut rgba = vec![0u8; w * h * 4];
        format.decompress(block, w, h, &mut rgba);
        f(&mut rgba, w, h);
        let mut enc = vec![0u8; size];
        format.compress(&rgba, w, h, Params::default(), &mut enc);
        out.extend_from_slice(&enc);
        at += size;
    }
    if let Some(rest) = dds.get(at..) {
        out.extend_from_slice(rest);
    }
    Some(out)
}

pub fn recolor(dds: &[u8], paint: Paint, mode: Mode) -> Option<Vec<u8>> {
    if dds.len() < 128 || &dds[0..4] != b"DDS " {
        return None;
    }
    let height = u32_at(dds, 12) as usize;
    let width = u32_at(dds, 16) as usize;
    let mips = (u32_at(dds, 28) as usize).max(1);
    let format = match &dds[84..88] {
        b"DXT3" => Format::Bc2,
        b"DXT5" => Format::Bc3,
        b"DXT1" => Format::Bc1,
        _ => return None,
    };
    let mut out = dds[..128].to_vec();
    let mut at = 128usize;
    for level in 0..mips {
        let (w, h) = ((width >> level).max(1), (height >> level).max(1));
        let size = format.compressed_size(w, h);
        let Some(block) = dds.get(at..at + size) else { break };
        let mut rgba = vec![0u8; w * h * 4];
        format.decompress(block, w, h, &mut rgba);
        for (i, p) in rgba.chunks_exact_mut(4).enumerate() {
            let rgb = paint.at(i % w, i / w, w, h);
            match mode {
                Mode::Replace => {
                    p[0] = rgb[0];
                    p[1] = rgb[1];
                    p[2] = rgb[2];
                }
                Mode::Brightness => {
                    let l = p[0].max(p[1]).max(p[2]) as u32;
                    p[0] = (rgb[0] as u32 * l / 255) as u8;
                    p[1] = (rgb[1] as u32 * l / 255) as u8;
                    p[2] = (rgb[2] as u32 * l / 255) as u8;
                }
            }
        }
        let mut enc = vec![0u8; size];
        format.compress(&rgba, w, h, Params::default(), &mut enc);
        out.extend_from_slice(&enc);
        at += size;
    }
    // Anything after the mip chain (rare) is kept as-is.
    if let Some(rest) = dds.get(at..) {
        out.extend_from_slice(rest);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    /// RUBY_TEST_DDS=<in.dds> RUBY_TEST_DDS_OUT=<out.dds> cargo test dds -- --nocapture
    #[test]
    fn recolor_real_dds() {
        let (Ok(input), Ok(out)) = (std::env::var("RUBY_TEST_DDS"), std::env::var("RUBY_TEST_DDS_OUT")) else { return };
        let bytes = std::fs::read(input).unwrap();
        let res = super::recolor(&bytes, super::Paint::Solid([0, 255, 0]), super::Mode::Brightness).expect("recolored");
        assert_eq!(res.len(), bytes.len(), "size must match the original");
        // Average colour of the top level after re-encoding.
        let (w, h) = (u32::from_le_bytes(res[16..20].try_into().unwrap()) as usize, u32::from_le_bytes(res[12..16].try_into().unwrap()) as usize);
        let fmt = if &res[84..88] == b"DXT3" { texpresso::Format::Bc2 } else { texpresso::Format::Bc3 };
        let mut rgba = vec![0u8; w * h * 4];
        fmt.decompress(&res[128..128 + fmt.compressed_size(w, h)], w, h, &mut rgba);
        let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
        for p in rgba.chunks_exact(4).filter(|p| p[3] > 16) {
            r += p[0] as u64; g += p[1] as u64; b += p[2] as u64; n += 1;
        }
        println!("{}x{} avg rgb over {} visible px: {} {} {}", w, h, n, r / n.max(1), g / n.max(1), b / n.max(1));
        std::fs::write(out, res).unwrap();
    }
}


/// The top level of a DXT texture as it is, undecorated (previews).
pub fn decode(dds: &[u8]) -> Option<image::RgbaImage> {
    if dds.len() < 128 || &dds[0..4] != b"DDS " {
        return None;
    }
    let height = u32_at(dds, 12) as usize;
    let width = u32_at(dds, 16) as usize;
    let format = match &dds[84..88] {
        b"DXT3" => Format::Bc2,
        b"DXT5" => Format::Bc3,
        b"DXT1" => Format::Bc1,
        _ => return None,
    };
    let size = format.compressed_size(width, height);
    let mut rgba = vec![0u8; width * height * 4];
    format.decompress(dds.get(128..128 + size)?, width, height, &mut rgba);
    image::RgbaImage::from_raw(width as u32, height as u32, rgba)
}
