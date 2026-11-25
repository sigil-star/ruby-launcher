//! Locate and spawn RobloxPlayerBeta; track session / playtime; return to Ruby on leave.

use crate::roblox::close_to_app::enforce_close_to_app_off;
use crate::roblox::log_watcher::{latest_joining_game, start_leave_watcher, stop_leave_watcher};
use crate::state::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const ROBLOX_PROCESS_NAMES: &[&str] = &[
    "RobloxPlayerBeta.exe",
    "Roblox.exe",
    "RobloxGameClient.exe",
];

/// Fetched while you look at a game page, so Play starts the client straight away.
#[derive(Default)]
struct PrewarmCache {
    /// One-time auth ticket (consumed on use) + when it was fetched.
    ticket: Option<(String, Instant)>,
    /// Current client exe + when it was resolved.
    version_exe: Option<(PathBuf, Instant)>,
}
static PREWARM: once_cell::sync::Lazy<parking_lot::Mutex<PrewarmCache>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(PrewarmCache::default()));
const TICKET_TTL: Duration = Duration::from_secs(90);
const VERSION_TTL: Duration = Duration::from_secs(300);

/// Bumped on every launch so older exit-poller tasks stop instead of tearing down a rejoin.
static SESSION_GEN: AtomicU64 = AtomicU64::new(0);
/// Set while the current session was taken over (not launched by Ruby).
static ADOPTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// The server the last session ended in, so a client still closing isn't adopted again.
static LAST_ENDED_JOB: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);
/// Unix seconds: until then, a closed client or a leave in the log doesn't end the session (rejoins).
static EXIT_GRACE_UNTIL: AtomicI64 = AtomicI64::new(0);

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn note_exit_grace(secs: i64) {
    let until = now_secs() + secs.max(1);
    EXIT_GRACE_UNTIL.store(until, Ordering::SeqCst);
}

pub fn in_exit_grace() -> bool {
    now_secs() < EXIT_GRACE_UNTIL.load(Ordering::SeqCst)
}

fn taskkill_path() -> PathBuf {
    std::env::var_os("SYSTEMROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("taskkill.exe")
}

/// Newest installed player by modified time — the offline fallback.
pub fn find_roblox_player() -> Option<PathBuf> {
    let local = dirs::data_local_dir()?;
    let versions = local.join("Roblox").join("Versions");
    if !versions.is_dir() {
        return None;
    }
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    if let Ok(entries) = std::fs::read_dir(&versions) {
        for entry in entries.flatten() {
            let path = entry.path().join("RobloxPlayerBeta.exe");
            if path.is_file() {
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(UNIX_EPOCH);
                match &best {
                    None => best = Some((modified, path)),
                    Some((t, _)) if modified > *t => best = Some((modified, path)),
                    _ => {}
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

/// The player exe for the version Roblox says is current. Starting an older build makes the
/// client run Roblox's own installer first.
async fn resolve_current_player(state: &Arc<AppState>) -> Option<PathBuf> {
    if let Some((p, at)) = PREWARM.lock().version_exe.clone() {
        if at.elapsed() < VERSION_TTL && p.is_file() {
            return Some(p);
        }
    }
    let versions = dirs::data_local_dir()?.join("Roblox").join("Versions");
    let (guid, _) = crate::roblox::bootstrap::current_version(state, "WindowsPlayer").await?;
    let guid = guid.as_str();
    let exe = versions.join(guid).join("RobloxPlayerBeta.exe");
    if exe.is_file() {
        tracing::info!("launching current client {guid}");
        PREWARM.lock().version_exe = Some((exe.clone(), Instant::now()));
        Some(exe)
    } else {
        tracing::warn!("current client {guid} not installed; using newest local");
        None
    }
}

/// Which RobloxPlayerBeta to start:
/// - "weblauncher" source: weblauncher's pinned (executor-synced) build, if it's there.
/// - otherwise the version Roblox currently ships; if it isn't installed yet, Ruby installs it
///   first (instead of starting an old build that hands off to Roblox's own installer).
async fn pick_player(app: &AppHandle, state: &Arc<AppState>) -> Result<PathBuf, String> {
    let source = crate::roblox::bootstrap::client_source(state);
    // A specific version the user picked: use it, installing it first if it isn't here yet.
    if let Some(guid) = source.get("source").and_then(|v| v.as_str()).and_then(|s| s.strip_prefix("version:")).map(str::to_string) {
        if let Some(p) = crate::roblox::bootstrap::player_exe_for(&guid) {
            return Ok(p);
        }
        let _ = app.emit("launch-status", json!({ "stage": "updating", "version": guid }));
        match crate::roblox::bootstrap::install_player(app, &guid).await {
            Ok(p) => return Ok(p),
            Err(e) => tracing::warn!("installing pinned {guid} failed: {e}; using Roblox's current version"),
        }
    }
    if source.get("source").and_then(|v| v.as_str()) == Some("weblauncher") {
        if let Some(p) = crate::roblox::bootstrap::weblauncher_player() {
            tracing::info!("launching weblauncher's synced client {}", p.display());
            return Ok(p);
        }
        tracing::warn!("weblauncher client not found; using Roblox's current version");
    }
    if let Some(p) = resolve_current_player(state).await {
        return Ok(p);
    }
    if let Some((guid, _)) = crate::roblox::bootstrap::current_version(state, "WindowsPlayer").await {
        let _ = app.emit("launch-status", json!({ "stage": "updating", "version": guid }));
        match crate::roblox::bootstrap::install_player(app, &guid).await {
            Ok(p) => {
                PREWARM.lock().version_exe = Some((p.clone(), Instant::now()));
                return Ok(p);
            }
            Err(e) => tracing::warn!("installing {guid} failed: {e}; falling back to newest local"),
        }
    }
    find_roblox_player().ok_or_else(|| "RobloxPlayerBeta.exe not found".to_string())
}

/// Fetch the version and a launch ticket ahead of time (see Prewarm).
pub async fn prewarm(state: &Arc<AppState>) -> Value {
    let _ = resolve_current_player(state).await;
    if let Some(ticket) = fetch_auth_ticket_raw(state).await {
        PREWARM.lock().ticket = Some((ticket, Instant::now()));
    }
    json!({ "ok": true })
}

pub fn is_roblox_running() -> bool {
    #[cfg(windows)]
    {
        // Roblox's own installer counts as "still starting": if it's updating, it will launch
        // the game when done, so the session must not end in the meantime.
        for name in ROBLOX_PROCESS_NAMES.iter().chain(["RobloxPlayerInstaller.exe"].iter()) {
            let mut cmd = Command::new("tasklist");
            cmd.args(["/FI", &format!("IMAGENAME eq {name}"), "/NH"]);
            crate::win_process::hide_console(&mut cmd);
            if let Ok(out) = cmd.output() {
                let s = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
                if s.contains(&name.to_ascii_lowercase()) {
                    return true;
                }
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Graceful (`force=false`) or force (`force=true`) close of Roblox game clients.
pub fn close_roblox_game_processes(force: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let kill = taskkill_path();
        for name in ROBLOX_PROCESS_NAMES {
            let mut cmd = Command::new(&kill);
            if force {
                cmd.args(["/F", "/IM", name]);
            } else {
                cmd.args(["/IM", name]);
            }
            crate::win_process::hide_console(&mut cmd);
            let _ = cmd.output();
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = force;
        Err("Windows-only".into())
    }
}

pub fn show_and_focus_main(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Mark session ended and bring the launcher back.
pub fn end_game_session_and_return_to_ruby(app: &AppHandle, state: &Arc<AppState>) {
    if in_exit_grace() {
        tracing::info!("skip session end — still in rejoin/exit grace");
        return;
    }
    crate::overlay::on_game_ended(app);
    let (place, elapsed) = {
        let mut gs = state.game_session.write();
        if !gs.running {
            return;
        }
        let place = gs.place_id;
        *LAST_ENDED_JOB.lock() = gs.job_id.clone();
        let started = gs.started_at.unwrap_or(now_secs());
        let elapsed = (now_secs() - started).max(0) as u64;
        gs.running = false;
        (place, elapsed)
    };

    SESSION_GEN.fetch_add(1, Ordering::SeqCst);
    stop_leave_watcher();

    if let Some(pid) = place {
        {
            let mut p = state.playtime.write();
            *p.by_place.entry(pid).or_insert(0) += elapsed;
            p.last_played.insert(pid, chrono::Utc::now().timestamp().max(0) as u64);
        }
        state.save_playtime();
    }
    let _ = app.emit(
        "roblox-session-ended",
        json!({ "placeId": place, "elapsedSeconds": elapsed }),
    );
    let _ = app.emit("roblox-session-state", json!({ "running": false }));
    show_and_focus_main(app);
}

/// Request a one-time authentication ticket for the launcher's signed-in account.
async fn fetch_auth_ticket_raw(state: &Arc<AppState>) -> Option<String> {
    state.cookie.read().as_ref()?;
    let opts = json!({
        "method": "POST",
        "body": "",
        "headers": {
            "RBXAuthenticationNegotiation": "1",
            "Referer": "https://www.roblox.com/",
            "Origin": "https://www.roblox.com",
            "Content-Type": "application/json"
        }
    });
    let res = crate::roblox::http::fetch_roblox_api(
        state,
        "https://auth.roblox.com/v1/authentication-ticket",
        Some(opts),
    )
    .await
    .ok()?;
    res.get("headers")?
        .get("rbx-authentication-ticket")?
        .as_str()
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
}

/// A recent prefetched ticket (used up, tickets work once), otherwise a fresh one.
async fn fetch_auth_ticket(state: &Arc<AppState>) -> Option<String> {
    if let Some((ticket, at)) = PREWARM.lock().ticket.take() {
        if at.elapsed() < TICKET_TTL {
            return Some(ticket);
        }
    }
    fetch_auth_ticket_raw(state).await
}

/// `roblox-player:` URI signed in as the launcher account. Falls back to the plain
/// deep link (uses whatever account the Roblox app has) when no ticket is available.
/// A private server travels through the `job` argument as `private:<accessCode>:<linkCode>`
/// (either part may be empty) so the rest of the launch pipeline stays unchanged.
fn parse_private(job: &str) -> Option<(String, String)> {
    let rest = job.strip_prefix("private:")?;
    let (access, link) = rest.split_once(':').unwrap_or((rest, ""));
    let clean = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>();
    Some((clean(access), clean(link)))
}

async fn build_launch_uri(state: &Arc<AppState>, place_id: u64, job: Option<&str>) -> String {
    let job = job.filter(|j| !j.is_empty());
    let private = job.and_then(parse_private);
    let Some(ticket) = fetch_auth_ticket(state).await else {
        tracing::warn!("auth ticket unavailable; falling back to roblox:// deep link");
        let mut url = format!("roblox://placeId={place_id}");
        match (&private, job) {
            (Some((_, link)), _) if !link.is_empty() => url.push_str(&format!("&linkCode={link}")),
            (Some(_), _) => {}
            (None, Some(j)) => url.push_str(&format!("&gameInstanceId={j}")),
            (None, None) => {}
        }
        return url;
    };
    let tracker: u64 = (uuid::Uuid::new_v4().as_u128() % 9_000_000_000 + 1_000_000_000) as u64;
    let launcher = match job {
        // Same request roblox.com's "Join" on a private server sends (RequestPrivateGame).
        Some(_) if private.is_some() => {
            let (access, link) = private.clone().unwrap_or_default();
            let mut u = format!(
                "https://www.roblox.com/Game/PlaceLauncher.ashx?request=RequestPrivateGame&browserTrackerId={tracker}&placeId={place_id}"
            );
            if !access.is_empty() {
                u.push_str(&format!("&accessCode={access}"));
            }
            if !link.is_empty() {
                u.push_str(&format!("&linkCode={link}"));
            }
            u
        }
        Some(j) => format!(
            "https://www.roblox.com/Game/PlaceLauncher.ashx?request=RequestGameJob&browserTrackerId={tracker}&placeId={place_id}&gameId={j}&isPlayTogetherGame=false"
        ),
        None => format!(
            "https://www.roblox.com/Game/PlaceLauncher.ashx?request=RequestGame&browserTrackerId={tracker}&placeId={place_id}&isPlayTogetherGame=false"
        ),
    };
    let encoded: String = url::form_urlencoded::byte_serialize(launcher.as_bytes()).collect();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // The account's rollout channel: with it empty the client compares itself against the
    // public build, decides it is out of date and runs RobloxPlayerInstaller.
    let channel = crate::roblox::bootstrap::USER_CHANNEL.lock().clone();
    format!(
        "roblox-player:1+launchmode:play+gameinfo:{ticket}+launchtime:{now_ms}+placelauncherurl:{encoded}+browsertrackerid:{tracker}+robloxLocale:en_us+gameLocale:en_us+channel:{channel}+LaunchExp:InApp"
    )
}

pub async fn launch_roblox(
    app: &AppHandle,
    state: &Arc<AppState>,
    place_id: u64,
    game_instance_id: Option<String>,
    place_name: Option<String>,
    icon_url: Option<String>,
) -> Result<Value, String> {
    // Ride the launch handoff (brief home->game transition). Short, so a real
    // short-session leave isn't swallowed. Teleports re-arm this on each launch.
    note_exit_grace(12);

    if state.behavior.read().dont_open_app_on_game_close {
        enforce_close_to_app_off();
    }

    let _ = app.emit("launch-started", json!({ "placeId": place_id }));
    let exe = pick_player(app, state).await?;
    // Keep the in-game theme on this build (new Roblox versions arrive untinted).
    crate::roblox::theme::ensure_for_exe(state, &exe).await;
    crate::roblox::fflags::apply(state);
    crate::roblox::bootstrap::ensure_channel(state).await;
    let url = build_launch_uri(state, place_id, game_instance_id.as_deref()).await;
    spawn_player(&exe, &url)?;
    begin_session(app, state, Some(place_id), game_instance_id.clone(), place_name, icon_url);
    Ok(json!({ "ok": true, "placeId": place_id, "gameInstanceId": game_instance_id }))
}

fn spawn_player(exe: &std::path::Path, uri: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new(exe);
        cmd.arg(uri);
        crate::win_process::hide_console(&mut cmd);
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (exe, uri);
        Err("Roblox launch is Windows-only in v1".into())
    }
}

/// A launch from roblox.com (the `roblox-player:` URI, passed through untouched).
pub async fn launch_uri(app: &AppHandle, state: &Arc<AppState>, uri: &str, place_id: Option<u64>) -> Result<Value, String> {
    note_exit_grace(12);
    if state.behavior.read().dont_open_app_on_game_close {
        enforce_close_to_app_off();
    }
    let _ = app.emit("launch-started", json!({ "placeId": place_id }));
    let exe = pick_player(app, state).await?;
    crate::roblox::theme::ensure_for_exe(state, &exe).await;
    crate::roblox::fflags::apply(state);
    spawn_player(&exe, uri)?;
    begin_session(app, state, place_id, None, None, None);
    Ok(json!({ "ok": true, "placeId": place_id }))
}

/// Ruby opened while a game was already running (launched from the web, the Roblox app,
/// or before Ruby started): take it over so the overlay works and leaving returns to Ruby.
pub fn adopt_running_game(app: &AppHandle, state: &Arc<AppState>) -> bool {
    if in_exit_grace() {
        return false;
    }
    if state.game_session.read().running {
        // A taken-over game ends when its log says it left (the Roblox app can stay open
        // on its home screen, so "Roblox is running" alone doesn't mean "in a game").
        if ADOPTED.load(Ordering::SeqCst) && crate::roblox::log_watcher::current_game_from_log().is_none() {
            end_game_session_and_return_to_ruby(app, state);
        }
        return false;
    }
    if !is_roblox_running() {
        return false;
    }
    // The newest player log belongs to the running client; it says which server it's in.
    let Some(info) = crate::roblox::log_watcher::current_game_from_log() else { return false };
    let Some(place) = info.place_id else { return false };
    if info.job_id.is_some() && *LAST_ENDED_JOB.lock() == info.job_id {
        return false;
    }
    tracing::info!("adopting running game {place}");
    begin_session(app, state, Some(place), info.job_id, None, None);
    ADOPTED.store(true, Ordering::SeqCst);
    true
}

/// Mark a game as running, watch it, and tell the UI.
fn begin_session(app: &AppHandle, state: &Arc<AppState>, place: Option<u64>, game_instance_id: Option<String>, place_name: Option<String>, icon_url: Option<String>) {
    {
        let mut gs = state.game_session.write();
        gs.place_id = place;
        if let Some(ref job) = game_instance_id {
            // A private-server access code isn't a job id; the log watcher fills the real one in.
            if !job.is_empty() && !job.starts_with("private:") {
                gs.job_id = Some(job.clone());
            }
        }
        gs.running = true;
        if gs.started_at.is_none() {
            gs.started_at = Some(now_secs());
        }
        gs.place_name = place_name;
        gs.icon_url = icon_url;
    }

    ADOPTED.store(false, Ordering::SeqCst);
    let gen = SESSION_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    start_leave_watcher(app.clone(), Arc::clone(state));

    let _ = app.emit(
        "launch-game-running",
        json!({ "placeId": place, "gameInstanceId": game_instance_id }),
    );
    let _ = app.emit(
        "roblox-session-state",
        json!({
            "running": true,
            "placeId": place,
            "jobId": game_instance_id,
            "serverId": game_instance_id,
        }),
    );

    // Poll for process exit (fallback if leave logs never fire).
    let app2 = app.clone();
    let state2 = Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        // Give the client time to start before treating "not running" as ended.
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if SESSION_GEN.load(Ordering::SeqCst) != gen {
                break;
            }
            if !state2.game_session.read().running {
                break;
            }
            if in_exit_grace() {
                continue;
            }
            if !is_roblox_running() {
                end_game_session_and_return_to_ruby(&app2, &state2);
                break;
            }
        }
    });
}

/// Where the server you're on is, cached per address (Roblox datacentres don't move).
static REGIONS: once_cell::sync::Lazy<parking_lot::Mutex<std::collections::HashMap<String, Value>>> = once_cell::sync::Lazy::new(Default::default);

/// Server address, ping at join and location, for the overlay. The location lookup sends only
/// the Roblox server's public IP (never anything about you) to ipinfo.io.
pub async fn get_server_info(state: &Arc<AppState>) -> Value {
    if !state.game_session.read().running {
        return json!({ "ok": false });
    }
    let Some((ip, ping)) = tokio::task::spawn_blocking(crate::roblox::log_watcher::server_from_log).await.ok().flatten() else {
        return json!({ "ok": false });
    };
    let place = locate(state, &ip).await;
    json!({ "ok": true, "ip": ip, "pingMs": ping, "location": place })
}

/// City, region and country for a Roblox server IP, cached for the session.
async fn locate(state: &Arc<AppState>, ip: &str) -> Value {
    if let Some(v) = REGIONS.lock().get(ip).cloned() {
        return v;
    }
    let looked = async {
        let r = state.http.get(format!("https://ipinfo.io/{ip}/json")).header("User-Agent", "RubyLauncher").timeout(std::time::Duration::from_secs(5)).send().await.ok()?;
        r.json::<Value>().await.ok()
    }
    .await
    .map(|v| json!({ "city": v["city"], "region": v["region"], "country": v["country"] }))
    .unwrap_or(Value::Null);
    if !looked.is_null() {
        REGIONS.lock().insert(ip.to_string(), looked.clone());
    }
    looked
}

pub fn get_current_game_session(state: &Arc<AppState>) -> Value {
    if let Some(info) = latest_joining_game() {
        let mut gs = state.game_session.write();
        if let Some(place) = info.place_id {
            gs.place_id = Some(place);
        }
        if let Some(job) = info.job_id {
            gs.job_id = Some(job);
        }
    }
    let gs = state.game_session.read();
    let started_secs = gs.started_at.unwrap_or(0);
    let started_ms = if started_secs > 1_000_000_000_000 {
        started_secs
    } else if started_secs > 0 {
        started_secs * 1000
    } else {
        0
    };
    json!({
        "placeId": gs.place_id.map(|p| p.to_string()),
        "jobId": gs.job_id,
        "serverId": gs.job_id,
        "running": gs.running,
        "startedAt": started_ms,
    })
}

/// Play time per place: `{ placeId: { totalMs, lastPlayedAt } }`.
pub fn get_play_time_for_places(state: &Arc<AppState>, place_ids: &[u64]) -> Value {
    let store = state.playtime.read();
    let mut out = serde_json::Map::new();
    for id in place_ids {
        let secs = store.by_place.get(id).copied().unwrap_or(0);
        let last = store.last_played.get(id).copied().unwrap_or(0);
        if secs > 0 || last > 0 {
            out.insert(id.to_string(), json!({ "totalMs": secs * 1000, "lastPlayedAt": last * 1000 }));
        }
    }
    Value::Object(out)
}

pub fn get_roblox_player_version_state() -> Value {
    let path = find_roblox_player();
    json!({
        "installed": path.is_some(),
        "path": path.map(|p| p.to_string_lossy().to_string()),
    })
}

pub fn open_roblox_versions_folder() -> Result<Value, String> {
    let local = dirs::data_local_dir().ok_or("no local app data")?;
    let versions = local.join("Roblox").join("Versions");
    open::that(&versions).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true }))
}

