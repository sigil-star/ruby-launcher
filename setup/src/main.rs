//! Ruby Launcher Setup: a small dark installer/uninstaller that carries Ruby inside it.
//! Install = copy Ruby to %LOCALAPPDATA%\Programs\Ruby Launcher, add shortcuts and an entry in
//! Windows' Apps list. Uninstall (the same exe, copied next to Ruby) undoes all of that and puts
//! Roblox back the way Roblox shipped it.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

/// Ruby, Brotli-compressed, after an 8-byte little-endian header holding its unpacked size.
static PAYLOAD: &[u8] = include_bytes!("../payload/Ruby Launcher.exe.br");

/// Skyboxes ride at the end of this exe (after the program itself), so the uninstaller copy can
/// leave them off: [entries][u64 LE entries length]["RUBYSKY1"]. Entry = [u32 path len][path][u64 len][data].
const SKY_MAGIC: &[u8; 8] = b"RUBYSKY1";

/// (exe path, where the skybox data starts, its length), if this exe carries skyboxes.
fn sky_overlay() -> Option<(std::path::PathBuf, u64, u64)> {
    use std::io::{Seek, SeekFrom};
    let me = std::env::current_exe().ok()?;
    let mut f = std::fs::File::open(&me).ok()?;
    let size = f.metadata().ok()?.len();
    if size < 16 {
        return None;
    }
    f.seek(SeekFrom::End(-16)).ok()?;
    let mut tail = [0u8; 16];
    f.read_exact(&mut tail).ok()?;
    if &tail[8..] != SKY_MAGIC {
        return None;
    }
    let len = u64::from_le_bytes(tail[..8].try_into().ok()?);
    let start = size.checked_sub(16 + len)?;
    Some((me, start, len))
}

/// Unpack the bundled skyboxes into <install dir>/skyboxes.
fn install_skyboxes(app: &tauri::AppHandle, dir: &std::path::Path) -> Result<(), String> {
    use std::io::{BufReader, Seek, SeekFrom};
    let Some((me, start, len)) = sky_overlay() else { return Ok(()) };
    let out = dir.join("skyboxes");
    let _ = std::fs::remove_dir_all(&out);
    let mut f = BufReader::new(std::fs::File::open(me).map_err(|e| e.to_string())?);
    f.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let bad = || "The skyboxes in the installer are damaged. Download the installer again.".to_string();
    let mut read = 0u64;
    while read < len {
        let mut n4 = [0u8; 4];
        f.read_exact(&mut n4).map_err(|_| bad())?;
        let mut name = vec![0u8; u32::from_le_bytes(n4) as usize];
        f.read_exact(&mut name).map_err(|_| bad())?;
        let mut n8 = [0u8; 8];
        f.read_exact(&mut n8).map_err(|_| bad())?;
        let size = u64::from_le_bytes(n8);
        let rel = String::from_utf8(name).map_err(|_| bad())?;
        // Only plain "<pack>/<file>" paths.
        let parts: Vec<&str> = rel.split('/').collect();
        if parts.len() != 2 || parts.iter().any(|p| p.is_empty() || *p == "." || *p == ".." || p.contains(['\\', ':'])) {
            return Err(bad());
        }
        let dest = out.join(parts[0]).join(parts[1]);
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut w = std::fs::File::create(&dest).map_err(|e| format!("Couldn't write skyboxes: {e}"))?;
        std::io::copy(&mut (&mut f).take(size), &mut w).map_err(|_| bad())?;
        read += 4 + rel.len() as u64 + 8 + size;
        progress(app, 80 + (read * 4 / len.max(1)) as u32, "Adding skyboxes…");
    }
    Ok(())
}

/// Copy this program as the uninstaller, without the skyboxes on the end.
fn write_uninstaller(dest: &std::path::Path) {
    let Ok(me) = std::env::current_exe() else { return };
    match sky_overlay() {
        Some((_, start, _)) => {
            if let (Ok(src), Ok(mut w)) = (std::fs::File::open(&me), std::fs::File::create(dest)) {
                let _ = std::io::copy(&mut src.take(start), &mut w);
            }
        }
        None => {
            let _ = std::fs::copy(me, dest);
        }
    }
}

fn unpacked_size() -> usize {
    PAYLOAD.get(..8).map(|b| u64::from_le_bytes(b.try_into().unwrap_or([0; 8])) as usize).unwrap_or(0)
}
const APP_EXE: &str = "Ruby Launcher.exe";
const UNINSTALLER: &str = "Uninstall Ruby Launcher.exe";
const UNINSTALL_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\RubyLauncher";
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn install_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("Programs").join("Ruby Launcher")
}

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    cmd
}

fn reg(args: &[&str]) -> bool {
    quiet(Command::new("reg").args(args)).output().map(|o| o.status.success()).unwrap_or(false)
}

/// Runs a fixed script. Paths reach it as environment variables, never as script text, so no
/// folder name (curly quotes included) can change what it does.
fn powershell(script: &str, env: &[(&str, &Path)]) -> bool {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    for (k, v) in env {
        cmd.env(k, v);
    }
    quiet(&mut cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn is_uninstall() -> bool {
    let exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).unwrap_or_default();
    std::env::args().any(|a| a == "--uninstall") || exe.starts_with("uninstall")
}

fn has_webview2() -> bool {
    const GUID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    [
        format!(r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{GUID}"),
        format!(r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{GUID}"),
        format!(r"HKCU\Software\Microsoft\EdgeUpdate\Clients\{GUID}"),
    ]
    .iter()
    .any(|k| {
        quiet(Command::new("reg").args(["query", k, "/v", "pv"]))
            .output()
            .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).contains(" 0.0.0.0"))
            .unwrap_or(false)
    })
}

/// Fetch and run Microsoft's WebView2 installer (it shows its own small progress window).
fn install_webview2() {
    let tmp = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    powershell(
        "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $env:RUBY_TMP; Start-Process -FilePath $env:RUBY_TMP -ArgumentList '/install' -Wait",
        &[("RUBY_TMP", &tmp)],
    );
    let _ = std::fs::remove_file(tmp);
}

fn close_ruby() {
    for name in [APP_EXE, "rubylauncher-tauri.exe"] {
        let _ = quiet(Command::new("taskkill").args(["/F", "/IM", name])).output();
    }
    std::thread::sleep(std::time::Duration::from_millis(600));
}

fn start_menu_lnk() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs\Ruby Launcher.lnk"))
}
fn desktop_lnk() -> Option<PathBuf> {
    dirs::desktop_dir().map(|d| d.join("Ruby Launcher.lnk"))
}

fn make_shortcut(lnk: &Path, target: &Path) -> bool {
    let dir = target.parent().unwrap_or(Path::new("."));
    powershell(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:RUBY_LNK); $s.TargetPath=$env:RUBY_EXE; $s.WorkingDirectory=$env:RUBY_DIR; $s.IconLocation=$env:RUBY_EXE; $s.Description='Ruby Launcher'; $s.Save()",
        &[("RUBY_LNK", lnk), ("RUBY_EXE", target), ("RUBY_DIR", dir)],
    )
}

fn progress(app: &tauri::AppHandle, pct: u32, step: &str) {
    let _ = app.emit("progress", json!({ "pct": pct, "step": step }));
}

fn do_install(app: &tauri::AppHandle, desktop: bool) -> Result<(), String> {
    let dir = install_dir();
    progress(app, 3, "Closing Ruby if it's open…");
    close_ruby();

    // Older Ruby builds used a different installer: remove it quietly first.
    if let Some(old) = dirs::data_local_dir().map(|d| d.join("Ruby Launcher").join("uninstall.exe")).filter(|p| p.is_file()) {
        progress(app, 6, "Removing the previous version…");
        let _ = quiet(Command::new(&old).arg("/S")).status();
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    let exe = dir.join(APP_EXE);
    let tmp = dir.join(format!("{APP_EXE}.new"));
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("Couldn't write Ruby: {e}"))?;
        let total = unpacked_size().max(1);
        let mut src = brotli_decompressor::Decompressor::new(&PAYLOAD[8..], 1 << 16);
        let mut buf = vec![0u8; 512 * 1024];
        let mut done = 0usize;
        loop {
            let n = src.read(&mut buf).map_err(|e| format!("Ruby's files are damaged ({e}). Download the installer again."))?;
            if n == 0 {
                break;
            }
            f.write_all(&buf[..n]).map_err(|e| format!("Couldn't write Ruby: {e}"))?;
            done += n;
            progress(app, 10 + (done.min(total) * 70 / total) as u32, "Unpacking Ruby…");
        }
        f.sync_all().ok();
        if done != unpacked_size() {
            let _ = std::fs::remove_file(&tmp);
            return Err("Ruby's files are incomplete. Download the installer again.".into());
        }
    }
    std::fs::rename(&tmp, &exe).or_else(|_| {
        let _ = std::fs::remove_file(&exe);
        std::fs::rename(&tmp, &exe)
    }).map_err(|e| format!("Couldn't place Ruby (is it still open?): {e}"))?;

    install_skyboxes(app, &dir)?;

    // This same program becomes the uninstaller.
    write_uninstaller(&dir.join(UNINSTALLER));

    progress(app, 84, "Adding shortcuts…");
    if let Some(l) = start_menu_lnk() {
        make_shortcut(&l, &exe);
    }
    if desktop {
        if let Some(l) = desktop_lnk() {
            make_shortcut(&l, &exe);
        }
    }

    progress(app, 94, "Registering with Windows…");
    let uninstaller = dir.join(UNINSTALLER);
    let sky = sky_overlay().map(|(_, _, l)| l as usize).unwrap_or(0);
    let size_kb = ((unpacked_size() + sky + std::fs::metadata(&uninstaller).map(|m| m.len() as usize).unwrap_or(0)) / 1024).to_string();
    let exe_s = exe.display().to_string();
    let un_s = format!("\"{}\"", uninstaller.display());
    let dir_s = dir.display().to_string();
    for (name, kind, value) in [
        ("DisplayName", "REG_SZ", "Ruby Launcher"),
        ("DisplayVersion", "REG_SZ", VERSION),
        ("Publisher", "REG_SZ", "Ruby Launcher"),
        ("DisplayIcon", "REG_SZ", exe_s.as_str()),
        ("InstallLocation", "REG_SZ", dir_s.as_str()),
        ("UninstallString", "REG_SZ", un_s.as_str()),
        ("QuietUninstallString", "REG_SZ", &format!("{un_s} --uninstall --quiet")),
        ("EstimatedSize", "REG_DWORD", size_kb.as_str()),
        ("NoModify", "REG_DWORD", "1"),
        ("NoRepair", "REG_DWORD", "1"),
    ] {
        reg(&["add", UNINSTALL_KEY, "/v", name, "/t", kind, "/d", value, "/f"]);
    }
    progress(app, 100, "Done");
    Ok(())
}

fn do_uninstall(app: &tauri::AppHandle, remove_data: bool) -> Result<(), String> {
    let dir = install_dir();
    progress(app, 5, "Closing Ruby…");
    close_ruby();

    // Hand roblox.com back to Roblox and restore Roblox's own files (Ruby does this itself).
    progress(app, 20, "Restoring Roblox…");
    let exe = dir.join(APP_EXE);
    if exe.is_file() {
        let _ = quiet(Command::new(&exe).arg("--restore-protocol")).status();
    }

    progress(app, 55, "Removing shortcuts…");
    for l in [start_menu_lnk(), desktop_lnk()].into_iter().flatten() {
        let _ = std::fs::remove_file(l);
    }

    progress(app, 70, "Removing Ruby…");
    for _ in 0..5 {
        if !dir.exists() || std::fs::remove_dir_all(&dir).is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    reg(&["delete", UNINSTALL_KEY, "/f"]);

    if remove_data {
        progress(app, 88, "Removing your settings…");
        for d in [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten() {
            let _ = std::fs::remove_dir_all(d.join("com.rubylauncher.tauri"));
        }
    }
    progress(app, 100, "Done");
    Ok(())
}

#[tauri::command]
fn setup_info() -> Value {
    let dir = install_dir();
    json!({
        "mode": if is_uninstall() { "uninstall" } else { "install" },
        "update": std::env::args().any(|a| a == "--update"),
        "desktop": desktop_lnk().map(|l| l.is_file()).unwrap_or(false),
        "version": VERSION,
        "installed": dir.join(APP_EXE).is_file(),
        "dir": dir.display().to_string(),
        "sizeMb": ((PAYLOAD.len() as u64 + sky_overlay().map(|(_, _, l)| l).unwrap_or(0)) as f64 / 1_048_576.0 * 10.0).round() / 10.0,
    })
}

#[tauri::command]
async fn run_install(app: tauri::AppHandle, desktop: bool) -> Result<(), String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || do_install(&a, desktop)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_uninstall(app: tauri::AppHandle, remove_data: bool) -> Result<(), String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || do_uninstall(&a, remove_data)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch_ruby() -> Result<(), String> {
    let exe = install_dir().join(APP_EXE);
    Command::new(&exe).current_dir(install_dir()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only web links".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

/// After uninstalling, the temporary copy of this program deletes itself.
fn schedule_self_delete() {
    if let Ok(me) = std::env::current_exe() {
        if me.starts_with(std::env::temp_dir()) {
            let _ = quiet(Command::new("cmd").args(["/C", &format!("ping 127.0.0.1 -n 3 > nul & del /f /q \"{}\"", me.display())])).spawn();
        }
    }
}

fn main() {
    // The uninstaller can't delete the folder it runs from: run a temporary copy instead.
    if is_uninstall() && !std::env::args().any(|a| a == "--from-temp") {
        if let Ok(me) = std::env::current_exe() {
            let tmp = std::env::temp_dir().join(format!("ruby-uninstall-{}.exe", std::process::id()));
            if std::fs::copy(&me, &tmp).is_ok() {
                let quiet_flag = std::env::args().any(|a| a == "--quiet");
                let mut cmd = Command::new(&tmp);
                cmd.args(["--uninstall", "--from-temp"]);
                if quiet_flag {
                    cmd.arg("--quiet");
                }
                if cmd.spawn().is_ok() {
                    return;
                }
            }
        }
    }

    // Silent uninstall (Windows "Apps" sometimes asks for one): no window.
    if is_uninstall() && std::env::args().any(|a| a == "--quiet") {
        let dir = install_dir();
        close_ruby();
        let exe = dir.join(APP_EXE);
        if exe.is_file() {
            let _ = quiet(Command::new(&exe).arg("--restore-protocol")).status();
        }
        for l in [start_menu_lnk(), desktop_lnk()].into_iter().flatten() {
            let _ = std::fs::remove_file(l);
        }
        let _ = std::fs::remove_dir_all(&dir);
        reg(&["delete", UNINSTALL_KEY, "/f"]);
        schedule_self_delete();
        return;
    }

    if !has_webview2() {
        install_webview2();
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![setup_info, run_install, run_uninstall, launch_ruby, open_link])
        .setup(|app| {
            let title = if is_uninstall() { "Uninstall Ruby Launcher" } else { "Ruby Launcher Setup" };
            WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(420.0, 560.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("setup failed to start")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                if is_uninstall() {
                    schedule_self_delete();
                }
            }
        });
}
