// PRISM module: feed filtering (channel blocker, keywords, card filters,
// shorts + auto-dub removal via the Rust scrubber and fetch interception).
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  const CONTENT_RE = /\/youtubei\/v1\/(browse|next|search|get_watch|reel\/reel_watch_sequence|reel\/reel_item_watch|feed\/[a-z_]+|notification\/[a-z_]+)(\?|$)/;
  const PLAYER_RE = /\/youtubei\/v1\/player(\?|$)/;
  const SHORTS_RE = /\/youtubei\/v1\/(reel|shorts)(\/|\?|$)/;

  let fetchInstalled = false;
  let currentScrub = null; // { shorts, autoDubbed }

  async function installFetchWrapper(ctx) {
    if (fetchInstalled) return;
    fetchInstalled = true;
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      let url = "";
      try {
        url = typeof input === "string" ? input : input && input.url ? input.url : String(input || "");
      } catch (_) {}
      const path = url.split("?")[0];
      const s = ctx.settings().feed;

      if (s.remove_shorts && SHORTS_RE.test(path)) {
        // Hard block: never let a Shorts endpoint load.
        return new Response(null, { status: 204, statusText: "No Content" });
      }

      const doShorts = s.remove_shorts && s.shorts_api_filter && CONTENT_RE.test(path);
      const doDub = s.hide_auto_dubbed && CONTENT_RE.test(path);
      const doPlayer = s.hide_auto_dubbed && PLAYER_RE.test(path);
      if (!doShorts && !doDub && !doPlayer) return realFetch(input, init);

      try {
        const res = await realFetch(input, init);
        if (!res || !res.ok) return res;
        const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        if (ct && ct.indexOf("json") === -1 && ct.indexOf("text") === -1) return res;
        // Skip large bodies before buffering (content-length check first).
        let contentLength = 0;
        try { contentLength = Number(res.headers.get("content-length")) || 0; } catch (_) {}
        if (contentLength > 6 * 1024 * 1024) return res;
        const clone = res.clone();
        const txt = await clone.text();
        if (!txt || txt[0] !== "{") return res;
        if (txt.length > 6 * 1024 * 1024) return res;
        const json = JSON.parse(txt);

        if (doPlayer) {
          // Restore original audio on auto-dubbed watch pages.
          const audio = await ctx.core("scrub.player_audio", { document: json }).catch(() => null);
          if (audio && audio.has_auto_dub && audio.original_track_id && ctx.settings().feed.restore_original_audio) {
            setOriginalAudio(audio.original_track_id);
          }
        }

        let removed = 0;
        if (doShorts || doDub) {
          const r = await ctx.core("scrub.run", {
            document: json,
            mode: { shorts: doShorts, auto_dubbed: doDub },
          }).catch(() => null);
          if (r && r.document) {
            const out = JSON.stringify(r.document);
            removed = r.stats ? r.stats.removed : 0;
            if (removed > 0 || out !== txt) {
              let headers = res.headers;
              try {
                headers = new Headers(res.headers);
                headers.delete("content-encoding");
                headers.delete("content-length");
              } catch (_) {}
              return new Response(out, { status: res.status, statusText: res.statusText, headers });
            }
          }
        }
        return res;
      } catch (_) {
        // Never re-issue the network request on a scrub failure — return
        // the already-fetched response untouched.
        return res;
      }
    };
  }

  function setOriginalAudio(trackId) {
    try {
      const api = document.querySelector("#movie_player");
      if (!api || typeof api.getAvailableAudioTracks !== "function") return;
      const tracks = api.getAvailableAudioTracks();
      const t = tracks && tracks.find((x) => String(x.id) === String(trackId));
      if (t) api.setAudioTrack(t, true);
    } catch (_) {}
  }

  // Card scanning: channel blocker + keywords + watched dim/hide +
  // length/live/premiere marks + numbering. Runs on idle, yields.
  const CARD_SELECTOR = "ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer";

  // Channel blocklist compiled once per scan: Set of @handles + keyword list.
  function compileBlocklist(raw) {
    const handles = new Set();
    const keywords = [];
    for (const line of String(raw || "").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("!") || t.startsWith("#")) continue;
      if (t.startsWith("@")) handles.add(t.slice(1).toLowerCase());
      else keywords.push(t.toLowerCase());
    }
    return { handles, keywords };
  }

  async function scanCards(ctx) {
    const f = ctx.settings().feed;
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
    const blockedList = f.channel_blocklist ? compileBlocklist(f.channel_blocklist) : null;
    let blocked = 0;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (card.dataset.prismScanned) continue;
      card.dataset.prismScanned = "1";

      // Channel blocker: read the handle href once, compare against a Set.
      if (blockedList && blockedList.handles.size) {
        const a = card.querySelector('a[href^="/@"]');
        const href = a && a.getAttribute("href");
        if (href) {
          const m = href.match(/^\/(@[^/]+)/i);
          const handle = m && m[1].slice(1).toLowerCase();
          if (handle && blockedList.handles.has(handle)) {
            card.style.display = "none";
            card.dataset.prismBlocked = "1";
            blocked++;
            continue;
          }
        }
      }

      // Keyword filter
      if (blockedList && blockedList.keywords.length) {
        const title = card.querySelector("#video-title");
        const text = (title && (title.title || title.textContent)) || card.textContent || "";
        const lower = text.toLowerCase();
        if (blockedList.keywords.some((k) => lower.includes(k))) {
          card.style.display = "none";
          continue;
        }
      }

      // Numbering
      if (f.number_results && !card.querySelector(".prism-num")) {
        const n = document.createElement("span");
        n.className = "prism-num";
        n.style.cssText = "position:absolute;top:4px;left:4px;z-index:5;background:rgba(0,0,0,.75);color:#fff;padding:1px 6px;border-radius:6px;font:700 11px system-ui";
        n.textContent = String(i + 1);
        (card.querySelector("#thumbnail") || card).appendChild(n);
      }

      // Length / live / premiere marks
      if (f.highlight_long || f.highlight_short || f.hide_live || f.hide_premieres) {
        const meta = card.textContent || "";
        const dur = parseDuration(meta);
        if (f.highlight_long && dur >= (f.long_min_sec || 1200)) card.classList.add("prism-long");
        if (f.highlight_short && dur > 0 && dur <= (f.short_max_sec || 60)) card.classList.add("prism-short");
        // Live: rely on the badge element rather than title text (titles can
        // contain the word "LIVE" without being live).
        if (f.hide_live) {
          const liveBadge = card.querySelector(".ytd-thumbnail-overlay-time-status-renderer[overlay-style='LIVE'], ytd-badge-supported-renderer[aria-label*='live' i], .badge-shape-wiz--thumbnail-badge[aria-label*='live' i]");
          const isLive = liveBadge || /\bwatching now\b|live now/i.test(meta);
          if (isLive) card.style.display = "none";
        }
        if (f.hide_premieres && /premiere|premieres/i.test(meta)) card.style.display = "none";
      }

      if ((i + 1) % 40 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  function parseDuration(text) {
    const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return 0;
    if (m[3]) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    return (+m[1]) * 60 + (+m[2]);
  }

  // Watched feed dim/hide: consult the Rust history model via stored records.
  async function applyWatched(ctx) {
    const f = ctx.settings().feed;
    if (!f.watched_mode || f.watched_mode === "off") return;
    const raw = await P.storage.get("history").catch(() => null);
    const records = (raw && raw.v) || [];
    const done = new Set(records.filter((r) => r.completed || (r.progress_pct || 0) > 90).map((r) => r.video_id));
    if (!done.size) return;
    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      if (card.dataset.prismWatched) return;
      const link = card.querySelector('a[href*="/watch?v="]');
      if (!link) return;
      const vid = new URL(link.href).searchParams.get("v");
      if (vid && done.has(vid)) {
        card.dataset.prismWatched = "1";
        if (f.watched_mode === "dim") card.style.opacity = "0.35";
        else card.style.display = "none";
      }
    });
  }

  // Top live games shelf.
  function hideTopLiveGames(ctx) {
    if (!ctx.settings().feed.hide_top_live_games) return;
    document.querySelectorAll("ytd-shelf-renderer").forEach((shelf) => {
      const h2 = shelf.querySelector("h2");
      if (h2 && /top live games/i.test(h2.textContent || "")) shelf.style.display = "none";
    });
  }

  P.registerModule({
    id: "feed",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._obs = null;
    },
    async start(ctx) {
      const f = ctx.settings().feed;
      if (f.remove_shorts || f.hide_auto_dubbed) {
        await installFetchWrapper(ctx);
      }
      // DOM scrub layer for shorts.
      if (f.remove_shorts && f.shorts_dom_clean) {
        const scrub = () => {
          document.querySelectorAll("ytd-reel-item-renderer, ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer").forEach((el) => el.remove());
        };
        scrub();
        this._obs = new MutationObserver(() => scrub());
        this._obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      }
      // Redirect shorts links.
      if (f.remove_shorts && f.shorts_redirect) {
        const go = () => {
          const m = location.pathname.match(/^\/shorts\/([\w-]+)/);
          if (m) {
            const q = location.search.replace("?", "&");
            location.replace("/watch?v=" + m[1] + q);
          }
        };
        go();
        ctx.on(document, "yt-navigate-finish", go, { passive: true });
      }

      const scan = () => {
        scanCards(ctx).catch(() => {});
        applyWatched(ctx).catch(() => {});
        hideTopLiveGames(ctx);
      };
      scan();
      ctx.timer.interval(scan, 4000);
      ctx.on(document, "yt-navigate-finish", () => {
        // Reset scan marks so new nav content gets scanned.
        document.querySelectorAll("[data-prism-scanned]").forEach((el) => delete el.dataset.prismScanned);
        ctx.timer.timeout(scan, 500);
      }, { passive: true });
    },
    stop() {
      if (this._obs) { this._obs.disconnect(); this._obs = null; }
    },
    health() {
      return { fetchWrapped: fetchInstalled };
    },
  });
})();
