// PRISM isolated-world bridge.
//
// Runs in the extension's isolated content-script world. Its jobs:
//   1. Fetch + instantiate the Rust core (prism-core.wasm). MAIN world
//      scripts cannot fetch extension resources (page CSP), so we do it
//      here and hand the WebAssembly.Module over via postMessage.
//   2. Relay structured requests from MAIN world to the wasm core and back.
//   3. Relay storage calls to the background page (single-writer storage).
//
// Protocol (window.postMessage, origin-checked):
//   MAIN -> bridge : { prism: 1, id, op, payload }
//   bridge -> MAIN : { prism: 1, id, ok, result | error }
// A unique per-document token prevents page-script spoofing of responses.

(() => {
  "use strict";

  const PROTOCOL = 1;
  const token = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();

  // ── wasm core ────────────────────────────────────────────────────────────
  let coreModule = null; // WebAssembly.Module
  let corePromise = null;

  async function loadCore() {
    if (coreModule) return coreModule;
    if (corePromise) return corePromise;
    corePromise = (async () => {
      const url = browser.runtime.getURL("dist/prism-core.wasm");
      const res = await fetch(url);
      if (!res.ok) throw new Error("core fetch failed: " + res.status);
      const bytes = await res.arrayBuffer();
      coreModule = await WebAssembly.compile(bytes);
      return coreModule;
    })();
    return corePromise;
  }

  async function instantiateCore() {
    const module = await loadCore();
    return WebAssembly.instantiate(module, {});
  }

  // Runs one request synchronously against a live instance (per-call
  // instantiation is cheap after compile; single-threaded event loop makes
  // this safe without a lock).
  async function runCore(op, payload) {
    const instance = await instantiateCore();
    const { prism_alloc, prism_free, prism_handle, memory } = instance.exports;
    const request = JSON.stringify({ version: PROTOCOL, op, payload });
    const bytes = new TextEncoder().encode(request);
    let reqPtr = 0;
    let lenPtr = 0;
    let outPtr = 0;
    let outLen = 0;
    try {
      reqPtr = prism_alloc(bytes.length);
      lenPtr = prism_alloc(4);
      if (!reqPtr || !lenPtr) throw new Error("core alloc failed");
      // The ABI stores a wasm32 usize (4 bytes); the high half must be zero.
      new Uint8Array(memory.buffer, lenPtr, 4).fill(0);
      new Uint8Array(memory.buffer, reqPtr, bytes.length).set(bytes);
      outPtr = prism_handle(reqPtr, bytes.length, lenPtr);
      if (!outPtr) throw new Error("core handle failed");
      outLen = new Uint32Array(memory.buffer, lenPtr, 1)[0];
      const out = new Uint8Array(memory.buffer, outPtr, outLen);
      return JSON.parse(new TextDecoder().decode(out));
    } finally {
      if (reqPtr) prism_free(reqPtr, bytes.length);
      if (lenPtr) prism_free(lenPtr, 4);
      if (outPtr) prism_free(outPtr, outLen);
    }
  }

  // ── storage relay ────────────────────────────────────────────────────────
  function storageGet(key) {
    return browser.runtime.sendMessage({ type: "prism:storage:get", key }).then((r) => (r && r.ok ? r.value : null));
  }
  function storageSet(key, value) {
    return browser.runtime.sendMessage({ type: "prism:storage:set", key, value });
  }
  function storageRemove(key) {
    return browser.runtime.sendMessage({ type: "prism:storage:remove", key });
  }

  // ── message pump ─────────────────────────────────────────────────────────
  const pending = new Map();
  let nextId = 1;

  async function handleRequest(msg) {
    const id = msg.id;
    try {
      let result;
      switch (msg.op) {
        case "core.call": {
          result = await runCore(msg.payload.op, msg.payload.payload);
          break;
        }
        case "core.ready": {
          await loadCore();
          result = { ready: true, token };
          break;
        }
        case "storage.get": {
          result = await storageGet(msg.payload.key);
          break;
        }
        case "storage.set": {
          await storageSet(msg.payload.key, msg.payload.value);
          result = true;
          break;
        }
        case "storage.remove": {
          await storageRemove(msg.payload.key);
          result = true;
          break;
        }
        case "open.options": {
          await browser.runtime.openOptionsPage();
          result = true;
          break;
        }
        case "health": {
          // Called from the popup/options via runtime message.
          result = await getHealth();
          break;
        }
        default: {
          result = { ok: false, error: { code: "UnknownOperation", message: "unknown bridge op: " + msg.op } };
        }
      }
      // Core.error envelope is promoted so the runtime sees ok:false.
      if (result && typeof result === "object" && result.ok === false) {
        window.postMessage({ prism: PROTOCOL, id, token, ok: false, error: result.error }, "*");
      } else {
        window.postMessage({ prism: PROTOCOL, id, token, ok: true, result }, "*");
      }
    } catch (err) {
      window.postMessage(
        { prism: PROTOCOL, id, token, ok: false, error: { code: "BridgeError", message: String(err && err.message || err) } },
        "*"
      );
    }
  }

  // Health snapshot from the MAIN-world runtime (if present).
  async function getHealth() {
    try {
      const r = await runCore("settings.defaults", {});
      const engine = window.__PRISM__ ? window.__PRISM__.health() : null;
      return {
        ok: true,
        core: !!r,
        engine,
        url: location.href,
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.prism !== PROTOCOL || typeof msg.id !== "number" || typeof msg.op !== "string") return;
    // Handshake: core.ready is accepted with any token; the response carries
    // ours so the MAIN world can adopt it for all subsequent calls.
    if (msg.op !== "core.ready" && msg.token !== token) return;
    handleRequest(msg).catch(() => {});
  });

  // Warm the core in the background (idle priority): fetch is cheap, and
  // first navigation stays fast.
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => {
      loadCore().catch(() => {});
    }, { timeout: 3000 });
  } else {
    setTimeout(() => {
      loadCore().catch(() => {});
    }, 500);
  }

  // Respond to popup/options health pings.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "prism:ping") {
      getHealth().then(sendResponse);
      return true;
    }
    return false;
  });
})();
