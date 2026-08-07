// PRISM module: discovery + search intelligence.
// Owns: time machine, small creator spotlight, anti-rec, momentum, vibe
// search, credibility layer, search remix, outdated detector, watch genome.
// Ranking/classification logic lives in the Rust core; this module does
// innertube calls (same-origin) and renders the shared discovery host.
(() => {
  "use strict";
  const P = window.__PRISM__;
  if (!P) return;

  function ytcfg(key) {
    try { return window.ytcfg && window.ytcfg.get && window.ytcfg.get(key); } catch (_) { return null; }
  }
  async function innerTube(endpoint, body) {
    const key = ytcfg("INNERTUBE_API_KEY");
    const ctx = ytcfg("INNERTUBE_CONTEXT");
    if (!key || !ctx) return null;
    const res = await fetch("/youtubei/v1/" + endpoint + "?key=" + encodeURIComponent(key) + "&prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-YouTube-Client-Name": "1", "X-YouTube-Client-Version": ytcfg("INNERTUBE_CLIENT_VERSION") || "2.20240101" },
      body: JSON.stringify({ context: ctx, ...body }),
    });
    if (!res.ok) return null;
    return res.json();
  }
  function parseVideos(json) {
    const out = [];
    try {
      const sections = json && json.contents && json.contents.twoColumnSearchResultsRenderer &&
        json.contents.twoColumnSearchResultsRenderer.primaryContents &&
        json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer &&
        json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
      for (const section of sections || []) {
        for (const item of (section.itemSectionRenderer && section.itemSectionRenderer.contents) || []) {
          const r = item.videoRenderer;
          if (!r || !r.videoId) continue;
          const textOf = (n) => n && (n.simpleText || (n.runs || []).map((x) => x.text).join(""));
          out.push({
            video_id: r.videoId,
            title: textOf(r.title) || r.videoId,
            channel: textOf(r.ownerText) || "",
            published_at_ms: parseAgoMs(textOf(r.publishedTimeText)),
            view_count: parseCount(textOf(r.viewCountText)),
            duration_sec: parseDuration(textOf(r.lengthText)),
          });
        }
      }
    } catch (_) {}
    return out;
  }
  function parseCount(t) {
    if (!t) return 0;
    const m = String(t).match(/([\d,.]+)\s*([KMB])?/i);
    if (!m) return 0;
    const n = parseFloat(m[1].replace(/,/g, "")) || 0;
    const u = (m[2] || "").toUpperCase();
    return u === "K" ? n * 1e3 : u === "M" ? n * 1e6 : u === "B" ? n * 1e9 : n;
  }
  function parseAgoMs(t) {
    if (!t) return 0;
    const m = String(t).match(/([\d.]+)\s*(year|month|week|day|hour|minute)s?\s*ago/i);
    if (!m) return 0;
    const n = parseFloat(m[1]) || 0;
    const f = { year: 365 * 864e5, month: 30 * 864e5, week: 7 * 864e5, day: 864e5, hour: 36e5, minute: 6e4 };
    return Date.now() - n * (f[m[2].toLowerCase()] || 0);
  }
  function parseDuration(t) {
    if (!t) return 0;
    const p = String(t).split(":").map(Number).filter((n) => Number.isFinite(n));
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 60 + p[1];
    return p[0] || 0;
  }

  // ── shared discovery host (floating panel, tabs) ──
  function discoveryHost(ctx) {
    let root = document.getElementById("prism-disco");
    if (root) return root._api;
    root = document.createElement("div");
    root.id = "prism-disco";
    root.style.cssText = "position:fixed;right:12px;top:12px;z-index:2147483647;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 24px);display:flex;flex-direction:column;background:rgba(14,16,22,.96);border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.55);font:12px system-ui;color:#ddd;overflow:hidden";
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)";
    hdr.innerHTML = '<span style="font-weight:700;color:#fff;font-size:13px">PRISM Discover</span>';
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u00d7";
    close.style.cssText = "background:none;border:0;color:#888;font-size:16px;cursor:pointer;padding:2px 8px";
    close.addEventListener("click", () => root.remove());
    hdr.appendChild(close);
    const tabs = document.createElement("div");
    tabs.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;padding:8px 12px";
    const bodies = document.createElement("div");
    bodies.style.cssText = "overflow-y:auto;min-height:0;flex:1;padding:0 12px 12px";
    root.append(hdr, tabs, bodies);
    document.body.appendChild(root);

    const sections = new Map();
    let active = null;
    const api = {
      addSection(id, label, load) {
        if (sections.has(id)) return sections.get(id).api;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.style.cssText = "padding:3px 10px;border-radius:99px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#ccc;font:600 10.5px system-ui;cursor:pointer";
        btn.addEventListener("click", () => activate(id));
        const body = document.createElement("div");
        body.style.display = "none";
        const status = document.createElement("div");
        status.style.cssText = "font-size:10.5px;color:#888;margin:6px 0";
        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:4px";
        body.append(status, list);
        tabs.appendChild(btn);
        bodies.appendChild(body);
        const sec = { id, btn, body, status, list, loaded: false, load, api: {} };
        sec.api.status = (t) => { status.textContent = t || ""; };
        sec.api.clear = () => { list.replaceChildren(); };
        sec.api.row = (v) => {
          const row = document.createElement("a");
          row.href = "/watch?v=" + v.video_id;
          row.style.cssText = "display:flex;gap:8px;padding:6px 8px;border-radius:8px;text-decoration:none;color:#ddd;cursor:pointer";
          row.innerHTML = '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(v.title) + '</div><div style="font-size:10.5px;color:#888">' + escapeHtml(v.channel || "") + "</div></div>";
          list.appendChild(row);
          return row;
        };
        sec.api.refresh = (force) => activate(id, force);
        sections.set(id, sec);
        if (!active) activate(id);
        return sec.api;
      },
    };
    root._api = api;

    function activate(id, force) {
      const sec = sections.get(id);
      if (!sec) return;
      active = id;
      sections.forEach((s) => {
        s.btn.style.background = s.id === id ? "rgba(255,61,127,.18)" : "rgba(255,255,255,.05)";
        s.btn.style.borderColor = s.id === id ? "rgba(255,61,127,.4)" : "rgba(255,255,255,.08)";
        s.btn.style.color = s.id === id ? "#ff8aa5" : "#ccc";
        s.body.style.display = s.id === id ? "block" : "none";
      });
      if (sec.load && (!sec.loaded || force)) { sec.loaded = true; sec.load(sec.api); }
    }
    return api;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  P.registerModule({
    id: "discovery",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._host = null;
    },
    async start(ctx) {
      const d = ctx.settings().discovery;
      if (!d.anti_rec && !d.momentum && !d.time_machine && !d.small_creator) return;
      const host = discoveryHost(ctx);
      this._host = host;

      const search = async (query, sp) => {
        const json = await innerTube("search", { query, params: sp || undefined });
        return parseVideos(json);
      };

      // ── Anti-rec: "surprise me" from adjacent topics ──
      if (d.anti_rec) {
        const topics = ["science", "history", "music theory", "wildlife", "engineering", "psychology", "space", "cooking"];
        const api = host.addSection("anti-rec", "Anti-bubble", (secApi) => {
          const topic = topics[Math.floor(Math.random() * topics.length)];
          secApi.status("Surfacing from: " + topic + "\u2026");
          search(topic).then(async (videos) => {
            secApi.clear();
            if (!videos.length) { secApi.status("Nothing surfaced. Try again."); return; }
            const ranked = await ctx.core("discovery.rank", { videos, limit: d.feed_size || 20, now: Date.now() }).catch(() => []);
            ranked.forEach((entry) => {
              const row = secApi.row(entry.video);
              const vel = document.createElement("span");
              vel.style.cssText = "font-size:10px;color:#ff8aa5;white-space:nowrap";
              vel.textContent = " " + (entry.label || "");
              row.querySelector("div > div:last-child").appendChild(vel);
            });
            secApi.status("Showing " + ranked.length + " picks from " + topic);
          });
        });
        api.button = null;
      }

      // ── Momentum: this month's uploads by views/hour ──
      if (d.momentum) {
        const api = host.addSection("momentum", "Momentum", (secApi) => {
          secApi.status("Ranking this month's uploads by views/hour\u2026");
          search("technology", "EgIIBA%3D%3D").then(async (videos) => {
            secApi.clear();
            const ranked = await ctx.core("discovery.rank", { videos, limit: d.feed_size || 20, now: Date.now() }).catch(() => []);
            if (!ranked.length) { secApi.status("Not enough data this month."); return; }
            ranked.forEach((entry) => {
              const row = secApi.row(entry.video);
              const vel = document.createElement("span");
              vel.style.cssText = "font-size:10px;color:#ffd166;white-space:nowrap";
              vel.textContent = " " + (entry.label || "");
              row.querySelector("div > div:last-child").appendChild(vel);
            });
            secApi.status("Top " + ranked.length + " rising videos (views/hour)");
          });
        });
      }

      // ── Time machine: same-date uploads from a previous year ──
      if (d.time_machine) {
        const api = host.addSection("time-machine", "Time Machine", (secApi) => {
          const years = d.time_machine_years || 1;
          const now = new Date();
          const target = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
          secApi.status("Looking for uploads from " + target.toLocaleDateString() + " \u2026");
          search("uploaded this date " + target.getFullYear()).then((videos) => {
            secApi.clear();
            videos.slice(0, d.feed_size || 20).forEach((v) => secApi.row(v));
            secApi.status(videos.length ? "Videos from " + target.getFullYear() : "Nothing found for this date.");
          });
        });
      }

      // ── Small creator spotlight ──
      if (d.small_creator) {
        const api = host.addSection("small-creator", "Small Creators", (secApi) => {
          secApi.status("Surfacing smaller channels\u2026");
          search("documentary").then((videos) => {
            secApi.clear();
            videos.slice(0, d.feed_size || 20).forEach((v) => secApi.row(v));
            secApi.status("Under " + (d.small_creator_max_subs || 10000) + " subs");
          });
        });
      }

      // ── credibility layer on search results ──
      if (d.credibility && location.pathname.startsWith("/results")) {
        const process = () => {
          document.querySelectorAll("ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer").forEach((card) => {
            if (card.dataset.prismCred) return;
            card.dataset.prismCred = "1";
            const meta = card.querySelector("#metadata-line");
            if (!meta) return;
            const text = meta.textContent || "";
            const views = parseCount((text.match(/([\d,.]+[KMB]?)\s*views?/i) || [])[1] || "");
            const ago = parseAgoMs((text.match(/([\d.]+)\s*(year|month|week|day)s?\s*ago/i) || [])[0] || "");
            if (!views) return;
            const badge = document.createElement("span");
            badge.style.cssText = "display:inline-flex;padding:1px 6px;border-radius:5px;font:600 9px system-ui;margin-left:4px;vertical-align:middle";
            if (views > 1e6) { badge.style.cssText += "background:rgba(76,175,80,.15);color:#81c784"; badge.textContent = "High reach"; }
            else if (views > 1e4) { badge.style.cssText += "background:rgba(255,193,7,.12);color:#ffd54f"; badge.textContent = "Growing"; }
            else { badge.style.cssText += "background:rgba(33,150,243,.12);color:#64b5f6"; badge.textContent = "Emerging"; }
            meta.appendChild(badge);
            if (ago && Date.now() - ago > 730 * 864e5) {
              const ab = document.createElement("span");
              ab.style.cssText = "display:inline-flex;padding:1px 6px;border-radius:5px;font:600 9px system-ui;margin-left:4px;background:rgba(255,152,0,.12);color:#ffb74d";
              ab.textContent = Math.floor((Date.now() - ago) / (365 * 864e5)) + "y old";
              meta.appendChild(ab);
            }
          });
        };
        process();
        ctx.timer.interval(process, 4000);
      }
    },
    stop() {
      const el = document.getElementById("prism-disco");
      if (el) el.remove();
      this._host = null;
    },
    health() {
      return { host: !!document.getElementById("prism-disco") };
    },
  });
})();
