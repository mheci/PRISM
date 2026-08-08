// PRISM module: session history (resume modes, click recorder, insights).
// Persistence lives in browser.storage (via bridge); decision logic
// (completion, resume, aggregation) lives in the Rust core.
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
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
  }

  async function loadHistory() {
    const raw = await P.storage.get("history").catch(() => null);
    return (raw && raw.v) || [];
  }
  async function saveHistory(records) {
    // Cap storage; evict oldest beyond capacity.
    const cap = 20000;
    if (records.length > cap) {
      records.sort((a, b) => (b.last_watched || 0) - (a.last_watched || 0));
      records.length = cap;
    }
    await P.storage.set("history", { v: records });
  }

  P.registerModule({
    id: "history",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._session = null; // { videoId, lastPos, lastTick }
      this._overlayStop = null;
      this._playGate = false;
    },
    async start(ctx) {
      const s = ctx.settings().history;
      if (!s.enabled) return;

      // Watchdog: persist progress every 5s while playing.
      ctx.timer.interval(async () => {
        const vid = videoId();
        const v = videoEl();
        if (!vid || !v) return;
        if (this._session && this._session.videoId !== vid) this._session = null;
        if (!this._session) this._session = { videoId: vid, lastPos: v.currentTime, lastTick: Date.now() };
        // Paused: nothing to record; just track position so the next play
        // doesn't look like a seek.
        if (v.paused || v.ended) {
          this._session.lastPos = v.currentTime;
          return;
        }
        const delta = v.currentTime - this._session.lastPos;
        this._session.lastPos = v.currentTime;
        if (delta <= 0) return; // seek backwards or no progress; ignore
        const records = await loadHistory();
        let rec = records.find((r) => r.video_id === vid);
        if (!rec) {
          rec = { video_id: vid, title: "", channel: "", channel_id: "", thumbnail: "", duration_sec: v.duration || 0, last_position_sec: 0, progress_pct: 0, completed: false, watch_count: 0, total_watch_sec: 0, last_watched: Date.now(), sessions: [] };
          records.push(rec);
        }
        rec.duration_sec = v.duration || rec.duration_sec;
        rec.last_position_sec = v.currentTime;
        if (rec.duration_sec > 0) rec.progress_pct = Math.min(100, (v.currentTime / rec.duration_sec) * 100);
        rec.total_watch_sec = (rec.total_watch_sec || 0) + delta;
        rec.watch_count = (rec.watch_count || 0) + 1;
        rec.last_watched = Date.now();
        // Completion rule via Rust core.
        try {
          const r = await ctx.core("history.complete", { record: rec });
          if (r && r.completed && !rec.completed) {
            rec.completed = true;
            rec.progress_pct = 100;
            rec.last_position_sec = 0;
          }
        } catch (_) {
          // Fallback local rule.
          if (rec.duration_sec > 0 && (rec.progress_pct >= 97 || (rec.duration_sec - rec.last_position_sec) < 15)) {
            rec.completed = true;
            rec.progress_pct = 100;
            rec.last_position_sec = 0;
          }
        }
        await saveHistory(records);
      }, 5000);

      // Resume prompt on navigation.
      ctx.on(document, "yt-navigate-finish", () => {
        this._dismissResume();
        ctx.timer.timeout(() => this._maybeResume(ctx), 1200);
      }, { passive: true });

      // Click recorder (serialized RMW so rapid clicks never lose entries).
      if (s.track_clicks) {
        let clickChain = Promise.resolve();
        ctx.on(document, "click", (e) => {
          const rec = { t: Date.now(), kind: "click", tag: (e.target && e.target.tagName) || "", url: location.pathname };
          clickChain = clickChain.then(async () => {
            const raw = await P.storage.get("clicks").catch(() => null);
            const arr = (raw && raw.v) || [];
            arr.push(rec);
            if (arr.length > 5000) arr.splice(0, arr.length - 5000);
            await P.storage.set("clicks", { v: arr }).catch(() => {});
          });
          clickChain.catch(() => {});
        }, { capture: true });
      }
    },
    async _maybeResume(ctx) {
      const s = ctx.settings().history;
      if (!s.enabled || s.resume_mode === "off") return;
      const vid = videoId();
      const v = videoEl();
      if (!vid || !v) return;
      const hasT = /[?&]t=/.test(location.search);
      const records = await loadHistory();
      const rec = records.find((r) => r.video_id === vid);
      if (!rec) return;
      let decision;
      try {
        decision = await ctx.core("history.resume", {
          record: rec,
          has_t_param: hasT,
          mode: s.resume_mode,
        });
      } catch (_) {
        decision = null;
      }
      if (!decision || !decision.show) return;
      if (s.resume_mode === "silent") {
        v.currentTime = decision.position_sec;
        v.play().catch(() => {});
        return;
      }
      this._showResumeOverlay(ctx, decision, rec);
    },
    _showResumeOverlay(ctx, decision, rec) {
      this._dismissResume();
      const s = ctx.settings().history;
      const overlay = document.createElement("div");
      overlay.id = "prism-resume-overlay";
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483640;background:rgba(10,12,18,.92);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(14px)";
      const card = document.createElement("div");
      card.style.cssText = "background:#161a24;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,.6)";
      const pct = rec.duration_sec > 0 ? Math.round((decision.position_sec / rec.duration_sec) * 100) : 0;
      card.innerHTML =
        '<div style="font:700 13px system-ui;color:#ff8aa5;margin-bottom:6px">Resume watching</div>' +
        '<div style="font:600 16px system-ui;color:#fff;margin-bottom:4px">' + escapeHtml(rec.title || videoId() || "") + "</div>" +
        '<div style="font:400 12px system-ui;color:#9aa0ae;margin-bottom:12px">' + escapeHtml(rec.channel || "") + " · " + fmtTime(decision.position_sec) + " / " + fmtTime(decision.duration_sec) + "</div>" +
        '<div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;margin-bottom:16px"><div style="height:100%;width:' + pct + '%;background:#ff3d7f"></div></div>' +
        '<div style="display:flex;gap:8px">' +
        '<button data-action="resume" style="flex:1;background:#ff3d7f;border:0;color:#fff;font:600 13px system-ui;padding:9px;border-radius:9px;cursor:pointer">Resume from ' + fmtTime(decision.position_sec) + "</button>" +
        '<button data-action="startover" style="flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:#fff;font:600 13px system-ui;padding:9px;border-radius:9px;cursor:pointer">Start over</button>' +
        '</div><div style="text-align:center;margin-top:10px"><button data-action="dismiss" style="background:none;border:0;color:#9aa0ae;font:500 12px system-ui;cursor:pointer;text-decoration:underline">Dismiss</button></div>';
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      const onAction = (e) => {
        const act = e.target && e.target.dataset && e.target.dataset.action;
        if (!act) return;
        e.preventDefault();
        e.stopPropagation();
        this._dismissResume();
        const v = videoEl();
        if (!v) return;
        if (act === "resume") {
          v.currentTime = decision.position_sec;
          v.play().catch(() => {});
        } else if (act === "startover") {
          v.currentTime = 0;
          v.play().catch(() => {});
        }
      };
      overlay.addEventListener("click", onAction, true);
      // Play-gate: block autoplay while the overlay is up.
      const gate = (ev) => {
        if (!overlay.isConnected) return;
        ev.preventDefault();
        ev.stopPropagation();
      };
      for (const ev of ["click", "mousedown", "mouseup", "wheel", "contextmenu"]) overlay.addEventListener(ev, gate, true);
      const onKey = (e) => {
        if (e.key === "Escape") this._dismissResume();
      };
      document.addEventListener("keydown", onKey, true);
      this._overlayStop = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
      };
      if (s.resume_mode === "card") {
        // Auto-dismiss after 15s for the card variant.
        ctx.timer.timeout(() => this._dismissResume(), 15000);
      }
    },
    _dismissResume() {
      if (this._overlayStop) {
        try { this._overlayStop(); } catch (_) {}
        this._overlayStop = null;
      }
    },
    stop() {
      this._dismissResume();
    },
    health() {
      return { session: !!this._session };
    },
  });

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
