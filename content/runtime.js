// PRISM MAIN-world runtime.
//
// Loaded at document-start as a content script in the MAIN world. Runs the
// feature modules. All logic that can live in Rust lives in Rust (via the
// bridge); this layer is a thin, deterministic DOM adapter.
//
// Design notes:
//  * No global mutable state beyond the `Prism` namespace object.
//  * Every module: id, deps, init/start/stop, health().
//  * Crash isolation: 3 consecutive failures quarantine the module.
//  * Watchdogs: modules report liveness; the runtime restarts dead ones.
//  * All timers go through the scheduler (adaptive backoff, hidden-tab
//    suppression) so idle YouTube costs nothing.

(() => {
  "use strict";

  const PROTOCOL = 1;
  // The bridge owns the channel token; we adopt it from the core.ready
  // handshake so replies and requests share one secret.
  let bridgeToken = null;

  // ── bridge client (async request/response) ──────────────────────────────
  const pending = new Map();
  let nextId = 1;

  function bridgeCall(op, payload) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("bridge timeout: " + op));
        }
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ prism: PROTOCOL, id, token: bridgeToken, op, payload }, "*");
    });
  }

  function coreCall(op, payload) {
    return bridgeCall("core.call", { op, payload }).then((r) => {
      if (!r || r.ok === false) {
        const e = new Error((r && r.error && r.error.message) || "core error");
        e.code = r && r.error && r.error.code;
        throw e;
      }
      return r.result;
    });
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.prism !== PROTOCOL) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    // Adopt the bridge token from the handshake response.
    if (bridgeToken === null && msg.token) bridgeToken = msg.token;
    if (bridgeToken !== null && msg.token !== bridgeToken) return;
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error((msg.error && msg.error.message) || "bridge error"));
  });

  const storage = {
    get: (key) => bridgeCall("storage.get", { key }).then((r) => (r.ok ? r.result : undefined)),
    set: (key, value) => bridgeCall("storage.set", { key, value }),
    remove: (key) => bridgeCall("storage.remove", { key }),
  };
  // Generic bridge op for extension-only actions (e.g. opening the options
  // page from the MAIN world, which has no browser API).
  const call = (op, payload) => bridgeCall(op, payload);

  // ── scheduler (adaptive timers) ─────────────────────────────────────────
  // All module timers go through here. Intervals stretch while the tab is
  // hidden; backoff grows when a tick runs long.
  class Scheduler {
    constructor() {
      this._intervals = new Map();
      this._timeouts = new Map();
      this._hidden = false;
      document.addEventListener("visibilitychange", () => {
        this._hidden = document.hidden;
      });
    }

    _factor() {
      let f = 1;
      if (this._hidden) f *= 8;
      if (document.hasFocus && !document.hasFocus()) f *= 1.5;
      return f;
    }

    interval(fn, baseMs) {
      const id = Symbol();
      let backoff = 1;
      const tick = () => {
        if (!this._intervals.has(id)) return;
        const t0 = performance.now();
        try {
          fn();
        } catch (err) {
          reportError("scheduler", err);
        }
        // Re-check after fn(): a callback may have cancelled itself.
        if (!this._intervals.has(id)) return;
        const dt = performance.now() - t0;
        backoff = dt > 12 ? Math.min(4, backoff * 1.3) : Math.max(1, backoff / 1.3);
        this._intervals.set(id, setTimeout(tick, Math.max(150, baseMs * this._factor() * backoff)));
      };
      this._intervals.set(id, setTimeout(tick, baseMs));
      return () => {
        clearTimeout(this._intervals.get(id));
        this._intervals.delete(id);
      };
    }

    timeout(fn, ms) {
      const id = Symbol();
      const t = setTimeout(() => {
        this._timeouts.delete(id);
        try {
          fn();
        } catch (err) {
          reportError("scheduler", err);
        }
      }, ms);
      this._timeouts.set(id, t);
      return () => {
        clearTimeout(t);
        this._timeouts.delete(id);
      };
    }
  }

  // ── diagnostics ─────────────────────────────────────────────────────────
  const logRing = [];
  const MAX_LOG = 64;
  function log(level, subsystem, message) {
    logRing.push({ ts: Date.now(), level, subsystem, message });
    if (logRing.length > MAX_LOG) logRing.shift();
    if (level === "error" || level === "critical") {
      try {
        console.error("[PRISM]", subsystem, message);
      } catch (_) {}
    }
  }
  function reportError(subsystem, err) {
    log("error", subsystem, String((err && err.message) || err));
    try {
      console.error("[PRISM]", subsystem, (err && err.stack) || (err && err.message) || err);
    } catch (_) {}
  }

  // ── module registry ─────────────────────────────────────────────────────
  const modules = new Map();
  const quarantined = new Set();
  const failures = new Map(); // module -> consecutive failure count

  function registerModule(module) {
    if (!module || typeof module.id !== "string") throw new Error("module without id");
    if (modules.has(module.id)) throw new Error("duplicate module: " + module.id);
    modules.set(module.id, {
      ...module,
      deps: module.deps || [],
      state: "registered",
      timers: [],
      listeners: [],
    });
  }

  // Guards a module callback: records failures (consecutive), resets the
  // counter on success, and handles both sync throws and async rejections.
  function withGuard(moduleId, fn) {
    return (...args) => {
      if (quarantined.has(moduleId)) return;
      const t0 = performance.now();
      const onSuccess = () => {
        failures.set(moduleId, 0);
        logMetric(moduleId, performance.now() - t0);
      };
      const onError = (err) => {
        reportError(moduleId, err);
        const n = (failures.get(moduleId) || 0) + 1;
        failures.set(moduleId, n);
        logMetric(moduleId, performance.now() - t0);
        if (n >= 3) {
          quarantined.add(moduleId);
          log("critical", moduleId, "quarantined after 3 consecutive failures");
          stopModule(moduleId);
        }
      };
      try {
        const r = fn(...args);
        if (r && typeof r.then === "function") {
          return r.then(onSuccess, onError);
        }
        onSuccess();
        return r;
      } catch (err) {
        onError(err);
      }
    };
  }

  const metrics = new Map();
  function logMetric(moduleId, ms) {
    const m = metrics.get(moduleId) || { applies: 0, totalMs: 0, errors: 0 };
    m.applies++;
    m.totalMs += ms;
    metrics.set(moduleId, m);
  }

  async function startModule(moduleId) {
    const m = modules.get(moduleId);
    if (!m || m.state === "started" || quarantined.has(moduleId)) return;
    // If this is a restart, tear the previous instance down first so
    // timers/listeners never accumulate.
    if (m.state !== "registered") stopModule(moduleId);
    // deps first
    for (const dep of m.deps) {
      await startModule(dep);
    }
    m.state = "starting";
    try {
      const ctx = moduleContext(m);
      await m.init(ctx);
      if (typeof m.start === "function") await m.start(ctx);
      m.state = "started";
      failures.set(moduleId, 0);
      log("info", moduleId, "started");
    } catch (err) {
      reportError(moduleId, err);
      m.state = "failed";
      const n = (failures.get(moduleId) || 0) + 1;
      failures.set(moduleId, n);
      if (n >= 3) {
        quarantined.add(moduleId);
        log("critical", moduleId, "quarantined after 3 consecutive failures");
        stopModule(moduleId);
      }
    }
  }

  function stopModule(moduleId) {
    const m = modules.get(moduleId);
    if (!m || m.state === "stopped") return;
    try {
      if (m.stop) m.stop();
    } catch (err) {
      reportError(moduleId, err);
    }
    // Release every lifecycle-scoped timer and listener.
    for (const stop of m.timers) {
      try { stop(); } catch (_) {}
    }
    m.timers = [];
    for (const off of m.listeners) {
      try { off(); } catch (_) {}
    }
    m.listeners = [];
    m.state = "stopped";
  }

  function moduleContext(m) {
    return {
      id: m.id,
      log: (level, msg) => log(level, m.id, msg),
      // Lifecycle-scoped timers: cleared on stop.
      timer: {
        interval: (fn, ms) => {
          const stop = scheduler.interval(withGuard(m.id, fn), ms);
          m.timers.push(stop);
          return stop;
        },
        timeout: (fn, ms) => {
          const stop = scheduler.timeout(withGuard(m.id, fn), ms);
          m.timers.push(stop);
          return stop;
        },
      },
      // Lifecycle-scoped listeners on the given target.
      on: (target, type, fn, opts) => {
        const wrapped = withGuard(m.id, fn);
        target.addEventListener(type, wrapped, opts);
        const off = () => target.removeEventListener(type, wrapped, opts);
        m.listeners.push(off);
        return off;
      },
      core: coreCall,
      storage,
      settings: () => runtimeSettings,
    };
  }

  // ── settings (cached, bridge-synced) ────────────────────────────────────
  let runtimeSettings = null;

  async function loadSettings() {
    try {
      const raw = await storage.get("settings");
      const blob = raw && raw.v !== undefined ? raw.v : "{}";
      const r = await coreCall("settings.validate", { blob });
      runtimeSettings = r.settings;
      if (r.issues && r.issues.length) {
        log("warn", "settings", "validation issues: " + r.issues.map((i) => i.path).join(", "));
      }
    } catch (err) {
      reportError("settings", err);
      const r = await coreCall("settings.defaults", {});
      runtimeSettings = r;
    }
  }

  async function saveSettings() {
    await storage.set("settings", { v: JSON.stringify(runtimeSettings) });
  }

  function updateSetting(path, value) {
    // path like "player.speed_default"
    if (!runtimeSettings) return; // not loaded yet; ignore
    const parts = path.split(".");
    let obj = runtimeSettings;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    saveSettings().catch((err) => reportError("settings", err));
  }

  // ── boot ────────────────────────────────────────────────────────────────
  const scheduler = new Scheduler();

  async function boot() {
    // Wait for the bridge to be ready (it fetches the wasm on idle).
    try {
      await bridgeCall("core.ready", {}).catch(() => {});
    } catch (_) {}
    await loadSettings();

    for (const m of modules.values()) {
      if (m.deps.length === 0 || m.state === "started") await startModule(m.id);
    }
    // Second pass for dependents.
    for (const m of modules.values()) {
      if (m.state !== "started") await startModule(m.id);
    }

    // Watchdog: restart failed modules periodically (bounded backoff).
    scheduler.interval(() => {
      for (const m of modules.values()) {
        if (m.state === "failed" && !quarantined.has(m.id)) {
          log("warn", m.id, "watchdog restarting failed module");
          stopModule(m.id); // releases timers/listeners from the failed run
          m.state = "registered";
          startModule(m.id).catch(() => {});
        }
      }
    }, 30000);
  }

  // Expose for dashboard/popup and other page-side tools.
  const Prism = {
    PROTOCOL,
    log,
    modules,
    metrics,
    quarantined: () => [...quarantined],
    health: () => ({
      uptimeMs: performance.now(),
      modules: [...modules.values()].map((m) => ({ id: m.id, state: m.state, quarantined: quarantined.has(m.id) })),
      metrics: [...metrics.entries()].map(([id, m]) => ({ id, ...m })),
      log: logRing.slice(),
    }),
    core: coreCall,
    storage,
    call,
    settings: () => runtimeSettings,
    updateSetting,
    registerModule,
    startModule,
    stopModule,
    boot,
    scheduler,
    logRing,
  };

  try {
    window.__PRISM__ = Prism;
  } catch (_) {}
})();
