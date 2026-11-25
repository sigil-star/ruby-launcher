//! Build helper: resize the bundled skybox packs and pack them into one file for the installer.
//! usage: cargo run --release --example pack_skyboxes -- <source dir> <list file> <out file>
//! Format: repeated [u32 LE path length][path utf-8][u64 LE data length][data].
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (src, list, out) = (std::path::Path::new(&a[1]), &a[2], &a[3]);
    let names = std::fs::read_to_string(list).unwrap();
    let mut f = std::io::BufWriter::new(std::fs::File::create(out).unwrap());
    let mut total = 0usize;
    for name in names.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let dir = src.join(name);
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            if !p.extension().map(|x| x.eq_ignore_ascii_case("tex")).unwrap_or(false) {
                continue;
            }
            let raw = std::fs::read(&p).unwrap();
            // Most packs are PNGs named .tex; anything else is copied as-is.
            let buf = match image::load_from_memory(&raw) {
                Ok(img) => {
                    let img = if img.width() > 1024 { img.resize(1024, 1024, image::imageops::FilterType::Lanczos3) } else { img };
                    let mut buf = Vec::new();
                    let enc = image::codecs::png::PngEncoder::new_with_quality(&mut buf, image::codecs::png::CompressionType::Best, image::codecs::png::FilterType::Adaptive);
                    img.to_rgb8().write_with_encoder(enc).unwrap();
                    if buf.len() < raw.len() { buf } else { strip_png_text(&raw) }
                }
                Err(_) => raw,
            };
            let rel = format!("{name}/{}", p.file_name().unwrap().to_string_lossy());
            f.write_all(&(rel.len() as u32).to_le_bytes()).unwrap();
            f.write_all(rel.as_bytes()).unwrap();
            f.write_all(&(buf.len() as u64).to_le_bytes()).unwrap();
            f.write_all(&buf).unwrap();
            total += buf.len();
        }
        eprintln!("{name}");
    }
    eprintln!("packed {:.1} MB", total as f64 / 1048576.0);
}

/// Drop PNG text/metadata chunks (tEXt, iTXt, zTXt, eXIf, tIME): they can hold the
/// original author's file paths and editor info.
fn strip_png_text(raw: &[u8]) -> Vec<u8> {
    if !raw.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return raw.to_vec();
    }
    let mut out = raw[..8].to_vec();
    let mut i = 8;
    while i + 12 <= raw.len() {
        let len = u32::from_be_bytes(raw[i..i + 4].try_into().unwrap()) as usize;
        let end = i + 12 + len;
        if end > raw.len() {
            return raw.to_vec();
        }
        if !matches!(&raw[i + 4..i + 8], b"tEXt" | b"iTXt" | b"zTXt" | b"eXIf" | b"tIME") {
            out.extend_from_slice(&raw[i..end]);
        }
        i = end;
    }
    out
}
