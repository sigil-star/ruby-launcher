//! Ruby's own desktop notifications: a small always-on-top window in the bottom-right corner
//! (not Windows' notification centre). The page (`index.html#toasts`) draws the cards and tells
//! us how tall the stack is, so the window only covers the cards and never blocks clicks elsewhere.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "toasts";
/// Card column width (logical px) and gap to the screen edge.
const W: f64 = 360.0;
const MARGIN: f64 = 16.0;

static LAST_ACTIVITY: parking_lot::Mutex<Option<std::time::Instant>> = parking_lot::Mutex::new(None);
static WATCHDOG: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Longest a card can stay without anything new (cards last ~6.5 s; hover pauses them).
const MAX_IDLE: std::time::Duration = std::time::Duration::from_secs(20);

fn touch() {
    *LAST_ACTIVITY.lock() = Some(std::time::Instant::now());
}

/// Safety net: if the page ever fails to report "empty", hide the window anyway so the corner
/// of the screen is never left unclickable.
fn start_watchdog(app: &AppHandle) {
    if WATCHDOG.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let stale = LAST_ACTIVITY.lock().map(|t| t.elapsed() > MAX_IDLE).unwrap_or(true);
        if !stale {
            continue;
        }
        if let Some(w) = app.get_webview_window(LABEL) {
            if w.is_visible().unwrap_or(false) {
                let _ = w.emit_to(LABEL, "toast-clear", ());
                let _ = w.hide();
            }
        }
    });
}

fn window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    start_watchdog(app);
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#toasts".into()))
        .title("Ruby notifications")
        .inner_size(W, 10.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

/// Show without taking focus from the game or whatever the user is doing.
fn show_no_activate(w: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
            fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        }
        const SW_SHOWNOACTIVATE: i32 = 4;
        const HWND_TOPMOST: isize = -1;
        const SWP_NOMOVE: u32 = 0x2;
        const SWP_NOSIZE: u32 = 0x1;
        const SWP_NOACTIVATE: u32 = 0x10;
        if let Ok(h) = w.hwnd() {
            unsafe {
                ShowWindow(h.0 as isize, SW_SHOWNOACTIVATE);
                SetWindowPos(h.0 as isize, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            return;
        }
    }
    let _ = w.show();
}

/// Queue a notification (the main window decides *whether* to; this just shows it).
pub fn push(app: &AppHandle, payload: Value) -> Result<Value, String> {
    let w = window(app)?;
    touch();
    // The page may still be loading the first time; it asks for anything it missed on start.
    *PENDING.lock() = Some(payload.clone());
    let _ = w.emit_to(LABEL, "toast-push", payload);
    Ok(json!({ "ok": true }))
}

static PENDING: parking_lot::Mutex<Option<Value>> = parking_lot::Mutex::new(None);

pub fn take_pending() -> Value {
    PENDING.lock().take().unwrap_or(Value::Null)
}

/// The page reports the stack height (logical px). 0 hides the window.
pub fn layout(app: &AppHandle, height: f64) -> Result<Value, String> {
    let Some(w) = app.get_webview_window(LABEL) else { return Ok(json!({ "ok": true })) };
    if height <= 0.5 {
        let _ = w.hide();
        return Ok(json!({ "ok": true }));
    }
    touch();
    let monitor = w.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (pw, ph) = ((W * scale).round() as u32, (height * scale).round() as u32);
        let margin = (MARGIN * scale).round() as i32;
        let x = area.position.x + area.size.width as i32 - pw as i32 - margin;
        let y = area.position.y + area.size.height as i32 - ph as i32 - margin;
        let _ = w.set_size(PhysicalSize::new(pw, ph));
        let _ = w.set_position(PhysicalPosition::new(x, y));
    }
    show_no_activate(&w);
    Ok(json!({ "ok": true }))
}

/// A card was clicked: bring Ruby up and let the main window navigate.
pub fn open(app: &AppHandle, target: Value) -> Result<Value, String> {
    if let Some(m) = app.get_window("main") {
        let _ = m.show();
        let _ = m.unminimize();
        let _ = m.set_focus();
    }
    let _ = app.emit_to("main", "toast-open", target);
    Ok(json!({ "ok": true }))
}

/// Is the main window in front? (Notifications only show when it isn't, or during a game.)
pub fn main_focused(app: &AppHandle) -> bool {
    app.get_window("main")
        .map(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(false) && m.is_focused().unwrap_or(false))
        .unwrap_or(false)
}
