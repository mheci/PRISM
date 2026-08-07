// Engine bundle unit tests: runs content/runtime.js + modules against a
// minimal DOM mock, verifies module registration, lifecycle, quarantine
// and the bridge protocol.
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
  }
  appendChild(el) { this.children.push(el); return el; }
  remove() { this.parentNode && (this.parentNode.children = this.parentNode.children.filter((c) => c !== this)); }
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
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get isConnected() { return true; }
}

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
};

const windowMock = {
  document: documentMock,
  location: { href: "https://www.youtube.com/", pathname: "/", search: "", hostname: "www.youtube.com" },
  navigator: { onLine: true },
  performance: { now: () => Date.now() },
  postMessage() {},
  addEventListener() {},
  removeEventListener() {},
  fetch: async () => new Response("{}", { status: 200 }),
  crypto: { randomUUID: () => "test-uuid" },
  requestIdleCallback: (fn) => setTimeout(fn, 0),
  setTimeout,
  clearTimeout,
  __PRISM__: null,
};

const ctx = { window: windowMock, document: documentMock, console, globalThis: windowMock };

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log("  ok  " + name);
  else { console.error("FAIL " + name); failures++; }
};

// Run the bundle inside the mock world.
const fn = new Function("window", "document", "self", "globalThis", "navigator", "performance", "location", "crypto", bundle);
try {
  fn(windowMock, documentMock, windowMock, windowMock, windowMock.navigator, windowMock.performance, windowMock.location, windowMock.crypto);
} catch (err) {
  console.error("bundle threw during load:", err);
  process.exit(1);
}

const Prism = windowMock.__PRISM__;
check("runtime exposed", !!Prism);
check("modules registered (>= 9)", Prism && Prism.modules.size >= 9);

const ids = [...Prism.modules.keys()];
check("styling module", ids.includes("styling"));
check("player module", ids.includes("player"));
check("captions module", ids.includes("captions"));
check("feed module", ids.includes("feed"));
check("history module", ids.includes("history"));
check("chrome module", ids.includes("chrome"));
check("sponsorblock module", ids.includes("sponsorblock"));
check("discovery module", ids.includes("discovery"));
check("netmon module", ids.includes("netmon"));
check("signals module", ids.includes("signals"));
check("perf module", ids.includes("perf"));
check("budget module", ids.includes("budget"));
check("theme module", ids.includes("theme"));

// Quarantine logic: a module that throws 3x should quarantine.
const thrown = [];
Prism.registerModule({
  id: "test-flaky",
  deps: [],
  init() { throw new Error("boom"); },
});
Prism.startModule("test-flaky");
Prism.startModule("test-flaky");
Prism.startModule("test-flaky").then(() => {
  check("flaky module quarantined", Prism.quarantined().includes("test-flaky"));
  check("health snapshot works", Array.isArray(Prism.health().modules));
  check("log ring has entries", Prism.health().log.length > 0);
  if (failures) { console.error(failures + " failures"); process.exit(1); }
  console.log("ALL ENGINE TESTS PASSED");
}).catch((e) => { console.error(e); process.exit(1); });
