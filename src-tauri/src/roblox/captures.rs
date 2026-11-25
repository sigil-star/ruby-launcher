//! Captures: the screenshots Roblox saves (Pictures\Roblox), shown as a gallery in Ruby.

use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;

/// Where Roblox writes screenshots (Windows "Pictures" can be redirected to OneDrive).
fn dirs_to_scan() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(p) = dirs::picture_dir() {
        v.push(p.join("Roblox"));
    }
    if let Some(h) = dirs::home_dir() {
        v.push(h.join("Pictures").join("Roblox"));
        v.push(h.join("OneDrive").join("Pictures").join("Roblox"));
    }
    v.dedup();
    v
}

fn is_capture(p: &std::path::Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("png" | "jpg" | "jpeg"))
}

/// Newest first: path, name, modified time (ms), and a small JPEG preview.
pub fn list() -> Result<Value, String> {
    let mut files: Vec<(PathBuf, u64)> = Vec::new();
    for d in dirs_to_scan() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if !is_capture(&p) || files.iter().any(|(f, _)| f == &p) {
                continue;
            }
            let t = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
            files.push((p, t));
        }
    }
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.truncate(200);
    let items: Vec<Value> = std::thread::scope(|sc| {
        let hs: Vec<_> = files
            .iter()
            .map(|(p, t)| {
                sc.spawn(move || {
                    let preview = image::open(p).ok().map(|i| i.thumbnail(480, 270).to_rgb8()).and_then(|i| {
                        let mut out = std::io::Cursor::new(Vec::new());
                        image::DynamicImage::ImageRgb8(i).write_to(&mut out, image::ImageFormat::Jpeg).ok()?;
                        Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
                    });
                    json!({ "path": p.to_string_lossy(), "name": p.file_name().map(|n| n.to_string_lossy().to_string()), "modified": t, "preview": preview })
                })
            })
            .collect();
        hs.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    Ok(json!({ "captures": items, "folder": dirs_to_scan().into_iter().find(|d| d.is_dir()).map(|d| d.to_string_lossy().to_string()) }))
}

/// Only files inside a captures folder may be opened, shown in Explorer or deleted.
fn checked(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    let ok = is_capture(&p) && dirs_to_scan().iter().any(|d| p.parent().map(|par| par == d).unwrap_or(false));
    if ok && p.is_file() { Ok(p) } else { Err("not a capture".into()) }
}

pub fn open(path: &str) -> Result<Value, String> {
    let p = checked(path)?;
    std::process::Command::new("explorer").arg(&p).spawn().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

pub fn reveal(path: &str) -> Result<Value, String> {
    let p = checked(path)?;
    std::process::Command::new("explorer").arg(format!("/select,{}", p.display())).spawn().map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

/// Moves the capture to the Recycle Bin rather than deleting it outright.
pub fn delete(path: &str) -> Result<Value, String> {
    let p = checked(path)?;
    let script = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:RUBY_FILE,'OnlyErrorDialogs','SendToRecycleBin')";
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]).env("RUBY_FILE", &p);
    crate::win_process::hide_console(&mut cmd);
    let st = cmd.status().map_err(|e| e.to_string())?;
    if st.success() { Ok(json!({ "ok": true })) } else { Err("couldn't move it to the Recycle Bin".into()) }
}
