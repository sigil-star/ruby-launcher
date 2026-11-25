# Roblox Windows app — behaviour reference

Observed directly in the Roblox desktop app (RobloxPlayerBeta "app mode", Windows, dark mode) on 2026‑11‑06 by driving it with mouse/keyboard and taking screenshots, signed in as the project owner's account. Nothing was bought, sent, equipped or changed; purchase/social flows were followed only to their confirmation screen.

> **Caveat — Reduce motion was ON in this account's Device Preferences**, so the real app showed almost no transitions. Animation notes below describe *what* animates, not exact timings.
>
> **Input model.** The UI is engine-rendered (LuaApp). It reacts to hover before click, has a full keyboard/gamepad focus mode (Esc enters it: a white focus ring plus a bottom hint bar like `Esc Back · PgUp Scroll Up · PgDn Scroll Down · / Search`), and `/` focuses Search.

---

## 1. Shell

| Region | Layout | Interactions |
|---|---|---|
| Left rail (~48px) | Hamburger (blue dot when something is new), **Home**, **Chat** (count badge), **Me** (your headshot). Roblox logo at the bottom. | Hover = grey rounded square behind the icon. Active item = filled icon + label. |
| Top bar | `ROBLOX` wordmark, centred Search pill, right side: headshot + username + premium icon, Robux icon button, bell with blue count badge. | Bell → Notifications popover. |
| Side drawer | Slides over the page from the left (~265px), page dimmed. | Click scrim to close. |

### Side drawer
- Header: headshot circle, display name + premium icon, `@username`.
- Robux card: `ⓡ balance` + small grey **Buy Robux**.
- Items (icon + bold label): Favorites · Continue Playing · Friends *(blue "99+" pill = requests)* · Communities · Inventory · Trades · Messages · **Roblox Plus** · Settings · Help & Safety — divider — Learn · Create.
- Full-width grey buttons: Switch Accounts · Quick Sign-in · Log Out. Footer links: Terms · Privacy.

---

## 2. Home
- Tabs **For you | Charts** (underline indicator). The tab bar stays pinned while scrolling.
- **Friends row**: "Add Friends" circle first, then ~88px headshots with presence dot, name, and a grey sub-line (game name / status). Hover shows a **›** scroll arrow at the row's right edge.
  - **Click a friend → popover** under the bubble: `[game icon] ditzy is playing / [🎃] Picnics n Plushies`, blue **Join**, grey **Chat**, text **View profile**. It closes on outside click (and moving away).
- **Recommended For You**: 6-column grid of 16:9 thumbnails, title, `👍 88% Rating`. Ads show `Ad · 👍 94% Rating`. Some tiles replace the rating with a **friend's headshot + name** (a friend played it).
- **Hover card** (after ~0.5s hover): the tile lifts onto a lighter rounded panel that grows over the row below; the thumbnail plays a video/alt image; a round **×** ("not interested") appears top-right; a full-width blue **▶ Play** button appears under the title. Clicking the tile opens the game page; Play launches directly.
- **Continue ›**: square tiles with `👍 70% 👤 3.3K`.
- **Discover Avatars**: tall portrait cards (full-body avatar on grey), creator + ✓, `ⓡ price`.
- Home content reshuffles on revisit.

---

## 3. Game details page
Opens over Home (Home stays active in the rail). Single centred column (~640px).
- Round **×** top-left. Blurred hero (first media image) behind the header, fading to the page colour.
- Header: large square icon · **title** · `Maturity: Mild` (or `Minimal • Ages 16+`) · creator + ✓ (link).
- **Play** (wide blue, ▶ only) · **person-with-play** button → menu *Invite Friends / Create Private Server / Join Friends* · **…** → menu *Invite Friends / Share / Report*.
- Chip row: `[👍 88% | 👎]` (split chip) · `👥 4.3K active` · `🔔 Notify` · `☆ Favorite` · `↗ Share` · `⚑ Report`.
- Media carousel (16:9, rounded): auto-advances; dots with the active one as a pill; **hover shows ‹ ›**; top-right **expand** button (fullscreen).
- **Description**, then **Store ›** (round game-pass art, 2-line name, **white pill price button** with Robux icon).
- **Information** key/value list with dividers: Visits · Content Maturity (Mild ›) · Developer (ROLVe ✓ ›) · Server Size · Genre · Subgenre · Created · Updated · Voice Chat · Camera · Store (View ›) · Badges (View ›) · **Servers (View ›)**.
- **Social Media**: round icon buttons (X, YouTube, Discord) with labels.
- **People Also Join**: tile row.
- **Sticky header on scroll**: ×, Play, friends button, …, and a centred small icon + title.
- Menus: dark rounded popovers, icon + label rows.

### Servers (full-screen sheet, rail hidden)
- Header: × left; centred small game name over **Servers**.
- **Your private servers**: "Create a private server" row (`~~100~~ 80/month`, grey **Create**) and private servers (avatar, name, `0 of 16 people max`, ✎ for owned ones, blue **Join**), small **Load More**.
- **Servers My Friends Are In** + `Refresh ⟳`; empty state `No Servers Found.`
- **Other Servers** + `Refresh ⟳`, **Sort By** dropdown (*Recommended For You*), ☑ **Exclude Full Servers**.
- Server cards in a 4-column grid: 2×3 player headshots (the last is a grey `+N`), `13 of 16 people max`, thin fill bar, grey **Join**, `ID: 2c89-43e3`. Full-width **Load More**.

---

## 4. Avatar (Me)
Split screen: the left pane (~37%) holds content; the right is the 3D avatar on the user's **backdrop** (full bleed, plays an idle animation, not an emote). A centred segmented pill **Marketplace | Customize | Profile** sits at the top.
- Preview tools (top-left, vertical pills): [headshot button, **person+gear** → *Accessory Adjustment, Body Shape, Head Adjustment, Clothing Layering, Makeup Layering, Skin Color* (button becomes × while open)] and [**Undo**, **Redo**] (disabled until there's a change). Top-right: Robux pill.

### Marketplace
- Search icon (top-right of pane). Tabs: All · Avatars · Backgrounds · Body · Clothing · Accessories · Animations · Makeup, plus a filter (sliders) button.
- "All" sections: **Recommended For You** (2×7), **Trending Items** (+ `See All` pill, horizontal), **Just For You**.
- Card: square thumb on grey rounded tile, name (1 line), creator + ✓, `ⓡ price`.
- **Click an unowned item → it is tried on immediately** (backgrounds swap the backdrop). The card gets a **white outline + white "Details" bar** across the bottom of its thumbnail; **Undo** enables; a bottom bar appears under the preview: full-width blue **ⓡ 160** + round **…** (*View Details Page, Favorite, Copy Link, Report*, over a dim scrim).
- Buy (short on Robux) → **"Buy Robux and item"** modal: item, price (Plus discount strikethrough), "Saving ⓡ40 with Plus", Robux package `ⓡ500 ~~400~~ $4.99`, blue **Buy**, legal line. *(Stopped here.)*
- **Details** → the right pane becomes the item panel: ×, title, image/3D, `N Friend(s) own` chip, description (clamped, chevron expands), `★ 12.6K Favorites`, Creator ✓ →, Type ⓘ, Placement, Attributes, **You May Also Like**; pinned bottom: blue price + … (unowned) or grey **Manage in Customize** (owned).
- Opening an item from Inventory lands here with its panel open.

### Customize
- Tabs: All · Avatars · Body · Clothing · Accessories · Backgrounds · Animations · Emotes · Makeup + filter.
- Dense 7-column, thumbnail-only grid (Emotes show names). Worn items: white outline + permanent **Details** bar.
- Emotes: a row of **8 slot buttons** above the grid (each shows its emote's pose); the selected slot is outlined. Hovering a card does nothing.
- Switching tab clears any try-on.

### Profile tab (own)
- Headshot, display name, @username; blue **Edit appearance**, grey **Edit profile**, square **QR** button.
- Pills: `467 Friends` `72.3K Followers` `1 Following`; bio; Currently Wearing; Store ›; Games.
- QR → **Share QR Code** page (← back): white card with QR (headshot centre), name, @user, explainer ("Age-checked 13+ users who connect via live QR scan will be trusted friends"), white **🔗 Copy Profile Link**.

---

## 5. Inventory (drawer → Inventory)
Full-screen sheet (× + "user's / Inventory"). "My Inventory" heading, category sidebar (Accessories ›, Animations, Audio, Avatar Animations ›, Backgrounds, Badges, Bottoms ›, Bundles, Classic Clothing ›, Decals, Emotes, Hair, Heads, Makeup ›, Meshes, Models & Packages, Passes, Places ›, Plugins, Private Servers ›, Shoes ›, Tops ›, Video). Breadcrumb `Accessories › Head`, promo "Explore the marketplace…" + blue **Get More**. 6-column cards: thumb (grey placeholder while loading), name, "By creator", price / "Off Sale".

---

## 6. Chat
- Left column: **Chat** + compose (✎). Search pill. Two nav rows with ›: **Start party** ("Join experiences together") and **Communities** ("Create and explore communities"). Conversations: 32px headshot with presence, bold name, `preview · 4h`, blue unread dot.
- Nothing selected: centred illustration (two tilted cards — mic and chat bubble), no text.
- Thread header: headshot, name, @username → **click opens Details**; right: grey **Start** (party). Banner: "Add trusted friend to chat freely … **Add** ×".
- History starts with a card: headshot, name, @user, "First conversation with …", safety copy. Centred date dividers. Mine = blue right, theirs = grey left with the avatar on the last bubble of a group.
- **Hover a bubble → round reply (curved arrow) button** beside it (right of theirs, left of mine). Click → reply bar above the composer: headshot, "**marin said…**", the quoted text, ×; the placeholder becomes "**Reply to marin**". There is no right-click or long-press menu.
- Composer: **+** (*Start party, Schedule a Party*), rounded "Say something", send arrow.
- **Details** pane (← Details): Members · ⊕ Add Friends · members with "Online" · **…** → *View Profile, Add trusted friend, Report User* · "Expressive chat features: Unavailable ⓘ".

---

## 7. Notifications
- Popover anchored top-right (~300px). Title **Notifications**; a small spinner shows at the top while refreshing.
- Card (rounded tile): icon/headshot, bold title (`Invite from ditzy @painedheartache`), body, time `1h` + ⋮; buttons: outlined **Dismiss** + blue action (**Join**, **Read**).
- ⋮ → the card is lifted with × and a **Report** option; the rest dims.
- Clicking outside closes it (and the click passes through to the page).

---

## 8. Settings
- ← back, centred **Settings**, Robux + bell top-right. Centred list (~640px) with chevrons; hover = lighter rounded row: Account Info · Security · Privacy & content restrictions · Parental Controls · Payment Methods · Subscriptions · Robux · Notifications · Device Preferences.
- **Device Preferences**: Volume slider (0–10) · Mode dropdown (Dark) · App theme (Default + Plus "Exclusive themes": Dynamic/Calm/Special → Cosmic Dust, Polar Freeze, Super Charge, Electric Lime, Lava Glow, Star Burst, Pixel Pop) · Background transparency slider · Haptics · **Reduce motion** · Text size slider · **Launch at startup** · **Minimize to tray when close**.
- Every other category opens one **full-screen sheet** (← / ×, "user's / Account Info") that embeds Roblox's account settings, with its own left menu: **Account info · Security · Privacy & content restrictions · Notifications · Spending · Robux · Subscriptions · Parental controls · App permissions** (active item = white left bar).
  - **Account info**: Name ✎, Username ✎, Password ✎, "Previous usernames: …", Phone Number (● Verified) ✎, Email (● Verified) ✎; *Personal*: Age Group (Checked), Birthday (Verified), Gender (Optional, two icon toggles), Language (dropdown), Automatic Translations (dropdown + note), Account Location; *Social networks visibility* radio card (Everyone / Friends, followers & people I follow / Friends & people I follow / Friends / No one); *Social Networks* fields (Facebook, X (formerly Twitter), YouTube, Twitch) + **Save**.
  - **Security**: Enhanced protection (Off ›); Two-step verification radio cards (None / Email (Secure) / Authenticator App (Very Secure) / Hardware Security Keys & Authenticator App (Very Secure)); Backup Codes (Create again, Delete); Devices where you're logged in (device, location, date, "Trusted" tag ›, Show More); **Log Out of All Other Sessions**.
  - **Privacy & content restrictions**: Content maturity › · Screen time › · Communication › (Experience chat, Chat and party with friends, Voice data usage, Camera input, Gameplay coordination) · Visibility & private servers › · Friends & contacts › · Trading & inventory › · Blocked users › · Account data, deactivation & deletion ›. Leaf pages are radio cards with helper text (e.g. *Chat and party with friends*: On/Off; *Friends chat*: All friends/Trusted friends/No one; *Voice chat with friends*: Trusted friends/No one).
  - **Notifications**: Device Notifications (Manage channels) · Communities · Games · Marketplace · Platform News · Social.
  - **Spending**: help line; Other Payment Methods → Roblox Credit (Balance); Gift Card Billing Information.
  - **Robux**: Transfer limits (Daily, Monthly); Robux transactions → Transaction history ↗.
  - **Subscriptions**: "Active (N)": Roblox Plus ($/month, renews …), private servers ("Free With Plus" / price, renews …) ›.
  - **Parental controls**: illustration, "Add a parent", **Ask a parent on this device** / **Send a parent an email**.
  - **App permissions**: third-party app cards (name, "N Permissions", description, Remove, Report).

---

## 10. Profiles
- **Own profile (drawer header)** opens as a **right-side panel** over the dimmed page: backdrop + 3D avatar, ×, headshot, name, @user, Friends/Followers/Following pills, bio, **Edit appearance** (blue) / **Edit profile** / QR; Currently Wearing, Store ›, Games; outlined **View full profile**. The action buttons pin to the top while scrolling. Opening an item from a row stacks a second panel (← back) with a **Try On** button.
- **Full profile** (full-screen sheet "user's / Profile"): banner with 3D avatar + **2D** toggle; headshot, name (+premium), @user; **Edit profile / Edit avatar / …** (own) or Add Friend/Chat/… (others); pills; bio + "more"; **Currently Wearing** (row with ›), **Store ›**, **Games**, **Favorites ›**, **Friends (N) See All →**, **Communities** (square cards with an **Owner** tag, "6.6K+ Members", your role), **Badges ›**.

## 11. Communities
- Full-screen sheet with a **left sidebar**: "Communities" + See All, "Search My Communities", **Primary**, **My Communities** (icon, name, "25 members • Owned"), **Create Community** at the bottom.
- Header: icon, name, **By <owner>**, **…** (Remove Primary / Leave Community / Copy link / Report abuse). Chips: **"6,643 Members"** (opens Members) and **"<role> Rank"** (your role). Description + "more".
- Tabs **Home | Posts | Store**. *Home*: Announcements ("No announcements yet..."), Top Community Posts (See All →). Post: headshot, name · age · role (Owner tag), bold title, body, emoji reaction chips + add-reaction, "N replies", …. *Posts*: channel chips (Announcements, Feedback, General Discussions, Suggestions), search + sort, channel title + **Create post**, 📌 pinned posts.
- **Members** modal: role dropdown (All members + each role with a member-count chip), rows with headshot/name/@user and **Add** (friend) or **Join** (in game).

---

## 9. Ruby comparison (2026‑11‑06)

| Area | Real app | Ruby before | Ruby now |
|---|---|---|---|
| Home tiles | Delayed hover card: lift panel, ×, full-width Play below | Play icon overlay on thumbnail | **Hover card** (`components/games.tsx`): delayed lift, × hides the game for the session, blue Play (below on wide cards, in the footer on square tiles) |
| Friends row | Click → popover (Join / Chat / View profile) | Hover popover, click → profile | **Click popover**, closes on outside click / Esc / scroll |
| Game page | Single column, blurred hero, × close, Play + friends menu + … menu, chip row, carousel (auto, arrows, expand), Information with Servers ›, Social Media, sticky header | Two-column hero, stats block, "Open on web" | **Rebuilt to the app layout** (`pages/Game.tsx`), incl. Notify (follow), Share (copy link), Report, auto-advancing carousel + lightbox, sticky header, social links |
| Servers | Full-screen sheet; friends' servers; grid cards with player headshots; Exclude Full | Inline list | **Servers sheet** (`servers` route) with friends' servers, headshot grid cards, Exclude Full Servers, Refresh, Load More |
| Chat | Header opens Details; reply bar "X said…", placeholder "Reply to X"; Communities row; illustrated empty state | Header → profile + ⓘ button; "Replying to X"; text empty state | **Matched** (kept a small Profile button) |
| Avatar try-on | Bottom blue price bar + …; Undo/Redo | "Trying on" chip | **Try-on bar** (price → BuyItemModal, … → View Details Page / Copy Link) + **Undo** (reverts the try-on) / Redo (disabled) |
| Notifications | Rounded cards, outlined Dismiss + blue action | Square rows, action buttons only | **Dismiss + action**, rounded cards |
| Drawer | "Roblox Plus", Terms · Privacy footer, ~265px | "Premium", no footer, 350px | **Matched** (300px) |
| Settings | 9 categories + Device Preferences | Same categories (web) + launcher prefs | Already matched |
| Private servers | List + Join; "Create a private server" with price | — | **Built**: "Your private servers" on the Servers sheet (`games/v1/games/{placeId}/private-servers`); Join goes through the launcher as `RequestPrivateGame` with the server's access code (`launch.rs`, job token `private:<accessCode>:<linkCode>`); the Create row shows price/discount from `private-servers-api/Universe-Private-Server-Settings` and opens a confirmation dialog that calls `POST games/v1/games/vip-servers/{universeId}` only on **Buy Now** (or offers Buy Robux when short) |
| Voting | 👍/👎 on the rating chip | Display only | **Built**: `PATCH games/v1/games/{universeId}/user-votes` (clicking your current vote clears it); `games/{id}/votes/user` supplies the "can't vote" reason, e.g. "Play this experience before voting." |
| Profile QR | Share QR Code page | Copy-link button | **Built**: QR (`qrcode` 1.5.4, lazy-loaded) with the headshot in the centre + Copy Profile Link |
| Hover previews | Hover card plays the game's preview video | Static thumbnail | **Built**: GamePreviewVideo media (type 86) → asset delivery → WebM on `contentdelivery.roblox.com` (CSP `media-src` added); muted loop after the hover delay |
| Discover Avatars | Home row of full-body avatars | — | **Built** from the catalog "Body → Full Bodies" taxonomy (the web Home feed doesn't include this row) |
| Marketplace home | Avatars tab; Recommended / Trending Items (See All) / Just For You | Recommended only | **Built**: Avatars tab (Full Bodies), Trending Items = best-selling this week with See All, Just For You = the rest of the recommendation feed |
| Emote slots | 8 slots above the Emotes grid; tap an emote to put it in the selected slot | — | **Built** (`equipEmote(current, id, slot)`) |
| Parties | Start party / Schedule a Party (chat list row + composer "+") | — | **UI up to the in-client step**: row + "+" menu → friend picker → explains the party must be started in the Roblox app |
| Focus mode | Esc focus ring + hint bar; arrows / D-pad; PgUp/PgDn; "/" Search | — | **Built** (`components/FocusMode.tsx`), including controller D-pad / A / B / shoulder buttons |
| Community page | Sidebar (Primary / My Communities / search / Create), header with owner + …, Members + Rank chips, Home/Posts/Store, members modal with role dropdown | Header + shout + flat member list | **Rebuilt** (`pages/Community.tsx`, data in `lib/social.ts`): sidebar, "By owner", … menu (Leave / Copy link / Report abuse / View on Roblox), Members chip → modal (All members + every role with count and rank; Add = friend request), "<role> Rank" chip (from membership, falling back to your public role list), Home (shout, announcements, top posts, events, experiences), Posts (forum categories, pinned + paged posts, comments, search), Store (group catalog items) |
| Community extras (web-only) | roblox.com shows them; the app doesn't | — | **About tab**: social links, group funds (only when your role can see them), all roles with rank + member counts, allies, enemies, previous names |
| Profile | Games, Favorites, Friends, Communities with Owner tag + role, Badges; own: Edit profile / Edit avatar | Store/Friends/Communities only | **Added** Games, Favorites ›, Primary community (role + rank), Owner tag + role on community cards, Badges, Roblox Badges; own profile buttons match the app |
| Profile extras (web-only) | roblox.com statistics, inventory, social links | — | **Added** Statistics (join date, previous usernames), Social links, Inventory by category (when the inventory is public) |
| Settings | Category list → embedded account settings sheet with inner menu; Device Preferences page | Categories opened the website | **Rebuilt** (`pages/Settings.tsx`, data in `lib/account.ts`): same 9 categories/order → sheet with the same 9-item inner menu. Native: Account info (name, username, previous usernames, phone/email + verified, birthday, gender, social-link visibility + Facebook/X/YouTube/Twitch fields with Save), Security (2-Step method, logged-in devices), Privacy (all user-settings as radio cards from `settings-and-options`, Blocked users with Unblock), Spending (Roblox Credit), Robux (balance + Purchases/Sales/Robux purchases history), Subscriptions (Roblox Plus + your private servers), Parental controls, App permissions; each page also has "Open this page on Roblox ↗". Device Preferences: Mode, **Reduce motion**, **Text size**, Minimize to tray, Close Roblox when leaving, player folder, log |

### Still different (and why)
- **Parties can't actually be started or scheduled from Ruby.** Roblox runs parties inside its own client: there's no party route on the web APIs (`party-api` paths 404) and nothing party-related in the website's bundles, so Ruby stops after the friend picker and points to the Roblox app.
- **Quick Sign-in and Learn** aren't added (Quick Sign-in is a device-login approval flow; Learn only links out to Roblox's learning hub).
- **Hover videos** only exist for games that uploaded a preview video; other games keep the static image, as in the app.
- **Trending Items** uses the catalog's best-selling-this-week sort; the app's own trending feed isn't exposed to the web.
- **Not exercised on the real account (by design):** buying a private server, joining one, voting, and equipping emotes into slots. All use the same endpoints Roblox's own web code uses and were checked up to the point of sending.
- **Settings changes that need a password or code** (name/username/password/email/phone, 2-Step Verification, backup codes, logging out other sessions, account deletion, notification channels, app-permission removal) open the matching roblox.com page instead of being done in Ruby.
- **Privacy saves** use `POST user-settings-api/v1/user-settings {key: value}`; the read side (`settings-and-options`) is from Roblox's bundles, but the exact save call couldn't be confirmed because Ruby's stored session had expired during this pass.
- **Forum posts, membership-only data and Settings data** couldn't be checked against live responses for the same reason (the saved `.ROBLOSECURITY` stopped authenticating on 2026‑11‑08); they use the endpoints from roblox.com's current bundles and fail soft (each section hides or links out).
- **Device Preferences volume, haptics, app themes and background transparency** are Roblox-client settings with no equivalent in Ruby; Mode is fixed to Dark.

### Live check (2026‑11‑11, signed in)
- Communities: rank chip, members modal with role dropdown (count + rank per role) and role filtering, Posts (forum pagination; Roblox returns a cursor to an empty page when a forum has one post), About (social links now use platform icons, every role with rank and member count) — all verified on real data.
- Profiles: backdrop, presence, counts, Currently Wearing, Favorites, community cards with role names, Roblox Badges, Statistics, private-inventory note — verified. 3D banner renders the rigged avatar, but BTR's layered-clothing/hair output doesn't fully match Roblox's own render.
- Settings: Account info and Security verified with live data. Privacy was showing every raw `user-settings-api` key; it is now grouped like roblox.com (Content maturity, Communication, Parties, Visibility & private servers, Friends & contacts, Trading & inventory), with Roblox's wording, locked options (age / parental requirement) disabled, and settings Roblox has locked shown read-only. Theme, notification and internal flags are no longer listed there.
- Not verified: saving a privacy change (needs a real account write).

## 12. Robux (2026‑11‑11)
- Real app: the top-bar Robux button and the menu's "Buy Robux" open the Buy Robux screen (same content as roblox.com/upgrades/robux): balance + Send, "Enjoy up to N% more Robux", "Bonus item we picked for you" (a game pass bundled with the larger packs), the bonus packages (amount, ~~base~~ + bonus, "Popular" tag, price button), "Robux packages", FAQ. Settings → Robux (in-app web view) shows Transfer limits (daily/monthly) and Transaction history.
- Data: roblox.com server-renders the packages into `#robux-redesign-page[data-buy-robux-page]` (sections → products with robuxAmount / nonPromotionalPlatformRobuxAmount / bonusRobuxAmount / price units+nanos, personalizedBonus.gamePassMetadata, transfers.pendingTransfers). Totals: `economy.roblox.com/v2/users/{id}/transaction-totals?timeFrame=Day|Week|Month|Year&transactionType=summary`.
- Ruby: new `robux` route (top bar + drawer). Same sections and packages from the live page; Buy/Send open Roblox's checkout (real money never goes through Ruby). Extras: Summary (incoming / outgoing / pending + breakdown by period) and Transactions (purchases / sales / Robux bought).

## 13. Community page, second pass
- Real app: full-width cover photo with the icon overlapping it; tabs come from the community (`profile-platform-api` profileType `Community` → `CommunityTabs`: About→Home, Forums→Posts, Events, Store, Affiliates); Events only shows when there are events; announcements are cards with author, "Owner" chip, role, time, title, body and emoji reaction counts, plus "See more posts" and a bell; owned communities first in the sidebar.
- Fixed in Ruby: cover photo (`CoverPhoto.coverPhotoId` → asset thumbnail 768x432), tabs in Roblox's order + Affiliates (allies) tab, announcement text (it lives in `message.content.slate`, which Ruby wasn't reading), reactions as emoji (stock emote ids from `groups/v1/groups/{id}/emotes`), Owner chip and verified badges on posts, owned-first sidebar. Ruby keeps Shout, Experiences and an About tab (roles, enemies, social links, funds, previous names) as extras.

## 14. Create hub (create.roblox.com, native)
- Sections: Home (updates, experiences, Learn links), Creations (Experiences with Active/Archived + sort, Avatar items by category, Development items by type), Finances (earnings by period), experience detail (Overview, Places, Passes, Developer Products, Configuration; Edit in Studio / Play / View on Roblox / Copy link), creator switcher (you or any community you can create for). Analytics, Learn, Store, Forum, Ads open create.roblox.com.
- Endpoints: `apis.roblox.com/universes/v1/search` (User or Group), `games/v1/games` + `games/v1/games/votes` (stats), `develop/v1/universes/{id}/configuration` + `/places`, `game-passes/v1/universes/{id}/game-passes?passView=Full` (creator price = `userBasePriceInRobux`; `price` is the viewer's discounted price), `developer-products/v2/universes/{id}/developerproducts?limit=50`, `itemconfiguration/v1/items/categories?categoryDomain=3` + `/items/by-creator?taxonomy=`, `creator-inventory-api/v1/-/creator-inventory-items:search`, `creator-home-api/v1/groups`, `creator-notifications/.../creator-stream-notifications`. Studio opens through `roblox-studio:1+launchmode:edit+task:EditPlace+placeId:…+universeId:…`.
