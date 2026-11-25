//! Roblox client GlobalBasicSettings XML + launcher behavior settings.

use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn get_launcher_behavior_settings(state: &Arc<AppState>) -> Value {
    serde_json::to_value(&*state.behavior.read()).unwrap_or(json!({}))
}

pub fn set_launcher_behavior_setting(
    state: &Arc<AppState>,
    key: &str,
    value: Value,
) -> Result<Value, String> {
    {
        let mut b = state.behavior.write();
        match key {
            "minimize_to_tray" | "minimizeToTray" => {
                b.minimize_to_tray = value.as_bool().unwrap_or(b.minimize_to_tray);
            }
            "resource_saver" | "resourceSaver" => {
                b.resource_saver = value.as_bool().unwrap_or(b.resource_saver);
            }
            "start_minimized" | "startMinimized" => {
                b.start_minimized = value.as_bool().unwrap_or(b.start_minimized);
            }
            "dont_open_app_on_game_close" | "dontOpenAppOnGameClose" => {
                b.dont_open_app_on_game_close =
                    value.as_bool().unwrap_or(b.dont_open_app_on_game_close);
                if b.dont_open_app_on_game_close {
                    crate::roblox::close_to_app::enforce_close_to_app_off();
                }
            }
            other => {
                b.extra.insert(other.to_string(), value.clone());
            }
        }
    }
    state.save_behavior();
    if key == "handleWebLaunches" {
        crate::roblox::protocol::sync(state);
    }
    Ok(json!({ "ok": true }))
}
