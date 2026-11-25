; Ruby Launcher installer hooks (Tauri NSIS).

!macro NSIS_HOOK_PREUNINSTALL
  ; Give "Play" on roblox.com back to Roblox before Ruby is removed,
  ; and close Ruby so its files can be deleted.
  ExecWait '"$INSTDIR\rubylauncher-tauri.exe" --restore-protocol'
!macroend
