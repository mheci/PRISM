// PRISM module: theme engine (Rust-generated palettes + CSS vars) and time
// budget + external signals (DeArrow, RYD) + screenshot + perf overlays.
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  const THEME_STYLE_ID = "prism-theme-style";

  P.registerModule({
    id: "theme",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
    },
    async start(ctx) {
      const t = ctx.settings().theme;
      if (!t.enabled || t.selected === "none") {
        this._removeTheme();
        return;
      }
      // Rust core owns the palette math: parse the stored theme entry.
      const raw = await P.storage.get("themes").catch(() => null);
      const themes = (raw && raw.v) || [];
      const entry = themes.find((x) => x.id === t.selected);
      if (!entry) { this._removeTheme(); return; }

      let css = "";
      if (entry.palette) {
        const r = await ctx.core("themes.cssvars", { palette: entry.palette }).catch(() => null);
        css = r && r.css || "";
      }
      // Mode enforcement + vars.
      const dark = entry.mode === "dark";
      const root = document.documentElement;
      if (dark) { root.setAttribute("dark", ""); root.removeAttribute("light"); }
      else { root.setAttribute("light", ""); root.removeAttribute("dark"); }
      try { root.style.colorScheme = dark ? "dark" : "light"; } catch (_) {}
      try {
        if (window.ytcfg && window.ytcfg.set) window.ytcfg.set("BACKGROUND_COLOR", dark ? "#0f0f0f" : "#ffffff");
      } catch (_) {}

      let el = document.getElementById(THEME_STYLE_ID);
      if (!el) {
        el = document.createElement("style");
        el.id = THEME_STYLE_ID;
        (document.head || document.documentElement).appendChild(el);
      }
      const hue = t.accent_hue || 215;
      const accent = entry.palette ? entry.palette.call_to_action : "#3ea6ff";
      el.textContent =
        "html,html[dark],ytd-app{--prism-base:" + (entry.palette ? entry.palette.base_background : "#0f0f0f") + "}" +
        css;
      this._guard = new MutationObserver(() => {
        const el2 = document.getElementById(THEME_STYLE_ID);
        if (!el2 && el.isConnected === false) {
          (document.head || document.documentElement).appendChild(el);
        }
      });
      this._guard.observe(document.head || document.documentElement, { childList: true });
    },
    _removeTheme() {
      const el = document.getElementById(THEME_STYLE_ID);
      if (el) el.remove();
      if (this._guard) { this._guard.disconnect(); this._guard = null; }
    },
    stop() {
      this._removeTheme();
    },
    health() {
      return { active: !!document.getElementById(THEME_STYLE_ID) };
    },
  });

  // ── time budget ──
  P.registerModule({
    id: "budget",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._day = new Date().toISOString().slice(0, 10);
      this._used = 0;
      this._lastPos = 0;
    },
    async start(ctx) {
      const b = ctx.settings().budget;
      if (!b.enabled) return;
      const raw = await P.storage.get("budget").catch(() => null);
      const data = (raw && raw.v) || {};
      if (data.day !== this._day) { data.day = this._day; data.used = 0; }
      this._used = data.used || 0;

      ctx.timer.interval(() => {
        const v = document.querySelector("video.html5-main-video, #movie_player video");
        if (!v || v.paused) return;
        const now = v.currentTime;
        if (this._lastPos > 0 && now > this._lastPos) {
          this._used += now - this._lastPos;
          data.used = this._used;
          P.storage.set("budget", { v: data }).catch(() => {});
          this._render(ctx);
        }
        this._lastPos = now;
      }, 5000);
    },
    _render(ctx) {
      const b = ctx.settings().budget;
      if (!b.enabled || !b.session_minutes) { if (this._bar) { this._bar.remove(); this._bar = null; } return; }
      if (!this._bar) {
        this._bar = document.createElement("div");
        this._bar.id = "prism-budget";
        this._bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;height:30px;z-index:2147483634;background:rgba(14,16,22,.94);border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:12px;padding:0 16px;font:11px system-ui;color:#ccc";
        document.body.appendChild(this._bar);
      }
      const limit = (b.session_minutes || 60) * 60;
      const pct = Math.min(100, (this._used / limit) * 100);
      this._bar.innerHTML =
        '<span style="font-weight:700;color:#fff">Time budget</span>' +
        '<div style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + (pct >= 85 ? "#ff5252" : "#ff3d7f") + '"></div></div>' +
        '<span>' + fmtTime(this._used) + " / " + fmtTime(limit) + "</span>";
    },
    stop() {
      if (this._bar) { this._bar.remove(); this._bar = null; }
    },
    health() {
      return { usedSec: this._used };
    },
  });

  // ── external signals: DeArrow + RYD + screenshot ──
  P.registerModule({
    id: "signals",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._dearrowCache = new Map();
    },
    async start(ctx) {
      const sg = ctx.settings().signals;
      if (sg.dearrow) {
        const vid = () => new URLSearchParams(location.search).get("v");
        const applyTitle = () => {
          const id = vid();
          if (!id || !location.pathname.startsWith("/watch")) return;
          if (document.getElementById("prism-dearrow-chip")) return;
          const titleEl = document.querySelector("#title h1");
          if (!titleEl) return;
          const original = titleEl.textContent;
          fetch("https://sponsor.ajay.app/api/brandedTitle?videoID=" + encodeURIComponent(id)).then((r) => r.json()).then((data) => {
            if (!data || !data.title || String(data.title).trim() === String(original).trim()) return;
            if (this._dearrowCache.has(id)) return;
            if (this._dearrowCache.size >= 200) {
              const oldest = this._dearrowCache.keys().next().value;
              if (oldest !== undefined) this._dearrowCache.delete(oldest);
            }
            this._dearrowCache.set(id, data.title);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.id = "prism-dearrow-chip";
            chip.textContent = "DeArrow title";
            chip.style.cssText = "margin-left:8px;padding:2px 8px;border-radius:99px;background:rgba(111,168,220,.14);border:1px solid rgba(111,168,220,.4);color:#8ab4e8;font:600 10.5px system-ui;cursor:pointer;vertical-align:middle";
            let swapped = false;
            chip.addEventListener("click", () => {
              swapped = !swapped;
              titleEl.textContent = swapped ? data.title : original;
              chip.textContent = swapped ? "Original title" : "DeArrow title";
            });
            (titleEl.closest("#title") || titleEl.parentElement).appendChild(chip);
          }).catch(() => {});
        };
        applyTitle();
        ctx.on(document, "yt-navigate-finish", () => ctx.timer.timeout(applyTitle, 800), { passive: true });
      }

      if (sg.ryd) {
        const applyRyd = () => {
          const id = () => new URLSearchParams(location.search).get("v");
          const vid = id();
          if (!vid || !location.pathname.startsWith("/watch")) return;
          if (document.getElementById("prism-ryd")) return;
          fetch("https://returnyoutubedislikeapi.com/votes?videoId=" + encodeURIComponent(vid)).then((r) => r.json()).then((d) => {
            if (!d || typeof d.likes !== "number" || typeof d.dislikes !== "number") return;
            const total = d.likes + d.dislikes;
            if (!total) return;
            const pct = Math.round((d.likes / total) * 100);
            const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n);
            const box = document.createElement("div");
            box.id = "prism-ryd";
            box.style.cssText = "display:flex;flex-direction:column;gap:2px;margin:6px 0;max-width:340px;cursor:default";
            box.innerHTML =
              '<div style="height:4px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden;display:flex"><div style="background:#3ea6ff;height:100%;width:' + pct + '%"></div><div style="background:#ff5252;height:100%;flex:1"></div></div>' +
              '<div style="font:600 10.5px system-ui;color:#aaa;display:flex;justify-content:space-between"><span style="color:#3ea6ff">' + pct + '% like</span><span>' + fmt(d.likes) + " vs " + fmt(d.dislikes) + "</span></div>";
            const seg = document.querySelector("ytd-segmented-like-dislike-button-renderer, like-button-view-model");
            if (seg && seg.parentElement) seg.parentElement.insertBefore(box, seg.nextSibling);
            else document.querySelector("#below") && document.querySelector("#below").appendChild(box);
          }).catch(() => {});
        };
        applyRyd();
        ctx.on(document, "yt-navigate-finish", () => ctx.timer.timeout(applyRyd, 900), { passive: true });
      }

      // Screenshot: X hotkey.
      ctx.on(document, "keydown", (e) => {
        if (e.key !== "x" && e.key !== "X") return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        const v = document.querySelector("video.html5-main-video, #movie_player video");
        if (!v || !v.videoWidth) { this._toast("No video", "error"); return; }
        const scale = Math.max(0.25, Math.min(4, Number(ctx.settings().player.screenshot_scale) || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        const g = canvas.getContext("2d");
        g.drawImage(v, 0, 0, canvas.width, canvas.height);
        const jpg = ctx.settings().player.screenshot_format === "jpeg";
        const mime = jpg ? "image/jpeg" : "image/png";
        const name = "prism-" + new Date().toISOString().slice(0, 19).replace(/:/g, "-") + "." + (jpg ? "jpg" : "png");
        if (ctx.settings().player.screenshot_clipboard && navigator.clipboard && window.ClipboardItem) {
          canvas.toBlob((blob) => {
            navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]).then(
              () => this._toast("Screenshot copied to clipboard", "success"),
              () => { this._download(canvas, mime, name); }
            );
          }, mime, 0.95);
        } else {
          this._download(canvas, mime, name);
          this._toast("Saved " + canvas.width + "x" + canvas.height, "success");
        }
      });
    },
    _download(canvas, mime, name) {
      const a = document.createElement("a");
      a.href = canvas.toDataURL(mime, 0.95);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
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
        el.style.border = "1px solid " + (kind === "error" ? "#ff5252" : kind === "success" ? "#4caf50" : "rgba(255,255,255,.15)");
        el.textContent = msg;
        el.style.opacity = "1";
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = "0"; }, 1600);
      } catch (_) {}
    },
    stop() {
      const chip = document.getElementById("prism-dearrow-chip");
      if (chip) chip.remove();
      const ryd = document.getElementById("prism-ryd");
      if (ryd) ryd.remove();
    },
    health() {
      return { dearrowCached: this._dearrowCache.size };
    },
  });

  // ── perf overlays (FPS, buffer, dropped frames, stats) ──
  P.registerModule({
    id: "perf",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._els = [];
    },
    async start(ctx) {
      const p = ctx.settings().perf;

      if (p.fps_counter) {
        const box = this._mk("prism-fps", p.fps_pos);
        let frames = 0, t0 = performance.now(), rafId = 0;
        const loop = () => {
          if (!this._ctx.settings().perf.fps_counter) return;
          frames++;
          const now = performance.now();
          const dt = now - t0;
          if (dt >= 500) {
            const fps = Math.round(frames * 1000 / dt);
            const v = document.querySelector("video.html5-main-video");
            const state = !v ? "—" : v.paused ? "paused" : v.ended ? "ended" : "playing";
            box.textContent = fps + " fps (" + state + ")";
            box.style.color = fps < 24 ? "#ff5252" : fps < 50 ? "#ffd166" : "#4caf50";
            frames = 0; t0 = now;
          }
          if (document.hidden) rafId = setTimeout(loop, 250);
          else rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        this._rafId = rafId;
      }

      if (p.buffer_health) {
        const box = this._mk("prism-buf", "bl");
        let rebuffers = 0;
        ctx.timer.interval(() => {
          const v = document.querySelector("video.html5-main-video, #movie_player video");
          if (!v) { box.textContent = "Buffer: —"; return; }
          let buf = 0;
          try {
            for (let i = 0; i < v.buffered.length; i++) {
              if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
                buf = v.buffered.end(i) - v.currentTime;
                break;
              }
            }
          } catch (_) {}
          const state = v.paused ? "paused" : v.ended ? "ended" : v.readyState < 3 ? "loading" : "playing";
          const color = buf < 2 ? "#ff5252" : buf < 6 ? "#ffd166" : "#4caf50";
          box.style.color = color;
          box.textContent = "Buffer: " + buf.toFixed(1) + "s | Rebuffers: " + rebuffers + " | " + state;
        }, 750);
        ctx.on(videoEl() || document, "waiting", () => { rebuffers++; }, { passive: true });
      }

      if (p.dropped_frames) {
        const box = this._mk("prism-drop", p.dropped_pos);
        let lastTotal = 0, lastT = performance.now();
        ctx.timer.interval(() => {
          const v = document.querySelector("video.html5-main-video");
          if (!v || typeof v.getVideoPlaybackQuality !== "function") { box.textContent = "dropped: —"; return; }
          const total = v.getVideoPlaybackQuality().droppedVideoFrames || 0;
          const now = performance.now();
          const dt = (now - lastT) / 1000;
          const rate = dt > 0 ? (total - lastTotal) / dt : 0;
          lastTotal = total; lastT = now;
          box.style.color = total > 60 ? "#ff5252" : total > 15 ? "#ffd166" : "#9ff";
          box.textContent = p.dropped_show_rate ? "dropped: " + rate.toFixed(1) + "/s (total " + total + ")" : "dropped: " + total;
        }, 1000);
      }

      if (p.stats_overlay) {
        const box = this._mk("prism-stats", "tr");
        ctx.timer.interval(() => {
          const v = document.querySelector("video.html5-main-video");
          if (!v) return;
          let buf = 0;
          try { if (v.buffered.length) buf = v.buffered.end(v.buffered.length - 1) - v.currentTime; } catch (_) {}
          box.textContent = "t=" + v.currentTime.toFixed(1) + "s - rate=" + v.playbackRate + "x - buf=" + buf.toFixed(1) + "s";
        }, 500);
      }
    },
    _mk(id, pos) {
      const el = document.createElement("div");
      el.id = id;
      const corners = { tl: "top:8px;left:8px", tr: "top:8px;right:8px", bl: "bottom:48px;left:8px", br: "bottom:48px;right:8px" };
      el.style.cssText = "position:fixed;" + (corners[pos] || corners.tr) + ";z-index:2147483635;background:rgba(20,22,28,.78);padding:3px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.15);font:600 11px monospace;pointer-events:none;min-width:54px";
      document.body.appendChild(el);
      this._els.push(el);
      return el;
    },
    stop() {
      if (this._rafId) {
        try { cancelAnimationFrame(this._rafId); } catch (_) {}
        clearTimeout(this._rafId);
        this._rafId = null;
      }
      this._els.forEach((e) => e.remove());
      this._els = [];
    },
    health() {
      return { overlays: this._els.length };
    },
  });

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
  }
})();
