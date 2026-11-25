//! In-game overlay: a small panel over the Roblox game window, toggled with F6.
//!
//! * It only opens while a Roblox window is in the foreground, and the hotkey is swallowed then,
//!   so the game never sees it (Tab/Ctrl would toggle the player list or shift lock).
//! * A watcher keeps it pinned to the Roblox window and hides it as soon as focus moves to any
//!   other app, so it never floats over the desktop.
//! * The panel itself is the React app rendered at `#overlay`.

use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "overlay";
const W: f64 = 360.0;
const H: f64 = 520.0;
/// Shown in the panel so the hint always matches.
pub const HOTKEY_LABEL: &str = "F6";

static LAST_TOGGLE_MS: AtomicU64 = AtomicU64::new(0);
static OVERLAY_HWND: AtomicI64 = AtomicI64::new(0);
static VISIBLE: AtomicBool = AtomicBool::new(false);
/// Actually on screen (it steps aside while another app is in front, then comes back).
static SHOWN: AtomicBool = AtomicBool::new(false);
static CTX: once_cell::sync::Lazy<parking_lot::Mutex<Option<AppHandle>>> = once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(None));

#[cfg(windows)]
mod win {
    pub type Hwnd = isize;
    #[repr(C)]
    #[derive(Default, Clone, Copy, PartialEq)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowTextW(hwnd: Hwnd, buf: *mut u16, max: i32) -> i32;
        fn GetClassNameW(hwnd: Hwnd, buf: *mut u16, max: i32) -> i32;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn IsWindow(hwnd: Hwnd) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut u32) -> u32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn CloseHandle(h: isize) -> i32;
        fn QueryFullProcessImageNameW(h: isize, flags: u32, buf: *mut u16, size: *mut u32) -> i32;
    }

    fn text(f: unsafe extern "system" fn(Hwnd, *mut u16, i32) -> i32, h: Hwnd) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { f(h, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    fn exe_name(h: Hwnd) -> String {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(h, &mut pid) };
        if pid == 0 {
            return String::new();
        }
        // PROCESS_QUERY_LIMITED_INFORMATION
        let p = unsafe { OpenProcess(0x1000, 0, pid) };
        if p == 0 {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(p, 0, buf.as_mut_ptr(), &mut len) };
        unsafe { CloseHandle(p) };
        if ok == 0 {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_ascii_lowercase()
    }

    pub fn foreground() -> Hwnd {
        unsafe { GetForegroundWindow() }
    }

    /// The Roblox *game* window: RobloxPlayerBeta's top-level window titled "Roblox".
    pub fn is_roblox(h: Hwnd) -> bool {
        h != 0 && text(GetWindowTextW, h) == "Roblox" && !text(GetClassNameW, h).is_empty() && exe_name(h) == "robloxplayerbeta.exe"
    }

    pub fn rect(h: Hwnd) -> Option<Rect> {
        if h == 0 || unsafe { IsWindow(h) } == 0 || unsafe { IsIconic(h) } != 0 {
            return None;
        }
        let mut r = Rect::default();
        (unsafe { GetWindowRect(h, &mut r) } != 0).then_some(r)
    }

    pub fn is_window(h: Hwnd) -> bool {
        h != 0 && unsafe { IsWindow(h) } != 0
    }

    pub fn focus(h: Hwnd) {
        if h != 0 {
            unsafe { SetForegroundWindow(h) };
        }
    }
}

/// The Roblox window the panel belongs to (last one it was opened over).
static ROBLOX_HWND: AtomicI64 = AtomicI64::new(0);

fn anchor(r_left: i32, r_top: i32, r_right: i32, scale: f64) -> PhysicalPosition<i32> {
    let margin = (16.0 * scale) as i32;
    let x = (r_right - (W * scale) as i32 - margin).max(r_left);
    // Below the title bar / Roblox's top bar.
    let y = r_top + (64.0 * scale) as i32;
    PhysicalPosition::new(x, y)
}

fn ensure_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#overlay".into()))
        .title("Ruby Overlay")
        .inner_size(W, H)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        // Real glass: Windows blurs the game behind the panel (acrylic backdrop).
        .effects(tauri::utils::config::WindowEffectsConfig { effects: vec![tauri::window::Effect::Acrylic], state: None, radius: None, color: Some(tauri::window::Color(18, 19, 23, 110)), interactive: false })
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if let Ok(h) = w.hwnd() {
        OVERLAY_HWND.store(h.0 as i64, Ordering::SeqCst);
    }
    Ok(w)
}

fn show_over(app: &AppHandle, roblox: isize) -> Result<Value, String> {
    let w = ensure_window(app)?;
    #[cfg(windows)]
    {
        let scale = w.scale_factor().unwrap_or(1.0);
        if let Some(r) = win::rect(roblox) {
            let _ = w.set_position(anchor(r.left, r.top, r.right, scale));
        }
    }
    ROBLOX_HWND.store(roblox as i64, Ordering::SeqCst);
    // Show without taking focus: Roblox keeps the keyboard so you can keep moving.
    let _ = w.set_focusable(false);
    let _ = w.show();
    let _ = w.set_always_on_top(true);
    VISIBLE.store(true, Ordering::SeqCst);
    SHOWN.store(true, Ordering::SeqCst);
    let _ = tauri::Emitter::emit_to(app, LABEL, "overlay-shown", json!({}));
    Ok(json!({ "ok": true, "visible": true }))
}

fn hide_only(app: &AppHandle) {
    VISIBLE.store(false, Ordering::SeqCst);
    SHOWN.store(false, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// Hide the panel and hand focus back to the game.
pub fn hide(app: &AppHandle) -> Result<Value, String> {
    hide_only(app);
    #[cfg(windows)]
    win::focus(ROBLOX_HWND.load(Ordering::SeqCst) as isize);
    Ok(json!({ "ok": true, "visible": false }))
}

/// After a click in the panel, hand the keyboard straight back to the game.
pub fn refocus_game() -> Result<Value, String> {
    #[cfg(windows)]
    win::focus(ROBLOX_HWND.load(Ordering::SeqCst) as isize);
    Ok(json!({ "ok": true }))
}

/// Copy text without needing the panel to have focus (the browser clipboard API requires it).
pub fn copy_text(text: &str) -> Result<Value, String> {
    #[cfg(windows)]
    {
        use std::io::Write;
        let mut cmd = std::process::Command::new("clip");
        cmd.stdin(std::process::Stdio::piped());
        crate::win_process::hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        child.stdin.take().ok_or("clipboard unavailable")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        child.wait().map_err(|e| e.to_string())?;
    }
    let _ = text;
    Ok(json!({ "ok": true }))
}

/// Toggle from the hotkey. Only acts over Roblox; returns whether the key was used.
fn toggle_from_hotkey(app: &AppHandle) -> bool {
    #[cfg(windows)]
    {
        let fg = win::foreground();
        let overlay = OVERLAY_HWND.load(Ordering::SeqCst) as isize;
        if VISIBLE.load(Ordering::SeqCst) && (fg == overlay || win::is_roblox(fg)) {
            let _ = hide(app);
            return true;
        }
        if win::is_roblox(fg) {
            let _ = show_over(app, fg);
            return true;
        }
    }
    let _ = app;
    false
}

pub fn toggle(app: &AppHandle) -> Result<Value, String> {
    if VISIBLE.load(Ordering::SeqCst) {
        hide(app)
    } else {
        Ok(json!({ "ok": toggle_from_hotkey(app) }))
    }
}

/// Close the panel when the game ends.
pub fn on_game_ended(app: &AppHandle) {
    hide_only(app);
}

/// Leave this server and join `job` (or any server when None) in `place`.
pub async fn rejoin(app: &AppHandle, state: &Arc<AppState>, place: u64, job: Option<String>) -> Result<Value, String> {
    if place == 0 {
        return Err("not in an experience".into());
    }
    let name = state.game_session.read().place_name.clone();
    hide_only(app);
    // Keep Ruby from treating the restart as "left the game".
    crate::roblox::launch::note_exit_grace(25);
    let _ = crate::roblox::launch::close_roblox_game_processes(true);
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    crate::roblox::launch_roblox(app, state, place, job, name, None).await
}

pub fn leave_game(app: &AppHandle, state: &Arc<AppState>) -> Result<Value, String> {
    hide_only(app);
    let _ = crate::roblox::launch::close_roblox_game_processes(true);
    crate::roblox::launch::end_game_session_and_return_to_ruby(app, state);
    Ok(json!({ "ok": true }))
}

/// Keep the panel glued to Roblox; hide it the moment focus goes anywhere else.
#[cfg(windows)]
fn start_watcher() {
    std::thread::Builder::new()
        .name("ruby-overlay-watch".into())
        .spawn(|| {
            let mut last = win::Rect::default();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(150));
                if !VISIBLE.load(Ordering::SeqCst) {
                    last = win::Rect::default();
                    continue;
                }
                let Some(app) = CTX.lock().clone() else { continue };
                let roblox = ROBLOX_HWND.load(Ordering::SeqCst) as isize;
                let overlay = OVERLAY_HWND.load(Ordering::SeqCst) as isize;
                let fg = win::foreground();
                let Some(w) = app.get_webview_window(LABEL) else { continue };
                if !win::is_window(roblox) {
                    // The game closed: really close.
                    hide_only(&app);
                    continue;
                }
                let front = fg == roblox || fg == overlay || fg == 0;
                let r = win::rect(roblox);
                match (front && r.is_some(), SHOWN.load(Ordering::SeqCst)) {
                    (false, true) => {
                        // Another app (or minimised): step aside but stay "open".
                        let _ = w.hide();
                        SHOWN.store(false, Ordering::SeqCst);
                        continue;
                    }
                    (true, false) => {
                        let _ = w.show();
                        let _ = w.set_always_on_top(true);
                        SHOWN.store(true, Ordering::SeqCst);
                        last = win::Rect::default();
                    }
                    (false, false) => continue,
                    _ => {}
                }
                let Some(r) = r else { continue };
                if r != last {
                    last = r;
                    let scale = w.scale_factor().unwrap_or(1.0);
                    let _ = w.set_position(anchor(r.left, r.top, r.right, scale));
                }
            }
        })
        .ok();
}

#[cfg(windows)]
mod hook {
    use super::*;
    type Hhook = isize;
    #[repr(C)]
    struct KbdLl {
        vk: u32,
        scan: u32,
        flags: u32,
        time: u32,
        extra: usize,
    }
    #[repr(C)]
    struct Msg {
        hwnd: isize,
        message: u32,
        w: usize,
        l: isize,
        time: u32,
        x: i32,
        y: i32,
    }
    type Proc = unsafe extern "system" fn(i32, usize, isize) -> isize;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SetWindowsHookExW(id: i32, f: Proc, hmod: isize, thread: u32) -> Hhook;
        fn CallNextHookEx(h: Hhook, code: i32, w: usize, l: isize) -> isize;
        fn GetMessageW(m: *mut Msg, hwnd: isize, a: u32, b: u32) -> i32;
        fn GetAsyncKeyState(vk: i32) -> i16;
    }
    static HOOK: AtomicU64 = AtomicU64::new(0);
    /// Swallow the matching key-up too, so the game sees neither half of the press.
    static SWALLOW_UP: AtomicBool = AtomicBool::new(false);
    const VK_F6: u32 = 0x75;
    const MODS: [i32; 4] = [0x10, 0x11, 0x12, 0x5B]; // shift, ctrl, alt, win

    unsafe extern "system" fn proc(code: i32, w: usize, l: isize) -> isize {
        if code == 0 && l != 0 {
            let info = &*(l as *const KbdLl);
            if info.vk == VK_F6 {
                let down = w == 0x0100 || w == 0x0104;
                let up = w == 0x0101 || w == 0x0105;
                if up && SWALLOW_UP.swap(false, Ordering::SeqCst) {
                    return 1;
                }
                let plain = MODS.iter().all(|&m| (GetAsyncKeyState(m) as u16 & 0x8000) == 0);
                // bit 7 of flags = key was already down (auto-repeat): ignore, but still swallow.
                if down && plain {
                    let fg = win::foreground();
                    let over_roblox = win::is_roblox(fg) || (VISIBLE.load(Ordering::SeqCst) && fg == OVERLAY_HWND.load(Ordering::SeqCst) as isize);
                    if over_roblox {
                        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                        if now.saturating_sub(LAST_TOGGLE_MS.load(Ordering::SeqCst)) > 200 {
                            LAST_TOGGLE_MS.store(now, Ordering::SeqCst);
                            if let Some(app) = CTX.lock().clone() {
                                let a = app.clone();
                                let _ = app.run_on_main_thread(move || {
                                    let _ = super::toggle_from_hotkey(&a);
                                });
                            }
                        }
                        SWALLOW_UP.store(true, Ordering::SeqCst);
                        return 1;
                    }
                }
            }
        }
        CallNextHookEx(HOOK.load(Ordering::SeqCst) as Hhook, code, w, l)
    }

    pub fn start() {
        if HOOK.load(Ordering::SeqCst) != 0 {
            return;
        }
        std::thread::Builder::new()
            .name("ruby-overlay-hotkey".into())
            .spawn(|| unsafe {
                let h = SetWindowsHookExW(13, proc, 0, 0); // WH_KEYBOARD_LL
                if h == 0 {
                    tracing::warn!("overlay hotkey hook failed");
                    return;
                }
                HOOK.store(h as u64, Ordering::SeqCst);
                let mut m = Msg { hwnd: 0, message: 0, w: 0, l: 0, time: 0, x: 0, y: 0 };
                while GetMessageW(&mut m, 0, 0, 0) > 0 {}
            })
            .ok();
    }
}

pub fn start_hotkey(app: AppHandle, _state: Arc<AppState>) {
    *CTX.lock() = Some(app.clone());
    // Build the (hidden) panel up front: creating a WebView2 window from inside the hotkey
    // callback on the main thread can deadlock.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        if let Err(e) = ensure_window(&app) {
            tracing::warn!("overlay window: {e}");
        }
    });
    #[cfg(windows)]
    {
        hook::start();
        start_watcher();
    }
}
