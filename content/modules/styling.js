// PRISM module: styling & appearance (CSS presets, filters, themes helpers).
// Owns: compact-ui, hide-* presets, always-progress-bar, dense grid, blur
// thumbnails, disable previews, video filters, flip, idle-dim, cinema,
// ambient, top progress bar, badges, end-soon.
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  const STYLE_ID = "prism-style-main";

  function inject(css) {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  function cssOf(s) {
    const p = s.player, f = s.feed, c = s.chrome;
    const rules = [];

    // ── CSS presets ──
    if (c.compact_ui) rules.push("html{--ytd-rich-grid-items-per-row:5!important}");
    if (c.hide_recs) rules.push("#secondary,#related,ytd-watch-next-secondary-results-renderer{display:none!important}#primary{max-width:100%!important}");
    if (c.hide_comments) rules.push("#comments,ytd-comments{display:none!important}");
    if (c.hide_endscreen) rules.push(".ytp-ce-element,.ytp-cards-teaser{display:none!important}");
    if (c.hide_livechat) rules.push("ytd-live-chat-frame{display:none!important}");
    if (c.hide_watermark) rules.push(".ytp-watermark{display:none!important}");
    if (c.hide_info_cards) rules.push(".ytp-cards-button,.ytp-cards-teaser-text{display:none!important}");
    if (c.hide_banner_ads) rules.push("ytd-ad-slot-renderer,ytd-banner-promo-renderer,ytd-promoted-sparkles-web-renderer,#masthead-ad,#player-ads,.ytp-ad-overlay-container,.ytp-ad-text-overlay,ytd-in-feed-ad-layout-renderer{display:none!important}");
    if (c.always_progress_bar) rules.push(".ytp-autohide .ytp-chrome-bottom{opacity:1!important;visibility:visible!important;pointer-events:auto!important;bottom:0!important}.ytp-autohide .ytp-progress-bar-container{opacity:1!important;visibility:visible!important;bottom:0!important}");
    if (c.top_bar_hide) rules.push("ytd-masthead,#masthead,#masthead-container,ytd-topbar,#topbar,#topbar-container{display:none!important}ytd-page-manager{--ytd-masthead-height:0px;margin-top:0!important}");

    // ── feed layout ──
    if (f.dense_grid) rules.push("ytd-rich-grid-renderer{--ytd-rich-grid-items-per-row:5!important;--ytd-rich-grid-posts-per-row:5!important}ytd-rich-item-renderer{margin-bottom:14px!important}");
    if (f.blur_thumbnails) {
      const px = f.blur_px || 12;
      rules.push(`ytd-rich-item-renderer #thumbnail yt-image img,ytd-thumbnail img{filter:blur(${px}px)!important;transition:filter .25s ease-out}ytd-rich-item-renderer:hover #thumbnail yt-image img,ytd-thumbnail:hover img{filter:blur(0)!important}`);
    }
    if (f.disable_previews) rules.push("ytd-moving-thumbnail-renderer,ytd-video-preview,ytd-thumbnail-overlay-loading-preview-renderer{display:none!important;visibility:hidden!important}");

    // ── video filters / flip ──
    if (p.filter_brightness !== 100 || p.filter_contrast !== 100 || p.filter_saturation !== 100 || p.filter_hue_deg !== 0 || p.filter_grayscale) {
      const t = `brightness(${p.filter_brightness}%) contrast(${p.filter_contrast}%) saturate(${p.filter_saturation}%) hue-rotate(${p.filter_hue_deg}deg)${p.filter_grayscale ? " grayscale(1)" : ""}`;
      rules.push(`video.html5-main-video,#movie_player video{filter:${t}!important}`);
    }
    if (p.flip_h || p.flip_v) {
      const t = `scale(${p.flip_h ? -1 : 1},${p.flip_v ? -1 : 1})`;
      rules.push(`video.html5-main-video{transform:${t}!important}`);
    }

    // ── restore fullscreen scroll ──
    if (p.restore_fs_scroll) rules.push(".html5-video-player:fullscreen{overflow:auto!important}");

    // ── comments tweaks ──
    const cm = s.comments;
    if (cm.highlight_creator) rules.push("ytd-comment-renderer:has(ytd-author-comment-badge-renderer){box-shadow:inset 3px 0 0 #3ea6ff!important;background:rgba(62,166,255,.08)!important}");
    if (cm.highlight_timestamps) rules.push("a[href*='t='],a[href*='start=']{background:rgba(62,166,255,.14)!important;border-radius:4px!important;padding:0 3px!important;font-weight:700!important}");

    // ── block YouTube AI ──
    if (s.privacy.block_yt_ai) rules.push("ytd-ai-summary-renderer,ytd-conversation-ai-renderer,yt-ai-summary,yt-ai-button,ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-video-summary']{display:none!important;visibility:hidden!important}");

    // ── hide shorts (CSS layer) ──
    if (f.remove_shorts) rules.push("ytd-rich-shelf-renderer[is-shorts],ytd-reel-shelf-renderer{display:none!important}");

    return rules.join("\n");
  }

  // Floating widgets: cinema spotlight, ambient canvas, top bar, badges.
  let widgets = [];
  function rebuildWidgets(ctx) {
    widgets.forEach((w) => w.remove());
    widgets = [];
    const s = ctx.settings();
    const body = document.body;
    if (!body) return;

    const mk = (id, cssText) => {
      const el = document.createElement("div");
      el.id = id;
      el.style.cssText = cssText;
      body.appendChild(el);
      widgets.push(el);
      return el;
    };

    if (s.player.cinema_opacity > 0) {
      const spot = mk("prism-cinema", "position:fixed;z-index:1300;pointer-events:none;display:none");
      const upd = () => {
        const player = document.querySelector("#movie_player");
        if (!player) return;
        const r = player.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const op = Math.max(0.05, Math.min(0.95, Number(s.player.cinema_opacity) || 0.85));
        spot.style.cssText = `position:fixed;z-index:1300;pointer-events:none;display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;box-shadow:0 0 0 9999px rgba(0,0,0,${op})`;
      };
      upd();
      ctx.timer.interval(upd, 250);
    }

    if (s.player.top_progress_bar) {
      const bar = mk("prism-topbar", "position:fixed;top:0;left:0;height:3px;width:0;background:#ff3d7f;z-index:2147483647;pointer-events:none;transition:width .1s linear");
      let last = -1;
      const upd = () => {
        const v = document.querySelector("video.html5-main-video, #movie_player video");
        if (!v || !v.duration) return;
        const pct = Math.min(100, (v.currentTime / v.duration) * 100);
        if (Math.abs(pct - last) > 0.1) {
          last = pct;
          bar.style.width = pct.toFixed(1) + "%";
        }
      };
      const v = document.querySelector("video.html5-main-video, #movie_player video");
      if (v) {
        ctx.on(v, "timeupdate", upd, { passive: true });
        ctx.on(v, "seeked", upd, { passive: true });
      }
      ctx.timer.interval(upd, 250);
    }

    if (s.player.remaining_badge) {
      const b = mk("prism-remain", "position:fixed;top:12px;right:12px;background:rgba(14,16,22,.8);color:#fff;padding:3px 8px;border-radius:8px;font:600 12px system-ui;z-index:2147483640;pointer-events:none");
      let last = -1;
      const upd = () => {
        const v = document.querySelector("video.html5-main-video, #movie_player video");
        if (!v || !v.duration) return;
        const rem = Math.floor(v.duration - v.currentTime);
        if (rem !== last) {
          last = rem;
          b.textContent = "\u2212" + fmtTime(rem);
        }
      };
      ctx.timer.interval(upd, 500);
    }

    if (s.player.clock_badge) {
      const b = mk("prism-clock", "position:fixed;top:48px;right:12px;background:rgba(14,16,22,.8);color:#9ff;padding:3px 8px;border-radius:8px;font:600 12px system-ui;z-index:2147483640;pointer-events:none");
      let last = -1;
      const upd = () => {
        const m = new Date().getMinutes();
        if (m !== last) {
          last = m;
          b.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
      };
      ctx.timer.interval(upd, 15000);
    }

    if (s.player.end_soon_warn) {
      const b = mk("prism-endsoon", "position:fixed;bottom:90px;right:12px;background:rgba(255,152,0,.16);color:#ffb74d;padding:3px 8px;border-radius:8px;font:600 12px system-ui;z-index:2147483640;pointer-events:none;display:none");
      let shown = false;
      const upd = () => {
        const v = document.querySelector("video.html5-main-video, #movie_player video");
        if (!v || !v.duration) { if (shown) { b.style.display = "none"; shown = false; } return; }
        const rem = Math.floor(v.duration - v.currentTime);
        const warn = rem > 0 && rem <= (s.player.end_soon_sec || 20);
        if (warn) b.textContent = "Ending in " + fmtTime(rem);
        if (warn !== shown) { b.style.display = warn ? "block" : "none"; shown = warn; }
      };
      ctx.timer.interval(upd, 500);
    }

    if (s.player.ambient_opacity > 0) {
      const canvas = mk("prism-ambient", "position:fixed;z-index:1995;pointer-events:none;width:calc(100% + 100px);height:calc(100% + 100px);top:-50px;left:-50px;object-fit:cover;filter:blur(" + (s.player.ambient_blur_px || 24) + "px);opacity:" + s.player.ambient_opacity);
      canvas.tagName = "canvas";
      canvas.width = 48;
      canvas.height = 27;
      const g = canvas.getContext("2d");
      let last = 0;
      ctx.timer.interval(() => {
        const v = document.querySelector("video.html5-main-video, #movie_player video");
        if (!v || v.paused || v.readyState < 2) return;
        const now = performance.now();
        if (now - last < 200) return;
        last = now;
        try { g.drawImage(v, 0, 0, 48, 27); } catch (_) {}
      }, 250);
    }
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
  }

  // ── idle dim ──
  function startIdleDim(ctx) {
    const s = ctx.settings();
    if (!s.player.idle_dim) return;
    const delay = (s.player.idle_dim_delay_sec || 60) * 1000;
    const blur = Math.max(1, Math.min(20, s.player.idle_dim_blur_px || 6));
    let style = null;
    let t = null;
    const clear = () => {
      if (style) { style.remove(); style = null; }
      if (t) { clearTimeout(t); t = null; }
    };
    const arm = () => {
      clear();
      t = setTimeout(() => {
        style = document.createElement("style");
        style.textContent = `video.html5-main-video,#movie_player video{filter:blur(${blur}px)!important;transition:filter 1s}`;
        (document.head || document.documentElement).appendChild(style);
      }, delay);
    };
    for (const ev of ["mousemove", "keydown", "click", "touchstart"]) {
      ctx.on(document, ev, arm, { passive: true });
    }
    arm();
    return clear;
  }

  P.registerModule({
    id: "styling",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._idleStop = null;
    },
    async start(ctx) {
      const apply = () => {
        const css = cssOf(ctx.settings());
        inject(css);
        rebuildWidgets(ctx);
        if (this._idleStop) { this._idleStop(); this._idleStop = null; }
        if (ctx.settings().player.idle_dim) this._idleStop = startIdleDim(ctx);
      };
      apply();
      // Re-apply when settings change: the runtime re-starts modules on
      // setting writes through the dashboard; also react to our own flag.
      this._stopNav = ctx.on(document, "yt-navigate-finish", () => {
        ctx.timer.timeout(apply, 300);
      }, { passive: true });
    },
    stop() {
      const el = document.getElementById(STYLE_ID);
      if (el) el.remove();
      this._ctx && this._ctx.settings;
      if (this._idleStop) { this._idleStop(); this._idleStop = null; }
      if (this._stopNav) this._stopNav();
      if (window.__prismWidgets) window.__prismWidgets.forEach((w) => w.remove());
    },
    health() {
      return { styleInjected: !!document.getElementById(STYLE_ID) };
    },
  });
})();
