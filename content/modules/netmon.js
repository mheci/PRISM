// PRISM module: network monitor (data usage tracking + budget + badge).
// Buckets persisted in storage; aggregation and budget math in Rust core.
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  function hourOf(ts) {
    return Math.floor(ts / 3600000);
  }

  P.registerModule({
    id: "netmon",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._bucket = null; // current hour
      this._installed = false;
      this._badge = null;
      this._budgetAlerted = [];
    },
    async start(ctx) {
      const n = ctx.settings().network;
      if (!n.monitor || ctx.settings().privacy_shield) return;

      // Load persisted buckets + current bucket.
      const raw = await P.storage.get("netbuckets").catch(() => null);
      const buckets = (raw && raw.v) || [];
      this._bucket = { hour: hourOf(Date.now()), down: 0, up: 0, requests: 0, hosts: {}, qualities: {} };

      const flush = () => {
        if (!this._bucket || this._bucket.requests === 0) return;
        const idx = buckets.findIndex((b) => b.hour === this._bucket.hour);
        if (idx >= 0) buckets[idx] = this._bucket;
        else buckets.push(this._bucket);
        if (buckets.length > 24 * 370) buckets.splice(0, buckets.length - 24 * 370);
        P.storage.set("netbuckets", { v: buckets }).catch(() => {});
        this._bucket = { hour: hourOf(Date.now()), down: 0, up: 0, requests: 0, hosts: {}, qualities: {} };
      };

      const account = (down, up, host) => {
        if (!this._bucket) return;
        this._bucket.down += down || 0;
        this._bucket.up += up || 0;
        this._bucket.requests++;
        if (host) {
          const h = this._bucket.hosts[host] || [0, 0];
          h[0] += down || 0;
          h[1] += up || 0;
          this._bucket.hosts[host] = h;
        }
        this._renderBadge(ctx);
      };

      const isYT = (u) => {
        try {
          const h = new URL(u).hostname;
          return /(^|\.)(youtube\.com|ytimg\.com|googlevideo\.com|ggpht\.com|youtu\.be)$/.test(h);
        } catch (_) { return false; }
      };

      // ── instrumentation ──
      if (n.patch_fetch) {
        const realFetch = window.fetch.bind(window);
        window.fetch = async function (input, init) {
          const url = typeof input === "string" ? input : input && input.url ? input.url : "";
          let up = 0;
          if (init && init.body) {
            up = typeof init.body === "string" ? new Blob([init.body]).size : init.body.size || 0;
          }
          const res = await realFetch(input, init);
          if (isYT(url)) {
            // Header-only accounting: never buffer the body for size.
            let down = 0;
            const cl = res.headers && res.headers.get && res.headers.get("content-length");
            if (cl) down = parseInt(cl, 10) || 0;
            account(down, up, (() => { try { return new URL(url).hostname; } catch (_) { return ""; } })());
          }
          return res;
        };
      }
      if (n.patch_xhr) {
        const realOpen = XMLHttpRequest.prototype.open;
        const realSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          this._prismUrl = String(url || "");
          return realOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
          const url = this._prismUrl || "";
          let up = 0;
          if (body) up = typeof body === "string" ? new Blob([body]).size : body.size || 0;
          this.addEventListener("loadend", () => {
            if (!isYT(url)) return;
            let down = 0;
            const cl = this.getResponseHeader && this.getResponseHeader("content-length");
            if (cl) down = parseInt(cl, 10) || 0;
            // Header-only: don't touch this.response (avoids buffering).
            account(down, up, (() => { try { return new URL(url).hostname; } catch (_) { return ""; } })());
          });
          return realSend.apply(this, arguments);
        };
      }
      if (n.patch_beacon && navigator.sendBeacon) {
        const realBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
          if (isYT(url)) {
            let up = 0;
            if (data) up = typeof data === "string" ? new Blob([data]).size : data.size || 0;
            account(0, up, (() => { try { return new URL(url).hostname; } catch (_) { return ""; } })());
          }
          return realBeacon(url, data);
        };
      }

      // ── budget check (once per hour) ──
      const checkBudget = async () => {
        if (!ctx.settings().network.budget_enabled) return;
        const monthStart = hourOf(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime());
        let used = 0;
        for (const b of buckets) if (b.hour >= monthStart) used += (b.down || 0) + (b.up || 0);
        // Include the live (unflushed) bucket so the check never undercounts.
        if (this._bucket && this._bucket.hour >= monthStart) used += (this._bucket.down || 0) + (this._bucket.up || 0);
        const r = await ctx.core("network.budget", { used_bytes: used, budget_gb: ctx.settings().network.budget_gb }).catch(() => null);
        if (!r) return;
        const monthKey = new Date().toISOString().slice(0, 7);
        if (r.state === "exceeded" && !this._budgetAlerted.includes(monthKey + ":100")) {
          this._budgetAlerted.push(monthKey + ":100");
          this._toast("Monthly data budget EXCEEDED", "error");
        } else if (r.state === "critical" && !this._budgetAlerted.includes(monthKey + ":95")) {
          this._budgetAlerted.push(monthKey + ":95");
          this._toast("Data budget at 95%", "warn");
        } else if (r.state === "warn" && !this._budgetAlerted.includes(monthKey + ":80")) {
          this._budgetAlerted.push(monthKey + ":80");
          this._toast("Data budget at 80%", "warn");
        }
        if (this._budgetAlerted.length > 12) this._budgetAlerted.splice(0, this._budgetAlerted.length - 12);
      };

      // ── flush on hide + periodic budget ──
      ctx.on(document, "visibilitychange", () => { if (document.hidden) flush(); }, { passive: true });
      ctx.on(window, "pagehide", flush, { passive: true });
      ctx.timer.interval(flush, 60000);
      ctx.timer.interval(checkBudget, 3600000);

      this._renderBadge(ctx);
    },
    _renderBadge(ctx) {
      const n = ctx.settings().network;
      if (!n.badge) {
        if (this._badge) { this._badge.remove(); this._badge = null; }
        return;
      }
      if (!this._badge) {
        this._badge = document.createElement("div");
        this._badge.id = "prism-net-badge";
        this._badge.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:2147483636;background:rgba(14,16,22,.85);padding:3px 8px;border-radius:8px;font:600 10.5px system-ui;pointer-events:none";
        document.body.appendChild(this._badge);
      }
      const fmt = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : b >= 1e3 ? (b / 1e3).toFixed(0) + " KB" : b + " B";
      this._badge.innerHTML = '<span style="color:#4dd0e1">dn ' + fmt(this._bucket ? this._bucket.down : 0) + '</span><span style="color:#888;margin:0 4px">-</span><span style="color:#ff8a65">up ' + fmt(this._bucket ? this._bucket.up : 0) + "</span>";
    },
    _toast(msg, kind) {
      try {
        let el = document.getElementById("prism-toast");
        if (!el) {
          el = document.createElement("div");
          el.id = "prism-toast";
          el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(14,16,22,.94);color:#fff;padding:8px 16px;border-radius:99px;font:500 12.5px system-ui";
          document.body.appendChild(el);
        }
        el.style.border = "1px solid " + (kind === "error" ? "#ff5252" : kind === "warn" ? "#ffd166" : "rgba(255,255,255,.15)");
        el.textContent = msg;
        el.style.opacity = "1";
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = "0"; }, 3000);
      } catch (_) {}
    },
    stop() {
      if (this._badge) { this._badge.remove(); this._badge = null; }
    },
    health() {
      return { bucketRequests: this._bucket ? this._bucket.requests : 0 };
    },
  });
})();
