// Engine bundle unit tests: runs content/runtime.js + modules against a
// minimal DOM mock WITH a working in-memory bridge (storage + core), so
// boot() completes and every module must reach state "started".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bundle = fs.readFileSync(path.join(root, "dist", "content", "engine.js"), "utf8");

// ── minimal DOM/window mock ──
class MockElement {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this._text = "";
    this._html = "";
    this.classList = {
      _s: new Set(),
      add: function (c) { this._s.add(c); },
      remove: function (c) { this._s.delete(c); },
      contains: function (c) { return this._s.has(c); },
      toggle: function (c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); return this._s.has(c); },
    };
  }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  replaceChildren(...els) { this.children = [...els]; }
  prepend(el) { this.children.unshift(el); el.parentNode = this; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((f) => f(ev)); }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getContext() { return { drawImage() {}, fillRect() {} }; }
  getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; }
  focus() {}
  click() {}
  scrollIntoView() {}
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get isConnected() { return true; }
}

const storage = new Map();
const documentMock = {
  hidden: false,
  readyState: "complete",
  documentElement: new MockElement("html"),
  head: new MockElement("head"),
  body: new MockElement("body"),
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
  removeEventListener() {},
  dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((f) => f(ev)); },
  createElement: (tag) => new MockElement(tag),
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById() { return null; },
  hasFocus: () => true,
};

// ── in-memory bridge (mirrors content/bridge.js protocol) ──
// The runtime and "bridge" share a token exchange: bridge token is fixed,
// the runtime adopts it from core.ready.
const BRIDGE_TOKEN = "bridge-token";
// Full default tree mirroring the Rust core defaults (modules read deep
// fields like settings().chrome.compact_ui directly).
const DEFAULTS = {
  schema_version: 1, profile: "", privacy_shield: false, toasts: "normal",
  player: { speed_default: 1, speed_per_channel: false, loop_video: false, ab_loop_a: null, ab_loop_b: null, quality_pref: "hd1080", seek_step_sec: 10, keep_screen_awake: false, screenshot_format: "png", screenshot_scale: 1, screenshot_clipboard: false, sleep_timer_min: 30, auto_pause_hidden: false, auto_pause_blurred: false, resume_auto_paused: false, pause_background_tabs: false, confirm_leave_playing: false, auto_recover_video: false, skip_ads: false, default_original_audio: false, hfr_allow: false, restore_fs_scroll: false, theater_default: false, theater_wide: false, theater_wide_min_width: 1600, cinema_opacity: 0.85, ambient_blur_px: 24, ambient_opacity: 0.5, flip_h: false, flip_v: false, filter_brightness: 100, filter_contrast: 100, filter_saturation: 100, filter_hue_deg: 0, filter_grayscale: false, filter_zoom_pct: 100, top_progress_bar: false, remaining_badge: false, clock_badge: false, end_soon_warn: false, end_soon_sec: 20, force_watched_account: true, force_watched_local: true, idle_dim: false, idle_dim_delay_sec: 60, idle_dim_blur_px: 6 },
  captions: { enabled: false, lang: "", fallback_langs: ["en", "en-US", "en-GB"], kind_pref: "any", auto_translate: false, translate_to: "", skip_music: false, skip_shorts: false, respect_manual_off: false, reengage_after_ad: false, native_prefs: false, font_size_px: 28, font_family: "Roboto, Arial, sans-serif", font_weight: 700, text_color: "#ffffff", bg_color: "#000000", bg_opacity_pct: 72, text_shadow: "outline", line_height: 1.25, letter_spacing_em: 0, position: "bottom", radius_px: 4, uppercase: false },
  sponsorblock: { enabled: true, privacy: false, toasts: false, seekbar_marks: true, hud: true, category_actions: {}, hidden_videos: [] },
  history: { enabled: false, resume_mode: "silent", max_sessions_per_video: 50, history_capacity: 20000, track_clicks: false, watch_insights: false },
  feed: { channel_blocklist: "", hide_blocked_watch: false, hide_blocked_browse: false, hide_blocked_comments: false, keywords: "", watched_mode: "off", number_results: false, highlight_long: false, highlight_short: false, long_min_sec: 1200, short_max_sec: 60, hide_live: false, hide_premieres: false, hide_top_live_games: false, blur_thumbnails: false, blur_px: 12, disable_previews: false, dense_grid: false, remove_shorts: false, shorts_redirect: false, shorts_dom_clean: false, shorts_api_filter: false, hide_auto_dubbed: false, restore_original_audio: false },
  comments: { collapse_long: false, collapse_threshold_chars: 1200, highlight_creator: false, highlight_timestamps: false, search_bar: false },
  privacy: { geo_override: false, geo_region: "US", geo_lang: "en", geo_timezone: "", patch_fetch: false, patch_xhr: false, patch_beacon: false, patch_navigator: false, cookie_control: false, cookie_live: false, block_yt_ai: false },
  network: { monitor: false, badge: false, patch_fetch: true, patch_xhr: true, patch_beacon: true, track_qualities: false, budget_enabled: false, budget_gb: 50 },
  perf: { enabled: false, tier: "balanced", auto_enable: false, fps_counter: false, fps_pos: "tl", buffer_health: false, dropped_frames: false, dropped_pos: "tr", dropped_show_rate: false, dropped_reset_on_nav: true, long_task_warn: false, long_task_threshold_ms: 50, stats_overlay: false, profiler: false, diag_console: false },
  theme: { enabled: false, selected: "none", glass_overhaul: false, accent_hue: 215, focus_ring: false, sidebar_active: false, gen_color: "#ff3d7f" },
  discovery: { anti_rec: false, momentum: false, time_machine: false, time_machine_years: 1, small_creator: false, small_creator_max_subs: 10000, feed_size: 20, vibe_search: false, credibility: false, search_remix: false, outdated_detector: false, watch_genome: false, algo_intelligence: false, collections: false },
  intelligence: { scene_jumper: false, video_dna: false, smart_speed: false, smart_speed_base: 1, smart_speed_fast: 1.5, smart_queue: false },
  chrome: { player_dash_button: true, copy_timestamp_btn: false, copy_info_btn: false, transcript_btn: false, video_notes: false, channel_notes: false, chapter_hotkeys: false, chapter_buttons: false, chapter_panel: false, fwd_rewind_buttons: false, stop_button: false, flip_buttons: false, pip_button: false, logo_to_subs: false, default_channel_tab: "featured", auto_expand_desc: false, disable_autoplay: false, remove_redirects: false, shorten_share: false, dismiss_pause_dialog: false, reverse_playlist: false, playlist_autoscroll: false, compact_playlist: false, shorts_auto_mute: false, shorts_hide_comments: false, top_bar_hide: false, hide_banner_ads: false, compact_ui: false, hide_recs: false, hide_comments: false, hide_endscreen: false, hide_livechat: false, hide_watermark: false, hide_info_cards: false, always_progress_bar: false, hidden_elements: [] },
  budget: { enabled: false, session_minutes: 60, daily_minutes: 0 },
  signals: { dearrow: false, ryd: false, local_ai: false },
};
const bridgeCore = {
  "settings.validate": (p) => {
    const raw = JSON.parse(p.blob || "{}");
    // Deep-merge the stored blob over defaults (mirrors core behavior).
    const merged = structuredClone(DEFAULTS);
    const walk = (base, patch) => {
      for (const k of Object.keys(patch)) {
        if (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) walk(base[k], patch[k]);
        else base[k] = patch[k];
      }
    };
    walk(merged, raw);
    return { settings: merged, issues: [] };
  },
  "settings.defaults": () => structuredClone(DEFAULTS),
  "settings.normalize": (p) => JSON.parse(p.blob),
  "history.complete": (p) => ({ completed: false, record: p.record }),
  "history.resume": () => ({ show: false }),
  "scrub.run": (p) => ({ document: p.document, stats: { removed: 0 } }),
  "scrub.player_audio": () => ({ has_auto_dub: false, original_track_id: null }),
  "sponsor.segments": () => ({ video_id: "", segments: [] }),
  "sponsor.decision": () => ({ decision: { kind: "none" }, muted: false }),
  "discovery.rank": () => [],
  "network.budget": () => ({ state: "ok" }),
  "themes.generate": () => ({ palette: {}, css_vars: "" }),
  "themes.cssvars": () => ({ css: "" }),
};
function bridgeHandle(op, payload) {
  if (op === "core.call") {
    const fn = bridgeCore[payload.op];
    if (!fn) return { ok: false, error: { code: "UnknownOperation", message: payload.op } };
    try { return { ok: true, result: fn(payload.payload) }; }
    catch (err) { return { ok: false, error: { code: "CoreError", message: String(err) } }; }
  }
  if (op === "storage.get") return { ok: true, result: storage.get(payload.key) };
  if (op === "storage.set") { storage.set(payload.key, payload.value); return { ok: true, result: true }; }
  if (op === "storage.remove") { storage.delete(payload.key); return { ok: true, result: true }; }
  if (op === "core.ready") return { ok: true, result: { ready: true, token: BRIDGE_TOKEN } };
  if (op === "open.options") return { ok: true, result: true };
  return { ok: false, error: { code: "UnknownOperation", message: op } };
}

const windowMock = {
  document: documentMock,
  location: { href: "https://www.youtube.com/", pathname: "/", search: "", hostname: "www.youtube.com" },
  navigator: { onLine: true },
  performance: { now: () => Date.now() },
  postMessage(msg) {
    // The runtime posts requests; deliver them to the fake bridge, then
    // echo the response back through the runtime's own message listener.
    setTimeout(() => {
      const reply = bridgeHandle(msg.op, msg.payload);
      windowMock._emitMessage({ prism: 1, id: msg.id, token: BRIDGE_TOKEN, ok: reply.ok, result: reply.result, error: reply.error });
    }, 0);
  },
  __deliver(msg) {
    const p = windowMock.__pending && windowMock.__pending.get(msg.id);
    if (!p) return;
    windowMock.__pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error((msg.error && msg.error.message) || "bridge error"));
  },
  _msgListeners: [],
  addEventListener(type, fn, opts) { if (type === "message") this._msgListeners.push(fn); },
  removeEventListener() {},
  _emitMessage(msg) { this._msgListeners.forEach((fn) => fn({ data: msg })); },
  fetch: async () => new Response("{}", { status: 200 }),
  crypto: { randomUUID: () => "runtime-token" },
  requestIdleCallback: (fn) => setTimeout(fn, 0),
  setTimeout,
  clearTimeout,
  __PRISM__: null,
};
// The runtime's pending map lives in closure; deliver replies through the
// runtime's own message listener (captured above).
windowMock.__pending = new Map();
windowMock.__deliver = (msg) => windowMock._emitMessage(msg);

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log("  ok  " + name);
  else { console.error("FAIL " + name); failures++; }
};

const fn = new Function("window", "document", "self", "globalThis", "navigator", "performance", "location", "crypto", bundle);
try {
  fn(windowMock, documentMock, windowMock, windowMock, windowMock.navigator, windowMock.performance, windowMock.location, windowMock.crypto);
} catch (err) {
  console.error("bundle threw during load:", err);
  process.exit(1);
}

const Prism = windowMock.__PRISM__;
check("runtime exposed", !!Prism);
check("modules registered (>= 13)", Prism && Prism.modules.size >= 13);

// ── boot with the mocked bridge, then verify every module started ──
const run = async () => {
  await new Promise((r) => setTimeout(r, 250)); // let boot's bridge round-trips settle
  console.log("DEBUG pre-boot settings:", JSON.stringify(Prism.settings()));
  await Prism.boot().catch((err) => console.error("boot error:", err));
  await new Promise((r) => setTimeout(r, 250));
  console.log("DEBUG post-boot settings:", JSON.stringify(Prism.settings()));
  const health = Prism.health();
  const started = health.modules.filter((m) => m.state === "started").length;
  const failed = health.modules.filter((m) => m.state === "failed" || m.quarantined);
  check("modules started: " + started + "/" + health.modules.length, started === health.modules.length);
  failed.forEach((m) => console.error("  NOT STARTED: " + m.id + " (" + m.state + ")"));
  check("no module failed/quarantined", failed.length === 0);

  // Quarantine logic: a module that throws 3x should quarantine.
  Prism.registerModule({
    id: "test-flaky",
    deps: [],
    init() { throw new Error("boom"); },
  });
  await Prism.startModule("test-flaky").catch(() => {});
  await Prism.startModule("test-flaky").catch(() => {});
  await Prism.startModule("test-flaky").catch(() => {});
  check("flaky module quarantined", Prism.quarantined().includes("test-flaky"));
  check("health snapshot works", Array.isArray(health.modules));
  check("log ring has entries", health.log.length > 0);

  if (failures) { console.error(failures + " failures"); process.exit(1); }
  console.log("ALL ENGINE TESTS PASSED");
  // The mock keeps scheduler intervals alive; exit cleanly.
  process.exit(0);
};
run().catch((e) => { console.error(e); process.exit(1); });
