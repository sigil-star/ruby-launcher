//! Stops the Roblox app from opening its home screen after you leave a game (optional).

use serde_json::{json, Value};
use std::path::PathBuf;

const CLOSE_TO_APP_KEYS: &[&str] = &[
    "OpenDesktopAppOnGameClose",
    "ReturnToAppOnGameClose",
    "LaunchAppAfterGameClose",
    "OpenAppAfterPlayerExit",
    "ExitToDesktopAppOnClose",
    "ShowDesktopAppOnGameClose",
    "OpenAppOnPlayerExit",
    "NavigateToAppOnClose",
    "ReturnToAppWhenLeavingExperience",
];

fn local_app_data() -> Option<PathBuf> {
    dirs::data_local_dir()
}

fn app_storage_path() -> Option<PathBuf> {
    Some(local_app_data()?.join("Roblox").join("LocalStorage").join("appStorage.json"))
}

fn client_app_settings_path() -> Option<PathBuf> {
    Some(
        local_app_data()?
            .join("Roblox")
            .join("ClientSettings")
            .join("ClientAppSettings.json"),
    )
}

fn versions_path() -> Option<PathBuf> {
    Some(local_app_data()?.join("Roblox").join("Versions"))
}

fn read_json_object(path: &std::path::Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}))
}

fn write_json_object(path: &std::path::Path, value: &Value) -> bool {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    serde_json::to_string_pretty(value)
        .ok()
        .and_then(|s| std::fs::write(path, s).ok())
        .is_some()
}

fn apply_close_flags_to_client_settings(settings: &mut serde_json::Map<String, Value>) -> bool {
    let mut changed = false;
    let ensure_true = |map: &mut serde_json::Map<String, Value>, key: &str, changed: &mut bool| {
        let want = Value::Bool(true);
        if map.get(key) != Some(&want) {
            map.insert(key.to_string(), want);
            *changed = true;
        }
    };
    ensure_true(settings, "FFlagDisableReturnToAppOnGameClose", &mut changed);
    ensure_true(settings, "FFlagDisableOpenDesktopAppOnGameClose", &mut changed);
    if settings.get("FFlagEnableReturnToAppOnGameClose") == Some(&Value::Bool(true)) {
        settings.insert("FFlagEnableReturnToAppOnGameClose".into(), Value::Bool(false));
        changed = true;
    }
    changed
}

/// Force Roblox to exit the process on leave instead of returning to in-app home.
pub fn enforce_close_to_app_off() {
    // 1) appStorage.json
    if let Some(path) = app_storage_path() {
        let mut storage = read_json_object(&path);
        let mut changed = false;
        if let Some(obj) = storage.as_object_mut() {
            for key in CLOSE_TO_APP_KEYS {
                let cur = obj.get(*key);
                if cur != Some(&Value::String("false".into())) && cur != Some(&Value::Bool(false)) {
                    obj.insert((*key).to_string(), Value::String("false".into()));
                    changed = true;
                }
            }

            let mut app_config: Value = obj
                .get("AppConfiguration")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if let Value::String(s) = &app_config {
                app_config = serde_json::from_str(s).unwrap_or_else(|_| json!({}));
            }
            if let Some(cfg) = app_config.as_object_mut() {
                let policy_off = [
                    ("EnableInGameHomeIcon", false),
                    ("ChatHeaderHomeButton", false),
                    ("InExperienceCanNavigateHome", false),
                    ("ShouldSystemBarUsuallyBePresent", false),
                    ("OpenDesktopAppOnGameClose", false),
                    ("ReturnToAppOnGameClose", false),
                ];
                let keys: Vec<String> = cfg.keys().cloned().collect();
                for config_key in keys {
                    if !config_key.ends_with(":app-policy") {
                        continue;
                    }
                    let mut policy = match cfg.get(&config_key).cloned().unwrap_or(json!({})) {
                        Value::String(s) => serde_json::from_str(&s).unwrap_or_else(|_| json!({})),
                        other => other,
                    };
                    if let Some(p) = policy.as_object_mut() {
                        let mut policy_changed = false;
                        for (k, expected) in policy_off {
                            if p.get(k) != Some(&Value::Bool(expected)) {
                                p.insert(k.to_string(), Value::Bool(expected));
                                policy_changed = true;
                            }
                        }
                        if policy_changed {
                            cfg.insert(config_key, Value::String(policy.to_string()));
                            changed = true;
                        }
                    }
                }
            }
            obj.insert(
                "AppConfiguration".into(),
                Value::String(app_config.to_string()),
            );
        }
        if changed {
            let _ = write_json_object(&path, &storage);
        }
    }

    // 2) global ClientAppSettings.json
    if let Some(path) = client_app_settings_path() {
        let mut settings = read_json_object(&path);
        if let Some(obj) = settings.as_object_mut() {
            if apply_close_flags_to_client_settings(obj) || !path.exists() {
                let _ = write_json_object(&path, &settings);
            }
        }
    }

    // 3) per-version ClientAppSettings.json
    if let Some(versions) = versions_path() {
        if let Ok(entries) = std::fs::read_dir(versions) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with("version-") {
                    continue;
                }
                let path = entry
                    .path()
                    .join("ClientSettings")
                    .join("ClientAppSettings.json");
                if !path.is_file() {
                    continue;
                }
                let mut settings = read_json_object(&path);
                if let Some(obj) = settings.as_object_mut() {
                    if apply_close_flags_to_client_settings(obj) {
                        let _ = write_json_object(&path, &settings);
                    }
                }
            }
        }
    }
}
