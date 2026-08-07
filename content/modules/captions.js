// PRISM module: captions (force CC with track selection + styling).
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  function playerApi() {
    return document.querySelector("#movie_player") || null;
  }
  function videoId() {
    return new URLSearchParams(location.search).get("v") || null;
  }
  function isMusic() {
    return /music\.youtube\.com$/i.test(location.hostname);
  }
  function isShorts() {
    return location.pathname.startsWith("/shorts/");
  }

  function buildCaptionCSS(s) {
    const c = s.captions;
    const pos = {
      bottom: ".ytp-caption-window-container{bottom:0!important;top:auto!important;left:0!important;right:0!important}",
      middle: ".ytp-caption-window-container{top:50%!important;bottom:auto!important}",
      top: ".ytp-caption-window-container{top:2%!important;bottom:auto!important}",
      left: ".ytp-caption-window-container{left:4px!important;right:auto!important;bottom:10%!important;top:auto!important}",
      right: ".ytp-caption-window-container{right:4px!important;left:auto!important;bottom:10%!important;top:auto!important}",
    }[c.position] || "";
    const color = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.text_color) ? c.text_color : "#ffffff";
    const bg = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.bg_color) ? c.bg_color : "#000000";
    const shadow = {
      none: "none",
      soft: "0 2px 6px rgba(0,0,0,.85)",
      heavy: "0 0 3px #000,0 0 5px #000,0 2px 4px #000",
      outline: "-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 3px #000",
    }[c.text_shadow] || "";
    const hexToRgb = (h) => {
      let x = h.replace("#", "");
      if (x.length === 3) x = x.split("").map((ch) => ch + ch).join("");
      const n = parseInt(x, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [br, bg_, bb] = hexToRgb(bg);
    const op = Math.max(0, Math.min(100, Number(c.bg_opacity_pct) || 0)) / 100;
    return (
      pos +
      ".ytp-caption-segment{font-size:" + Math.max(10, Math.min(96, c.font_size_px || 28)) + "px!important;" +
      "font-family:" + String(c.font_family || "Roboto, Arial, sans-serif").replace(/[;{}<>]/g, "") + "!important;" +
      "font-weight:" + (c.font_weight || 700) + "!important;color:" + color + "!important;" +
      "line-height:" + (c.line_height || 1.25) + "!important;letter-spacing:" + (Number(c.letter_spacing_em) || 0) + "em!important;" +
      "text-transform:" + (c.uppercase ? "uppercase" : "none") + "!important;text-shadow:" + shadow + "!important;" +
      "background:rgba(" + br + "," + bg_ + "," + bb + "," + op + ")!important;" +
      "border-radius:" + Math.max(0, Math.min(30, c.radius_px || 0)) + "px!important;" +
      "padding:.08em .28em!important;box-decoration-break:clone!important;-webkit-box-decoration-break:clone!important}" +
      ".caption-window{font-size:" + Math.max(10, Math.min(96, c.font_size_px || 28)) + "px!important}"
    );
  }

  function captionStyleId() {
    return "prism-caption-style";
  }

  function injectCaptionCSS(css) {
    let el = document.getElementById(captionStyleId());
    if (!el) {
      el = document.createElement("style");
      el.id = captionStyleId();
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }

  function removeCaptionCSS() {
    const el = document.getElementById(captionStyleId());
    if (el) el.remove();
  }

  // Track selection state per video (manual-off memory).
  const manualOff = new Map(); // videoId -> true

  function getTracks(api) {
    try {
      const t = api.getOption && api.getOption("captions", "tracklist", { includeAsr: true });
      if (t && t.length) return t;
    } catch (_) {}
    try {
      const pr = window.ytInitialPlayerResponse;
      const tr = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer;
      if (tr && tr.captionTracks && tr.captionTracks.length) return tr.captionTracks;
    } catch (_) {}
    return [];
  }

  function selectTrack(api, s) {
    const tracks = getTracks(api);
    if (!tracks.length) return;
    const prefs = [s.captions.lang || "", ...(s.captions.fallback_langs || [])].filter(Boolean);
    const kindOk = (t) => {
      if (s.captions.kind_pref === "any") return true;
      const kind = (t.kind || "") + ":" + (t.vssId || "");
      const asr = /asr/i.test(kind);
      return s.captions.kind_pref === "human" ? !asr : asr;
    };
    const pick = (test) => tracks.find((t) => test(t));
    let chosen = null;
    for (const lang of prefs) {
      chosen = pick((t) => kindOk(t) && t.languageCode === lang) ||
        pick((t) => kindOk(t) && (t.languageCode || "").split("-")[0] === lang.split("-")[0]) ||
        pick((t) => t.languageCode === lang);
      if (chosen) break;
    }
    if (!chosen && !prefs.length) chosen = tracks.find((t) => !kindOk(t)) || tracks[0];
    if (!chosen && s.captions.auto_translate && s.captions.translate_to && tracks.length) {
      chosen = tracks.find((t) => t.translationLanguage && t.translationLanguage.languageCode === s.captions.translate_to) || tracks[0];
    }
    if (!chosen && !s.captions.lang && tracks.length) chosen = tracks[0];
    if (chosen) {
      try {
        api.setOption("captions", "track", { languageCode: chosen.languageCode, kind: chosen.kind, vssId: chosen.vssId });
      } catch (_) {}
    }
  }

  function engage(api, s) {
    try {
      if (api.loadModule) api.loadModule("captions");
      if (api.toggleSubtitlesOn) api.toggleSubtitlesOn();
      const btn = document.querySelector(".ytp-subtitles-button");
      if (btn && btn.getAttribute("aria-pressed") === "false") btn.click();
      selectTrack(api, s);
      applyNativePrefs(api, s);
      if (api.toggleSubtitlesOn) api.toggleSubtitlesOn();
    } catch (_) {}
  }

  function applyNativePrefs(api, s) {
    if (!s.captions.native_prefs || !api.setOption) return;
    try {
      const size = s.captions.font_size_px || 28;
      api.setOption("captions", "fontSize", size <= 18 ? -2 : size <= 23 ? -1 : size <= 30 ? 0 : size <= 38 ? 1 : size <= 48 ? 2 : 3);
      api.setOption("captions", "fontFamily", s.captions.font_family || "Roboto, Arial, sans-serif");
      api.setOption("captions", "fontColor", s.captions.text_color || "#ffffff");
      api.setOption("captions", "bgColor", s.captions.bg_color || "#000000");
      api.setOption("captions", "bgOpacity", (Math.max(0, Math.min(100, Number(s.captions.bg_opacity_pct) || 0)) / 100));
      api.setOption("captions", "edgeStyle", { none: 0, soft: 1, heavy: 2 }[s.captions.text_shadow] !== undefined ? { none: 0, soft: 1, heavy: 2 }[s.captions.text_shadow] : 4);
    } catch (_) {}
  }

  function shouldSkip(s) {
    if (!s.captions.enabled) return true;
    if (s.captions.skip_music && isMusic()) return true;
    if (s.captions.skip_shorts && isShorts()) return true;
    const vid = videoId();
    if (s.captions.respect_manual_off && vid && manualOff.get(vid)) return true;
    return false;
  }

  P.registerModule({
    id: "captions",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._wired = false;
    },
    async start(ctx) {
      const apply = () => {
        const s = ctx.settings();
        if (shouldSkip(s)) {
          removeCaptionCSS();
          return;
        }
        injectCaptionCSS(buildCaptionCSS(s));
        const api = playerApi();
        if (api) {
          engage(api, s);
          this._wireButton(api, s);
        }
      };
      apply();
      ctx.timer.interval(apply, 3000); // watchdog self-heal
      ctx.on(document, "yt-navigate-finish", () => {
        manualOff.clear();
        ctx.timer.timeout(apply, 600);
        ctx.timer.timeout(apply, 1800);
      }, { passive: true });
    },
    _wireButton(api, s) {
      if (this._wired) return;
      this._wired = true;
      const btn = () => document.querySelector(".ytp-subtitles-button");
      this._off = P.scheduler && undefined;
      const obs = new MutationObserver(() => {
        const b = btn();
        if (!b) return;
        const pressed = b.getAttribute("aria-pressed");
        if (pressed === "false") {
          const vid = videoId();
          if (s.captions.respect_manual_off && vid) {
            manualOff.set(vid, true);
            // User turned them off; respect it.
            return;
          }
          // YouTube dropped them (e.g. after ad) — re-engage.
          ctx.timer.timeout(() => {
            const b2 = btn();
            if (b2 && b2.getAttribute("aria-pressed") === "false" && !shouldSkip(ctx.settings())) {
              engage(api, ctx.settings());
            }
          }, 350);
        } else if (pressed === "true") {
          const vid = videoId();
          if (vid) manualOff.delete(vid);
        }
      });
      obs.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed"] });
      this._stopObs = () => obs.disconnect();
    },
    stop() {
      removeCaptionCSS();
      if (this._stopObs) { this._stopObs(); this._stopObs = null; }
      this._wired = false;
    },
    health() {
      return { cssInjected: !!document.getElementById(captionStyleId()) };
    },
  });
})();
