//! Ruby's shared state, and the files it keeps in AppData.
pub mod secret;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RobloxUserData {
    pub id: Option<i64>,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub has_verified_badge: Option<bool>,
    pub avatar: Option<String>,
    pub avatar_full: Option<String>,
    pub robux: Option<i64>,
    pub is_premium: Option<bool>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAccount {
    pub id: String,
    pub user_id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub cookie: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherBehaviorSettings {
    pub minimize_to_tray: bool,
    pub resource_saver: bool,
    pub start_minimized: bool,
    /// When true, leave/end experience should exit Roblox instead of returning to Roblox home.
    #[serde(default = "default_true")]
    pub dont_open_app_on_game_close: bool,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

fn default_true() -> bool {
    true
}

impl Default for LauncherBehaviorSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: false,
            resource_saver: false,
            start_minimized: false,
            dont_open_app_on_game_close: true,
            extra: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionDebug {
    pub step: String,
    pub cookie_status: String,
}

#[derive(Debug, Default)]
pub struct GameSession {
    pub place_id: Option<u64>,
    pub job_id: Option<String>,
    pub running: bool,
    pub started_at: Option<i64>,
    pub place_name: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Default)]
pub struct PlaytimeStore {
    /// place_id -> seconds
    pub by_place: HashMap<u64, u64>,
    /// place_id -> when you last left it (unix seconds). Kept in its own file so older Ruby
    /// versions can still read playtime.json.
    pub last_played: HashMap<u64, u64>,
}

pub struct AppState {
    pub data_dir: PathBuf,
    pub cookie: RwLock<Option<String>>,
    pub user: RwLock<RobloxUserData>,
    pub accounts: RwLock<Vec<SavedAccount>>,
    pub is_guest: AtomicBool,
    pub login_bar_visible: AtomicBool,
    pub session_debug: RwLock<SessionDebug>,
    pub behavior: RwLock<LauncherBehaviorSettings>,
    pub game_session: RwLock<GameSession>,
    pub playtime: RwLock<PlaytimeStore>,
    pub main_ready: AtomicBool,
    pub http: reqwest::Client,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&data_dir);
        // No cookie jar: the session cookie is added per request (http.rs). A jar would replace
        // that header with its own cookies after Roblox's first Set-Cookie, signing Ruby out.
        let http = reqwest::Client::builder()
            .user_agent("RubyLauncher-Tauri/1.0")
            // A stalled connection must fail, not hang the page that needs it forever.
            .connect_timeout(std::time::Duration::from_secs(8))
            .timeout(std::time::Duration::from_secs(25))
            .pool_idle_timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("http client");

        let state = Arc::new(Self {
            data_dir,
            cookie: RwLock::new(None),
            user: RwLock::new(RobloxUserData::default()),
            accounts: RwLock::new(Vec::new()),
            is_guest: AtomicBool::new(false),
            login_bar_visible: AtomicBool::new(true),
            session_debug: RwLock::new(SessionDebug {
                step: "boot".into(),
                cookie_status: "none".into(),
            }),
            behavior: RwLock::new(LauncherBehaviorSettings {
                minimize_to_tray: true,
                dont_open_app_on_game_close: true,
                ..Default::default()
            }),
            game_session: RwLock::new(GameSession::default()),
            playtime: RwLock::new(PlaytimeStore::default()),
            main_ready: AtomicBool::new(false),
            http,
        });
        state.load_persisted();
        state
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("launcher-settings.json")
    }

    pub fn session_path(&self) -> PathBuf {
        self.data_dir.join("session.json")
    }

    pub fn accounts_path(&self) -> PathBuf {
        self.data_dir.join("accounts.json")
    }

    pub fn playtime_path(&self) -> PathBuf {
        self.data_dir.join("playtime.json")
    }

    pub fn log_path(&self) -> PathBuf {
        self.data_dir.join("ruby-launcher.log")
    }

    fn load_persisted(&self) {
        // Files from before encryption get re-saved encrypted once loaded.
        let mut migrate = false;
        if let Ok(raw) = std::fs::read_to_string(self.settings_path()) {
            if let Ok(v) = serde_json::from_str::<LauncherBehaviorSettings>(&raw) {
                *self.behavior.write() = v;
            }
        }
        if let Ok(raw) = std::fs::read_to_string(self.session_path()) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                if let Some(c) = v.get("cookie").and_then(|x| x.as_str()).and_then(secret::unprotect) {
                    migrate |= !v.get("cookie").and_then(|x| x.as_str()).map(secret::is_protected).unwrap_or(true);
                    *self.cookie.write() = Some(c);
                    self.login_bar_visible.store(false, Ordering::SeqCst);
                    self.session_debug.write().cookie_status = "loaded".into();
                }
                if let Some(u) = v.get("user") {
                    if let Ok(user) = serde_json::from_value::<RobloxUserData>(u.clone()) {
                        *self.user.write() = user;
                    }
                }
            }
        }
        if let Ok(raw) = std::fs::read_to_string(self.accounts_path()) {
            if let Ok(mut list) = serde_json::from_str::<Vec<SavedAccount>>(&raw) {
                for a in list.iter_mut() {
                    migrate |= !secret::is_protected(&a.cookie);
                    a.cookie = secret::unprotect(&a.cookie).unwrap_or_default();
                }
                *self.accounts.write() = list;
            }
        }
        if let Ok(raw) = std::fs::read_to_string(self.playtime_path()) {
            if let Ok(map) = serde_json::from_str::<HashMap<u64, u64>>(&raw) {
                self.playtime.write().by_place = map;
            }
        }
        if let Ok(raw) = std::fs::read_to_string(self.data_dir.join("playtime-last.json")) {
            if let Ok(map) = serde_json::from_str::<HashMap<u64, u64>>(&raw) {
                self.playtime.write().last_played = map;
            }
        }
        if migrate {
            self.save_session();
            self.save_accounts();
        }
    }

    pub fn save_session(&self) {
        let cookie = self.cookie.read().clone();
        let user = self.user.read().clone();
        let payload = json!({ "cookie": cookie.as_deref().map(secret::protect), "user": user });
        let _ = std::fs::write(self.session_path(), payload.to_string());
    }

    pub fn save_accounts(&self) {
        let mut list = self.accounts.read().clone();
        for a in list.iter_mut() {
            a.cookie = secret::protect(&a.cookie);
        }
        let _ = std::fs::write(
            self.accounts_path(),
            serde_json::to_string_pretty(&list).unwrap_or_else(|_| "[]".into()),
        );
    }

    pub fn save_behavior(&self) {
        let b = self.behavior.read().clone();
        let _ = std::fs::write(
            self.settings_path(),
            serde_json::to_string_pretty(&b).unwrap_or_else(|_| "{}".into()),
        );
    }

    pub fn save_playtime(&self) {
        let (map, last) = {
            let p = self.playtime.read();
            (p.by_place.clone(), p.last_played.clone())
        };
        let _ = std::fs::write(
            self.playtime_path(),
            serde_json::to_string_pretty(&map).unwrap_or_else(|_| "{}".into()),
        );
        let _ = std::fs::write(self.data_dir.join("playtime-last.json"), serde_json::to_string(&last).unwrap_or_else(|_| "{}".into()));
    }

    pub fn user_json(&self) -> Value {
        serde_json::to_value(self.user.read().clone()).unwrap_or(json!({}))
    }
}
