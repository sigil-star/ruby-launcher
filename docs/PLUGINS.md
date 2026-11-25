# Ruby plugins

Plugins let you add features to Ruby — or ship your **own** project on top of Ruby — without
copying or rebranding it. A plugin is a small folder with a manifest and a JavaScript file.
Ruby loads enabled plugins and gives each one a single `ruby` object to work with.

> **Build on Ruby, don't fork it.** Making a plugin is the supported way to extend Ruby. Give
> your plugin its own name — the Ruby name and logo are reserved (see
> [TRADEMARK.md](../TRADEMARK.md)).

## Install a plugin

1. In Ruby, open **Plugins** (the menu, or Settings › General › Plugins).
2. Click **Open folder**.
3. Drop the plugin's folder inside, then click **Refresh**.
4. Turn the plugin **on**. Ruby asks you to confirm, because plugins run inside Ruby with full
   access — only enable ones you trust.

## Folder layout

```
my-plugin/
  plugin.json
  index.js
```

### `plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "you",
  "description": "What it does, in one line.",
  "entry": "index.js"
}
```

- `id` — a unique, lowercase slug (letters, digits, `-`, `.`). It names the folder and your
  storage keys.
- `entry` — the JavaScript file to run (defaults to `index.js`). It must stay inside the folder.

### `index.js`

Your code runs with one injected name, `ruby`. No imports, no bundler needed.

```js
ruby.registerPage({
  id: "main",
  label: "My Plugin",
  icon: "star",
  mount(container) {
    container.innerHTML = "<h1>Hello from my plugin!</h1>";
    const btn = document.createElement("button");
    btn.textContent = "Say hi";
    btn.onclick = () => ruby.toast("Hi from " + ruby.name + "!");
    container.append(btn);
    // Optional: return a cleanup function, called when the user leaves the page.
    return () => { /* tear down timers, listeners, etc. */ };
  },
});
```

## The `ruby` API (v1)

| Member | What it does |
|---|---|
| `ruby.id` / `ruby.name` | Your plugin's id and name. |
| `ruby.apiVersion` | The API version (currently `1`). |
| `ruby.registerPage({ id, label, icon?, mount })` | Adds a button to the left bar. `mount(container)` draws your page into a plain DOM element; it may return a cleanup function. |
| `ruby.registerSettings({ id, title, mount })` | Adds a section under Ruby Settings › General. Same `mount` shape. |
| `ruby.on(event, cb)` | Listen for `"navigate"`, `"gameLaunch"`, or `"gameLeave"`. |
| `ruby.toast(message, kind?)` | Show a toast. `kind` may be `"error"`. |
| `ruby.navigate(name)` | Go to a built-in page by name (`"home"`, `"avatar"`, `"chat"`, `"mods"`, `"plugins"`, …). |
| `ruby.storage.get(key)` / `ruby.storage.set(key, value)` | Per-plugin string storage, saved on this PC only. |

`icon` names are Ruby's built-in icons (e.g. `star`, `compass`, `chat`, `person`); an unknown
name just shows no icon.

## Security — read this

- Plugins run **inside Ruby, with Ruby's privileges**. A malicious plugin could do real harm.
  That's why plugins are **off by default** and each one asks for confirmation before it runs.
- The `ruby` API on purpose does **not** hand you the Roblox session cookie or a raw
  authenticated request method. Don't try to work around that, and never send a user's Roblox
  session anywhere.
- Only install plugins from people you trust, and read the code first — it's right there in the
  folder.

## Roadmap

- A reviewed, in-app plugin list you can browse and install from.
- Stronger isolation (running plugins in a sandbox so the API is the only thing they can touch).
- More events and API surface, versioned so old plugins keep working.

Found a bug or want more API? Open an issue.
