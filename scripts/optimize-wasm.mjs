// Optimizes the compiled WASM with wasm-opt (binaryen's CLI): strips debug
// info and runs -O3. Output goes to dist/prism-core.wasm.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const inFile =
  process.argv[2] ||
  path.join(root, "target", "wasm32-unknown-unknown", "release", "prism_wasm.wasm");
const outDir = path.join(root, "dist");
const outFile = path.join(outDir, "prism-core.wasm");

if (!fs.existsSync(inFile)) {
  console.error(`WASM not found at ${inFile} — run cargo build first.`);
  process.exit(1);
}
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Locate the wasm-opt binary (node_modules/wasm-opt/bin/wasm-opt.exe).
const candidates = [
  path.join(root, "node_modules", "wasm-opt", "bin", "wasm-opt.exe"),
  path.join(root, "node_modules", "wasm-opt", "bin", "wasm-opt"),
];
const bin = candidates.find((c) => fs.existsSync(c));
if (!bin) {
  console.error("wasm-opt binary not found — npm install first.");
  process.exit(1);
}

const before = fs.statSync(inFile).size;
execFileSync(bin, [inFile, "-O3", "--strip-debug", "--strip-producers", "-o", outFile], { stdio: "pipe" });
const after = fs.statSync(outFile).size;
console.log(`prism-core.wasm: ${(after / 1024).toFixed(1)} KB (was ${(before / 1024).toFixed(1)} KB)`);
