# Ruby Launcher

A clean, lightweight Roblox desktop launcher (Tauri 2 + React). The UI follows the official Roblox app layout and talks to Roblox's own APIs. There is no Ruby backend server. The only other services are listed in [PRIVACY.md](PRIVACY.md).

> **Not affiliated with Roblox.** Ruby Launcher is an independent project. It is not affiliated with, endorsed by, or sponsored by Roblox Corporation. "Roblox" is a trademark of Roblox Corporation.

## Run

```bash
npm install
npm run tauri:dev
```

Installer build (NSIS): `npm run tauri:build`

Requires Node 20+, Rust stable and the WebView2 runtime.

`npm run build:setup` (the single-file installer) and `npm run export:dsk` (publishing to dsk.wtf)
are maintainer tools: they need the skybox art and the release signing key, which aren't in this
repo. Everything else builds from a fresh clone.

## What it does

- **Home**: friends row with presence, recommendations, Continue, and a Charts tab.
- **Experience pages**: media, stats, favorite, friends in the game (join them), and a server list with direct join.
- **Search**: experiences and people.
- **Chat**: Roblox conversations (read + send).
- **Me / Avatar**: Marketplace browse, Customize (wear/remove from inventory, outfits, R6/R15), and Profile.
- **Friends**: list with presence and join, plus friend requests.
- **Communities**.
- **Settings**: multiple accounts, tray behaviour, and Roblox install info.
- **Launching**: requests an authentication ticket so games start signed in as the launcher's account. It falls back to the plain `roblox://` link if that fails.

## Layout

```
src/
  main.tsx          routing + providers
  app/              Shell (rail, top bar, menu), state (nav, session, launch)
  lib/              ipc (Tauri bridge), api (Roblox endpoints), thumbs (batched thumbnails)
  components/       shared UI
  pages/            Home, Game, Lists, People, Chat, Avatar, Settings, Login
src-tauri/src/
  commands/         IPC dispatcher (the full list of native methods)
  roblox/           auth + accounts, login window, HTTP proxy (Roblox hosts only), launch, chat, log watcher
  state/            persisted session/accounts/settings/playtime
```

The session cookie is stored locally and is only ever sent to `*.roblox.com` / `*.rbxcdn.com`.

## Privacy and safety

- Your Roblox session is stored only on your PC, encrypted with Windows DPAPI, and is only sent to roblox.com. See [PRIVACY.md](PRIVACY.md).
- Mods back up every original file and can be turned off at any time.
- Uninstalling hands "Play" on roblox.com back to Roblox.

## Contributing & plugins

- **Contributions** are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Build on Ruby, don't fork it:** Ruby has a plugin API so you can add features and ship
  your own projects *on top of* Ruby without copying or rebranding it. See
  [docs/PLUGINS.md](docs/PLUGINS.md), especially **Writing plugins safely**.
- **Get featured:** submit your plugin to
  [sigil-star/ruby-plugins](https://github.com/sigil-star/ruby-plugins). Reviewed plugins show
  up under **Plugins › Featured** and are verified file-by-file against a signed list before
  they install.

## License & name

- **Source code:** [PolyForm Strict 1.0.0](LICENSE) — source-available. You may read, study,
  run, and privately modify Ruby for non-commercial use. You may **not** redistribute it or
  ship your own build/fork of it.
- **Name, logo and branding:** reserved — see [TRADEMARK.md](TRADEMARK.md). Forks and
  derivatives must use their own name and icon.
- **Official builds** come only from **dsk.wtf**, signed with a key that never ships in the
  app, so no one else can push an update Ruby will accept.
