// PRISM popup: instant startup, minimal rendering. Queries the active
// YouTube tab's runtime state; falls back to graceful "no tab" state.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const HOME = "https://github.com/mheci/PRISM";

  // Settings index for quick search (kept in sync with the Rust schema).
  const SETTINGS_INDEX = [
    ["player.speed_default", "Playback Speed", "Default playback rate"],
    ["player.speed_per_channel", "Per-Channel Speed", "Remember speed per channel"],
    ["player.loop_video", "Loop Video", "Repeat the video"],
    ["player.keep_screen_awake", "Keep Screen Awake", "Wake Lock while playing"],
    ["player.skip_ads", "Skip Ads", "Auto-click skip buttons"],
    ["captions.enabled", "Always Captions", "Force captions on"],
    ["captions.position", "Caption Position", "Bottom/Center/Top/Left/Right"],
    ["sponsorblock.enabled", "SponsorBlock", "Skip sponsored segments"],
    ["history.enabled", "Session History", "Resume where you left off"],
    ["history.resume_mode", "Resume Mode", "Silent/Card/Overlay"],
    ["feed.channel_blocklist", "Channel Blocker", "Hide channels"],
    ["feed.keywords", "Keyword Filter", "Hide titles containing words"],
    ["feed.remove_shorts", "Remove Shorts", "Strip Shorts everywhere"],
    ["feed.hide_auto_dubbed", "Hide Auto-Dubbed", "Filter dubbed videos"],
    ["chrome.top_bar_hide", "Hide Top Bar", "Remove the masthead"],
    ["chrome.hidden_elements", "Hide Page Elements", "359-element catalog"],
    ["privacy.geo_override", "Geo Override", "Country & language"],
    ["privacy.cookie_control", "Cookie Control", "Manage YouTube cookies"],
    ["network.monitor", "Data Usage Tracker", "Network bytes + budget"],
    ["network.budget_gb", "Data Budget", "Monthly limit"],
    ["perf.enabled", "Performance Mode", "Tiered optimizations"],
    ["theme.enabled", "Theme Engine", "200 themes"],
    ["discovery.anti_rec", "Anti-Recommendation", "Break filter bubbles"],
    ["discovery.momentum", "Before It Blew Up", "Rising videos"],
    ["intelligence.scene_jumper", "Scene Jumper", "Scene markers"],
    ["intelligence.smart_speed", "Smart Speed", "Auto rate"],
    ["budget.enabled", "Time Budget", "Session limit"],
    ["signals.dearrow", "DeArrow", "Clickbait-free titles"],
    ["signals.ryd", "Dislike Meter", "Return YouTube Dislike"],
    ["signals.local_ai", "Local AI", "On-device summaries"],
  ];

  async function init() {
    let manifest = null;
    try { manifest = browser.runtime.getManifest(); } catch (_) {}
    $("ver").textContent = manifest ? manifest.version : "?";

    // Health from the active tab.
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && /^https:\/\/(www\.|m\.|music\.)?youtube\.com/.test(tab.url)) {
        const res = await browser.tabs.sendMessage(tab.id, { type: "prism:ping" }).catch(() => null);
        if (res && res.engine) renderHealth(res.engine);
        else $("st-engine").textContent = "tab open, engine idle";
      } else {
        $("st-engine").textContent = "open a YouTube tab";
        $("health").textContent = "idle";
      }
    } catch (_) {
      $("st-engine").textContent = "open a YouTube tab";
    }

    // Quick search.
    const search = $("search");
    const results = $("results");
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      results.replaceChildren();
      if (!q) return;
      const hits = SETTINGS_INDEX.filter(([, name, desc]) =>
        (name + " " + desc).toLowerCase().includes(q)
      ).slice(0, 8);
      hits.forEach(([path, name, desc]) => {
        const row = document.createElement("div");
        row.className = "result";
        row.innerHTML = '<div>' + name + ' <span class="k">' + path + "</span></div>";
        row.title = desc;
        row.addEventListener("click", () => browser.runtime.openOptionsPage());
        results.appendChild(row);
      });
    });

    $("open-yt").addEventListener("click", () => browser.tabs.create({ url: "https://www.youtube.com" }));
    $("open-options").addEventListener("click", () => browser.runtime.openOptionsPage());
    $("open-releases").addEventListener("click", () => browser.tabs.create({ url: HOME + "/releases" }));
  }

  function renderHealth(h) {
    const pill = $("health");
    const quarantined = (h.quarantined || []).length;
    const failed = (h.modules || []).filter((m) => m.state === "failed" || m.quarantined).length;
    $("st-engine").textContent = h.uptimeMs ? Math.round(h.uptimeMs / 1000) + "s up" : "—";
    $("st-modules").textContent = (h.modules || []).length + " (" + failed + " troubled)";
    $("st-quarantined").textContent = quarantined;
    $("st-video").textContent = "—";
    if (failed || quarantined) { pill.textContent = "warn"; pill.className = "pill warn"; }
    else { pill.textContent = "ok"; pill.className = "pill ok"; }
  }

  init();
})();
