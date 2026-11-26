#!/usr/bin/env node
// Builds Ruby's signed featured-plugin list from a checkout of sigil-star/ruby-plugins.
//
//   node scripts/build-plugin-registry.cjs <path-to-ruby-plugins> <out.json>
//
// What it does:
//  1. Requires a clean checkout whose HEAD is already pushed to origin/main (so every URL in
//     the list points at reviewed, merged code that can't change).
//  2. Runs the repo's own checker (scripts/validate.cjs) and stops if anything fails.
//  3. For every plugin, records each file's path, size and SHA-256, and a raw.githubusercontent
//     URL pinned to that commit.
//  4. Signs "ruby-plugins\n" + payload with Ruby's release key (the same key that signs
//     updates; it never leaves this PC) and writes { payload, signature }.
//
// Ruby only installs a featured plugin if the signature, URL, size and hash all match.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const repo = path.resolve(process.argv[2] || path.join(__dirname, "..", "..", "ruby-plugins"));
if (!process.argv[3]) throw new Error("usage: build-plugin-registry.cjs <ruby-plugins checkout> <output .json>");
const out = path.resolve(process.argv[3]);
const RAW = "https://raw.githubusercontent.com/sigil-star/ruby-plugins/";

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) throw new Error("ruby-plugins has uncommitted changes; commit and push first.");
git("fetch", "-q", "origin", "main");
const commit = git("rev-parse", "HEAD");
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("couldn't read the commit");
const contained = execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", commit, "origin/main"], { stdio: "ignore" });
void contained; // throws if HEAD isn't on origin/main

execFileSync(process.execPath, [path.join(repo, "scripts", "validate.cjs"), path.join(repo, "plugins")], { stdio: "inherit" });

const featured = new Set(JSON.parse(fs.readFileSync(path.join(repo, "featured.json"), "utf8")));
const pluginsDir = path.join(repo, "plugins");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const plugins = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => {
    const id = e.name;
    const dir = path.join(pluginsDir, id);
    const m = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
    const files = walk(dir)
      .map((p) => {
        const rel = path.relative(dir, p).replace(/\\/g, "/");
        // Hash the bytes exactly as GitHub serves them (the committed blob, LF line endings).
        const bytes = execFileSync("git", ["-C", repo, "show", `${commit}:plugins/${id}/${rel}`]);
        return { path: rel, url: `${RAW}${commit}/plugins/${id}/${rel}`, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    return { id, name: m.name, version: m.version, author: m.author, description: m.description, featured: featured.has(id), icon: m.icon || "", files };
  })
  .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));

const payload = JSON.stringify({ updated: new Date().toISOString().slice(0, 10), commit, plugins });
const keyPath = process.env.RUBY_UPDATE_KEY || path.join(os.homedir(), ".ruby-release", "update-signing-key.pem");
const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
const message = Buffer.from(`ruby-plugins\n${payload}`);
const signature = crypto.sign(null, message, key).toString("base64");
if (!crypto.verify(null, message, crypto.createPublicKey(key), Buffer.from(signature, "base64"))) throw new Error("signature check failed");

fs.writeFileSync(out, JSON.stringify({ payload, signature }, null, 2) + "\n");
console.log(`Signed ${plugins.length} plugin(s) at ${commit.slice(0, 7)} -> ${out}`);
