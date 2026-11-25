//! Minimal TrueType patcher: replace the outline of chosen glyphs (by codepoint) with polygons,
//! keeping every other glyph byte-for-byte. Used to put Ruby's logo into Roblox's BuilderIcons
//! icon font (the in-game menu button and other logo spots draw the "tilt" glyph, U+F200).
//!
//! Rebuilds `glyf` + `loca` (switching to long offsets), updates `head`, and recomputes all
//! table checksums plus head.checkSumAdjustment.

use std::collections::HashMap;

fn u16_at(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(o)?, *b.get(o + 1)?]))
}
fn i16_at(b: &[u8], o: usize) -> Option<i16> {
    u16_at(b, o).map(|v| v as i16)
}
fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*b.get(o)?, *b.get(o + 1)?, *b.get(o + 2)?, *b.get(o + 3)?]))
}

struct Table {
    tag: [u8; 4],
    data: Vec<u8>,
}

fn read_tables(font: &[u8]) -> Option<(u32, Vec<Table>)> {
    let version = u32_at(font, 0)?;
    let n = u16_at(font, 4)? as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let rec = 12 + i * 16;
        let tag = [font[rec], font[rec + 1], font[rec + 2], font[rec + 3]];
        let off = u32_at(font, rec + 8)? as usize;
        let len = u32_at(font, rec + 12)? as usize;
        out.push(Table { tag, data: font.get(off..off + len)?.to_vec() });
    }
    Some((version, out))
}

fn table<'a>(tables: &'a [Table], tag: &[u8; 4]) -> Option<&'a Table> {
    tables.iter().find(|t| &t.tag == tag)
}

/// Glyph index for a codepoint via cmap format 12 or 4.
fn glyph_for(cmap: &[u8], cp: u32) -> Option<u16> {
    let n = u16_at(cmap, 2)? as usize;
    let mut f4 = None;
    for i in 0..n {
        let off = u32_at(cmap, 4 + i * 8 + 4)? as usize;
        match u16_at(cmap, off)? {
            12 => {
                let groups = u32_at(cmap, off + 12)? as usize;
                for g in 0..groups {
                    let r = off + 16 + g * 12;
                    let (start, end, gid) = (u32_at(cmap, r)?, u32_at(cmap, r + 4)?, u32_at(cmap, r + 8)?);
                    if cp >= start && cp <= end {
                        return Some((gid + cp - start) as u16);
                    }
                }
            }
            4 => f4 = Some(off),
            _ => {}
        }
    }
    let off = f4?;
    if cp > 0xFFFF {
        return None;
    }
    let cp = cp as u16;
    let seg2 = u16_at(cmap, off + 6)? as usize;
    let ends = off + 14;
    let starts = ends + seg2 + 2;
    let deltas = starts + seg2;
    let ranges = deltas + seg2;
    for s in 0..seg2 / 2 {
        let end = u16_at(cmap, ends + s * 2)?;
        if cp > end {
            continue;
        }
        let start = u16_at(cmap, starts + s * 2)?;
        if cp < start {
            return None;
        }
        let delta = u16_at(cmap, deltas + s * 2)?;
        let ro = u16_at(cmap, ranges + s * 2)? as usize;
        if ro == 0 {
            return Some(cp.wrapping_add(delta));
        }
        let addr = ranges + s * 2 + ro + (cp - start) as usize * 2;
        let g = u16_at(cmap, addr)?;
        return Some(if g == 0 { 0 } else { g.wrapping_add(delta) });
    }
    None
}

/// Encode a simple glyph made of closed polygons (all points on-curve).
fn encode_glyph(contours: &[Vec<(i16, i16)>]) -> Vec<u8> {
    let pts: Vec<(i16, i16)> = contours.iter().flatten().copied().collect();
    let (mut x0, mut y0, mut x1, mut y1) = (i16::MAX, i16::MAX, i16::MIN, i16::MIN);
    for &(x, y) in &pts {
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    let mut g = vec![];
    g.extend_from_slice(&(contours.len() as i16).to_be_bytes());
    for v in [x0, y0, x1, y1] {
        g.extend_from_slice(&v.to_be_bytes());
    }
    let mut end = -1i32;
    for c in contours {
        end += c.len() as i32;
        g.extend_from_slice(&(end as u16).to_be_bytes());
    }
    g.extend_from_slice(&0u16.to_be_bytes()); // no instructions
    g.extend(std::iter::repeat(0x01u8).take(pts.len())); // on-curve, 16-bit deltas
    let (mut px, mut py) = (0i32, 0i32);
    for &(x, _) in &pts {
        g.extend_from_slice(&((x as i32 - px) as i16).to_be_bytes());
        px = x as i32;
    }
    for &(_, y) in &pts {
        g.extend_from_slice(&((y as i32 - py) as i16).to_be_bytes());
        py = y as i32;
    }
    g
}

fn checksum(data: &[u8]) -> u32 {
    let mut sum = 0u32;
    for chunk in data.chunks(4) {
        let mut w = [0u8; 4];
        w[..chunk.len()].copy_from_slice(chunk);
        sum = sum.wrapping_add(u32::from_be_bytes(w));
    }
    sum
}

/// Polygons in a 0..1 box (y up). Each glyph gets them scaled into its original bounding box.
pub type Shape = Vec<Vec<(f32, f32)>>;

/// Replace the glyphs for `codepoints` with `shape`. Returns the new font, or None if the font
/// isn't a TrueType font this patcher understands (then leave it untouched).
pub fn replace_glyphs(font: &[u8], codepoints: &[u32], shape: &Shape) -> Option<Vec<u8>> {
    let (version, mut tables) = read_tables(font)?;
    let head = table(&tables, b"head")?.data.clone();
    let maxp = &table(&tables, b"maxp")?.data;
    let num_glyphs = u16_at(maxp, 4)? as usize;
    let long = i16_at(&head, 50)? == 1;
    let loca = &table(&tables, b"loca")?.data;
    let glyf = &table(&tables, b"glyf")?.data;
    let cmap = &table(&tables, b"cmap")?.data;
    let offset = |i: usize| -> Option<usize> { if long { u32_at(loca, i * 4).map(|v| v as usize) } else { u16_at(loca, i * 2).map(|v| v as usize * 2) } };

    let mut replace: HashMap<usize, Vec<u8>> = HashMap::new();
    for &cp in codepoints {
        let Some(gid) = glyph_for(cmap, cp) else { continue };
        let gid = gid as usize;
        if gid == 0 || gid >= num_glyphs {
            continue;
        }
        let (a, b) = (offset(gid)?, offset(gid + 1)?);
        // Fit into the original glyph's box (or the em square if it was empty).
        let (bx0, by0, bx1, by1) = if b > a {
            (i16_at(glyf, a + 2)? as f32, i16_at(glyf, a + 4)? as f32, i16_at(glyf, a + 6)? as f32, i16_at(glyf, a + 8)? as f32)
        } else {
            let upm = u16_at(&head, 18)? as f32;
            (0.0, 0.0, upm, upm)
        };
        let (w, h) = (bx1 - bx0, by1 - by0);
        let side = w.min(h);
        let (ox, oy) = (bx0 + (w - side) / 2.0, by0 + (h - side) / 2.0);
        let contours: Vec<Vec<(i16, i16)>> =
            shape.iter().map(|c| c.iter().map(|&(x, y)| ((ox + x * side).round() as i16, (oy + y * side).round() as i16)).collect()).collect();
        replace.insert(gid, encode_glyph(&contours));
    }
    if replace.is_empty() {
        return None;
    }

    // Rebuild glyf + long loca.
    let mut new_glyf = Vec::with_capacity(glyf.len() + 1024);
    let mut new_loca = Vec::with_capacity((num_glyphs + 1) * 4);
    for i in 0..num_glyphs {
        new_loca.extend_from_slice(&(new_glyf.len() as u32).to_be_bytes());
        match replace.get(&i) {
            Some(g) => new_glyf.extend_from_slice(g),
            None => new_glyf.extend_from_slice(glyf.get(offset(i)?..offset(i + 1)?)?),
        }
        while new_glyf.len() % 4 != 0 {
            new_glyf.push(0);
        }
    }
    new_loca.extend_from_slice(&(new_glyf.len() as u32).to_be_bytes());
    let mut new_head = head;
    new_head[50..52].copy_from_slice(&1i16.to_be_bytes());
    new_head[8..12].copy_from_slice(&0u32.to_be_bytes()); // checkSumAdjustment, set below
    for t in tables.iter_mut() {
        match &t.tag {
            b"glyf" => t.data = new_glyf.clone(),
            b"loca" => t.data = new_loca.clone(),
            b"head" => t.data = new_head.clone(),
            _ => {}
        }
    }

    // Write the file: directory, then 4-byte aligned tables.
    tables.sort_by(|a, b| a.tag.cmp(&b.tag));
    let n = tables.len() as u16;
    let mut es = 0u16;
    while (1u16 << (es + 1)) <= n {
        es += 1;
    }
    let sr = (1u16 << es) * 16;
    let mut out = vec![];
    out.extend_from_slice(&version.to_be_bytes());
    for v in [n, sr, es, n * 16 - sr] {
        out.extend_from_slice(&v.to_be_bytes());
    }
    let mut off = 12 + tables.len() * 16;
    let mut head_at = 0usize;
    for t in &tables {
        out.extend_from_slice(&t.tag);
        out.extend_from_slice(&checksum(&t.data).to_be_bytes());
        out.extend_from_slice(&(off as u32).to_be_bytes());
        out.extend_from_slice(&(t.data.len() as u32).to_be_bytes());
        if &t.tag == b"head" {
            head_at = off;
        }
        off += (t.data.len() + 3) & !3;
    }
    for t in &tables {
        out.extend_from_slice(&t.data);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    let adj = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
    out[head_at + 8..head_at + 12].copy_from_slice(&adj.to_be_bytes());
    Some(out)
}

/// Ruby's logo (two polygons from Ruby.svg, 1853×1671 viewBox) normalised to a 0..1 box, y up.
pub fn ruby_logo_shape() -> Shape {
    let a: &[(f32, f32)] = &[(1832., 248.), (1111., 672.), (1052., 900.), (822., 843.), (106., 1266.), (106., 1270.), (1479., 1623.)];
    let b: &[(f32, f32)] = &[(1784., 181.), (1156., 21.), (235., 553.), (70., 1196.), (788., 774.), (845., 553.), (1070., 607.), (1784., 185.)];
    // SVG is y-down; flip, and fit the longer side to 1 keeping proportions (centred).
    let (minx, maxx, miny, maxy) = (70.0f32, 1832.0f32, 21.0f32, 1623.0f32);
    let scale = 1.0 / (maxx - minx).max(maxy - miny);
    let (pw, ph) = ((maxx - minx) * scale, (maxy - miny) * scale);
    let map = |&(x, y): &(f32, f32)| ((x - minx) * scale + (1.0 - pw) / 2.0, 1.0 - ((y - miny) * scale + (1.0 - ph) / 2.0));
    // TrueType outer contours run clockwise; the SVG polygons are counter-clockwise once flipped.
    let poly = |pts: &[(f32, f32)]| {
        let mut v: Vec<(f32, f32)> = pts.iter().map(map).collect();
        v.reverse();
        v
    };
    vec![poly(a), poly(b)]
}

#[cfg(test)]
mod tests {
    /// RUBY_TEST_FONT=<in.ttf> RUBY_TEST_OUT=<out.ttf> cargo test fontpatch -- --nocapture
    #[test]
    fn patch_real_font() {
        let (Ok(input), Ok(out)) = (std::env::var("RUBY_TEST_FONT"), std::env::var("RUBY_TEST_OUT")) else { return };
        let bytes = std::fs::read(input).unwrap();
        let patched = super::replace_glyphs(&bytes, &[0xF200, 0xF408], &super::ruby_logo_shape()).expect("patched");
        std::fs::write(out, &patched).unwrap();
        println!("in {} bytes -> out {} bytes", bytes.len(), patched.len());
    }
}
