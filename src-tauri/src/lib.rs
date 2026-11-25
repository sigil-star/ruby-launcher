mod commands;
mod discord;
mod overlay;
mod plugins;
mod toasts;
mod tray;
mod updates;
mod wallpapers;
mod roblox;
mod state;
mod win_process;
mod windows;

use state::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Uninstaller hook: hand roblox.com launches back to Roblox, then exit.
    if roblox::protocol::restore_from_args() {
        return;
    }
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rubylauncher_tauri=info".into()),
        )
        .try_init();

    // Game shortcuts start Ruby too; without its own app id, Windows would give Ruby's taskbar
    // button that shortcut's icon (the game cover) instead of Ruby's logo.
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn SetCurrentProcessExplicitAppUserModelID(id: *const u16) -> i32;
        }
        let id: Vec<u16> = "com.rubylauncher.tauri".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
        }
    }
    roblox::shortcuts::remember_startup_play();
    roblox::protocol::remember_startup_uri();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A game shortcut opened while Ruby is running: play it here.
            if let Some(place) = roblox::shortcuts::play_arg(&args) {
                let _ = app.emit("ruby-play", place);
            }
            // "Play" on roblox.com while Ruby is running: launch it here, leave Ruby where it is.
            if let Some(uri) = roblox::protocol::uri_arg(&args) {
                let (app, state) = (app.clone(), app.state::<std::sync::Arc<AppState>>().inner().clone());
                tauri::async_runtime::spawn(async move { roblox::protocol::handle(&app, &state, uri).await });
                return;
            }
            if let Some(w) = app.get_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin({
            #[cfg(windows)]
            {
                use tauri_plugin_prevent_default::PlatformOptions;
                tauri_plugin_prevent_default::Builder::new()
                    .platform(
                        PlatformOptions::new()
                            .browser_accelerator_keys(false)
                            .default_context_menus(false),
                    )
                    .build()
            }
            #[cfg(not(windows))]
            {
                tauri_plugin_prevent_default::init()
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                dirs::data_local_dir()
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join("RubyLauncher-Tauri")
            });
            let state = AppState::new(data_dir);
            if state.behavior.read().dont_open_app_on_game_close {
                roblox::close_to_app::enforce_close_to_app_off();
            }
            app.manage(state.clone());
            roblox::bundled_packs::seed(&state);

            // Discord Rich Presence (shows "Playing <game>" / "In Ruby Launcher").
            discord::start(state.clone());

            // In-game overlay: F6 while Roblox is in front.
            overlay::start_hotkey(app.handle().clone(), state.clone());

            // Single tray icon only (do not also set app.trayIcon in tauri.conf.json).
            tray::build(app)?;

            // Web launches go through Ruby; a game already running (or started elsewhere
            // later) is adopted so the overlay works and leaving it lands on Ruby's home.
            roblox::protocol::sync(&state);
            {
                let (h, st) = (app.handle().clone(), state.clone());
                let startup_uri = roblox::protocol::take_startup_uri();
                tauri::async_runtime::spawn(async move {
                    if let Some(uri) = startup_uri {
                        roblox::protocol::handle(&h, &st, uri).await;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    loop {
                        let (h2, st2) = (h.clone(), st.clone());
                        let _ = tokio::task::spawn_blocking(move || roblox::launch::adopt_running_game(&h2, &st2)).await;
                        tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                    }
                });
            }

            // New Roblox builds get Ruby's mods as soon as they appear, not only when Ruby launches a game.
            {
                let st = state.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        roblox::theme::keep_all_versions(&st).await;
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    }
                });
            }

            let handle = app.handle().clone();
            let state_boot = state.clone();
            tauri::async_runtime::spawn(async move {
                roblox::bootstrap_session(&handle, &state_boot).await;
            });

            // Show main window once React is ready (avoids white flashbang). Failsafe after 4s.
            let handle_show = app.handle().clone();
            let state_show = state.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(4000)).await;
                if !state_show
                    .main_ready
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    if let Some(w) = handle_show.get_window("main") {
                        let _ = w.show();
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let state = window.app_handle().state::<std::sync::Arc<AppState>>();
                    if state.behavior.read().minimize_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                        tracing::info!("main window closed to tray");
                    } else {
                        // No tray: closing the window quits Ruby.
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![commands::launcher_invoke])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
