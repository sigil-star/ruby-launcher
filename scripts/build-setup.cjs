// Builds Ruby, packs it into the setup app, and writes dist-setup/Ruby Launcher Setup.exe.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
// Map local build paths to neutral names so the exes don't carry this PC's user folder.
const home = require("os").homedir();
const remap = [[path.join(home, ".cargo"), "cargo"], [path.join(home, ".rustup"), "rustup"], [root, "ruby"]]
  .map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join(" ");
const env = { ...process.env, RUSTFLAGS: [process.env.RUSTFLAGS, remap].filter(Boolean).join(" ") };
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit", env });

run("npx tauri build --no-bundle");
const payloadDir = path.join(root, "setup", "payload");
fs.mkdirSync(payloadDir, { recursive: true });
// Pack Ruby with Brotli (max quality, large window): an 8-byte size header, then the stream.
const zlib = require("zlib");
const exe = fs.readFileSync(path.join(root, "src-tauri", "target", "release", "rubylauncher-tauri.exe"));
const packed = zlib.brotliCompressSync(exe, {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: exe.length,
  },
});
const header = Buffer.alloc(8);
header.writeBigUInt64LE(BigInt(exe.length));
fs.writeFileSync(path.join(payloadDir, "Ruby Launcher.exe.br"), Buffer.concat([header, packed]));
console.log(`Packed Ruby: ${(exe.length / 1048576).toFixed(1)} MB -> ${(packed.length / 1048576).toFixed(1)} MB`);
run("cargo build --release", path.join(root, "setup"));
const out = path.join(root, "dist-setup");
fs.mkdirSync(out, { recursive: true });
const dest = path.join(out, "Ruby Launcher Setup.exe");
fs.copyFileSync(path.join(root, "setup", "target", "release", "ruby-setup.exe"), dest);
// Tauri bakes the setup project's folder into the exe as data (only used in dev builds).
// Swap it for a same-length neutral path so the installer doesn't carry this PC's user folder.
{
  const exeBytes = fs.readFileSync(dest);
  const from = Buffer.from(root, "utf8");
  const to = Buffer.from(("C:" + path.sep + "ruby" + path.sep).padEnd(root.length, "_"), "utf8");
  let n = 0;
  for (let i = exeBytes.indexOf(from); i >= 0; i = exeBytes.indexOf(from, i + 1), n++) to.copy(exeBytes, i);
  fs.writeFileSync(dest, exeBytes);
  console.log(`Scrubbed ${n} local path(s) from the setup exe`);
}
// Attach the bundled skyboxes to the end of the setup exe (see setup/src/main.rs, sky_overlay).
// They're resized from the source packs once, by: cargo run --release --example pack_skyboxes.
const skySrc = process.env.RUBY_SKYBOX_SRC || path.join(require("os").homedir(), "Documents", "RubyLauncher", "assets", "EngineAssets", "skybox");
const skyPack = path.join(root, "src-tauri", "target", "skyboxes.pack");
if (!fs.existsSync(skyPack) || process.env.RUBY_REPACK_SKYBOXES) {
  run(`cargo run --release --example pack_skyboxes -- "${skySrc}" ../scripts/skyboxes.txt target/skyboxes.pack`, path.join(root, "src-tauri"));
}
const sky = fs.readFileSync(skyPack);
const tail = Buffer.alloc(16);
tail.writeBigUInt64LE(BigInt(sky.length));
tail.write("RUBYSKY1", 8, "ascii");
fs.appendFileSync(dest, Buffer.concat([sky, tail]));
console.log(`Skyboxes: ${(sky.length / 1048576).toFixed(1)} MB`);
console.log(`\nSetup ready: ${dest} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
