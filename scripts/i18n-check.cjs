// Collects every t("...") key in src/ and checks each locale file has it (with the same {placeholders}).
// node scripts/i18n-check.cjs            -> report
// node scripts/i18n-check.cjs --keys     -> write scripts/i18n-keys.json (all English keys)
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "src");
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
  }
})(root);
const keys = new Set();
// t("..."), t('...'), t(`...`) without ${}
const re = /\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)/g;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(s))) {
    const lit = m[1];
    let v;
    if (lit[0] === "`") v = lit.slice(1, -1).replace(/\\`/g, "`");
    else v = Function(`return ${lit}`)();
    keys.add(v);
  }
}
const all = [...keys].sort();
if (process.argv.includes("--keys")) {
  fs.writeFileSync(path.join(__dirname, "i18n-keys.json"), JSON.stringify(all, null, 1));
  console.log(`${all.length} keys written`);
  process.exit(0);
}
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(",");
const dir = path.join(root, "locales");
let bad = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const missing = all.filter((k) => !(k in d) || !d[k]);
  const phBad = all.filter((k) => d[k] && ph(d[k]) !== ph(k));
  const extra = Object.keys(d).filter((k) => !keys.has(k));
  if (missing.length || phBad.length) bad++;
  console.log(`${f}: ${all.length - missing.length}/${all.length}` + (missing.length ? ` missing ${missing.length}` : "") + (phBad.length ? ` placeholder-mismatch ${phBad.length}` : "") + (extra.length ? ` (unused ${extra.length})` : ""));
  if (process.argv.includes("-v")) {
    missing.slice(0, 20).forEach((k) => console.log("   missing:", k));
    phBad.slice(0, 20).forEach((k) => console.log("   placeholder:", k, "=>", d[k]));
  }
}
console.log(`${all.length} keys total`);
process.exit(bad ? 1 : 0);
