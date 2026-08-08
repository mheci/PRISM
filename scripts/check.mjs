// PRISM pre-release checks: manifest validity, bundle presence, wasm ABI,
// icon presence, no secrets in tree.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

let failures = 0;
const fail = (msg) => { console.error("FAIL " + msg); failures++; };
const ok = (msg) => console.log("  ok  " + msg);

// 1. manifest
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
else ok("manifest v3");
if (!manifest.browser_specific_settings?.gecko?.id) fail("missing gecko id");
else ok("gecko id " + manifest.browser_specific_settings.gecko.id);

// 2. bundle
const bundle = path.join(root, "dist", "content", "engine.js");
if (!fs.existsSync(bundle)) fail("engine bundle missing — run npm run build");
else ok("engine bundle present (" + (fs.statSync(bundle).size / 1024).toFixed(1) + " KB)");

// 2b. manifest references resolve inside the zip
{
  const zipPath2 = path.join(root, "dist", "prism.zip");
  if (fs.existsSync(zipPath2)) {
    const zip = fs.readFileSync(zipPath2);
    const entries = [];
    let off = 0;
    while (off + 4 <= zip.length && zip.readUInt32LE(off) === 0x04034b50) {
      const nameLen = zip.readUInt16LE(off + 26);
      const extraLen = zip.readUInt16LE(off + 28);
      const csize = zip.readUInt32LE(off + 18);
      entries.push(zip.slice(off + 30, off + 30 + nameLen).toString("utf8"));
      off += 30 + nameLen + extraLen + csize;
    }
    const refs = [];
    for (const cs of manifest.content_scripts || []) refs.push(...(cs.js || []));
    if (manifest.background?.scripts) refs.push(...manifest.background.scripts);
    if (manifest.options_ui?.page) refs.push(manifest.options_ui.page);
    if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);
    const missing = refs.filter((r) => !entries.includes(r));
    if (missing.length) fail("manifest references missing from zip: " + missing.join(", "));
    else ok("manifest references resolve (" + refs.length + " files)");
  }
}

// 3. wasm
const wasm = path.join(root, "dist", "prism-core.wasm");
if (!fs.existsSync(wasm)) fail("prism-core.wasm missing");
else {
  const bytes = fs.readFileSync(wasm);
  const text = bytes.toString("latin1");
  if (!text.includes("prism_handle") || !text.includes("prism_alloc")) fail("wasm ABI exports missing");
  else ok("wasm ABI exports present");
}

// 4. icons
for (const size of [16, 32, 48, 96, 128]) {
  const p = path.join(root, "icons", `icon${size}.png`);
  if (!fs.existsSync(p)) fail("missing icons/icon" + size + ".png");
}
ok("icons present");

// 4b. zip integrity (strict central-directory walk)
const zipPath = path.join(root, "dist", "prism.zip");
if (!fs.existsSync(zipPath)) {
  fail("dist/prism.zip missing — run npm run build");
} else {
  const zip = fs.readFileSync(zipPath);
  const eocd = zip.slice(zip.length - 22);
  if (eocd.readUInt32LE(0) !== 0x06054b50) fail("zip EOCD signature missing");
  else {
    const cdStart = eocd.readUInt32LE(16);
    const cdSize = eocd.readUInt32LE(12);
    const okZip =
      zip.readUInt32LE(cdStart) === 0x02014b50 &&
      cdStart + cdSize + 22 === zip.length;
    if (!okZip) fail("zip central directory corrupt");
    else ok("zip integrity (" + (zip.length / 1024).toFixed(1) + " KB)");
  }
}

// 5. secret scan
const secretPatterns = [/JWT_SECRET\s*[:=]\s*['"][A-Za-z0-9]{32,}/, /964b878d64856a6a123dfeea27847bc/i];
const walk = (dir, base) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "target", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) walk(full, rel);
    else if (/\.(js|mjs|json|toml|yml|yaml|md|html|rs)$/.test(entry.name) && rel !== "scripts/check.mjs") {
      const content = fs.readFileSync(full, "utf8");
      if (secretPatterns.some((re) => re.test(content))) fail("possible secret in " + rel);
    }
  }
};
walk(root, "");
ok("secret scan clean");

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
