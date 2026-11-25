# Ruby Launcher: private beta

Thanks for testing! This is an early build, so expect rough edges.

## Installing
1. Run `Ruby Launcher_1.0.0_x64-setup.exe`.
2. **Windows will show "Windows protected your PC".** The beta isn't code-signed yet. Click **More info**, then **Run anyway**.
3. Sign in with **Sign in to Roblox**, or use **Use account from Roblox app**.

Your Roblox session stays on your PC, encrypted for your Windows account. It is only sent to roblox.com. See PRIVACY.md.

## Things to know
- **"Play" on roblox.com now opens through Ruby**, so your mods and the overlay work. You can turn this off in Settings ("Open roblox.com games with Ruby").
- **Mods back up the original files.** Turning a mod off restores Roblox's own files.
- **Overlay:** press **F6** in a game (you can change the key in Settings).
- **Updates:** this beta doesn't update itself. Download new builds from the beta channel.
- **Uninstalling** hands "Play" on roblox.com back to Roblox.

## Please test
- [ ] Sign in, both ways
- [ ] Join a game from Home, from a game page and from roblox.com
- [ ] A game that teleports you (RIVALS, lobbies → matches): Ruby should stay in the game
- [ ] Leave a game: you should land on Ruby's Home
- [ ] Open Ruby while already in a game: the overlay should work
- [ ] Overlay: Rejoin, Best ping server, Servers tab, Friends tab
- [ ] Mods: apply something, join a game, check it shows, then turn it off
- [ ] Graphics quality slider: check the change in-game
- [ ] Chat, Trades and Inbox (if your account allows them)
- [ ] Private servers: join, and configure your own
- [ ] Uninstall, then check "Play" on roblox.com opens Roblox normally

**Accounts we especially need:** under 13, Roblox Select (9–15), no Plus, outside the US.

## Reporting a bug
Include:
- what you did, what happened, and what you expected
- a screenshot
- Ruby's log, from Settings → Device Preferences → Launcher log → **Open log**. Check it for anything private before sharing.

**Never share your `.ROBLOSECURITY` cookie or Ruby's `session.json`, with anyone.**

> Ruby Launcher is an independent project. It is not affiliated with, endorsed by, or sponsored by Roblox Corporation.
