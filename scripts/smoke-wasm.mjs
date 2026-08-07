// ABI smoke test: instantiates dist/prism-core.wasm in Node and exercises
// the core ops (settings, filter, scrub, sponsor, themes, network).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, "..", "dist", "prism-core.wasm");
const wasm = fs.readFileSync(wasmPath);

const imports = {
  env: {
    // Rust std wasm needs a few imported functions; release build with
    // panic=abort typically needs only memory. Provide stubs if requested.
  },
  wasi_snapshot_preview1: {},
};

const module = await WebAssembly.compile(wasm);
const instance = await WebAssembly.instantiate(module, imports);
const { prism_alloc, prism_free, prism_handle, memory } = instance.exports;

function call(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const ptr = prism_alloc(bytes.length);
  new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
  const lenPtr = prism_alloc(8);
  new BigInt64Array(memory.buffer, lenPtr, 1)[0] = 0n;
  const outPtr = prism_handle(ptr, bytes.length, lenPtr);
  const outLen = Number(new BigInt64Array(memory.buffer, lenPtr, 1)[0]);
  const out = new Uint8Array(memory.buffer, outPtr, outLen);
  const text = new TextDecoder().decode(out);
  prism_free(ptr, bytes.length);
  prism_free(lenPtr, 8);
  prism_free(outPtr, outLen);
  return JSON.parse(text);
}

const V = 1;
let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failures++;
  }
}

console.log("settings.validate");
{
  const r = call({ version: V, op: "settings.validate", payload: { blob: "{}" } });
  check("valid empty blob", r.ok === true);
  const bad = call({ version: V, op: "settings.validate", payload: { blob: "{nope" } });
  check("invalid blob -> structured error", bad.ok === false && bad.error.subsystem === "config");
}

console.log("filter.parse");
{
  const r = call({
    version: V,
    op: "filter.parse",
    payload: { list: "youtube.com##ytd-masthead\n##.ytp-watermark\n! comment" },
  });
  check("2 css rules", r.ok && r.result.css_rules.length === 2);
  check("css emitted", r.ok && r.result.css.includes("display:none!important"));
}

console.log("scrub.run");
{
  const r = call({
    version: V,
    op: "scrub.run",
    payload: {
      document: {
        contents: [
          { reelItemRenderer: { videoId: "x" } },
          { videoRenderer: { videoId: "y", audioTrack: { isAutoDubbed: true } } },
        ],
      },
      mode: { shorts: true, auto_dubbed: true },
    },
  });
  check("removed both entries", r.ok && r.result.stats.removed === 2);
}

console.log("sponsor.decision");
{
  const r = call({
    version: V,
    op: "sponsor.decision",
    payload: {
      video_id: "v",
      segments: [{ category: "sponsor", segment: [10, 20] }],
      position: 15,
      actions: [{ category: "sponsor", action: "skip" }],
    },
  });
  check("skip decision", r.ok && r.result.decision.kind === "skip" && r.result.decision.to === 20);
}

console.log("themes.generate");
{
  const r = call({ version: V, op: "themes.generate", payload: { base: "#ff3d7f", dark: true } });
  check("palette generated", r.ok && r.result.palette.call_to_action === "#ff3d7f");
  check("css vars", r.ok && r.result.css_vars.includes("--yt-spec-base-background"));
}

console.log("network.budget + classify");
{
  const r = call({ version: V, op: "network.budget", payload: { used_bytes: 9 * 1024 ** 3, budget_gb: 10 } });
  check("warn at 90%", r.ok && r.result.state === "warn");
  const q = call({ version: V, op: "network.classify", payload: { itag: 137 } });
  check("itag 137 = 1080p", q.ok && q.result.class === "1080p");
}

console.log("history.resume");
{
  const r = call({
    version: V,
    op: "history.resume",
    payload: {
      record: { video_id: "v", last_position_sec: 50, duration_sec: 100, progress_pct: 50 },
      has_t_param: false,
      mode: "card",
    },
  });
  check("resume shown", r.ok && r.result.show === true);
}
console.log("unknown op");
{
  const r = call({ version: V, op: "nope", payload: {} });
  check("structured unknown-op error", r.ok === false && r.error.code === "UnknownOperation");
}

if (failures) {
  console.error(`${failures} failures`);
  process.exit(1);
}
console.log("ALL ABI SMOKE TESTS PASSED");
