//! IPC dispatcher. The frontend calls `launcher_invoke(method, args)`.

use crate::roblox;
use crate::state::AppState;
use crate::windows;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::AppHandle;

fn arg<'a>(args: &'a [Value], i: usize) -> Option<&'a Value> {
    args.get(i)
}

fn arg_str(args: &[Value], i: usize) -> Option<&str> {
    arg(args, i).and_then(|v| v.as_str())
}

fn arg_u64(args: &[Value], i: usize) -> Option<u64> {
    arg(args, i).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_f64().map(|n| n as u64))
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    })
}

pub async fn dispatch(
    app: AppHandle,
    state: Arc<AppState>,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match method.as_str() {
        // Window
        "minimize" => windows::minimize(&app),
        "maximize" => windows::maximize(&app),
        "close" => windows::close(&app, &state),
        "trayStatus" => crate::tray::set_status(&app, arg(&args, 0).unwrap_or(&serde_json::Value::Null)),
        "isMaximized" => windows::is_maximized(&app),
        "mainRendererReady" => windows::main_renderer_ready(&app, &state),
        "openExternal" => {
            let url = arg_str(&args, 0).unwrap_or("");
            // http(s) links, plus Roblox Studio's own protocol (Create hub: "Edit in Studio").
            // Re-serialize through a URL parser (percent-encodes anything odd) and refuse
            // anything that isn't a plain web link or Studio's protocol, so a link from Roblox
            // content can never become a file path or a command for the shell.
            let parsed = url::Url::parse(url).map_err(|_| "that link isn't valid".to_string())?;
            let safe = match parsed.scheme() {
                "https" | "http" => parsed.host_str().is_some(),
                "roblox-studio" => true,
                _ => false,
            };
            if !safe || parsed.as_str().chars().any(|c| c.is_whitespace() || c == '"' || c == '^' || c == '`') {
                return Err("only http(s) links can be opened".into());
            }
            windows::open_external(&app, parsed.as_str())
        }
        // Roblox pages embedded inside Ruby (Plus, redeem): url, x, y, w, h
        "showEmbed" => windows::embed::show_embed(&app, &state, arg_str(&args, 0).unwrap_or(""), args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0), args.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0), args.get(3).and_then(|v| v.as_f64()).unwrap_or(0.0), args.get(4).and_then(|v| v.as_f64()).unwrap_or(0.0)),
        "moveEmbed" => windows::embed::move_embed(&app, args.get(0).and_then(|v| v.as_f64()).unwrap_or(0.0), args.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0), args.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0), args.get(3).and_then(|v| v.as_f64()).unwrap_or(0.0)),
        "closeEmbed" => windows::embed::close_embed(&app),
        "checkUpdate" => Ok(crate::updates::check(&app.package_info().version.to_string()).await),
        "wallpaperPictures" => crate::wallpapers::search_pictures(arg_str(&args, 0).unwrap_or(""), arg(&args, 1).and_then(|v| v.as_u64()).unwrap_or(1)).await,
        "wallpaperVideos" => crate::wallpapers::search_videos(arg_str(&args, 0).unwrap_or(""), arg(&args, 1).and_then(|v| v.as_u64()).unwrap_or(1)).await,
        "wallpaperCredit" => crate::wallpapers::picture_credit(arg_str(&args, 0).unwrap_or("")).await,
        "wallpaperThumb" => crate::wallpapers::thumb(arg_str(&args, 0).unwrap_or("")).await,
        "wallpaperVideoFile" => crate::wallpapers::moewalls_video(arg_str(&args, 0).unwrap_or("")).await.map(serde_json::Value::String),
        "wallpaperDownload" => crate::wallpapers::download(arg_str(&args, 0).unwrap_or("")).await,
        "installUpdate" => crate::updates::install(&app, &app.package_info().version.to_string()).await,
        "prewarmEmbed" => windows::embed::prewarm_embed(&app, &state),
        "hideEmbed" => windows::embed::hide_embed(&app),
        "reloadEmbed" => windows::embed::reload_embed(&app),
        "embedScript" => windows::embed::embed_script(&app, arg_str(&args, 0).unwrap_or("")),
        // In-game theme (tinted Roblox UI + Ruby logos)
        "getGraphicsFlags" => Ok(roblox::fflags::get(&state)),
        "setGraphicsFlags" => roblox::fflags::set(&state, args.first().cloned().unwrap_or_default()),
        "getIngameTheme" => Ok(roblox::theme::get(&state)),
        "setIngameTheme" => {
            let s: roblox::theme::ThemeSettings = serde_json::from_value(args.first().cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            roblox::theme::set(&state, s).await
        }
        "setCustomFont" => roblox::theme::set_custom_font(&state, arg_str(&args, 0).unwrap_or("font"), arg_str(&args, 1).unwrap_or("")),
        "modCatalog" => {
            let color = arg_str(&args, 0).filter(|c| c.starts_with('#')).map(|c| {
                let h = c.trim_start_matches('#');
                let p = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
                [p(0), p(2), p(4)]
            });
            Ok(roblox::packs::catalog(color))
        }
        "importPack" => {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD.decode(arg_str(&args, 1).unwrap_or("")).map_err(|e| e.to_string())?;
            roblox::userpacks::import(&state, arg_str(&args, 0).unwrap_or("Pack"), &bytes)
        }
        "importPackFiles" => {
            use base64::Engine;
            let list: Vec<(String, Vec<u8>)> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|f| {
                            let n = f.get(0)?.as_str()?.to_string();
                            let b = base64::engine::general_purpose::STANDARD.decode(f.get(1)?.as_str()?).ok()?;
                            Some((n, b))
                        })
                        .collect()
                })
                .unwrap_or_default();
            if list.is_empty() {
                return Err("No files".into());
            }
            roblox::userpacks::import_files(&state, arg_str(&args, 0).unwrap_or("Pack"), list)
        }
        "listUserPacks" => Ok(roblox::userpacks::list(&state)),
        "deleteUserPack" => roblox::userpacks::delete(&state, arg_str(&args, 0).unwrap_or("")),
        "openPacksFolder" => {
            let dir = roblox::userpacks::inbox_dir(&state);
            let _ = std::fs::create_dir_all(&dir);
            open::that(&dir).map(|_| serde_json::json!({ "ok": true })).map_err(|e| e.to_string())
        }
        "listFonts" => Ok(roblox::theme::list_fonts()),
        "fontPreview" => roblox::theme::font_preview(arg_str(&args, 0).unwrap_or("")),
        "uiFonts" => Ok(roblox::theme::ui_fonts()),
        "forceFieldPresets" => Ok(serde_json::json!(roblox::theme::FORCE_FIELD_PRESETS.iter().map(|(n, c)| serde_json::json!({ "name": n, "color": c })).collect::<Vec<_>>())),
        "forceFieldPreview" => roblox::theme::force_field_preview(arg_str(&args, 0).unwrap_or("#ffffff")),
        "micPacks" => Ok(roblox::theme::mic_catalog(&state)),
        "deathSounds" => Ok(roblox::theme::death_sound_list(&state)),
        "setDeathSound" => roblox::theme::set_death_sound(&state, arg_str(&args, 0).unwrap_or("")),
        "otherBootstrappers" => Ok(roblox::userpacks::other_bootstrappers()),
        "importBootstrapper" => roblox::userpacks::import_bootstrapper(&state, arg_str(&args, 0).unwrap_or("")),
        "listSkyboxes" => Ok(roblox::theme::list_skyboxes(&state)),
        "skyboxThumb" => roblox::theme::skybox_thumb(&state, arg_str(&args, 0).unwrap_or("")),
        "openSkyboxFolder" => {
            let dir = state.data_dir.join("skyboxes");
            let _ = std::fs::create_dir_all(&dir);
            open::that(&dir).map(|_| serde_json::json!({ "ok": true })).map_err(|e| e.to_string())
        }
        "getDiscordPrefs" => Ok(crate::discord::get_prefs(&state)),
        "setDiscordPrefs" => crate::discord::set_prefs(&state, args.first().cloned().unwrap_or_default()),
        "setDiscordPage" => {
            crate::discord::set_page(arg_str(&args, 0).unwrap_or(""), arg_str(&args, 1).unwrap_or(""));
            Ok(serde_json::json!({ "ok": true }))
        }
        // In-game overlay
        "overlayToggle" => crate::overlay::toggle(&app),
        "toastPush" => crate::toasts::push(&app, args.first().cloned().unwrap_or_default()),
        "toastPending" => Ok(crate::toasts::take_pending()),
        "toastLayout" => crate::toasts::layout(&app, args.first().and_then(|v| v.as_f64()).unwrap_or(0.0)),
        "toastOpen" => crate::toasts::open(&app, args.first().cloned().unwrap_or_default()),
        "mainFocused" => Ok(serde_json::json!(crate::toasts::main_focused(&app))),
        "overlayInfo" => Ok(serde_json::json!({ "hotkey": crate::overlay::HOTKEY_LABEL })),
        "overlayHide" => crate::overlay::hide(&app),
        "overlayRefocus" => crate::overlay::refocus_game(),
        "overlayCopy" => crate::overlay::copy_text(arg_str(&args, 0).unwrap_or("")),
        "overlayRejoin" => {
            let place = arg_u64(&args, 0).or_else(|| arg_str(&args, 0).and_then(|s| s.parse().ok())).unwrap_or(0);
            let job = arg_str(&args, 1).map(|s| s.to_string()).filter(|s| !s.is_empty());
            crate::overlay::rejoin(&app, &state, place, job).await
        }
        "overlayLeave" => crate::overlay::leave_game(&app, &state),
        "showMain" => {
            crate::roblox::launch::show_and_focus_main(&app);
            Ok(serde_json::json!({ "ok": true }))
        }
        "openRobloxWeb" => windows::open_roblox_web(
            &app,
            &state,
            arg_str(&args, 0).unwrap_or(""),
            arg_str(&args, 1).unwrap_or("Roblox"),
        ),

        // Account
        "getUserData" => Ok(roblox::get_user_data(&state).await),
        "refreshUserData" => roblox::refresh_user_data(&state).await,
        "getAuthState" => Ok(roblox::get_auth_bootstrap_state(&state)),
        "listSavedAccounts" => Ok(roblox::list_saved_accounts(&state)),
        "switchSavedAccount" => {
            roblox::switch_saved_account(&app, &state, arg_str(&args, 0).unwrap_or("")).await
        }
        "removeSavedAccount" => roblox::remove_saved_account(&state, arg_str(&args, 0).unwrap_or("")),
        "signIn" => roblox::login::open_login_window(&app, &state),
        "useRobloxAppSession" => Ok(roblox::use_roblox_app_session(&app, &state).await),
        "signOut" => roblox::sign_out_current_account(&app, &state),

        // Captures and desktop shortcuts
        "createGameShortcut" => {
            let place = arg_u64(&args, 0).ok_or("placeId required")?;
            roblox::shortcuts::create(&state.data_dir, place, arg_str(&args, 1).unwrap_or("Roblox game"), arg_str(&args, 2)).await
        }
        "rolimonsItems" => roblox::rolimons::items().await,
        "takeStartupPlay" => Ok(serde_json::json!(roblox::shortcuts::take_startup_play())),

        "listCaptures" => roblox::captures::list(),
        "openCapture" => roblox::captures::open(arg_str(&args, 0).unwrap_or("")),
        "revealCapture" => roblox::captures::reveal(arg_str(&args, 0).unwrap_or("")),
        "deleteCapture" => roblox::captures::delete(arg_str(&args, 0).unwrap_or("")),

        // Roblox web API (Roblox hosts only)
        "fetchRobloxAPI" => {
            let url = arg_str(&args, 0).ok_or("url required")?;
            roblox::fetch_roblox_api(&state, url, arg(&args, 1).cloned()).await
        }

        // Launch
        "launchRoblox" => {
            let place = arg_u64(&args, 0).ok_or("placeId required")?;
            let job = arg_str(&args, 1)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            let meta = arg(&args, 2);
            let name = meta
                .and_then(|m| m.get("name"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let icon = meta
                .and_then(|m| m.get("iconUrl"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            roblox::launch_roblox(&app, &state, place, job, name, icon).await
        }
        "prewarmLaunch" => Ok(roblox::prewarm(&state).await),
        "getServerInfo" => Ok(roblox::launch::get_server_info(&state).await),
        "serverRegion" => Ok(roblox::regions::server_region(&state, arg(&args, 0).and_then(|v| v.as_u64()).unwrap_or(0), arg_str(&args, 1).unwrap_or("")).await),
        "getGameSession" => Ok(roblox::get_current_game_session(&state)),
        "getRobloxInstall" => Ok(roblox::get_roblox_player_version_state()),
        "openRobloxVersionsFolder" => roblox::open_roblox_versions_folder(),
        // Roblox tab: versions, updates, weblauncher sync
        "getRobloxClientInfo" => Ok(roblox::bootstrap::client_info(&state).await),
        "updateRobloxPlayer" => {
            let guid = roblox::bootstrap::current_version(&state, "WindowsPlayer").await.map(|(g, _)| g).ok_or("could not reach Roblox")?;
            roblox::bootstrap::install_player(&app, &guid).await.map(|p| serde_json::json!({ "ok": true, "path": p.to_string_lossy() }))
        }
        "setClientSource" => roblox::bootstrap::set_client_source(&state, arg_str(&args, 0).unwrap_or("roblox")),
        "getPlayTimeForPlaces" => {
            let ids: Vec<u64> = arg(&args, 0)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_u64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
                        .collect()
                })
                .unwrap_or_default();
            Ok(roblox::get_play_time_for_places(&state, &ids))
        }

        // Settings
        "getLauncherSettings" => Ok(roblox::get_launcher_behavior_settings(&state)),
        "setLauncherSetting" => {
            let key = arg_str(&args, 0).ok_or("key required")?;
            roblox::set_launcher_behavior_setting(&state, key, arg(&args, 1).cloned().unwrap_or(Value::Null))
        }
        "openLogFile" => windows::open_ruby_log(&state),

        // Chat
        "chatListThreads" => {
            Ok(roblox::chat_list_threads(&app, &state, arg_str(&args, 0).unwrap_or("")).await)
        }
        "chatGetMessages" => Ok(roblox::chat_get_messages(
            &state,
            arg_str(&args, 0).unwrap_or(""),
            arg_str(&args, 1).unwrap_or(""),
        )
        .await),

        "appVersion" => Ok(json!(app.package_info().version.to_string())),

        // Plugins
        "listPlugins" => Ok(crate::plugins::list(&state)),
        "installPluginFiles" => crate::plugins::install_files(&state, arg(&args, 0).cloned().unwrap_or(json!([]))),
        "setPluginEnabled" => crate::plugins::set_enabled(&state, arg_str(&args, 0).unwrap_or(""), arg(&args, 1).and_then(|v| v.as_bool()).unwrap_or(false)),
        "removePlugin" => crate::plugins::remove(&state, arg_str(&args, 0).unwrap_or("")),
        "openPluginsFolder" => crate::plugins::open_folder(&state),
        "installPluginFromDir" => crate::plugins::install_from_dir(&state, arg_str(&args, 0).unwrap_or("")),

        other => Ok(json!({ "ok": false, "error": format!("unknown method: {other}") })),
    }
}

#[tauri::command]
pub async fn launcher_invoke(
    app: AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    method: String,
    args: Option<Vec<Value>>,
) -> Result<Value, String> {
    dispatch(app, state.inner().clone(), method, args.unwrap_or_default()).await
}
