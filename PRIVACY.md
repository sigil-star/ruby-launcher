# Privacy

Ruby Launcher runs on your PC. There is no Ruby server and no account with us.

## What stays on your PC
- **Your Roblox session (`.ROBLOSECURITY`)**: stored in Ruby's data folder, encrypted with Windows DPAPI for your Windows account. It is only ever sent to `*.roblox.com`.
- **Settings, mods, play time and saved accounts**: stored locally in Ruby's data folder.

## What Ruby sends, and where
| Where | What | Why |
|---|---|---|
| `*.roblox.com`, `*.rbxcdn.com` | Your Roblox requests, with your session | Everything Roblox-related: games, friends, chat, avatar, purchases you confirm |
| `dsk.wtf` | Nothing about you (no cookie, no username) | Checking whether a newer Ruby is out |
| `api.rolimons.com` | Nothing about you (no cookie, no username) | Limited item values on the Trades page |
| `ipinfo.io` | Only the IP address of the Roblox **server** you're on | The overlay's server region |
| Discord (local app) | The game you're playing, if Rich Presence is on | Your Discord status; turn it off in Settings |

Ruby has no analytics and no tracking, and it doesn't sell or share data.

## Removing your data
Sign out in Ruby, or delete Ruby's data folder:
`%APPDATA%\com.rubylauncher.tauri`

Uninstalling Ruby gives "Play" on roblox.com back to Roblox.
