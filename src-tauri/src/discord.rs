//! Discord Rich Presence. In a game: the game's cover art, name, creator, how long you've been
//! playing, and Join / View Profile buttons. In Ruby: what page you're on. Every part can be
//! switched off in Ruby's settings (Settings → Security → Discord status).
//!
//! Connects to the local Discord IPC pipe and quietly retries if Discord isn't running.

use crate::state::AppState;
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

const APP_ID: &str = "1480710833196765324";
static STOP: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);

const DOWNLOAD_URL: &str = "https://dsk.wtf/ruby";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordPrefs {
    /// Show any Ruby status on Discord at all.
    pub enabled: bool,
    /// Show which game you're playing (off: just "Playing Roblox").
    pub show_game: bool,
    /// The game's icon as the big image.
    pub show_cover: bool,
    /// "by <creator>".
    pub show_creator: bool,
    /// The elapsed-time counter.
    pub show_elapsed: bool,
    /// A button that joins your exact server.
    pub join_button: bool,
    /// A button to your Roblox profile.
    pub profile_button: bool,
    /// A "Download Ruby Launcher" button linking to dsk.wtf/ruby.
    pub download_button: bool,
    /// What you're doing in Ruby when not in a game.
    pub show_browsing: bool,
}

impl Default for DiscordPrefs {
    fn default() -> Self {
        Self { enabled: true, show_game: true, show_cover: true, show_creator: true, show_elapsed: true, join_button: true, profile_button: true, download_button: true, show_browsing: true }
    }
}

static PREFS: once_cell::sync::Lazy<parking_lot::Mutex<Option<DiscordPrefs>>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(None));

fn prefs_path(state: &AppState) -> std::path::PathBuf {
    state.data_dir.join("discord.json")
}

pub fn prefs(state: &AppState) -> DiscordPrefs {
    let mut cached = PREFS.lock();
    if let Some(p) = cached.as_ref() {
        return p.clone();
    }
    let p: DiscordPrefs = std::fs::read_to_string(prefs_path(state)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    *cached = Some(p.clone());
    p
}

pub fn get_prefs(state: &AppState) -> Value {
    serde_json::to_value(prefs(state)).unwrap_or(json!({}))
}

pub fn set_prefs(state: &AppState, v: Value) -> Result<Value, String> {
    let p: DiscordPrefs = serde_json::from_value(v).map_err(|e| e.to_string())?;
    std::fs::write(prefs_path(state), serde_json::to_string_pretty(&p).unwrap_or_default()).map_err(|e| e.to_string())?;
    *PREFS.lock() = Some(p.clone());
    Ok(serde_json::to_value(p).unwrap_or(json!({})))
}

/// What Ruby is showing right now ("details", "state"), set by the frontend on navigation.
static PAGE: once_cell::sync::Lazy<parking_lot::Mutex<(String, String)>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(("Browsing Roblox".into(), "In Ruby Launcher".into())));

pub fn set_page(details: &str, state: &str) {
    let d = details.trim();
    let st = state.trim();
    *PAGE.lock() = (
        if d.is_empty() { "Browsing Roblox".into() } else { d.chars().take(120).collect() },
        if st.is_empty() { "In Ruby Launcher".into() } else { st.chars().take(120).collect() },
    );
}

#[derive(Clone)]
struct GameInfo {
    name: String,
    creator: String,
    cover: Option<String>,
}

static GAMES: once_cell::sync::Lazy<parking_lot::Mutex<HashMap<u64, Option<GameInfo>>>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(HashMap::new()));

async fn fetch_game(state: &AppState, place: u64) -> Option<GameInfo> {
    let get = |url: String| async move { state.http.get(url).send().await.ok()?.json::<Value>().await.ok() };
    let uni = get(format!("https://apis.roblox.com/universes/v1/places/{place}/universe")).await?.get("universeId")?.as_u64()?;
    let (game, icon) = tokio::join!(
        get(format!("https://games.roblox.com/v1/games?universeIds={uni}")),
        get(format!("https://thumbnails.roblox.com/v1/games/icons?universeIds={uni}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false")),
    );
    let g = game.as_ref()?.get("data")?.get(0)?;
    Some(GameInfo {
        name: g.get("name")?.as_str()?.to_string(),
        creator: g.get("creator").and_then(|c| c.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string(),
        cover: icon.as_ref().and_then(|i| i.get("data")?.get(0)?.get("imageUrl")?.as_str().map(|s| s.to_string())).filter(|u| u.starts_with("https://")),
    })
}

/// Cached per place; fetched once (from the Discord thread) the first time a game is seen.
fn game_info(state: &AppState, place: u64) -> Option<GameInfo> {
    if let Some(hit) = GAMES.lock().get(&place) {
        return hit.clone();
    }
    let info = tauri::async_runtime::block_on(fetch_game(state, place));
    GAMES.lock().insert(place, info.clone());
    info
}

struct Presence {
    /// Shown as the activity's title ("Playing <name>") instead of the app name.
    name: Option<String>,
    details: String,
    state: String,
    large_image: Option<String>,
    large_text: String,
    start: Option<i64>,
    buttons: Vec<(String, String)>,
}

fn clip(s: &str, max: usize) -> String {
    let t: String = s.chars().take(max).collect();
    // Discord rejects 1-character fields.
    if t.chars().count() < 2 { format!("{t} ") } else { t }
}

fn build(state: &AppState, p: &DiscordPrefs) -> Option<Presence> {
    if !p.enabled {
        return None;
    }
    // Snapshot, so no lock is held while fetching game info.
    struct Gs { running: bool, place_id: Option<u64>, job_id: Option<String>, started_at: Option<i64>, place_name: Option<String> }
    let gs = {
        let g = state.game_session.read();
        Gs { running: g.running, place_id: g.place_id, job_id: g.job_id.clone(), started_at: g.started_at, place_name: g.place_name.clone() }
    };
    let user_id = state.user.read().id;
    let mut buttons = vec![];

    if gs.running {
        let info = if p.show_game { gs.place_id.and_then(|id| game_info(state, id)) } else { None };
        let name = info.as_ref().map(|i| i.name.clone()).or_else(|| gs.place_name.clone().filter(|_| p.show_game)).unwrap_or_else(|| "Roblox".into());
        let creator = info.as_ref().map(|i| i.creator.clone()).filter(|c| !c.is_empty() && p.show_creator && p.show_game);
        if p.join_button && p.show_game {
            if let (Some(place), Some(job)) = (gs.place_id, gs.job_id.as_deref().filter(|j| !j.is_empty())) {
                buttons.push(("Join".to_string(), format!("https://www.roblox.com/games/start?placeId={place}&gameInstanceId={job}")));
            } else if let Some(place) = gs.place_id {
                buttons.push(("Join".to_string(), format!("https://www.roblox.com/games/start?placeId={place}")));
            }
        }
        if p.profile_button {
            if let Some(id) = user_id {
                buttons.push(("View Profile".to_string(), format!("https://www.roblox.com/users/{id}/profile")));
            }
        }
        if p.download_button {
            buttons.push(("Download Ruby Launcher".to_string(), DOWNLOAD_URL.to_string()));
        }
        buttons.truncate(2); // Discord shows at most two
        let start = gs.started_at.filter(|_| p.show_elapsed).map(|t| if t > 1_000_000_000_000 { t / 1000 } else { t });
        return Some(Presence {
            // Title is the game itself; Ruby goes last.
            name: Some(clip(&name, 120)),
            details: clip(&creator.map(|c| format!("by {c}")).unwrap_or_else(|| "Roblox".into()), 120),
            state: "via Ruby Launcher".into(),
            large_image: info.as_ref().and_then(|i| i.cover.clone()).filter(|_| p.show_cover),
            large_text: clip(&name, 120),
            start,
            buttons,
        });
    }

    let (details, page_state) = if p.show_browsing { PAGE.lock().clone() } else { ("Browsing Roblox".to_string(), "In Ruby Launcher".to_string()) };
    if p.profile_button {
        if let Some(id) = user_id {
            buttons.push(("View Profile".to_string(), format!("https://www.roblox.com/users/{id}/profile")));
        }
    }
    if p.download_button {
        buttons.push(("Download Ruby Launcher".to_string(), DOWNLOAD_URL.to_string()));
    }
    buttons.truncate(2);
    Some(Presence { name: None, details: clip(&details, 120), state: clip(&page_state, 120), large_image: None, large_text: "Ruby Launcher".into(), start: None, buttons })
}

fn signature(p: &Option<Presence>) -> String {
    match p {
        None => "off".into(),
        Some(p) => format!("{:?}|{}|{}|{:?}|{}|{:?}|{:?}", p.name, p.details, p.state, p.large_image, p.large_text, p.start, p.buttons),
    }
}

pub fn start(state: Arc<AppState>) {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    STOP.store(false, Ordering::SeqCst);
    std::thread::Builder::new()
        .name("ruby-discord-rpc".into())
        .spawn(move || {
            let mut client: Option<DiscordIpcClient> = None;
            let mut last_sig = String::new();
            while !STOP.load(Ordering::SeqCst) {
                if client.is_none() {
                    if let Ok(mut c) = DiscordIpcClient::new(APP_ID) {
                        if c.connect().is_ok() {
                            tracing::info!("discord rpc connected");
                            client = Some(c);
                            last_sig.clear();
                        }
                    }
                }
                if let Some(c) = client.as_mut() {
                    let prefs = prefs(&state);
                    let presence = build(&state, &prefs);
                    let sig = signature(&presence);
                    if sig != last_sig {
                        let result = match &presence {
                            None => c.clear_activity(),
                            Some(p) => {
                                // Raw payload: the crate's Activity has no `name` / `status_display_type`,
                                // which let Discord title the card with the game instead of "Ruby".
                                let mut act = json!({ "type": 0, "details": p.details, "state": p.state, "assets": { "large_text": p.large_text } });
                                if let Some(n) = &p.name {
                                    act["name"] = json!(n);
                                    act["status_display_type"] = json!(0);
                                }
                                if let Some(img) = p.large_image.as_deref() {
                                    act["assets"]["large_image"] = json!(img);
                                }
                                if let Some(ts) = p.start {
                                    act["timestamps"] = json!({ "start": ts });
                                }
                                let buttons: Vec<Value> = p.buttons.iter().take(2).map(|(l, u)| json!({ "label": l, "url": u })).collect();
                                if !buttons.is_empty() {
                                    act["buttons"] = json!(buttons);
                                }
                                let nonce = format!("ruby-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
                                c.send(json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": act }, "nonce": nonce }), 1)
                            }
                        };
                        match result {
                            Ok(_) => {
                                tracing::debug!(%sig, "discord activity set");
                                last_sig = sig;
                            }
                            Err(e) => {
                                tracing::warn!("discord update failed: {e}");
                                client = None; // reconnect next loop
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_secs(2));
            }
            if let Some(mut c) = client.take() {
                let _ = c.close();
            }
            RUNNING.store(false, Ordering::SeqCst);
        })
        .ok();
}
