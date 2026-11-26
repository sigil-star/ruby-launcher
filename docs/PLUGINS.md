# Ruby plugins

Plugins let you add features to Ruby — or ship your **own** project on top of Ruby — without
copying or rebranding it. A plugin is a small folder with a manifest and a JavaScript file.
Ruby loads enabled plugins and gives each one a single `ruby` object to work with.

> **Build on Ruby, don't fork it.** Making a plugin is the supported way to extend Ruby. Give
> your plugin its own name — the Ruby name and logo are reserved (see
> [TRADEMARK.md](../TRADEMARK.md)).

- [Installing plugins](#installing-plugins)
- [Making a plugin](#making-a-plugin)
- [The `ruby` API](#the-ruby-api-v1)
- [Writing plugins safely](#writing-plugins-safely) ← read this before you publish
- [Getting featured](#getting-featured)

---

## Installing plugins

Open **Plugins** in Ruby (the menu, or Settings › General › Plugins).

- **Featured** — plugins that were reviewed before they were listed. Ruby downloads them from
  the [ruby-plugins](https://github.com/sigil-star/ruby-plugins) repo, pinned to the exact
  reviewed version, and checks every file's SHA-256 against a list signed with Ruby's release
  key. If anything doesn't match, nothing is installed. These show a green **Reviewed** badge.
- **Installed** — everything on this PC. You can also **Install from folder** to try a plugin
  that isn't featured; it shows an orange **Not reviewed** badge.

Plugins are **off** until you turn them on, and Ruby asks you to confirm first.

---

## Making a plugin

```
my-plugin/
  plugin.json
  index.js
  README.md        (recommended)
```

### `plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "description": "What it does, in one line.",
  "entry": "index.js",
  "icon": "icon.svg"
}
```

- `id` — unique, lowercase letters, digits, `-` and `.`. It must match the folder name.
- `version` — bump it every time you change the plugin (`1.0.1`, `1.1.0`, …).
- `entry` — the JavaScript file to run, relative to the folder (defaults to `index.js`).
- `icon` — optional square image in the folder (`.png`, `.svg` or `.webp`, up to 256 KB). It's
  shown on your plugin's card, and you can use it for your left-bar button. SVG icons may not
  contain scripts, event handlers or links.

### `index.js`

Your code runs with one injected name, `ruby`. No imports and no bundler.

```js
ruby.registerPage({
  id: "main",
  label: "My Plugin",
  icon: "star",
  mount(container) {
    const h = document.createElement("h1");
    h.textContent = "Hello from my plugin!";
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Say hi";
    btn.onclick = () => ruby.toast("Hi " + ruby.user.displayName + "!");
    container.append(h, btn);
    return () => { /* clean up timers and listeners here */ };
  },
});
```

To try it: Plugins › Installed › **Install from folder**, pick your folder, turn it on. After
editing, click **Refresh** to reload it. A full example lives in
[`examples/hello-ruby-plugin`](../examples/hello-ruby-plugin).

---

## The `ruby` API (v1)

| Member | What it does |
|---|---|
| `ruby.id` / `ruby.name` | Your plugin's id and name. |
| `ruby.apiVersion` | The API version (currently `1`). |
| `ruby.version` | Ruby's version string. |
| `ruby.user` | Public info about the signed-in user: `{ id, name, displayName }`. Never the Roblox session. |
| `ruby.registerPage({ id, label, icon?, iconUrl?, mount })` | Adds a button to the left bar. `icon` is a built-in icon name; pass `iconUrl: ruby.iconUrl` to use your plugin's own icon. `mount(container)` draws into a plain DOM element and may return a cleanup function. |
| `ruby.iconUrl` | Your plugin's icon as an image URL (or `null`). |
| `ruby.addStyles(css)` | Adds CSS to Ruby; returns a function that removes it, and it's removed automatically when the plugin turns off. CSS that loads anything (`url()`, `@import`) is refused. Max 50 KB. |
| `ruby.registerSettings({ id, title, mount })` | Adds a section under Ruby Settings › General. |
| `ruby.registerCustomizeTab({ id, label, icon?, mount })` | Adds a tab to the Customize page. |
| `ruby.on(event, cb)` | `"navigate"` (`{ name }`), `"gameLaunch"` (`{ placeId, jobId }`), `"gameLeave"`. |
| `ruby.onUnload(cb)` | Runs when the plugin is turned off or reloaded. |
| `ruby.toast(message, kind?)` | Show a toast. `kind` may be `"error"`. |
| `ruby.confirm(message)` | Ask the user; returns `Promise<boolean>`. |
| `ruby.openExternal(url)` | Open an `https` link in the user's browser. |
| `ruby.navigate(name)` | Go to a built-in page: `"home"`, `"avatar"`, `"chat"`, `"mods"`, `"plugins"`, `"friends"`, … |
| `ruby.storage.get(key)` / `ruby.storage.set(key, value)` | Per-plugin string storage, on this PC only. |

`icon` is one of Ruby's built-in icon names (`star`, `compass`, `chat`, `person`, `puzzle`, …).

### Styling avatars

Every avatar in Ruby is a `.headshot` element with two attributes you can target from
`ruby.addStyles`:

- `data-user` — the Roblox user id.
- `data-presence` — `online`, `ingame`, `studio` or `offline` (when Ruby knows it; your own
  avatar is `online`, or `ingame` while you play).

```js
ruby.addStyles(`
  .headshot[data-presence="ingame"]::before {
    content: ""; position: absolute; inset: -6%; border-radius: 50%;
    border: 2px solid var(--blue); pointer-events: none;
  }
`);
```

Ruby's accent color is the CSS variable `--blue`. The featured **Avatar Frames** plugin is a
complete example of animated, status-colored rings.

---

## Writing plugins safely

Plugins run **inside Ruby, with Ruby's privileges**. That's what makes them powerful, and it's
why a careless or malicious plugin can do real harm to the person who installs it. These rules
are not optional for featured plugins — the review checks every one of them, and the automatic
checker rejects most violations before a human even looks.

### Never touch the Roblox session or Ruby's internals

- Don't read `document.cookie`, and never try to get, store or send anyone's `.ROBLOSECURITY`.
- Don't call Ruby's native layer directly (`__TAURI__`, `__TAURI_INTERNALS__`, `invoke`, IPC).
  Use only the `ruby` object. If you need something it doesn't offer, open an issue asking for
  it instead of working around it.
- Don't reach into Ruby's pages or patch its code. Draw only inside the `container` you're given.

### No network, no hidden code

- No `fetch`, `XMLHttpRequest`, `WebSocket` or other ways to send data off the PC. Ruby's
  content policy blocks most of these anyway; featured plugins may not try.
- No `eval`, `new Function`, `import()`, or loading scripts from anywhere. Everything your plugin
  runs must be in its folder, readable.
- No minified, obfuscated or encoded code (`atob` blobs, giant one-line files). Reviewers must be
  able to read every line. Ship your source, not a build.

### Handle data and the page carefully

- Build UI with `document.createElement` and `textContent`. Don't build HTML from strings
  (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) — it's the easiest way to create an injection
  bug.
- Style with `ruby.addStyles` and keep selectors specific to what you change; don't hide or
  restyle Ruby's own safety prompts, Settings or the Plugins page.
- Keep your data in `ruby.storage`, not `localStorage`/`sessionStorage`/IndexedDB directly, so
  you can't read or overwrite other plugins' or Ruby's data.
- Don't open windows or pop-ups yourself; use `ruby.openExternal` for links (https only).

### Be a good citizen

- Clean up in the function `mount` returns, and in `ruby.onUnload`: clear timers, intervals and
  event listeners. A plugin that keeps running after it's turned off is a bug.
- Ask with `ruby.confirm` before doing anything the user might not expect.
- Respect Roblox's Terms of Use. No cheats, exploits, automation that breaks Roblox's rules, or
  anything that collects other players' data.
- Keep it small: no more than 200 files and 10 MB per file; most plugins need two files.

### What users should know

- **Reviewed** (featured) plugins were read by a person and are verified byte-for-byte on
  install. **Not reviewed** plugins weren't — only enable those from people you trust.
- Reviewed doesn't mean risk-free; it means someone checked it against these rules. Report
  anything suspicious as an issue on the ruby-plugins repo.

---

## Getting featured

Featured plugins come from the public
[**sigil-star/ruby-plugins**](https://github.com/sigil-star/ruby-plugins) repo.

1. Fork the repo and add your plugin as `plugins/<your-id>/` (`plugin.json`, `index.js`,
   `README.md`).
2. Open a pull request. The template asks you to confirm you followed the rules above.
3. An automatic check runs on your pull request (manifest, file types and sizes, banned
   patterns). Fix anything it flags.
4. The maintainer reviews the code by hand. Changes may be requested.
5. Once merged, the plugin is added to the signed featured list on the next update, and appears
   under **Plugins › Featured** in Ruby.

Updates work the same way: open a pull request that changes your plugin and bumps its
`version`. Ruby offers the update once the new version is reviewed and listed.

See the ruby-plugins repo's [submission guide](https://github.com/sigil-star/ruby-plugins#submit-a-plugin)
for the full checklist.

---

## Roadmap

- Running plugins in an isolated sandbox, so the `ruby` API is the only thing they can reach.
- More events and API, versioned so older plugins keep working.
