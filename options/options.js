// PRISM dashboard (options page).
// A schema-driven settings UI: the Rust core owns defaults + validation,
// this page renders groups, searchable settings, command palette, profiles,
// backup/restore and diagnostics. All persistence via browser.storage.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // ── storage helpers ──
  async function getSetting() {
    const v = await browser.storage.local.get("settings");
    return (v.settings && v.settings.v) || "{}";
  }
  async function saveSetting(blob) {
    await browser.storage.local.set({ settings: { v: blob } });
  }

  // ── settings schema (mirrors the Rust config) ──
  // Each entry: [path, label, desc, control]
  // control: {t:"toggle"} | {t:"select", options:[[v,label]...]} |
  //          {t:"number", min, max, step} | {t:"text"} | {t:"textarea"}
  const GROUPS = [
    {
      id: "player", name: "Playback", icon: "▶",
      items: [
        ["player.speed_default", "Default speed", "Playback rate applied to every video", { t: "select", options: [[0.25, "0.25x"], [0.5, "0.5x"], [0.75, "0.75x"], [1, "1x"], [1.25, "1.25x"], [1.5, "1.5x"], [1.75, "1.75x"], [2, "2x"], [2.5, "2.5x"], [3, "3x"], [4, "4x"]] }],
        ["player.speed_per_channel", "Per-channel speed memory", "Remember the rate per channel", { t: "toggle" }],
        ["player.loop_video", "Loop video", "Repeat when it ends", { t: "toggle" }],
        ["player.quality_pref", "Preferred quality", "Applied to every video", { t: "select", options: [["auto", "Auto"], ["hd2160", "4K"], ["hd1440", "1440p"], ["hd1080", "1080p"], ["hd720", "720p"], ["large", "480p"], ["medium", "360p"], ["small", "240p"]] }],
        ["player.seek_step_sec", "Seek step (s)", "Forward/rewind buttons", { t: "number", min: 1, max: 120, step: 1 }],
        ["player.keep_screen_awake", "Keep screen awake", "Wake Lock while playing", { t: "toggle" }],
        ["player.screenshot_format", "Screenshot format", "X hotkey capture", { t: "select", options: [["png", "PNG"], ["jpeg", "JPEG"]] }],
        ["player.screenshot_clipboard", "Screenshot to clipboard", "Copy instead of download", { t: "toggle" }],
        ["player.sleep_timer_min", "Sleep timer (min)", "Auto-pause after N minutes", { t: "number", min: 1, max: 240, step: 1 }],
        ["player.auto_pause_hidden", "Pause when tab hidden", "", { t: "toggle" }],
        ["player.auto_pause_blurred", "Pause when window blurred", "", { t: "toggle" }],
        ["player.resume_auto_paused", "Auto-resume auto-paused", "Only for auto-pause pauses", { t: "toggle" }],
        ["player.pause_background_tabs", "Pause background tabs", "Save bandwidth/CPU", { t: "toggle" }],
        ["player.confirm_leave_playing", "Confirm leave while playing", "beforeunload guard", { t: "toggle" }],
        ["player.auto_recover_video", "Auto-recover on reconnect", "Resume after network drop", { t: "toggle" }],
        ["player.skip_ads", "Skip ads automatically", "Click skip buttons", { t: "toggle" }],
        ["player.default_original_audio", "Original audio track", "Prefer the original language", { t: "toggle" }],
        ["player.hfr_allow", "Allow 60fps (HFR)", "Set VISITOR_INFO1_LIVE", { t: "toggle" }],
        ["player.restore_fs_scroll", "Scroll in fullscreen", "", { t: "toggle" }],
        ["player.theater_default", "Theater mode default", "", { t: "toggle" }],
        ["player.theater_wide", "Theater on wide screens", "Over 1600px", { t: "toggle" }],
        ["player.cinema_opacity", "Cinema dim opacity", "0 = off", { t: "number", min: 0, max: 0.95, step: 0.05 }],
        ["player.ambient_blur_px", "Ambient glow blur (px)", "", { t: "number", min: 0, max: 80, step: 1 }],
        ["player.ambient_opacity", "Ambient glow opacity", "0 = off", { t: "number", min: 0, max: 1, step: 0.05 }],
        ["player.flip_h", "Flip horizontally", "", { t: "toggle" }],
        ["player.flip_v", "Flip vertically", "", { t: "toggle" }],
        ["player.filter_brightness", "Brightness (%)", "", { t: "number", min: 0, max: 200, step: 1 }],
        ["player.filter_contrast", "Contrast (%)", "", { t: "number", min: 0, max: 200, step: 1 }],
        ["player.filter_saturation", "Saturation (%)", "", { t: "number", min: 0, max: 200, step: 1 }],
        ["player.filter_hue_deg", "Hue (deg)", "", { t: "number", min: 0, max: 360, step: 1 }],
        ["player.filter_grayscale", "Grayscale", "", { t: "toggle" }],
        ["player.filter_zoom_pct", "Zoom (%)", "", { t: "number", min: 50, max: 200, step: 1 }],
        ["player.top_progress_bar", "Top progress bar", "Pinned to the top of the page", { t: "toggle" }],
        ["player.remaining_badge", "Remaining time badge", "", { t: "toggle" }],
        ["player.clock_badge", "Local clock badge", "", { t: "toggle" }],
        ["player.end_soon_warn", "End-soon warning", "", { t: "toggle" }],
        ["player.end_soon_sec", "End-soon threshold (s)", "", { t: "number", min: 5, max: 120, step: 5 }],
        ["player.force_watched_account", "Force-watched: account history", "", { t: "toggle" }],
        ["player.force_watched_local", "Force-watched: local history", "", { t: "toggle" }],
        ["player.idle_dim", "Idle dim", "Blur after inactivity", { t: "toggle" }],
        ["player.idle_dim_delay_sec", "Idle dim delay (s)", "", { t: "number", min: 5, max: 600, step: 5 }],
        ["player.idle_dim_blur_px", "Idle dim blur (px)", "", { t: "number", min: 1, max: 20, step: 1 }],
      ],
    },
    {
      id: "captions", name: "Captions", icon: "CC",
      items: [
        ["captions.enabled", "Always turn on captions", "Master switch", { t: "toggle" }],
        ["captions.lang", "Preferred language", "Empty = player default", { t: "text" }],
        ["captions.fallback_langs", "Fallback languages (comma)", "", { t: "text" }],
        ["captions.kind_pref", "Track kind", "", { t: "select", options: [["any", "Any"], ["human", "Human-written"], ["asr", "Auto-generated"]] }],
        ["captions.auto_translate", "Auto-translate fallback", "", { t: "toggle" }],
        ["captions.translate_to", "Translate to", "Language code", { t: "text" }],
        ["captions.skip_music", "Skip YouTube Music", "", { t: "toggle" }],
        ["captions.skip_shorts", "Skip Shorts", "", { t: "toggle" }],
        ["captions.respect_manual_off", "Respect manual off", "Per video", { t: "toggle" }],
        ["captions.reengage_after_ad", "Re-engage after ads", "", { t: "toggle" }],
        ["captions.native_prefs", "Native caption prefs", "Also set YouTube's own", { t: "toggle" }],
        ["captions.font_size_px", "Font size (px)", "", { t: "number", min: 10, max: 96, step: 1 }],
        ["captions.font_family", "Font family", "", { t: "text" }],
        ["captions.font_weight", "Font weight", "", { t: "select", options: [[400, "Regular"], [500, "Medium"], [600, "Semi-bold"], [700, "Bold"], [800, "Extra-bold"], [900, "Black"]] }],
        ["captions.text_color", "Text color", "Hex", { t: "text" }],
        ["captions.bg_color", "Background color", "Hex", { t: "text" }],
        ["captions.bg_opacity_pct", "Background opacity (%)", "", { t: "number", min: 0, max: 100, step: 1 }],
        ["captions.text_shadow", "Text shadow", "", { t: "select", options: [["outline", "Outline"], ["soft", "Soft"], ["heavy", "Heavy"], ["none", "None"]] }],
        ["captions.line_height", "Line height", "", { t: "number", min: 0.8, max: 2.2, step: 0.05 }],
        ["captions.letter_spacing_em", "Letter spacing (em)", "", { t: "number", min: -0.1, max: 0.4, step: 0.01 }],
        ["captions.position", "Caption position", "", { t: "select", options: [["bottom", "Bottom"], ["middle", "Center"], ["top", "Top"], ["left", "Left"], ["right", "Right"]] }],
        ["captions.radius_px", "Background radius (px)", "", { t: "number", min: 0, max: 30, step: 1 }],
        ["captions.uppercase", "Uppercase captions", "", { t: "toggle" }],
      ],
    },
    {
      id: "sponsorblock", name: "SponsorBlock", icon: "SB",
      items: [
        ["sponsorblock.enabled", "Enabled", "Segment skipping", { t: "toggle" }],
        ["sponsorblock.privacy", "Privacy mode", "Hide video IDs from the server", { t: "toggle" }],
        ["sponsorblock.toasts", "Skip notifications", "", { t: "toggle" }],
        ["sponsorblock.seekbar_marks", "Seekbar marks", "", { t: "toggle" }],
        ["sponsorblock.hud", "HUD chip", "Segments + time saved", { t: "toggle" }],
        ["sponsorblock.hidden_videos", "Hidden videos (JSON list)", "Per-video opt-out", { t: "textarea" }],
      ],
    },
    {
      id: "history", name: "Session", icon: "◷",
      items: [
        ["history.enabled", "Session history", "Track and resume", { t: "toggle" }],
        ["history.resume_mode", "Resume mode", "", { t: "select", options: [["off", "Off"], ["silent", "Silent"], ["card", "Card"], ["overlay", "Overlay"]] }],
        ["history.max_sessions_per_video", "Max sessions / video", "", { t: "number", min: 1, max: 200, step: 1 }],
        ["history.history_capacity", "History capacity", "Records kept", { t: "number", min: 100, max: 500000, step: 100 }],
        ["history.track_clicks", "Click recorder", "Local navigation log", { t: "toggle" }],
        ["history.watch_insights", "Watch insights", "Today + top channels", { t: "toggle" }],
      ],
    },
    {
      id: "feed", name: "Feed", icon: "≡",
      items: [
        ["feed.channel_blocklist", "Channel blocklist", "One @handle per line (uBlock syntax ok)", { t: "textarea" }],
        ["feed.hide_blocked_watch", "Hide blocked on watch page", "", { t: "toggle" }],
        ["feed.hide_blocked_browse", "Hide blocked channel pages", "", { t: "toggle" }],
        ["feed.hide_blocked_comments", "Hide blocked in comments", "", { t: "toggle" }],
        ["feed.keywords", "Keyword filter", "One per line", { t: "textarea" }],
        ["feed.watched_mode", "Watched feed videos", "", { t: "select", options: [["off", "Off"], ["dim", "Dim"], ["hide", "Hide"]] }],
        ["feed.number_results", "Number feed results", "", { t: "toggle" }],
        ["feed.highlight_long", "Highlight long videos", "", { t: "toggle" }],
        ["feed.highlight_short", "Highlight short videos", "", { t: "toggle" }],
        ["feed.long_min_sec", "Long threshold (s)", "", { t: "number", min: 60, max: 14400, step: 60 }],
        ["feed.short_max_sec", "Short threshold (s)", "", { t: "number", min: 5, max: 300, step: 5 }],
        ["feed.hide_live", "Hide live content", "", { t: "toggle" }],
        ["feed.hide_premieres", "Hide premieres", "", { t: "toggle" }],
        ["feed.hide_top_live_games", "Hide top live games shelf", "", { t: "toggle" }],
        ["feed.blur_thumbnails", "Blur thumbnails", "Until hover", { t: "toggle" }],
        ["feed.blur_px", "Blur strength (px)", "", { t: "number", min: 1, max: 30, step: 1 }],
        ["feed.disable_previews", "No preview on hover", "", { t: "toggle" }],
        ["feed.dense_grid", "Dense video grid", "5 per row", { t: "toggle" }],
        ["feed.remove_shorts", "Remove Shorts everywhere", "Master switch", { t: "toggle" }],
        ["feed.shorts_redirect", "Redirect Shorts links", "To the watch player", { t: "toggle" }],
        ["feed.shorts_dom_clean", "Strip injected Shorts", "DOM layer", { t: "toggle" }],
        ["feed.shorts_api_filter", "Filter Shorts pre-render", "API layer (recommended)", { t: "toggle" }],
        ["feed.hide_auto_dubbed", "Hide auto-dubbed videos", "", { t: "toggle" }],
        ["feed.restore_original_audio", "Restore original audio", "On the watch page", { t: "toggle" }],
      ],
    },
    {
      id: "comments", name: "Comments", icon: "💬",
      items: [
        ["comments.collapse_long", "Collapse long comments", "", { t: "toggle" }],
        ["comments.collapse_threshold_chars", "Collapse threshold (chars)", "", { t: "number", min: 400, max: 5000, step: 100 }],
        ["comments.highlight_creator", "Highlight creator comments", "", { t: "toggle" }],
        ["comments.highlight_timestamps", "Highlight timestamp links", "", { t: "toggle" }],
        ["comments.search_bar", "Comment search bar", "", { t: "toggle" }],
      ],
    },
    {
      id: "privacy", name: "Privacy & Geo", icon: "🛡",
      items: [
        ["privacy_shield", "Privacy shield", "Suppress all tracking features", { t: "toggle" }],
        ["privacy.geo_override", "Geo override", "Country + language", { t: "toggle" }],
        ["privacy.geo_region", "Region (ISO)", "e.g. US, DE, JP", { t: "text" }],
        ["privacy.geo_lang", "Language (code)", "e.g. en, de", { t: "text" }],
        ["privacy.geo_timezone", "Timezone (IANA)", "Empty = auto", { t: "text" }],
        ["privacy.patch_fetch", "Patch fetch()", "Rewrite innertube bodies", { t: "toggle" }],
        ["privacy.patch_xhr", "Patch XHR", "", { t: "toggle" }],
        ["privacy.patch_beacon", "Patch sendBeacon", "", { t: "toggle" }],
        ["privacy.patch_navigator", "Patch navigator language", "", { t: "toggle" }],
        ["privacy.cookie_control", "Cookie control", "Manage YouTube cookies", { t: "toggle" }],
        ["privacy.cookie_live", "Cookie live monitoring", "", { t: "toggle" }],
        ["privacy.block_yt_ai", "Hide YouTube AI features", "Summaries, AI buttons", { t: "toggle" }],
      ],
    },
    {
      id: "network", name: "Network", icon: "⇅",
      items: [
        ["network.monitor", "Data usage tracker", "", { t: "toggle" }],
        ["network.badge", "Corner badge", "Live down/up", { t: "toggle" }],
        ["network.patch_fetch", "Track fetch()", "", { t: "toggle" }],
        ["network.patch_xhr", "Track XHR", "", { t: "toggle" }],
        ["network.patch_beacon", "Track beacons", "", { t: "toggle" }],
        ["network.track_qualities", "Quality attribution", "Per-quality bytes", { t: "toggle" }],
        ["network.budget_enabled", "Monthly budget", "", { t: "toggle" }],
        ["network.budget_gb", "Budget (GB)", "", { t: "number", min: 1, max: 500, step: 1 }],
      ],
    },
    {
      id: "perf", name: "Performance", icon: "⚡",
      items: [
        ["perf.enabled", "Performance mode", "Tiered optimizations", { t: "toggle" }],
        ["perf.tier", "Tier", "", { t: "select", options: [["balanced", "Balanced"], ["aggressive", "Aggressive"]] }],
        ["perf.auto_enable", "Auto-enable when constrained", "Battery/CPU/save-data", { t: "toggle" }],
        ["perf.fps_counter", "FPS counter", "", { t: "toggle" }],
        ["perf.fps_pos", "FPS position", "", { t: "select", options: [["tl", "Top-left"], ["tr", "Top-right"], ["bl", "Bottom-left"], ["br", "Bottom-right"]] }],
        ["perf.buffer_health", "Buffer health monitor", "", { t: "toggle" }],
        ["perf.dropped_frames", "Dropped frame counter", "", { t: "toggle" }],
        ["perf.dropped_pos", "Dropped frames position", "", { t: "select", options: [["tl", "Top-left"], ["tr", "Top-right"], ["bl", "Bottom-left"], ["br", "Bottom-right"]] }],
        ["perf.dropped_show_rate", "Show rate instead of total", "", { t: "toggle" }],
        ["perf.dropped_reset_on_nav", "Reset on navigation", "", { t: "toggle" }],
        ["perf.long_task_warn", "Long-task warning", "", { t: "toggle" }],
        ["perf.long_task_threshold_ms", "Long-task threshold (ms)", "", { t: "number", min: 20, max: 1000, step: 10 }],
        ["perf.stats_overlay", "Stats overlay", "t / rate / buffer", { t: "toggle" }],
        ["perf.profiler", "Feature profiler", "Per-module CPU", { t: "toggle" }],
        ["perf.diag_console", "Activity monitor", "Live log", { t: "toggle" }],
      ],
    },
    {
      id: "theme", name: "Themes", icon: "🎨",
      items: [
        ["theme.enabled", "Theme engine", "", { t: "toggle" }],
        ["theme.selected", "Selected theme", "none = YouTube default", { t: "text" }],
        ["theme.glass_overhaul", "Glass overhaul", "Blur + translucency", { t: "toggle" }],
        ["theme.accent_hue", "Accent hue (deg)", "", { t: "number", min: 0, max: 359, step: 1 }],
        ["theme.focus_ring", "Keyboard focus ring", "", { t: "toggle" }],
        ["theme.sidebar_active", "Sidebar active highlight", "", { t: "toggle" }],
        ["theme.gen_color", "Theme generator base color", "Hex; use with Rust core", { t: "text" }],
      ],
    },
    {
      id: "discovery", name: "Discovery", icon: "✴",
      items: [
        ["discovery.anti_rec", "Anti-recommendation", "Break filter bubbles", { t: "toggle" }],
        ["discovery.momentum", "Before It Blew Up", "Rising videos", { t: "toggle" }],
        ["discovery.time_machine", "Time machine feed", "Same date, past year", { t: "toggle" }],
        ["discovery.time_machine_years", "Years back", "", { t: "number", min: 1, max: 10, step: 1 }],
        ["discovery.small_creator", "Small creator spotlight", "", { t: "toggle" }],
        ["discovery.small_creator_max_subs", "Max subscribers", "", { t: "number", min: 100, max: 1000000, step: 100 }],
        ["discovery.feed_size", "Feed size per tab", "", { t: "number", min: 5, max: 60, step: 1 }],
        ["discovery.vibe_search", "Vibe search", "Search by feeling", { t: "toggle" }],
        ["discovery.credibility", "Credibility layer", "Reach/age badges", { t: "toggle" }],
        ["discovery.search_remix", "Search remix", "Filter chips", { t: "toggle" }],
        ["discovery.outdated_detector", "Outdated detector", "Old-video badges", { t: "toggle" }],
        ["discovery.watch_genome", "Watch genome", "Preference model", { t: "toggle" }],
        ["discovery.algo_intelligence", "Algorithm intelligence", "Signal analysis", { t: "toggle" }],
        ["discovery.collections", "Curated collections", "", { t: "toggle" }],
      ],
    },
    {
      id: "intelligence", name: "Playback AI", icon: "🧠",
      items: [
        ["intelligence.scene_jumper", "Scene jumper", "Silence-detected markers", { t: "toggle" }],
        ["intelligence.video_dna", "Video DNA timeline", "Heatmap overlay", { t: "toggle" }],
        ["intelligence.smart_speed", "Smart speed", "Auto rate by density", { t: "toggle" }],
        ["intelligence.smart_speed_base", "Base rate", "", { t: "number", min: 0.25, max: 4, step: 0.25 }],
        ["intelligence.smart_speed_fast", "Fast rate", "", { t: "number", min: 0.25, max: 4, step: 0.25 }],
        ["intelligence.smart_queue", "Smart watch queue", "", { t: "toggle" }],
      ],
    },
    {
      id: "chrome", name: "Chrome & UI", icon: "🖥",
      items: [
        ["chrome.player_dash_button", "Player dashboard button", "", { t: "toggle" }],
        ["chrome.copy_timestamp_btn", "Copy timestamp button", "", { t: "toggle" }],
        ["chrome.copy_info_btn", "Copy video info button", "", { t: "toggle" }],
        ["chrome.transcript_btn", "Transcript button", "", { t: "toggle" }],
        ["chrome.video_notes", "Video notes", "Private local notes", { t: "toggle" }],
        ["chrome.channel_notes", "Channel notes", "", { t: "toggle" }],
        ["chrome.chapter_hotkeys", "Chapter hotkeys", "- / =", { t: "toggle" }],
        ["chrome.chapter_buttons", "Chapter buttons", "", { t: "toggle" }],
        ["chrome.chapter_panel", "Chapter list panel", "Clickable list", { t: "toggle" }],
        ["chrome.fwd_rewind_buttons", "Forward/rewind buttons", "", { t: "toggle" }],
        ["chrome.stop_button", "Stop button", "", { t: "toggle" }],
        ["chrome.flip_buttons", "Flip buttons", "", { t: "toggle" }],
        ["chrome.pip_button", "PiP button", "", { t: "toggle" }],
        ["chrome.logo_to_subs", "Logo to subscriptions", "", { t: "toggle" }],
        ["chrome.default_channel_tab", "Default channel tab", "", { t: "select", options: [["featured", "Featured"], ["videos", "Videos"], ["shorts", "Shorts"], ["live", "Live"], ["playlists", "Playlists"], ["community", "Community"], ["about", "About"]] }],
        ["chrome.auto_expand_desc", "Auto-expand description", "", { t: "toggle" }],
        ["chrome.disable_autoplay", "Disable autoplay", "", { t: "toggle" }],
        ["chrome.remove_redirects", "Skip /redirect URLs", "", { t: "toggle" }],
        ["chrome.shorten_share", "Shorten share URLs", "", { t: "toggle" }],
        ["chrome.dismiss_pause_dialog", "Dismiss pause dialog", "Safe auto-click", { t: "toggle" }],
        ["chrome.reverse_playlist", "Reverse playlist button", "", { t: "toggle" }],
        ["chrome.playlist_autoscroll", "Playlist autoscroll", "", { t: "toggle" }],
        ["chrome.compact_playlist", "Compact playlist", "", { t: "toggle" }],
        ["chrome.shorts_auto_mute", "Shorts auto-mute", "", { t: "toggle" }],
        ["chrome.shorts_hide_comments", "Shorts hide comments", "", { t: "toggle" }],
        ["chrome.top_bar_hide", "Hide top bar", "", { t: "toggle" }],
        ["chrome.hide_banner_ads", "Hide banner ads", "", { t: "toggle" }],
        ["chrome.compact_ui", "Compact UI", "", { t: "toggle" }],
        ["chrome.hide_recs", "Hide recommendations", "", { t: "toggle" }],
        ["chrome.hide_comments", "Hide comments", "", { t: "toggle" }],
        ["chrome.hide_endscreen", "Hide end-screen cards", "", { t: "toggle" }],
        ["chrome.hide_livechat", "Hide live chat", "", { t: "toggle" }],
        ["chrome.hide_watermark", "Hide watermark", "", { t: "toggle" }],
        ["chrome.hide_info_cards", "Hide info cards", "", { t: "toggle" }],
        ["chrome.always_progress_bar", "Always-visible progress bar", "", { t: "toggle" }],
        ["chrome.hidden_elements", "Hidden elements (JSON list)", "Element-control ids", { t: "textarea" }],
      ],
    },
    {
      id: "budget", name: "Time Budget", icon: "⏱",
      items: [
        ["budget.enabled", "Time budget", "Session limit bar", { t: "toggle" }],
        ["budget.session_minutes", "Session limit (min)", "", { t: "number", min: 5, max: 600, step: 5 }],
        ["budget.daily_minutes", "Daily limit (min)", "0 = off", { t: "number", min: 0, max: 1440, step: 15 }],
      ],
    },
    {
      id: "signals", name: "Signals", icon: "◎",
      items: [
        ["signals.dearrow", "DeArrow titles", "Clickbait-free titles", { t: "toggle" }],
        ["signals.ryd", "Dislike meter", "Return YouTube Dislike", { t: "toggle" }],
        ["signals.local_ai", "Local AI summaries", "Transformers.js on-device", { t: "toggle" }],
      ],
    },
  ];

  // ── state ──
  let settings = {};
  let activeGroup = "player";
  const searchIndex = [];
  GROUPS.forEach((g) => g.items.forEach(([path, label, desc]) => searchIndex.push({ path, label, desc, group: g.name })));

  // Minimal default shape so a fresh profile renders usable controls before
  // any content script has ever persisted settings (the Rust core is the
  // real authority on validation; this only prevents crashes/undefined UI).
  const DEFAULTS = {
    schema_version: 1,
    profile: "",
    privacy_shield: false,
    toasts: "normal",
    player: { speed_default: 1, speed_per_channel: false, loop_video: false, quality_pref: "hd1080", seek_step_sec: 10, keep_screen_awake: false, screenshot_format: "png", screenshot_scale: 1, screenshot_clipboard: false, sleep_timer_min: 30, auto_pause_hidden: false, auto_pause_blurred: false, resume_auto_paused: false, pause_background_tabs: false, confirm_leave_playing: false, auto_recover_video: false, skip_ads: false, default_original_audio: false, hfr_allow: false, restore_fs_scroll: false, theater_default: false, theater_wide: false, cinema_opacity: 0.85, ambient_blur_px: 24, ambient_opacity: 0.5, flip_h: false, flip_v: false, filter_brightness: 100, filter_contrast: 100, filter_saturation: 100, filter_hue_deg: 0, filter_grayscale: false, filter_zoom_pct: 100, top_progress_bar: false, remaining_badge: false, clock_badge: false, end_soon_warn: false, end_soon_sec: 20, force_watched_account: true, force_watched_local: true, idle_dim: false, idle_dim_delay_sec: 60, idle_dim_blur_px: 6 },
    captions: { enabled: false, lang: "", fallback_langs: ["en", "en-US", "en-GB"], kind_pref: "any", auto_translate: false, translate_to: "", skip_music: false, skip_shorts: false, respect_manual_off: false, reengage_after_ad: false, native_prefs: false, font_size_px: 28, font_family: "Roboto, Arial, sans-serif", font_weight: 700, text_color: "#ffffff", bg_color: "#000000", bg_opacity_pct: 72, text_shadow: "outline", line_height: 1.25, letter_spacing_em: 0, position: "bottom", radius_px: 4, uppercase: false },
    sponsorblock: { enabled: true, privacy: false, toasts: false, seekbar_marks: true, hud: true, category_actions: {}, hidden_videos: [] },
    history: { enabled: false, resume_mode: "silent", max_sessions_per_video: 50, history_capacity: 20000, track_clicks: false, watch_insights: false },
    feed: { channel_blocklist: "", hide_blocked_watch: false, hide_blocked_browse: false, hide_blocked_comments: false, keywords: "", watched_mode: "off", number_results: false, highlight_long: false, highlight_short: false, long_min_sec: 1200, short_max_sec: 60, hide_live: false, hide_premieres: false, hide_top_live_games: false, blur_thumbnails: false, blur_px: 12, disable_previews: false, dense_grid: false, remove_shorts: false, shorts_redirect: false, shorts_dom_clean: false, shorts_api_filter: false, hide_auto_dubbed: false, restore_original_audio: false },
    comments: { collapse_long: false, collapse_threshold_chars: 1200, highlight_creator: false, highlight_timestamps: false, search_bar: false },
    privacy: { geo_override: false, geo_region: "US", geo_lang: "en", geo_timezone: "", patch_fetch: false, patch_xhr: false, patch_beacon: false, patch_navigator: false, cookie_control: false, cookie_live: false, block_yt_ai: false },
    network: { monitor: false, badge: false, patch_fetch: true, patch_xhr: true, patch_beacon: true, track_qualities: false, budget_enabled: false, budget_gb: 50 },
    perf: { enabled: false, tier: "balanced", auto_enable: false, fps_counter: false, fps_pos: "tl", buffer_health: false, dropped_frames: false, dropped_pos: "tr", dropped_show_rate: false, dropped_reset_on_nav: true, long_task_warn: false, long_task_threshold_ms: 50, stats_overlay: false, profiler: false, diag_console: false },
    theme: { enabled: false, selected: "none", glass_overhaul: false, accent_hue: 215, focus_ring: false, sidebar_active: false, gen_color: "#ff3d7f" },
    discovery: { anti_rec: false, momentum: false, time_machine: false, time_machine_years: 1, small_creator: false, small_creator_max_subs: 10000, feed_size: 20, vibe_search: false, credibility: false, search_remix: false, outdated_detector: false, watch_genome: false, algo_intelligence: false, collections: false },
    intelligence: { scene_jumper: false, video_dna: false, smart_speed: false, smart_speed_base: 1, smart_speed_fast: 1.5, smart_queue: false },
    chrome: { player_dash_button: true, copy_timestamp_btn: false, copy_info_btn: false, transcript_btn: false, video_notes: false, channel_notes: false, chapter_hotkeys: false, chapter_buttons: false, chapter_panel: false, fwd_rewind_buttons: false, stop_button: false, flip_buttons: false, pip_button: false, logo_to_subs: false, default_channel_tab: "featured", auto_expand_desc: false, disable_autoplay: false, remove_redirects: false, shorten_share: false, dismiss_pause_dialog: false, reverse_playlist: false, playlist_autoscroll: false, compact_playlist: false, shorts_auto_mute: false, shorts_hide_comments: false, top_bar_hide: false, hide_banner_ads: false, compact_ui: false, hide_recs: false, hide_comments: false, hide_endscreen: false, hide_livechat: false, hide_watermark: false, hide_info_cards: false, always_progress_bar: false, hidden_elements: [] },
    budget: { enabled: false, session_minutes: 60, daily_minutes: 0 },
    signals: { dearrow: false, ryd: false, local_ai: false },
  };
  function deepMerge(base, patch) {
    for (const k of Object.keys(patch)) {
      if (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
        deepMerge(base[k], patch[k]);
      } else if (patch[k] !== undefined) {
        base[k] = patch[k];
      }
    }
    return base;
  }

  // ── rendering ──
  function renderNav() {
    const nav = $("nav");
    nav.replaceChildren();
    const total = GROUPS.reduce((n, g) => n + g.items.length, 0);
    const base = [
      { id: "overview", name: "Overview", icon: "◉", count: null },
      ...GROUPS.map((g) => ({ id: g.id, name: g.name, icon: g.icon, count: g.items.length })),
      { id: "diagnostics", name: "Diagnostics", icon: "▤", count: null },
    ];
    base.forEach((item) => {
      const el = document.createElement("div");
      el.className = "nav-item" + (item.id === activeGroup ? " active" : "");
      el.innerHTML = '<span>' + item.icon + "  " + item.name + '</span>' + (item.count !== null ? '<span class="count">' + item.count + "</span>" : "");
      el.addEventListener("click", () => { activeGroup = item.id; renderNav(); renderContent(); });
      nav.appendChild(el);
    });
    const count = $("nav").querySelector(".count");
    if (count) count.textContent = total;
  }

  function getValue(path) {
    let o = settings;
    for (const p of path.split(".")) o = o && o[p];
    return o;
  }
  function setValue(path, value) {
    const parts = path.split(".");
    let o = settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
    persist();
  }
  function persist() {
    saveSetting(JSON.stringify(settings)).catch((err) => console.error("[PRISM] persist", err));
  }

  function renderControl(item) {
    const [path, label, desc, control] = item;
    const wrap = document.createElement("div");
    wrap.className = "setting";
    const info = document.createElement("div");
    info.innerHTML = '<div class="lbl">' + label + '</div>' + (desc ? '<div class="desc">' + desc + "</div>" : "");
    wrap.appendChild(info);

    if (control.t === "toggle") {
      const sw = document.createElement("label");
      sw.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!getValue(path);
      input.addEventListener("change", () => setValue(path, input.checked));
      const slider = document.createElement("span");
      slider.className = "slider";
      sw.append(input, slider);
      wrap.appendChild(sw);
    } else if (control.t === "select") {
      const sel = document.createElement("select");
      control.options.forEach(([v, l]) => {
        const opt = document.createElement("option");
        opt.value = String(v);
        opt.textContent = l;
        opt.selected = String(getValue(path)) === String(v);
        sel.appendChild(opt);
      });
      sel.addEventListener("change", () => {
        const v = control.options.find(([x]) => String(x) === sel.value)[0];
        setValue(path, v);
      });
      wrap.appendChild(sel);
    } else if (control.t === "number") {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = control.min;
      inp.max = control.max;
      inp.step = control.step;
      inp.value = getValue(path) ?? control.min ?? 0;
      inp.addEventListener("change", () => {
        let v = Number(inp.value);
        if (control.min !== undefined && v < control.min) v = control.min;
        if (control.max !== undefined && v > control.max) v = control.max;
        inp.value = v;
        setValue(path, v);
      });
      wrap.appendChild(inp);
    } else if (control.t === "textarea") {
      const ta = document.createElement("textarea");
      const val = getValue(path);
      ta.value = Array.isArray(val) ? val.join("\n") : String(val ?? "");
      ta.addEventListener("change", () => {
        // Arrays stored as newline lists in the UI.
        const raw = ta.value;
        const parsed = raw.trim() ? raw.split("\n").map((s) => s.trim()).filter(Boolean) : [];
        setValue(path, parsed.length ? parsed : (control.asArray !== false ? [] : raw));
      });
      info.appendChild(ta);
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = getValue(path) ?? "";
      inp.addEventListener("change", () => setValue(path, inp.value));
      wrap.appendChild(inp);
    }
    return wrap;
  }

  function renderContent() {
    const content = $("content");
    content.replaceChildren();
    if (activeGroup === "overview") return renderOverview(content);
    if (activeGroup === "diagnostics") return renderDiagnostics(content);
    const group = GROUPS.find((g) => g.id === activeGroup);
    if (!group) return;
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = group.name;
    const sub = document.createElement("p");
    sub.className = "page-sub";
    sub.textContent = group.items.length + " settings · changes apply live";
    content.append(title, sub);
    const card = document.createElement("div");
    card.className = "card";
    group.items.forEach((item) => card.appendChild(renderControl(item)));
    content.appendChild(card);
  }

  function renderOverview(content) {
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = "Overview";
    content.appendChild(title);
    const sub = document.createElement("p");
    sub.className = "page-sub";
    sub.textContent = "PRISM — Rust core, thin shell. " + GROUPS.reduce((n, g) => n + g.items.length, 0) + " settings in " + GROUPS.length + " groups.";
    content.appendChild(sub);
    const grid = document.createElement("div");
    grid.className = "grid";
    const stats = [
      ["Groups", String(GROUPS.length)],
      ["Settings", String(GROUPS.reduce((n, g) => n + g.items.length, 0))],
      ["Core", "Rust (WASM)"],
      ["Protocol", "v1 (versioned)"],
    ];
    stats.forEach(([l, v]) => {
      const s = document.createElement("div");
      s.className = "stat";
      s.innerHTML = '<div class="v">' + v + '</div><div class="l">' + l + "</div>";
      grid.appendChild(s);
    });
    content.appendChild(grid);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = "<h3>Architecture</h3><p>All logic (config validation, filters, scrubbing, sponsorblock decisions, history, themes, network math, discovery ranking) executes in the Rust core compiled to WASM. The content shell is a thin DOM adapter with lifecycle-managed modules, crash quarantine and adaptive timers. Nothing runs while YouTube is idle.</p>";
    content.appendChild(card);
  }

  async function renderDiagnostics(content) {
    const title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = "Diagnostics";
    content.appendChild(title);
    const sub = document.createElement("p");
    sub.className = "page-sub";
    sub.textContent = "Runtime health from the active YouTube tab (if any).";
    content.appendChild(sub);

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = "<h3>Engine health</h3><div id='diag-body'>querying…</div>";
    content.appendChild(card);

    // Query the active tab.
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && /^https:\/\/(www\.|m\.|music\.)?youtube\.com/.test(tab.url)) {
        const res = await browser.tabs.sendMessage(tab.id, { type: "prism:ping" }).catch(() => null);
        const body = $("diag-body");
        if (!body) return;
        if (res && res.engine) {
          const h = res.engine;
          const modules = h.modules || [];
          // Build rows with createElement/textContent: module ids/states come
          // from the MAIN world (page-controlled) and must never hit innerHTML.
          body.replaceChildren();
          const stat = document.createElement("div");
          stat.className = "stat";
          stat.style.marginBottom = "10px";
          const v = document.createElement("div");
          v.className = "v";
          v.textContent = Math.round((h.uptimeMs || 0) / 1000) + "s";
          const l = document.createElement("div");
          l.className = "l";
          l.textContent = "uptime";
          stat.append(v, l);
          body.appendChild(stat);
          const head = document.createElement("div");
          head.className = "module-row";
          const name = document.createElement("span");
          name.className = "name";
          name.textContent = "Modules";
          const count = document.createElement("span");
          count.textContent = String(modules.length);
          head.append(name, count);
          body.appendChild(head);
          modules.forEach((m) => {
            const row = document.createElement("div");
            row.className = "module-row";
            const n = document.createElement("span");
            n.className = "name";
            n.textContent = m.id;
            const badge = document.createElement("span");
            badge.className = "badge " + (m.quarantined ? "err" : m.state === "started" ? "ok" : "warn");
            badge.textContent = m.quarantined ? "quarantined" : m.state;
            row.append(n, badge);
            body.appendChild(row);
          });
        } else if (res && res.core) {
          body.textContent = "Core is live; engine not yet booted on this tab.";
        } else {
          body.textContent = "No PRISM runtime detected in the active tab.";
        }
      } else {
        const b2 = $("diag-body");
        if (b2) b2.textContent = "Open a YouTube tab to see live diagnostics.";
      }
    } catch (_) {
      const b3 = $("diag-body");
      if (b3) b3.textContent = "No tab available.";
    }
  }

  // ── command palette ──
  function setupPalette() {
    const trigger = $("command-trigger");
    const palette = $("palette");
    const input = $("palette-input");
    const results = $("palette-results");
    const open = () => { palette.hidden = false; input.value = ""; results.replaceChildren(); input.focus(); };
    const close = () => { palette.hidden = true; };
    trigger.addEventListener("click", open);
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette.hidden ? open() : close();
      }
      if (e.key === "Escape") close();
    });
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      results.replaceChildren();
      const hits = searchIndex.filter((s) => (s.label + " " + s.desc + " " + s.path).toLowerCase().includes(q)).slice(0, 12);
      hits.forEach((hit) => {
        const el = document.createElement("div");
        el.className = "palette-item";
        el.innerHTML = hit.label + ' <span class="k">' + hit.group + " · " + hit.path + "</span>";
        el.addEventListener("click", () => {
          activeGroup = hit.path.split(".")[0];
          close();
          renderNav();
          renderContent();
        });
        results.appendChild(el);
      });
      if (!hits.length) {
        const none = document.createElement("div");
        none.className = "palette-item";
        none.textContent = "No matches";
        results.appendChild(none);
      }
    });
  }

  // ── profiles / backup / restore ──
  function setupBackup() {
    $("backup-btn").addEventListener("click", async () => {
      const blob = JSON.stringify({ version: 1, ts: Date.now(), settings: JSON.parse(await getSetting()) }, null, 2);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "prism-settings-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 6000);
    });
    $("restore-btn").addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.addEventListener("change", async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const parsed = JSON.parse(await f.text());
          const blob = parsed.settings ? JSON.stringify(parsed.settings) : JSON.stringify(parsed);
          settings = JSON.parse(blob);
          persist();
          renderContent();
          alert("Settings restored.");
        } catch (_) {
          alert("Could not read that file.");
        }
      });
      input.click();
    });
    $("profiles-btn").addEventListener("click", () => {
      const modal = $("modal");
      modal.replaceChildren();
      const box = document.createElement("div");
      box.className = "modal-box";
      const title = document.createElement("h3");
      title.textContent = "Profiles";
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "Profiles are named setting snapshots. (Storage model ready; UI ships in the next iteration.)";
      const close = document.createElement("button");
      close.className = "ghost-btn";
      close.textContent = "Close";
      close.addEventListener("click", () => { modal.hidden = true; });
      box.append(title, note, close);
      modal.appendChild(box);
      modal.hidden = false;
    });
  }
  function showModal(html) {
    const modal = $("modal");
    modal.innerHTML = '<div class="modal-box">' + html + "</div>";
    modal.hidden = false;
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  }

  // ── boot ──
  async function init() {
    $("ver").textContent = browser.runtime.getManifest().version;
    let loaded = {};
    try {
      loaded = JSON.parse(await getSetting()) || {};
    } catch (_) {
      loaded = {};
    }
    // Deep-merge over defaults: a fresh profile renders usable controls and
    // partial blobs never produce undefined reads.
    settings = deepMerge(structuredClone(DEFAULTS), loaded);
    renderNav();
    renderContent();
    setupPalette();
    setupBackup();
  }
  init();
})();
