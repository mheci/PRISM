// PRISM module: playback behaviors.
// Owns: speed, per-channel speed, loop, A-B loop, auto-HD, seek buttons,
// stop button, sleep timer, theater, skip-ads, audio track, auto pause/
// resume, background pause, confirm-leave, auto-recover, HFR, wake-lock,
// PiP, screenshot hotkeys.
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  function videoEl() {
    return document.querySelector("video.html5-main-video, #movie_player video") || null;
  }
  function playerApi() {
    return document.querySelector("#movie_player") || null;
  }
  function videoId() {
    const m = location.pathname.match(/^\/watch\/?/) && new URLSearchParams(location.search).get("v");
    return m || null;
  }
  function channelId() {
    try {
      const pr = window.ytInitialPlayerResponse;
      if (pr && pr.videoDetails) return pr.videoDetails.channelId || "";
    } catch (_) {}
    const meta = document.querySelector('meta[itemprop="channelId"]');
    return meta ? meta.content : "";
  }
  function isLive() {
    try {
      const v = videoEl();
      if (v && !isFinite(v.duration)) return true;
      const pr = window.ytInitialPlayerResponse;
      return !!(pr && pr.videoDetails && (pr.videoDetails.isLiveContent || pr.videoDetails.isLive));
    } catch (_) {
      return false;
    }
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
  }

  function toast(msg, kind) {
    try {
      let el = document.getElementById("prism-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "prism-toast";
        el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(14,16,22,.94);color:#fff;padding:8px 16px;border-radius:99px;font:500 12.5px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:opacity .2s";
        document.body.appendChild(el);
      }
      el.style.border = "1px solid " + (kind === "error" ? "#ff5252" : kind === "success" ? "#4caf50" : "rgba(255,255,255,.15)");
      el.textContent = msg;
      el.style.opacity = "1";
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.opacity = "0"; }, 1800);
    } catch (_) {}
  }

  // Speed memory: per-channel map in storage.
  async function loadSpeedMap() {
    const v = await P.storage.get("speed-map");
    return (v && v.v) || {};
  }
  async function saveSpeedMap(map) {
    await P.storage.set("speed-map", { v: map });
  }

  P.registerModule({
    id: "player",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._stopFns = [];
      this._rateChangeBound = null;
    },
    async start(ctx) {
      const s = ctx.settings().player;
      const vid = videoEl();

      // 1. default speed
      const applySpeed = () => {
        const v = videoEl();
        if (!v || isLive()) return;
        if (ctx.settings().intelligence.smart_speed) return; // smart-speed owns rate
        const target = Math.max(0.0625, Math.min(16, Number(ctx.settings().player.speed_default) || 1));
        if (Math.abs(v.playbackRate - target) > 0.01) v.playbackRate = target;
      };

      // 2. per-channel memory
      const chRestore = async () => {
        if (!ctx.settings().player.speed_per_channel) return;
        const v = videoEl();
        const ch = channelId();
        if (!v || !ch || isLive()) return;
        const map = await loadSpeedMap();
        const rec = map[ch];
        if (rec && isFinite(rec.r) && Math.abs(v.playbackRate - rec.r) > 0.01) {
          v.playbackRate = rec.r;
        }
      };
      const chSave = async (v) => {
        if (!ctx.settings().player.speed_per_channel) return;
        const ch = channelId();
        if (!ch || !isFinite(v.playbackRate)) return;
        const map = await loadSpeedMap();
        const keys = Object.keys(map);
        if (keys.length >= 200) {
          const sorted = keys.sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0));
          for (const k of sorted.slice(0, 50)) delete map[k];
        }
        map[ch] = { r: v.playbackRate || 1, ts: Date.now() };
        await saveSpeedMap(map);
      };

      // 3. loop + A-B loop
      const applyLoops = () => {
        const v = videoEl();
        if (!v) return;
        v.loop = !!ctx.settings().player.loop_video;
      };

      // 4. auto-HD
      const applyQuality = () => {
        const api = playerApi();
        if (!api || !ctx.settings().player.quality_pref) return;
        if (ctx.settings().player.quality_pref === "auto") return;
        try {
          const levels = api.getAvailableQualityLevels && api.getAvailableQualityLevels();
          if (!levels || !levels.length) return;
          const want = ctx.settings().player.quality_pref;
          const target = levels.includes(want) ? want : levels[0];
          api.setPlaybackQualityRange && api.setPlaybackQualityRange(target, target);
          api.setPlaybackQuality && api.setPlaybackQuality(target);
        } catch (_) {}
      };

      // 5. sleep timer
      let sleepStop = null;
      if (ctx.settings().player.sleep_timer_min > 0) {
        sleepStop = ctx.timer.timeout(() => {
          const v = videoEl();
          if (v && !v.paused && !v.ended) {
            v.pause();
            toast("Sleep timer - pausing.", "info");
          }
        }, ctx.settings().player.sleep_timer_min * 60000);
      }

      // 6. skip ads
      if (ctx.settings().player.skip_ads) {
        const clickSkip = () => {
          const b = document.querySelector(".ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern");
          if (b) { try { b.click(); } catch (_) {} }
        };
        const obs = new MutationObserver(() => {
          if (document.querySelector(".ad-showing, .ad-interrupting")) clickSkip();
        });
        const player = playerApi();
        if (player) obs.observe(player, { attributes: true, attributeFilter: ["class"] });
        this._stopFns.push(() => obs.disconnect());
        ctx.timer.interval(clickSkip, 3000);
      }

      // 7. default original audio
      if (ctx.settings().player.default_original_audio) {
        const setOrig = () => {
          const api = playerApi();
          if (!api || typeof api.getAvailableAudioTracks !== "function") return;
          try {
            const tracks = api.getAvailableAudioTracks();
            if (!tracks || !tracks.length) return;
            const orig = tracks.find((t) => /orig/i.test(t.id || "")) || tracks[0];
            api.setAudioTrack(orig, true);
          } catch (_) {}
        };
        ctx.timer.timeout(setOrig, 1500);
      }

      // 8. auto pause / resume / background pause
      const gr = { autoPaused: false };
      const maybePause = (reason) => {
        const v = videoEl();
        if (!v || v.paused || v.ended) return;
        const p = ctx.settings().player;
        const should = (reason === "hidden" && (p.auto_pause_hidden || p.pause_background_tabs)) ||
          (reason === "blur" && p.auto_pause_blurred);
        if (should) {
          gr.autoPaused = true;
          v.pause();
        }
      };
      ctx.on(document, "visibilitychange", () => {
        if (document.hidden) {
          ctx.timer.timeout(() => maybePause("hidden"), 500);
        } else if (gr.autoPaused && ctx.settings().player.resume_auto_paused) {
          const v = videoEl();
          if (v && v.paused) { gr.autoPaused = false; v.play().catch(() => {}); }
        }
      }, { passive: true });
      ctx.on(window, "blur", () => maybePause("blur"), { passive: true });

      // 9. confirm leave
      if (ctx.settings().player.confirm_leave_playing) {
        ctx.on(window, "beforeunload", (e) => {
          const v = videoEl();
          if (v && !v.paused && !v.ended) {
            e.preventDefault();
            e.returnValue = "";
          }
        });
      }

      // 10. auto recover
      if (ctx.settings().player.auto_recover_video) {
        ctx.on(window, "online", () => {
          const v = videoEl();
          if (v && v.paused && !isLive()) {
            v.play().catch(() => {});
            toast("Network restored - resuming video", "success");
          }
        });
      }

      // 11. HFR cookie
      if (ctx.settings().player.hfr_allow) {
        const val = Math.random().toString(36).slice(2, 14) + "QfX";
        try {
          document.cookie = "VISITOR_INFO1_LIVE=" + val + ";domain=.youtube.com;path=/;max-age=" + (180 * 86400) + ";SameSite=Lax";
        } catch (_) {}
        toast("HFR cookie set - reload to see 60fps options", "info");
      }

      // 12. wake lock
      if (ctx.settings().player.keep_screen_awake && navigator.wakeLock && navigator.wakeLock.request) {
        let lock = null;
        const release = () => { if (lock) { try { lock.release(); } catch (_) {} lock = null; } };
        const acquire = () => {
          const v = videoEl();
          if (v && !v.paused && !v.ended && document.visibilityState === "visible") {
            if (!lock) navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
          } else release();
        };
        ctx.on(document, "visibilitychange", acquire, { passive: true });
        ctx.timer.interval(acquire, 5000);
      }

      // 13. theater default
      const applyTheater = () => {
        if (ctx.settings().player.theater_default && location.pathname === "/watch") {
          const flexy = document.querySelector("ytd-watch-flexy");
          const btn = document.querySelector(".ytp-size-button");
          if (flexy && !flexy.hasAttribute("theater") && btn) btn.click();
        }
      };

      // 14. seek buttons (forward/rewind)
      if (ctx.settings().chrome.fwd_rewind_buttons) {
        const step = Math.max(1, Number(ctx.settings().player.seek_step_sec) || 10);
        const mountSeek = () => {
          const controls = document.querySelector("#movie_player .ytp-left-controls");
          if (!controls || controls.querySelector(".prism-fr-btn")) return;
          const mk = (cls, title, svg, dir) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "ytp-button prism-fr-btn " + cls;
            b.title = title;
            b.setAttribute("aria-label", title);
            b.style.cssText = "width:40px;height:40px;color:#fff";
            b.innerHTML = svg;
            b.addEventListener("click", () => {
              const v = videoEl();
              if (!v) return;
              if (dir === -1) v.currentTime = Math.max(0, v.currentTime - step);
              else if (!isLive()) v.currentTime = Math.min(v.duration || 1e9, v.currentTime + step);
            });
            return b;
          };
          const rewind = mk("prism-fr-rewind", "Rewind " + step + " seconds", '<svg viewBox="0 0 36 36" fill="currentColor" style="width:24px;height:24px"><path d="M12.5,17.5l10,10l0,-20l-10,10z M2.5,17.5l10,10l0,-20l-10,10z"/></svg>', -1);
          const forward = mk("prism-fr-forward", "Forward " + step + " seconds", '<svg viewBox="0 0 36 36" fill="currentColor" style="width:24px;height:24px"><path d="M23.5,17.5l-10,-10l0,20l10,-10z M13.5,17.5l-10,-10l0,20l10,-10z"/></svg>', 1);
          const play = controls.querySelector(".ytp-play-button");
          if (play && play.parentNode === controls) {
            controls.insertBefore(rewind, play.nextSibling);
            controls.insertBefore(forward, play.nextSibling);
          } else {
            controls.appendChild(rewind);
            controls.appendChild(forward);
          }
        };
        mountSeek();
        ctx.timer.timeout(mountSeek, 1200);
      }

      // 15. stop button
      if (ctx.settings().chrome.stop_button) {
        const mountStop = () => {
          const controls = document.querySelector("#movie_player .ytp-left-controls");
          if (!controls || controls.querySelector(".prism-stop-btn")) return;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "ytp-button prism-stop-btn";
          b.title = "Stop";
          b.setAttribute("aria-label", "Stop");
          b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:24px;height:24px"><path d="M6 6h12v12H6z"/></svg>';
          b.addEventListener("click", () => {
            const v = videoEl();
            const api = playerApi();
            if (!v) { toast("No video element", "error"); return; }
            try {
              v.pause();
              api && api.pauseVideo && api.pauseVideo();
              v.currentTime = 0;
              api && api.seekTo && api.seekTo(0, true);
              api && api.stopVideo && api.stopVideo();
              const src = v.src;
              v.removeAttribute("src");
              v.load();
              setTimeout(() => {
                v.src = src;
                v.load();
                v.pause();
              }, 50);
              toast("Stopped", "info");
            } catch (_) {}
          });
          const play = controls.querySelector(".ytp-play-button");
          if (play && play.parentNode === controls) controls.insertBefore(b, play.nextSibling);
          else controls.appendChild(b);
        };
        mountStop();
        ctx.timer.timeout(mountStop, 1200);
      }

      // 16. pip toggle hotkey (via settings button only — expose key handler)
      if (ctx.settings().chrome.pip_button) {
        // exposed in the global hotkey handler below
      }

      // Wire listeners
      const v0 = videoEl();
      if (v0) {
        ctx.on(v0, "ratechange", () => chSave(v0).catch(() => {}), { passive: true });
        ctx.on(v0, "loadedmetadata", () => { applySpeed(); applyLoops(); applyQuality(); chRestore(); }, { passive: true });
      }
      ctx.on(document, "yt-navigate-finish", () => {
        ctx.timer.timeout(() => {
          const v = videoEl();
          if (v) {
            ctx.on(v, "ratechange", () => chSave(v).catch(() => {}), { passive: true });
            ctx.on(v, "loadedmetadata", () => { applySpeed(); applyLoops(); applyQuality(); chRestore(); }, { passive: true });
          }
          applySpeed();
          applyLoops();
          applyTheater();
        }, 800);
      }, { passive: true });
      ctx.timer.interval(applySpeed, 2000);

      // Global hotkeys: X screenshot handled elsewhere; Shift+S stop.
      this._hotkey = ctx.on(document, "keydown", (e) => {
        if (e.shiftKey && (e.code === "KeyS" || e.key === "S") && ctx.settings().chrome.stop_button) {
          const v = videoEl();
          const api = playerApi();
          if (v) {
            v.pause();
            api && api.stopVideo && api.stopVideo();
            toast("Stopped", "info");
          }
        }
      }, { passive: true });
    },
    stop() {
      this._stopFns.forEach((f) => f());
      this._stopFns = [];
      document.querySelectorAll(".prism-fr-btn, .prism-stop-btn").forEach((b) => b.remove());
    },
    health() {
      return { video: !!videoEl() };
    },
  });
})();
