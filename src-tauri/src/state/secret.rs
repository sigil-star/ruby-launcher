//! Secrets at rest (the Roblox cookie): encrypted with Windows DPAPI for the current user, so
//! another account on the PC, or a copied file, can't read them. Values from older versions
//! (plain text) are still read and get re-saved encrypted.

use base64::Engine;

const PREFIX: &str = "dpapi:";

#[cfg(windows)]
mod ffi {
    #[repr(C)]
    pub struct Blob {
        pub len: u32,
        pub data: *mut u8,
    }
    #[link(name = "crypt32")]
    extern "system" {
        pub fn CryptProtectData(input: *const Blob, desc: *const u16, entropy: *const Blob, reserved: *mut core::ffi::c_void, prompt: *mut core::ffi::c_void, flags: u32, out: *mut Blob) -> i32;
        pub fn CryptUnprotectData(input: *const Blob, desc: *mut *mut u16, entropy: *const Blob, reserved: *mut core::ffi::c_void, prompt: *mut core::ffi::c_void, flags: u32, out: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        pub fn LocalFree(mem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }
    /// Ruby-specific extra secret, so other apps using DPAPI can't trivially decrypt it.
    pub const ENTROPY: &[u8] = b"RubyLauncher.session.v1";
    pub const UI_FORBIDDEN: u32 = 0x1;
}

#[cfg(windows)]
fn run(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    run_with(data, protect, ffi::ENTROPY)
}

#[cfg(windows)]
fn run_with(data: &[u8], protect: bool, extra: &[u8]) -> Option<Vec<u8>> {
    use ffi::*;
    let input = Blob { len: data.len() as u32, data: data.as_ptr() as *mut u8 };
    let entropy = Blob { len: extra.len() as u32, data: extra.as_ptr() as *mut u8 };
    let mut out = Blob { len: 0, data: std::ptr::null_mut() };
    let ok = unsafe {
        if protect {
            CryptProtectData(&input, std::ptr::null(), if extra.is_empty() { std::ptr::null() } else { &entropy }, std::ptr::null_mut(), std::ptr::null_mut(), UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), if extra.is_empty() { std::ptr::null() } else { &entropy }, std::ptr::null_mut(), std::ptr::null_mut(), UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 || out.data.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(out.data, out.len as usize).to_vec() };
    unsafe {
        LocalFree(out.data as *mut core::ffi::c_void);
    }
    Some(bytes)
}

/// Encrypt for storage. Falls back to the plain value only where DPAPI doesn't exist.
pub fn protect(plain: &str) -> String {
    if plain.is_empty() {
        return String::new();
    }
    #[cfg(windows)]
    if let Some(enc) = run(plain.as_bytes(), true) {
        return format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(enc));
    }
    plain.to_string()
}

/// Decrypt a stored value; plain values (from before encryption) pass through.
pub fn unprotect(stored: &str) -> Option<String> {
    let Some(b64) = stored.strip_prefix(PREFIX) else {
        return (!stored.is_empty()).then(|| stored.to_string());
    };
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    #[cfg(windows)]
    {
        run(&bytes, false).and_then(|b| String::from_utf8(b).ok())
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        None
    }
}

/// Decrypt another app's DPAPI blob for this Windows user (no extra secret), in memory.
pub fn unprotect_user_blob(bytes: &[u8]) -> Option<Vec<u8>> {
    #[cfg(windows)]
    {
        run_with(bytes, false, &[])
    }
    #[cfg(not(windows))]
    {
        let _ = bytes;
        None
    }
}

pub fn is_protected(stored: &str) -> bool {
    stored.starts_with(PREFIX)
}

#[cfg(test)]
mod tests {
    #[test]
    fn round_trip() {
        let enc = super::protect("_|WARNING:-test-cookie");
        assert!(super::is_protected(&enc));
        assert_eq!(super::unprotect(&enc).as_deref(), Some("_|WARNING:-test-cookie"));
        assert_eq!(super::unprotect("plain").as_deref(), Some("plain"));
    }
}
