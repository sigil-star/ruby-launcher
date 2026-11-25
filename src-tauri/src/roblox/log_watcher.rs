//! Tail Roblox player logs for leave-to-home and end the play session.

use crate::roblox::launch::{
    close_roblox_game_processes, end_game_session_and_return_to_ruby, in_exit_grace,
    show_and_focus_main,
};
use crate::state::AppState;
use notify::Watcher;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::json;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static WATCHER_STOP: AtomicBool = AtomicBool::new(false);
static WATCHER_RUNNING: AtomicBool = AtomicBool::new(false);
static JOIN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)! Joining game ['"]([a-f0-9-]+)['"]\s+place\s+(\d+)\s+at"#).unwrap()
});

#[derive(Clone, Debug, Default)]
pub struct JoiningGameInfo {
    pub job_id: Option<String>,
    pub place_id: Option<u64>,
}

fn parse_joining_game(line: &str) -> Option<JoiningGameInfo> {
    let caps = JOIN_RE.captures(line)?;
    let job = caps.get(1)?.as_str().to_string();
    let place = caps.get(2)?.as_str().parse::<u64>().ok()?;
    Some(JoiningGameInfo {
        job_id: Some(job),
        place_id: Some(place),
    })
}

/// Scan the newest player log (tail) for the most recent "! Joining game" line.
pub fn latest_joining_game() -> Option<JoiningGameInfo> {
    let path = newest_player_log()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let mut last: Option<JoiningGameInfo> = None;
    for line in raw.lines().rev().take(8000) {
        if let Some(info) = parse_joining_game(line) {
            last = Some(info);
            break;
        }
    }
    last
}

/// The game the running client is in right now: the newest join in its log, unless a leave
/// (or a disconnect) was logged after it, as when you leave to the Roblox app's home screen.
pub fn current_game_from_log() -> Option<JoiningGameInfo> {
    let path = newest_player_log()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    for line in raw.lines().rev() {
        if leave_type(line).is_some() {
            return None;
        }
        if let Some(info) = parse_joining_game(line) {
            return Some(info);
        }
    }
    None
}

/// The server you're connected to, from the newest log: its public address and the connection
/// handshake time (a round trip, so a fair ping estimate at join).
pub fn server_from_log() -> Option<(String, Option<u32>)> {
    let path = newest_player_log()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let secs = |line: &str| line.split(',').nth(1).and_then(|s| s.parse::<f64>().ok());
    let mut ip: Option<String> = None;
    let mut created: Option<f64> = None;
    let mut rtt: Option<u32> = None;
    for line in raw.lines() {
        if let Some(i) = line.find("UDMUX Address = ") {
            let rest = &line[i + "UDMUX Address = ".len()..];
            ip = rest.split(',').next().map(|s| s.trim().to_string());
            rtt = None;
            created = None;
        } else if line.contains("Creating connection to ") {
            created = secs(line);
        } else if line.contains("Handshake complete") {
            if let (Some(a), Some(b)) = (created, secs(line)) {
                rtt = Some(((b - a) * 1000.0).round().max(1.0) as u32);
            }
        }
    }
    ip.map(|i| (i, rtt))
}

fn apply_joining_to_session(app: &AppHandle, state: &Arc<AppState>, info: &JoiningGameInfo) {
    let mut changed = false;
    {
        let mut gs = state.game_session.write();
        if let Some(place) = info.place_id {
            if gs.place_id != Some(place) {
                gs.place_id = Some(place);
                changed = true;
            }
        }
        if let Some(ref job) = info.job_id {
            if gs.job_id.as_deref() != Some(job.as_str()) {
                gs.job_id = Some(job.clone());
                changed = true;
            }
        }
        if !gs.running {
            gs.running = true;
            changed = true;
        }
    }
    // The client has actually joined a server (the launch card waits for this).
    if info.job_id.is_some() {
        let _ = app.emit("roblox-game-joined", json!({ "placeId": info.place_id, "jobId": info.job_id }));
    }
    if changed {
        let gs = state.game_session.read();
        let _ = app.emit(
            "roblox-session-state",
            json!({
                "running": gs.running,
                "placeId": gs.place_id,
                "jobId": gs.job_id,
                "serverId": gs.job_id,
            }),
        );
    }
}

fn logs_dir() -> Option<PathBuf> {
    Some(dirs::data_local_dir()?.join("Roblox").join("logs"))
}

/// The in-game session log, not the crash handler or installer logs that share the
/// "_Player_" prefix (they never log a leave, so following one would miss it).
fn newest_player_log() -> Option<PathBuf> {
    let dir = logs_dir()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()) else {
            continue;
        };
        if !name.ends_with(".log") {
            continue;
        }
        if !name.contains("_player_") {
            continue;
        }
        if name.contains("crash") || name.contains("installer") || name.contains("bootstrapper") {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        match &best {
            None => best = Some((modified, path)),
            Some((t, _)) if modified > *t => best = Some((modified, path)),
            _ => {}
        }
    }
    best.map(|(_, p)| p)
}

fn leave_type(line: &str) -> Option<&'static str> {
    static PATTERNS: Lazy<Vec<(&'static str, Regex)>> = Lazy::new(|| {
        vec![
            (
                "returnToLuaApp",
                Regex::new(r"(?i)\[FLog::(SingleSurfaceApp|AppShell|AppController)\]\s*returnToLuaApp")
                    .unwrap(),
            ),
            (
                "leaveUGCGameInternal",
                Regex::new(r"(?i)\[FLog::(SingleSurfaceApp|AppShell|AppController)\]\s*leaveUGCGameInternal")
                    .unwrap(),
            ),
            (
                "setStageLuaApp",
                Regex::new(r"(?i)setStage:\s*\(stage:(InitializedLuaApp|LuaApp)\)").unwrap(),
            ),
            ("clientDisconnect", Regex::new(r"(?i)Client:Disconnect").unwrap()),
            (
                "sendingDisconnect",
                Regex::new(r"(?i)Sending disconnect with reason:").unwrap(),
            ),
            (
                "disconnectedFromServer",
                Regex::new(r"(?i)Disconnected from server for reason:\s*Player:").unwrap(),
            ),
            (
                "mobileRbxl",
                Regex::new(r"(?i)DataModel Loading rbxasset://places/Mobile\.rbxl").unwrap(),
            ),
        ]
    });
    if Regex::new(r#"(?i)FFlag|"[^"]*":\s*(true|false)"#)
        .ok()
        .map(|re| re.is_match(line))
        .unwrap_or(false)
    {
        return None;
    }
    for (name, re) in PATTERNS.iter() {
        if re.is_match(line) {
            if *name == "returnToLuaApp" && line.to_ascii_lowercase().contains("stage:ugcgame") {
                return None;
            }
            return Some(*name);
        }
    }
    None
}

/// The client went back to its home screen, which a teleport never does.
fn went_home(leave: &str) -> bool {
    matches!(leave, "returnToLuaApp" | "setStageLuaApp" | "leaveUGCGameInternal")
}

fn should_kill_on_leave(leave: &str, session_age_secs: i64) -> bool {
    // A real leave; act on it after the launch handoff settles.
    if went_home(leave) {
        return session_age_secs >= 8;
    }
    // Bare disconnects are ambiguous with teleport handoffs — wait a little longer.
    session_age_secs >= 12
}

fn read_new_lines(path: &Path, offset: &mut u64, buf: &mut String) -> Vec<String> {
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let Ok(meta) = file.metadata() else {
        return Vec::new();
    };
    let len = meta.len();
    if len < *offset {
        *offset = 0;
    }
    if len == *offset {
        return Vec::new();
    }
    if file.seek(SeekFrom::Start(*offset)).is_err() {
        return Vec::new();
    }
    buf.clear();
    let _ = file.read_to_string(buf);
    *offset = len;
    buf.lines().map(|s| s.to_string()).collect()
}

/// Start (or restart) the leave watcher for the current game session.
pub fn start_leave_watcher(app: AppHandle, state: Arc<AppState>) {
    stop_leave_watcher();
    WATCHER_STOP.store(false, Ordering::SeqCst);
    if WATCHER_RUNNING.swap(true, Ordering::SeqCst) {
    }
    std::thread::Builder::new()
        .name("ruby-roblox-log-watch".into())
        .spawn(move || {
            let mut path: Option<PathBuf> = None;
            let mut offset: u64 = 0;
            let mut line_buf = String::new();
            let mut saw_game = false;
            let started_at = Instant::now();
            // A "went home" leave seen while a launch handoff was settling. It counts once the
            // handoff is over, unless a new join came after it.
            let mut pending: Option<&'static str> = None;

            // Seed to end of current log so we only see new leave events.
            if let Some(p) = newest_player_log() {
                if let Ok(meta) = std::fs::metadata(&p) {
                    offset = meta.len();
                }
                path = Some(p);
            }

            // Wakes when Roblox writes to a log; the short timeout covers missed events.
            let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
            let mut _watcher = notify::RecommendedWatcher::new(tx, notify::Config::default()).ok();
            if let (Some(w), Some(dir)) = (_watcher.as_mut(), logs_dir()) {
                let _ = w.watch(&dir, notify::RecursiveMode::NonRecursive);
            }

            while !WATCHER_STOP.load(Ordering::SeqCst) {
                if !state.game_session.read().running {
                    break;
                }
                // Prefer newest log; reset offset if the file rotates.
                if let Some(newest) = newest_player_log() {
                    if path.as_ref() != Some(&newest) {
                        path = Some(newest.clone());
                        offset = std::fs::metadata(&newest).map(|m| m.len()).unwrap_or(0);
                    }
                }
                let mut leave_now: Option<&'static str> = None;
                if let Some(p) = path.as_ref() {
                    for line in read_new_lines(p, &mut offset, &mut line_buf) {
                        if let Some(info) = parse_joining_game(&line) {
                            saw_game = true;
                            pending = None;
                            apply_joining_to_session(&app, &state, &info);
                        } else if line.contains("! Joining game") {
                            saw_game = true;
                            pending = None;
                        } else if line.to_ascii_lowercase().contains("ugcgame") {
                            saw_game = true;
                        }
                        // In-experience teleports (RIVALS matchmaking, lobbies → matches) disconnect
                        // from the old server before joining the new one: not a leave.
                        if line.contains("doTeleport") || line.contains("finishTeleport") || line.contains("SessionTransitionFSM] Teleported") {
                            crate::roblox::launch::note_exit_grace(20);
                            continue;
                        }
                        let Some(leave) = leave_type(&line) else {
                            continue;
                        };
                        if in_exit_grace() || (!saw_game && started_at.elapsed() < Duration::from_secs(12)) {
                            // Handoff still settling: a disconnect may be a teleport, but going
                            // home never is, so remember that and decide once it settles.
                            if went_home(leave) {
                                pending = Some(leave);
                            }
                            continue;
                        }
                        leave_now = Some(leave);
                        break;
                    }
                }
                if leave_now.is_none() && !in_exit_grace() && started_at.elapsed() >= Duration::from_secs(12) {
                    leave_now = pending.take();
                }
                if let Some(leave) = leave_now {
                        let session_age = state
                            .game_session
                            .read()
                            .started_at
                            .map(|s| {
                                (chrono::Utc::now().timestamp() - s).max(0)
                            })
                            .unwrap_or(0);
                        let kill = should_kill_on_leave(leave, session_age)
                            && state.behavior.read().dont_open_app_on_game_close;
                        tracing::info!(leave, kill, "Roblox leave detected");
                        // Bring Ruby forward first so the user never sees the Roblox home flash.
                        show_and_focus_main(&app);
                        if kill {
                            let _ = close_roblox_game_processes(false);
                            std::thread::sleep(Duration::from_millis(600));
                            if crate::roblox::launch::is_roblox_running() {
                                let _ = close_roblox_game_processes(true);
                            }
                        }
                        end_game_session_and_return_to_ruby(&app, &state);
                        WATCHER_STOP.store(true, Ordering::SeqCst);
                        break;
                }
                // Wake on the next log write, or re-check after a short fallback.
                let _ = rx.recv_timeout(Duration::from_millis(400));
                while rx.try_recv().is_ok() {} // drain a burst of events
            }
            WATCHER_RUNNING.store(false, Ordering::SeqCst);
        })
        .ok();
}

pub fn stop_leave_watcher() {
    WATCHER_STOP.store(true, Ordering::SeqCst);
}
