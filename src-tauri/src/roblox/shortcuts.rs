//! Desktop shortcuts that launch a game straight through Ruby (`--play <placeId>`).

use std::sync::Mutex;

/// A `--play` request Ruby was started with, kept until the UI is ready to take it.
static STARTUP_PLAY: Mutex<Option<u64>> = Mutex::new(None);

/// The place id after `--play` in a command line, if any.
pub fn play_arg<S: AsRef<str>>(args: &[S]) -> Option<u64> {
    let i = args.iter().position(|a| a.as_ref() == "--play")?;
    args.get(i + 1)?.as_ref().parse().ok()
}

pub fn remember_startup_play() {
    let args: Vec<String> = std::env::args().collect();
    *STARTUP_PLAY.lock().unwrap() = play_arg(&args);
}

pub fn take_startup_play() -> Option<u64> {
    STARTUP_PLAY.lock().unwrap().take()
}

/// A PNG wrapped as a single-image .ico (Windows reads PNG-in-ICO since Vista).
fn png_to_ico(png: &[u8], size: u32) -> Vec<u8> {
    let dim = if size >= 256 { 0u8 } else { size as u8 };
    let mut v = Vec::with_capacity(22 + png.len());
    v.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    v.extend_from_slice(&[dim, dim, 0, 0, 1, 0, 32, 0]);
    v.extend_from_slice(&(png.len() as u32).to_le_bytes());
    v.extend_from_slice(&22u32.to_le_bytes());
    v.extend_from_slice(png);
    v
}

fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "Roblox game".into() } else { s.chars().take(80).collect() }
}

pub async fn create(data_dir: &std::path::Path, place_id: u64, name: &str, icon_url: Option<&str>) -> Result<serde_json::Value, String> {
    let desktop = dirs::desktop_dir().ok_or("Couldn't find your desktop folder")?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    let mut icon_path = None;
    let rbxcdn = |u: &&str| url::Url::parse(u).ok().is_some_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| h.ends_with(".rbxcdn.com")));
    if let Some(url) = icon_url.filter(rbxcdn) {
        if let Ok(r) = reqwest::get(url).await {
            if let Ok(bytes) = r.bytes().await {
                if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                    let dir = data_dir.join("shortcut-icons");
                    let _ = std::fs::create_dir_all(&dir);
                    let p = dir.join(format!("{place_id}.ico"));
                    if std::fs::write(&p, png_to_ico(&bytes, 256)).is_ok() {
                        icon_path = Some(p);
                    }
                }
            }
        }
    }

    let lnk = desktop.join(format!("{}.lnk", safe_name(name)));
    // Values reach PowerShell as environment variables, never as script text, so a game name
    // can't break out of its quotes (PowerShell treats curly quotes as quotes too).
    let script = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:RUBY_LNK);$s.TargetPath=$env:RUBY_EXE;$s.Arguments=$env:RUBY_ARGS;$s.WorkingDirectory=$env:RUBY_WD;if($env:RUBY_ICON){$s.IconLocation=$env:RUBY_ICON};$s.Description=$env:RUBY_DESC;$s.Save()";
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("RUBY_LNK", &lnk)
        .env("RUBY_EXE", &exe)
        .env("RUBY_ARGS", format!("--play {place_id}"))
        .env("RUBY_WD", exe.parent().unwrap_or(std::path::Path::new(".")))
        .env("RUBY_ICON", icon_path.map(|p| format!("{},0", p.to_string_lossy())).unwrap_or_default())
        .env("RUBY_DESC", format!("Play {} with Ruby Launcher", safe_name(name)));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("Couldn't create the shortcut: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(serde_json::json!({ "path": lnk.to_string_lossy() }))
}
