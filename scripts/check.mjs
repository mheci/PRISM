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
