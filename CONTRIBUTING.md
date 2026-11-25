# Contributing to Ruby Launcher

Thanks for wanting to help. A few things to know first.

## The deal

- Ruby's source is **source-available** under [PolyForm Strict 1.0.0](LICENSE), not a
  permissive open-source license. You can read it, build it, and send changes back here.
- You may **not** ship your own launcher built from this code, and you may not use the Ruby
  name or logo — see [TRADEMARK.md](TRADEMARK.md).
- Want to add a feature of your own and release it? Build it as a **plugin**
  ([docs/PLUGINS.md](docs/PLUGINS.md)) and give it your own name. That's the supported way
  to build on Ruby.
- By opening a pull request, you agree your contribution can be included in Ruby and
  licensed under the same terms as the rest of the project.

## Building

```bash
npm install
npm run tauri:dev      # run the app
npm run build          # type-check + bundle the frontend
```

Requirements: Node 20+, Rust stable, and the WebView2 runtime (Windows).

Before you open a PR:

- `npx tsc --noEmit -p .` passes (no type errors).
- `cargo check` passes in `src-tauri/`.
- `npx vite build` succeeds.
- UI strings are added through the i18n layer (`src/lib/i18n.ts`), not hard-coded, so they
  stay translatable.

## Ground rules

- **Never** commit secrets, the update signing key, `.env*`, or anything with a local path
  or personal info. The signing key lives outside the repo, in `~/.ruby-release`, and must
  stay there.
- **Respect Roblox.** Ruby talks to Roblox's own APIs as the signed-in user. Don't add
  cheating, exploiting, automation that breaks Roblox's rules, or anything that sends a
  user's `.ROBLOSECURITY` cookie anywhere except roblox.com.
- Keep the Roblox HTTP proxy host-locked (`*.roblox.com` / `*.rbxcdn.com`) and keep the
  session cookie off any other host.
- Match the existing style; keep changes focused.

## Reporting security issues

Please **don't** open a public issue for a security problem. Open a private report (GitHub
"Report a vulnerability") or contact the maintainer, and give time for a fix before any
disclosure.
