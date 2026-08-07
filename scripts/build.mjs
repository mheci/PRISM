// PRISM build: bundles the content-script modules into one file (they share
// the MAIN-world namespace via window.__PRISM__), validates JS syntax,
// packages the extension zip (with the optimized wasm), writes checksums.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import zlib from "node:zlib";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(root, "dist");

const CONTENT_FILES = [
  "content/runtime.js",
  "content/modules/styling.js",
  "content/modules/player.js",
  "content/modules/captions.js",
  "content/modules/feed.js",
  "content/modules/history.js",
  "content/modules/chrome.js",
  "content/modules/sponsorblock.js",
  "content/modules/discovery.js",
  "content/modules/netmon.js",
  "content/modules/misc.js",
  "content/boot.js",
];

function checkJs(file) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  // Syntax check via node --check on a temp copy (ESM-friendly).
  const tmp = path.join(dist, ".check-" + path.basename(file));
  fs.writeFileSync(tmp, src);
  try {
    execSync(`node --check "${tmp}"`, { stdio: "pipe" });
  } catch (err) {
    console.error(`SYNTAX ERROR in ${file}:\n${err.stderr || err.stdout || err}`);
    process.exit(1);
  } finally {
    fs.unlinkSync(tmp);
  }
}

function bundleContent() {
  const parts = [];
  for (const f of CONTENT_FILES) {
    checkJs(f);
    parts.push(fs.readFileSync(path.join(root, f), "utf8"));
  }
  const bundle = parts.join("\n;\n");
  fs.writeFileSync(path.join(dist, "content", "engine.js"), bundle);
  return bundle.length;
}

function zipEntry(entries, rel, data) {
  const name = Buffer.from(rel, "utf8");
  const compressed = zlib.deflateRawSync(data);
  const use = compressed.length < data.length ? compressed : data;
  const crc = crc32(data);
  entries.push({ rel, name, data, use, crc, method: compressed.length < data.length ? 8 : 0 });
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function packageZip() {
  const entries = [];
  const manifest = fs.readFileSync(path.join(root, "manifest.json"));
  zipEntry(entries, "manifest.json", manifest);

  // Copy the extension tree (everything except build dirs).
  const skip = new Set(["dist", "target", "node_modules", ".git", "scripts", "crates", "docs"]);
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.posix.join(base, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else zipEntry(entries, rel, fs.readFileSync(full));
    }
  };
  walk(root, "");

  // WASM core must be in dist/ path referenced by the bridge.
  const wasm = fs.readFileSync(path.join(dist, "prism-core.wasm"));
  zipEntry(entries, "dist/prism-core.wasm", wasm);

  // ── zip writer ──
  const chunks = [];
  const centralChunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.use.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(e.name.length, 26);
    chunks.push(local, e.name, e.use);
    central.push({ name: e.name, crc: e.crc, csize: e.use.length, size: e.data.length, method: e.method, offset });
    offset += 30 + e.name.length + e.use.length;
  }
  const cdStart = offset;
  for (const e of central) {
    const rec = Buffer.alloc(46);
    rec.writeUInt32LE(0x02014b50, 0);
    rec.writeUInt16LE(20, 4);
    rec.writeUInt16LE(20, 6);
    rec.writeUInt16LE(0x0800, 8);
    rec.writeUInt16LE(e.method, 10);
    rec.writeUInt32LE(e.crc, 16);
    rec.writeUInt32LE(e.csize, 20);
    rec.writeUInt32LE(e.size, 24);
    rec.writeUInt16LE(e.name.length, 28);
    rec.writeUInt32LE(e.offset, 42);
    centralChunks.push(rec, e.name);
  }
  const cd = Buffer.concat(centralChunks);
  chunks.push(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  chunks.push(eocd);
  const zip = Buffer.concat(chunks);

  const zipPath = path.join(dist, "prism.zip");
  fs.writeFileSync(zipPath, zip);
  const sha = crypto.createHash("sha256").update(zip).digest("hex");
  fs.writeFileSync(zipPath + ".sha256", sha + "  " + path.basename(zipPath) + "\n");
  console.log(`packaged ${entries.length} files -> dist/prism.zip (${(zip.length / 1024).toFixed(1)} KB) sha256 ${sha.slice(0, 16)}…`);
}

if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(path.join(dist, "content"), { recursive: true });
const bytes = bundleContent();
console.log(`bundled engine.js (${(bytes / 1024).toFixed(1)} KB)`);
packageZip();
console.log("BUILD OK");
