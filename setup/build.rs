fn main() {
    // Rebuild whenever the packaged Ruby changes.
    println!("cargo:rerun-if-changed=payload/Ruby Launcher.exe.br");
    tauri_build::build()
}
