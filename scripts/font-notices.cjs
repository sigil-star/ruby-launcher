// Reads the copyright and license lines out of every font Ruby ships and writes
// public/licenses/fonts.txt (with the full license texts from scripts/licenses/).
// Run it again whenever a font is added: `node scripts/font-notices.cjs`.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function nameTable(file) {
  const b = fs.readFileSync(file);
  const tables = b.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString("latin1", rec, rec + 4) !== "name") continue;
    const off = b.readUInt32BE(rec + 8);
    const count = b.readUInt16BE(off + 2);
    const strings = off + b.readUInt16BE(off + 4);
    const out = {};
    for (let j = 0; j < count; j++) {
      const r = off + 6 + j * 12;
      const platform = b.readUInt16BE(r);
      const id = b.readUInt16BE(r + 6);
      const len = b.readUInt16BE(r + 8);
      const at = strings + b.readUInt16BE(r + 10);
      const raw = b.subarray(at, at + len);
      let text;
      if (platform === 3 || platform === 0) {
        const swapped = Buffer.from(raw);
        swapped.swap16();
        text = swapped.toString("utf16le");
      } else text = raw.toString("latin1");
      if (!out[id] || platform === 3) out[id] = text.replace(/\s+/g, " ").trim();
    }
    return out;
  }
  return {};
}

// Builder Sans isn't shipped: Ruby loads it from the user's Roblox install (ui_fonts in theme.rs).
const fonts = ["src-tauri/assets/fonts", "public/fonts"].flatMap((dir) =>
  fs.readdirSync(path.join(root, dir)).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(dir, f)),
);

let txt = "Fonts that come with Ruby Launcher\n==================================\n\n";
txt += "Each font is used under its own license, listed below with the copyright notice from the font file itself.\n";
txt += "The full license texts follow at the end of this file.\n\n";
for (const rel of fonts) {
  const n = nameTable(path.join(root, rel));
  txt += `${n[4] || path.basename(rel)} (${path.basename(rel)})\n`;
  if (n[0]) txt += `  ${n[0]}\n`;
  if (n[13]) txt += `  License: ${n[13]}\n`;
  if (n[14]) txt += `  ${n[14]}\n`;
  txt += "\n";
}
for (const lic of ["OFL-1.1.txt", "Apache-2.0.txt"]) {
  const p = path.join(__dirname, "licenses", lic);
  if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
  txt += `\n\n${"=".repeat(72)}\n${lic.replace(".txt", "")}\n${"=".repeat(72)}\n\n${fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n")}`;
}
fs.mkdirSync(path.join(root, "public/licenses"), { recursive: true });
fs.writeFileSync(path.join(root, "public/licenses/fonts.txt"), txt);
console.log(`wrote public/licenses/fonts.txt for ${fonts.length} fonts`);
