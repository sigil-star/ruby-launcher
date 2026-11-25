//! The tray icon. Left-click opens Ruby; right-click shows who you're signed in as, how many
//! friends are online and how many notifications you have, plus Open and Quit.
//!
//! The numbers come from Ruby's own screens (they already keep them up to date), sent here with
//! `trayStatus`, so the tray never makes requests of its own.

use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

struct Items {
    account: MenuItem<Wry>,
    friends: MenuItem<Wry>,
    notifications: MenuItem<Wry>,
}

static ITEMS: Mutex<Option<Items>> = parking_lot::const_mutex(None);

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Open Ruby on a page ("friends", "notifications"); the screens handle the event.
fn open_on(app: &AppHandle, target: &str) {
    show_main(app);
    let _ = app.emit("ruby-tray", target);
}

pub fn build(app: &tauri::App) -> tauri::Result<()> {
    let account = MenuItem::with_id(app, "account", "Not signed in", false, None::<&str>)?;
    let friends = MenuItem::with_id(app, "friends", "Friends online: …", true, None::<&str>)?;
    let notifications = MenuItem::with_id(app, "notifications", "Notifications: …", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Open Ruby Launcher", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&account, &sep1, &friends, &notifications, &sep2, &show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("ruby")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Ruby Launcher")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "show" => show_main(app),
            "friends" => open_on(app, "friends"),
            "notifications" => open_on(app, "notifications"),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    *ITEMS.lock() = Some(Items { account, friends, notifications });
    Ok(())
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    display_name: Option<String>,
    name: Option<String>,
    online: Option<u32>,
    in_game: Option<u32>,
    notifications: Option<u32>,
}

/// Called by the screens whenever the account or the counts change.
pub fn set_status(app: &AppHandle, v: &Value) -> Result<Value, String> {
    let s: Status = serde_json::from_value(v.clone()).unwrap_or_default();
    let plural = |n: u32, one: &str, many: &str| if n == 1 { format!("1 {one}") } else { format!("{n} {many}") };
    let account = match (&s.display_name, &s.name) {
        (Some(d), Some(n)) if d != n => format!("Signed in as {d} (@{n})"),
        (_, Some(n)) => format!("Signed in as @{n}"),
        _ => "Not signed in".to_string(),
    };
    let friends = match (s.online, s.in_game) {
        (Some(o), Some(g)) if g > 0 => format!("{} ({g} in a game)", plural(o, "friend online", "friends online")),
        (Some(o), _) => plural(o, "friend online", "friends online"),
        _ => "Friends online: …".to_string(),
    };
    let notes = match s.notifications {
        Some(0) => "No new notifications".to_string(),
        Some(n) => plural(n, "new notification", "new notifications"),
        None => "Notifications: …".to_string(),
    };
    if let Some(items) = ITEMS.lock().as_ref() {
        let _ = items.account.set_text(&account);
        let _ = items.friends.set_text(&friends);
        let _ = items.notifications.set_text(&notes);
    }
    if let Some(t) = app.tray_by_id("ruby") {
        let n = s.notifications.unwrap_or(0);
        let tip = if n > 0 { format!("Ruby Launcher · {}", plural(n, "notification", "notifications")) } else { "Ruby Launcher".to_string() };
        let _ = t.set_tooltip(Some(tip));
    }
    Ok(json!({ "ok": true }))
}
