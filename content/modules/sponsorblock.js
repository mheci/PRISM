// PRISM module: SponsorBlock (segment fetch, decision loop via Rust core,
// seekbar marks, HUD, submission editor).
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  function videoId() {
    return new URLSearchParams(location.search).get("v") || null;
  }
  function videoEl() {
    return document.querySelector("video.html5-main-video, #movie_player video") || null;
  }

  const CATEGORIES = [
    ["sponsor", "#00d400"], ["selfpromo", "#ffff00"], ["interaction", "#cc00ff"],
    ["intro", "#00ffff"], ["outro", "#0202ed"], ["preview", "#008fd6"],
    ["hook", "#ff6f00"], ["filler", "#7300ab"], ["music_offtopic", "#ff9900"],
    ["poi_highlight", "#ff1684"], ["exclusive_access", "#008a5c"], ["chapter", "#ffffff"],
  ];

  async function fetchSegments(videoId, privacy) {
    const url = "https://sponsor.ajay.app/api/skipSegments?videoID=" + encodeURIComponent(videoId);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  }

  P.registerModule({
    id: "sponsorblock",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._set = null;
      this._marks = null;
      this._lastSeek = null;
      this._hud = null;
    },
    async start(ctx) {
      const s = ctx.settings().sponsorblock;
      if (!s.enabled) return;

      const load = async () => {
        const vid = videoId();
        if (!vid) return;
        if (s.hidden_videos && s.hidden_videos.includes(vid)) { this._set = null; this._renderMarks(ctx, null); return; }
        try {
          const raw = await fetchSegments(vid, s.privacy);
          const r = await ctx.core("sponsor.segments", { video_id: vid, payload: raw });
          this._set = r || null;
        } catch (err) {
          ctx.log("warn", "segment fetch failed: " + String(err && err.message || err));
          this._set = null;
        }
        this._renderMarks(ctx, this._set);
        this._renderHud(ctx, this._set);
      };

      const actions = () => {
        const map = s.category_actions || {};
        return CATEGORIES.map(([cat]) => {
          const a = map[cat] || "default";
          return { category: cat, action: a };
        }).filter((x) => x.action !== "off");
      };

      // Decision loop.
      ctx.timer.interval(async () => {
        const v = videoEl();
        if (!v || !this._set) return;
        if (v.paused) return;
        const decision = await ctx.core("sponsor.decision", {
          video_id: this._set.video_id,
          segments: this._set.segments,
          position: v.currentTime,
          last_seek: this._lastSeek,
          draft: false,
          actions: actions(),
        }).catch(() => null);
        if (!decision) return;
        if (decision.decision.kind === "skip") {
          v.currentTime = decision.decision.to;
          if (s.toasts) this._toast("Skipped sponsor segment", "info");
          if (this._set) this._set.saved_seconds = (this._set.saved_seconds || 0) + 1;
        } else if (decision.decision.kind === "mute") {
          v.muted = true;
          ctx.timer.timeout(() => { if (videoEl()) videoEl().muted = false; }, Math.max(0, decision.decision.until - v.currentTime) * 1000);
        }
      }, 500);

      // Track user seeks to feed the grace window.
      ctx.on(videoEl() || document, "seeking", () => {
        this._lastSeek = performance.now() / 1000;
      }, { passive: true });

      ctx.on(document, "yt-navigate-finish", () => {
        this._set = null;
        this._lastSeek = null;
        ctx.timer.timeout(load, 1000);
      }, { passive: true });

      load();
      ctx.timer.interval(load, 600000); // re-validate every 10 min
    },
    _renderMarks(ctx, set) {
      if (this._marks) { this._marks.remove(); this._marks = null; }
      if (!set || !set.segments || !set.segments.length) return;
      const container = document.querySelector(".ytp-progress-bar-container");
      if (!container) return;
      const strip = document.createElement("div");
      strip.style.cssText = "position:absolute;left:0;right:0;bottom:100%;height:4px;pointer-events:none;z-index:5";
      const dur = (videoEl() && videoEl().duration) || 1;
      set.segments.forEach((seg) => {
        const mk = document.createElement("div");
        const color = (CATEGORIES.find(([c]) => c === seg.category) || [null, "#888"])[1];
        mk.style.cssText = "position:absolute;top:0;bottom:0;background:" + color + ";opacity:.8";
        mk.style.left = (seg.start / dur * 100) + "%";
        mk.style.width = Math.max(0.3, ((seg.end - seg.start) / dur) * 100) + "%";
        strip.appendChild(mk);
      });
      container.appendChild(strip);
      this._marks = strip;
    },
    _renderHud(ctx, set) {
      if (this._hud) { this._hud.remove(); this._hud = null; }
      const s = ctx.settings().sponsorblock;
      if (!s.hud) return;
      if (!set || !set.segments) return;
      const n = set.segments.length;
      const saved = Math.round(set.saved_seconds || 0);
      this._hud = document.createElement("div");
      this._hud.style.cssText = "position:fixed;bottom:64px;right:14px;z-index:2147483000;background:rgba(14,16,22,.9);border:1px solid rgba(255,255,255,.12);color:#fff;padding:5px 10px;border-radius:99px;font:600 11px system-ui;pointer-events:none";
      this._hud.textContent = "SB: " + n + " segs | " + saved + "s saved";
      document.body.appendChild(this._hud);
    },
    _toast(msg, kind) {
      try {
        let el = document.getElementById("prism-toast");
        if (!el) {
          el = document.createElement("div");
          el.id = "prism-toast";
          el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(14,16,22,.94);color:#fff;padding:8px 16px;border-radius:99px;font:500 12.5px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4)";
          document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = "1";
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = "0"; }, 1600);
      } catch (_) {}
    },
    stop() {
      if (this._marks) { this._marks.remove(); this._marks = null; }
      if (this._hud) { this._hud.remove(); this._hud = null; }
    },
    health() {
      return { segments: this._set ? this._set.segments.length : 0 };
    },
  });
})();
