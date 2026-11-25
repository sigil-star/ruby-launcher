# Ruby Launcher: release plan

## 1. Accounts Ruby has to handle

Roblox changed a lot in 2026. Ruby should work for every kind of account, not just yours.

### Roblox Plus (replaced Premium on 30 April 2026)
- Plus is a monthly subscription. It does **not** include monthly Robux; the "Plus 500/1000/2000" bundles do.
- It gives discounts on purchases, free private servers, unlimited Limited trading and Robux transfers.
- Old Premium members keep their subscription.
- **What Ruby must do:**
  - Read Plus from the profile header's `isPremium` field (already fixed).
  - Show "Included with Plus" on private servers when the price is 0 (Roblox already returns 0).
  - Never assume a monthly Robux stipend.
  - Trading: without Plus, trades can be limited or blocked. Show Roblox's own error text when a trade is refused.

### Age checks, Roblox Kids and Roblox Select
- Chat needs an age check (face estimate or ID). The six age bands are under 9, 9–12, 13–15, 16–17, 18–20 and 21+.
- **Roblox Kids (5–8):** chat is off unless a parent allows it. Some experiences aren't available.
- **Roblox Select (9–15):** chat is limited by age band. Parents can change settings from a linked account.
- **Standard accounts:** 16 and up.
- **What Ruby must do:**
  - **Chat:** when Roblox refuses a message because there's no age check, or the band isn't allowed, show "Age check needed. Do it in the Roblox app" instead of a raw error. Hide chat entry points for Kids accounts.
  - **Games:** keep using the playability check (already in), which reports age and parental-control blocks.
  - **Marketplace, trades, groups and private servers:** surface Roblox's refusal reasons, such as spend limits or "not allowed for your account", in plain words.
  - **Settings:** link to roblox.com's age-check and parental-controls pages using the in-app browser.

### Regions
- Roblox isn't available in some countries, and some features (voice, some payment methods) vary by country.
- **What Ruby must do:**
  - Never hard-code US prices or currency. Read prices from Roblox, already done for Robux.
  - Keep all text ready for translation, and add i18n before release.
  - The FastFlags allowlist is the same everywhere. Server-region lookups only send Roblox server IPs.

## 2. Before buying a domain and publishing on GitHub

### Must do
1. **Legal and trust**
   - Rename anything that looks official. Ruby must never claim to be Roblox or made by Roblox.
   - Add a clear "Not affiliated with Roblox Corporation" line in the app and README.
   - Remove bundled third-party assets you don't have rights to (some cursor packs, the Kenney packs are fine as CC0, character images).
   - Add a LICENSE (MIT or GPL-3.0), a privacy policy and terms.
2. **Account safety**
   - The `.ROBLOSECURITY` cookie must stay on the user's PC only. It already never leaves except to roblox.com.
   - Encrypt it at rest with Windows DPAPI if it isn't already, and audit that no log line prints it.
   - Turn on the production CSP (done) and test a release build with it.
3. **Signing and installer**
   - Code-sign the Windows installer. Unsigned launchers that touch Roblox files get flagged by SmartScreen and antivirus.
   - Use an EV or OV certificate, or Azure Trusted Signing.
4. **Auto-update**
   - Set up the Tauri updater with signed update manifests, hosted on GitHub Releases.
5. **Protocol takeover safety**
   - The installer must put the original `roblox-player` handler back on uninstall.
   - The setting to turn it off must keep working (done).
6. **Crash and error reporting**
   - Make it opt-in, with no cookies or usernames in reports.
7. **Remove dev-only paths**
   - The `roblox-player` handler currently points at the debug build. That fixes itself once installed.
   - Remove any test hooks, and clean the repo of personal data, local paths and screenshots that show account names.
8. **Testing**
   - A fresh Windows user with no Roblox installed, a Kids/Select test account, a non-Plus account, and a non-US region (VPN).

### Should do
- A website on the domain: download button, screenshots, FAQ ("Is this safe?", "Will I get banned?"), changelog.
- A GitHub README with screenshots, build steps and the disclaimer.
- Issue templates and a Discord server for support.
- A versioning and changelog process.

## 3. Ways Ruby can make money

### The "round up" donation idea
- Ruby Crystal owns one game, **Ruby** (universe 9935553407).
- **Developer products** can only be bought *inside* a running experience; there is no web or launcher API to buy them. So "round up" with dev products would mean opening the Ruby game, which is too much friction.
- **Game passes** *can* be bought from outside a game (Ruby already does this). But each pass can only be bought once per account, so a 1–9 R$ round-up can't repeat.
- **What works instead:**
  - A one-time "Supporter" game pass ladder on the Ruby game: 25, 100, 500, 1000 R$. It unlocks a badge-like perk in Ruby, such as a supporter tag, an accent colour or early features.
  - Ruby shows these on a "Support Ruby" page and in the checkout as an optional add-on. Each is bought once.
  - Roblox keeps its cut, and you earn the creator share, which can be converted through DevEx once you meet its requirements.

### Other ideas
1. **Ruby Plus (cosmetic supporter tier):** paid through the game passes above, never by locking core features. Perks could be extra themes, overlay skins, exclusive mod packs, more profile customisation and early beta access.
2. **Creator marketplace for mod packs:** a curated gallery of cursors, emote wheels, skyboxes, fonts and icon sets. Free packs, plus optional "tip the creator", with Ruby taking a share.
3. **GitHub Sponsors, Ko-fi or Patreon:** simple, and keeps Robux out of it. Common for open-source launchers.
4. **Affiliate links:** where allowed, use referral links for gaming hardware or VPNs, clearly labelled. Avoid anything that looks like Robux selling.
5. **Sponsored "featured experience" slot:** a clearly labelled spot on Ruby's home, sold to game studios. Only do this with strict rules, and never present it as Roblox's own recommendation.
6. **Paid custom builds and white-label versions** for groups or communities, such as a clan launcher with their branding.

### Avoid
- Selling Robux, accounts or Limiteds, which breaks Roblox's terms.
- Any feature that spends a user's Robux without a clear confirm.
- Ads injected into Roblox pages.
- Locking safety or accessibility features behind payment.

## Sources
- Roblox Plus: [Fandom wiki](https://roblox.fandom.com/wiki/Roblox_Plus), [allthings.how](https://allthings.how/roblox-plus-launches-april-30-pricing-perks-and-how-it-differs-from-premium/), [timesaver.gg](https://timesaver.gg/blog/roblox-plus-explained)
- Age checks and account types: [Roblox IR announcement](https://ir.roblox.com/news/news-details/2026/Roblox-Requires-Users-Worldwide-to-Age-Check-to-Access-Chat/default.aspx), [Roblox newsroom: Kids & Select](https://about.roblox.com/newsroom/2026/05/what-families-should-know-roblox-kids-select), [senseos.gg guide](https://senseos.gg/guides/roblox/roblox-account-types-chat-ages/)

## 4. Update: round-up donations, Ruby Plus perks, domain

### Round-up with re-buyable game passes
- **The idea:** game passes *can* be bought again if the user deletes them from their inventory. So round-up works with a small set of passes on the **Ruby** game.
- **Passes:** for example "Round up" at 1–9 R$, plus "Support Ruby" at 10, 25, 50 and 100 R$.
- **Flow at checkout:**
  1. "Round 76 R$ up to 80 R$? (+4 R$ to Ruby)"
  2. Ruby buys the 4 R$ pass.
  3. Ruby removes it from the inventory straight away, so it can be bought again next time.
- **Things to check before building:**
  - The exact "delete from inventory" endpoint, tested on a test account.
  - Small passes earn little after Roblox's cut, about 70% to you, so 1 R$ ≈ 0. Rounding up to the nearest **10 R$**, with a minimum of 5 R$, works better.
- Developer products stay in-game only (no outside purchase API), so passes are the right tool.

### Ruby Plus perks (cosmetic, never core features)
- **Supporter look:** a supporter badge on your Ruby profile card, and a "Ruby Plus" ring around your headshot inside Ruby.
- **Themes:** extra app themes and accent colours, and animated backgrounds for Home.
- **Overlay skins:** more glass styles and colours, plus a compact HUD mode.
- **Mod Studio:** an early-access editor for making your own emote wheels, cursors and icon fonts, with share links.
- **Extra mod slots:** keep more saved mod presets and switch between them in one click.
- **Session history:** a full play-history timeline per game, with servers, time and screenshots.
- **Early access:** beta channel builds a week early.
- **Priority support:** a role in the Ruby Discord.

Free users keep every launcher, safety and performance feature.

### Domain (Vercel, checked 2026-11-12)
| Domain | First year | Renews |
|---|---|---|
| **rubylauncher.com** | $12.03 | $12.03/yr |
| **rubylauncher.app** | $9.99 | $15.00/yr |
| rubylauncher.dev | $9.99 | $13.00/yr |
| playruby.app | $9.99 | $15.00/yr |
| playruby.com | taken | |
| ruby.gg | taken | |

Avoid "rbx" or "roblox" in the domain because of Roblox's trademark.

**Recommended:** **rubylauncher.com**. It's plain, matches the app name and has a cheap renewal. Add **rubylauncher.app** as a redirect if you want both.

### When to release
1. **Now:** nothing public yet. Finish the "Must do" list in section 2: notice, license, signing, updater, uninstall handler, cookie encryption.
2. **Private beta:** about 2 weeks after that. Share signed builds with 10–30 people from your Discord, covering Kids/Select/non-Plus accounts and other regions. Fix what breaks.
3. **Buy the domain when the beta starts.** It's cheap and lets the site, downloads and update feed live there from day one.
4. **Public GitHub release:** after a week of beta with no crash or account-safety bugs.
