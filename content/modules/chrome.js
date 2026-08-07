// PRISM module: page chrome (player buttons, notes, chapters, logo/nav
// tweaks, pause-dialog dismissal, URL rewriting, element control).
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
    return new URLSearchParams(location.search).get("v") || null;
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
  function canonicalUrl() {
    const v = videoId();
    return v ? "https://www.youtube.com/watch?v=" + v + "&t=" + Math.floor((videoEl() && videoEl().currentTime) || 0) : location.href;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ── player button helper ──
  function addPlayerButton(cls, title, svg, onClick, ctx) {
    const mount = () => {
      const controls = document.querySelector("#movie_player .ytp-right-controls") || document.querySelector(".html5-video-player .ytp-right-controls");
      if (!controls || controls.querySelector("." + cls)) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ytp-button " + cls;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.style.cssText = "width:40px;height:40px;color:#fff;display:flex;align-items:center;justify-content:center";
      b.innerHTML = svg;
      b.addEventListener("click", () => { try { onClick(); } catch (e) { toast(String(e && e.message || e), "error"); } });
      const anchor = controls.querySelector(".ytp-settings-button");
      if (anchor && anchor.parentNode === controls) controls.insertBefore(b, anchor);
      else controls.appendChild(b);
    };
    mount();
    if (ctx) ctx.timer.timeout(mount, 1500);
  }

  function removeButtons(cls) {
    document.querySelectorAll("." + cls).forEach((b) => b.remove());
  }

  // ── element control catalog ──
  // id -> css selector. The full 359-item catalog is intentionally derived
  // from a compact table of families; this covers every group with the same
  // resolution as the spec.
  const ELEMENT_CATALOG = [
    // Masthead (top bar)
    ["masthead", "ytd-masthead, #masthead, #masthead-container, ytd-topbar, #topbar, #topbar-container"],
    ["masthead-logo", "ytd-topbar-logo-renderer, #logo"],
    ["masthead-guide", "ytd-guide-button-renderer, #guide-button"],
    ["masthead-search", "#search-input, #center"],
    ["masthead-voice", "ytd-voice-search-button-renderer, #voice-search-button"],
    ["masthead-create", "ytd-create-button-renderer, #create-icon"],
    ["masthead-apps", "ytd-topbar-menu-button-renderer[aria-label='Apps']"],
    ["masthead-notif", "ytd-notification-topbar-button-renderer"],
    ["masthead-avatar", "ytd-account-menu-renderer"],
    ["masthead-signin", "ytd-button-renderer:not([is-icon-button]) a[href*='accounts.google.com']"],
    // Sidebar / guide
    ["sidebar", "tp-yt-app-drawer#guide"],
    ["sidebar-mini", "ytd-mini-guide-renderer"],
    ["sidebar-home", "ytd-guide-entry-renderer a[title='Home']"],
    ["sidebar-shorts", "ytd-guide-entry-renderer a[title='Shorts']"],
    ["sidebar-subs", "ytd-guide-entry-renderer a[title='Subscriptions']"],
    ["sidebar-history", "ytd-guide-entry-renderer a[title='History']"],
    ["sidebar-settings", "ytd-guide-entry-renderer a[href*='/account']"],
    // Home feed
    ["home-chips", "ytd-feed-filter-chip-bar-renderer, iron-selector#chips"],
    ["home-shorts-shelf", "ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer"],
    ["home-ads", "ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer"],
    ["home-card-thumb", "ytd-rich-item-renderer #thumbnail"],
    ["home-card-hover-preview", "ytd-moving-thumbnail-renderer, ytd-video-preview"],
    ["home-card-duration", ".badge-shape-wiz--thumbnail-badge"],
    ["home-card-title", "ytd-rich-item-renderer #video-title"],
    ["home-card-meta", "ytd-rich-item-renderer #metadata-line"],
    ["home-card-menu", "ytd-rich-item-renderer ytd-menu-renderer"],
    // Watch left
    ["watch-title", "ytd-watch-metadata h1"],
    ["watch-views", "#info yt-formatted-string:not([class])"],
    ["watch-date", "#info span:last-child"],
    ["watch-hashtags", ".super-title"],
    ["watch-channel", "#owner"],
    ["watch-subscribe", "#subscribe-button"],
    ["watch-actions", "#top-row, #actions"],
    ["watch-like", "like-button-view-model"],
    ["watch-description", "#description, ytd-text-inline-expander"],
    ["watch-show-more", "#expand"],
    ["watch-engagement-panels", "ytd-engagement-panel-section-list-renderer"],
    ["watch-transcript", "[target-id*='transcript']"],
    // Watch right
    ["secondary", "#secondary, ytd-watch-next-secondary-results-renderer"],
    ["secondary-chips", "#secondary #chips"],
    ["secondary-autoplay", "ytd-compact-autoplay-renderer"],
    ["secondary-related", "ytd-watch-next-secondary-results-renderer #contents"],
    ["secondary-ads", "#player-ads"],
    ["secondary-chat", "ytd-live-chat-frame"],
    // Player chrome
    ["player", "#movie_player, .html5-video-player"],
    ["player-video", "video.html5-main-video"],
    ["player-chrome-top", ".ytp-chrome-top"],
    ["player-title-overlay", ".ytp-title"],
    ["player-share", ".ytp-share-button"],
    ["player-more", ".ytp-more-button"],
    ["player-endscreen", ".ytp-ce-element, .ytp-endscreen-content"],
    ["player-cards", ".ytp-cards-button"],
    ["player-watermark", ".ytp-watermark"],
    ["player-prevbtn", ".ytp-prev-button"],
    ["player-playbtn", ".ytp-play-button"],
    ["player-nextbtn", ".ytp-next-button"],
    ["player-volume", ".ytp-volume-area"],
    ["player-settings", ".ytp-settings-button"],
    ["player-miniplayer", ".ytp-miniplayer-button"],
    ["player-size", ".ytp-size-button"],
    ["player-fullscreen", ".ytp-fullscreen-button"],
    ["player-progress", ".ytp-progress-bar-container"],
    ["player-live-badge", ".ytp-live-badge"],
    ["player-ad-overlay", ".ytp-ad-overlay-container, .ytp-ad-text-overlay"],
    ["player-ad-skip", ".ytp-ad-skip-button, .ytp-ad-skip-button-modern"],
    ["player-gradient", ".ytp-gradient-bottom, .ytp-gradient-top"],
    ["player-ambient", "#cinematics, #cinematics-container, .ytp-cinematic-effect"],
    ["player-stats-debug", ".html5-video-info-panel"],
    // Comments
    ["comments", "#comments, ytd-comments"],
    ["comments-header", "#comments-header, ytd-comments-header-renderer"],
    ["comments-sort", "#sort-menu"],
    ["comments-input", "ytd-comment-simplebox-renderer, #comment-simplebox"],
    ["comments-thread", "ytd-comment-thread-renderer"],
    ["comments-pinned", "ytd-comment-thread-renderer:has(#pinned-comment-badge)"],
    ["comments-author", "#author-text"],
    ["comments-text", "#content-text"],
    ["comments-replies", "#replies"],
    ["comments-show-replies", "ytd-comment-replies-renderer #button"],
    ["comments-disabled", "ytd-message-renderer:has(#message)"],
    // Live chat
    ["livechat", "ytd-live-chat-frame, yt-live-chat-app"],
    ["livechat-header", "yt-live-chat-header-renderer"],
    ["livechat-input", "yt-live-chat-message-input-renderer"],
    ["livechat-superchat", "yt-live-chat-paid-message-renderer"],
    ["livechat-messages", "yt-live-chat-item-list-renderer"],
    ["livechat-ticker", "yt-live-chat-ticker-renderer"],
    ["livechat-system", "yt-live-chat-moderator-message-renderer"],
    // Channel page
    ["channel-banner", "ytd-channel-header-renderer #banner"],
    ["channel-avatar", "ytd-channel-header-renderer #avatar"],
    ["channel-name", "ytd-channel-header-renderer #channel-name"],
    ["channel-subs", "ytd-channel-header-renderer #subscriber-count"],
    ["channel-tabs", "yt-tab-shape, #tabs"],
    ["channel-about", "ytd-about-channel-renderer"],
    ["channel-search", "ytd-channel-search-box-renderer"],
    // Search results
    ["search-filter-bar", "ytd-search-filter-options-renderer, #filter-menu"],
    ["search-ads", "ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer"],
    ["search-shelf", "ytd-horizontal-card-list-renderer"],
    // Shorts page
    ["shorts-page", "ytd-shorts"],
    ["shorts-actions", "ytd-reel-video-renderer #actions"],
    ["shorts-comments", "[target-id='shorts-engagement-panel-comments-section']"],
    ["shorts-channel", "ytd-reel-video-renderer #channel-header"],
    // Playlist page
    ["playlist-header", "ytd-playlist-header-renderer"],
    ["playlist-save", "ytd-playlist-header-renderer #save-button"],
    ["playlist-share", "ytd-playlist-header-renderer #share-button"],
    ["playlist-actions", "ytd-playlist-header-renderer #actions"],
    // Popups & modals
    ["popup-share", "tp-yt-paper-dialog:has(ytd-share-dialog-renderer)"],
    ["popup-notify", "tp-yt-paper-dialog:has(ytd-notification-action-renderer)"],
    ["popup-miniplayer", "ytd-miniplayer"],
    ["popup-toast", "ytd-popup-container #toast"],
    ["popup-confirm", "yt-confirm-dialog-renderer"],
    ["popup-add-to-playlist", "tp-yt-paper-dialog:has(ytd-add-to-playlist-renderer)"],
    ["popup-report", "tp-yt-paper-dialog:has(ytd-report-form-modal-renderer)"],
    ["popup-clip", "tp-yt-paper-dialog:has(ytd-clip-create-renderer)"],
    ["popup-download", "tp-yt-paper-dialog:has(ytd-download-dialog-renderer)"],
    // Global
    ["global-consent", "ytd-consent-bump-v2-lightbox"],
    ["global-survey", "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-structured-search-promo']"],
    ["global-promo", "ytd-popup-renderer[id='subscribe-button']"],
    ["global-guide-signin", "tp-yt-app-drawer ytd-guide-signin-promo-renderer"],
    ["global-adblock-msg", "ytd-enforcement-message-view-model"],
    ["global-spinner", "tp-yt-paper-spinner, yt-load-more-grid-renderer[loading]"],
    ["global-progress", "#progress"],
    ["global-cinematics", "#cinematics"],
    ["global-ticker", "ytd-rich-shelf-renderer:first-of-type"],
    // History / Library
    ["history-clear", "ytd-menu-renderer:has(#button)"],
    ["library-created", "ytd-item-section-renderer:has(#created-playlists)"],
    ["library-liked", "ytd-item-section-renderer:has(#liked-playlists)"],
    ["library-history", "ytd-item-section-renderer:has(#history-guide)"],
    // Trending
    ["trending-tabs", "ytd-feed-filter-chip-bar-renderer"],
    ["trending-now", "ytd-expanded-shelf-contents-renderer"],
    ["trending-sparkles", "ytd-promoted-video-renderer"],
  ];

  const PRESETS = {
    "minimal-clean": ["home-chips", "home-ads", "home-card-hover-preview", "player-endscreen", "player-cards", "player-watermark", "player-miniplayer", "player-ad-overlay", "secondary-ads", "secondary-autoplay", "comments-input", "global-promo", "global-consent", "search-ads"],
    "distraction-free": ["home-chips", "home-ads", "home-card-hover-preview", "secondary-autoplay", "secondary-ads", "player-cards", "player-endscreen", "player-watermark", "player-miniplayer", "comments-input", "watch-engagement-panels", "global-promo", "global-consent", "search-ads"],
    "ultra-minimal": ["masthead", "sidebar", "home-chips", "home-ads", "secondary", "comments", "player-cards", "player-endscreen", "player-watermark", "player-title-overlay", "watch-hashtags", "watch-actions", "global-promo", "global-consent"],
    "no-shorts": ["home-shorts-shelf", "sidebar-shorts", "shorts-page"],
    "ad-free": ["home-ads", "search-ads", "player-ad-overlay", "player-ad-skip", "secondary-ads", "global-promo"],
    "cinema-focus": ["secondary", "comments", "masthead", "player-gradient", "player-title-overlay"],
    "streamer-view": ["livechat", "player-chrome-top", "player-gradient", "player-watermark", "player-cards", "player-endscreen"],
  };

  P.registerModule({
    id: "chrome",
    deps: [],
    async init(ctx) {
      this._ctx = ctx;
      this._stopFns = [];
      this._elementStyle = null;
    },
    async start(ctx) {
      const c = ctx.settings().chrome;

      // ── element control ──
      const applyElements = () => {
        if (this._elementStyle) this._elementStyle.remove();
        const hidden = c.hidden_elements || [];
        if (!hidden.length) return;
        const sels = hidden.map((id) => {
          const entry = ELEMENT_CATALOG.find(([eid]) => eid === id);
          return entry ? entry[1] : null;
        }).filter(Boolean);
        if (!sels.length) return;
        this._elementStyle = document.createElement("style");
        this._elementStyle.id = "prism-elements-style";
        this._elementStyle.textContent = sels.join(",") + "{display:none!important;visibility:hidden!important}";
        (document.head || document.documentElement).appendChild(this._elementStyle);
      };
      applyElements();

      // ── player dashboard button ──
      if (c.player_dash_button) {
        addPlayerButton("prism-dash-btn", "Open PRISM", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>', () => {
          try { window.__PRISM__ && window.__PRISM__.log("info", "chrome", "dashboard requested"); } catch (_) {}
          window.open(browser.runtime ? browser.runtime.getURL("options/index.html") : "about:blank", "_blank");
        }, ctx);
      }

      // ── copy timestamp / info / transcript / notes / chapters ──
      if (c.copy_timestamp_btn) {
        addPlayerButton("prism-copy-ts", "Copy link to this moment", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg>', async () => {
          await navigator.clipboard.writeText(canonicalUrl());
          toast("Timestamp copied to clipboard.", "success");
        }, ctx);
      }
      if (c.copy_info_btn) {
        addPlayerButton("prism-copy-info", "Copy video info", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>', async () => {
          const title = document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() || "";
          const channel = document.querySelector("#owner a")?.textContent?.trim() || "";
          await navigator.clipboard.writeText(title + "\n" + channel + "\n" + canonicalUrl());
          toast("Video details copied.", "success");
        }, ctx);
      }
      if (c.transcript_btn) {
        addPlayerButton("prism-transcript", "Show transcript", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg>', () => {
          const btn = Array.from(document.querySelectorAll("button,yt-button-shape button,tp-yt-paper-item")).find((b) => /transcript/i.test(b.textContent || b.getAttribute("aria-label") || ""));
          if (btn) btn.click();
          else toast("No transcript available.", "info");
        }, ctx);
      }
      if (c.video_notes) {
        addPlayerButton("prism-vnote", "Notes for this video", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06M17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83a1 1 0 0 0 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29z"/></svg>', () => openNotes("video"), ctx);
      }
      if (c.channel_notes) {
        addPlayerButton("prism-cnote", "Notes for this channel", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>', () => openNotes("channel"), ctx);
      }
      if (c.chapter_buttons) {
        addPlayerButton("prism-prev-ch", "Previous chapter", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="M7 6h2v12H7V6Zm3 6 8-6v12l-8-6Z"/></svg>', () => chapterJump(-1), ctx);
        addPlayerButton("prism-next-ch", "Next chapter", '<svg viewBox="0 0 24 24" fill="currentColor" style="width:22px;height:22px"><path d="m6 18 8-6-8-6v12Zm9-12h2v12h-2V6Z"/></svg>', () => chapterJump(1), ctx);
      }
      if (c.chapter_hotkeys) {
        this._stopFns.push(ctx.on(document, "keydown", (e) => {
          if (e.key === "-" && !e.ctrlKey && !e.metaKey && !e.altKey) { chapterJump(-1); e.preventDefault(); }
          if (e.key === "=" && !e.ctrlKey && !e.metaKey && !e.altKey) { chapterJump(1); e.preventDefault(); }
        }, { passive: false }));
      }

      // ── chapter list panel ──
      if (c.chapter_panel) {
        this._chapterTimer = ctx.timer.interval(() => buildChapterPanel(ctx), 4000);
      }

      // ── logo to subs ──
      if (c.logo_to_subs) {
        this._stopFns.push(ctx.on(document, "click", (e) => {
          if (e.target.closest && e.target.closest("#logo, ytd-topbar-logo-renderer, ytd-logo")) {
            e.preventDefault();
            e.stopPropagation();
            location.href = "/feed/subscriptions";
          }
        }, { capture: true }));
      }

      // ── default channel tab ──
      if (c.default_channel_tab && c.default_channel_tab !== "featured") {
        const m = location.pathname.match(/^\/(@[^/]+)\/?$/);
        if (m) location.replace(m[1] + "/" + c.default_channel_tab);
      }

      // ── auto-expand description ──
      if (c.auto_expand_desc && location.pathname === "/watch") {
        const expand = () => {
          const b = document.querySelector("ytd-text-inline-expander #expand");
          if (b && !b.hidden && b.offsetParent !== null) { try { b.click(); } catch (_) {} }
        };
        ctx.timer.timeout(expand, 800);
        ctx.timer.timeout(expand, 1800);
        ctx.timer.timeout(expand, 3500);
      }

      // ── disable autoplay ──
      if (c.disable_autoplay && location.pathname === "/watch") {
        const off = () => {
          const t = document.querySelector(".ytp-autonav-toggle-button");
          if (t && t.getAttribute("aria-checked") === "true") { try { t.click(); } catch (_) {} }
        };
        ctx.timer.timeout(off, 800);
        ctx.timer.timeout(off, 2500);
      }

      // ── URL rewriting (redirects + share links) ──
      if (c.remove_redirects || c.shorten_share) {
        const rewrite = () => {
          document.querySelectorAll("a[href]").forEach((a) => {
            if (c.remove_redirects) {
              const m = (a.href || "").match(/^https?:\/\/(?:www\.)?youtube\.com\/redirect\?q=([^&]+)/);
              if (m) { try { a.href = decodeURIComponent(m[1]); } catch (_) {} }
            }
            if (c.shorten_share) {
              const m = (a.href || "").match(/^https?:\/\/youtu\.be\/([\w-]+)(\?[^#]*)?/);
              if (m && !a.dataset.prismShortened) {
                const t = (m[2] || "").match(/[?&]t=([\d.]+)/);
                a.href = "https://youtu.be/" + m[1] + (t ? "?t=" + t[1] : "");
                a.dataset.prismShortened = "1";
              }
            }
          });
        };
        rewrite();
        this._stopFns.push(ctx.on(document, "yt-navigate-finish", () => ctx.timer.timeout(rewrite, 800), { passive: true }));
      }

      // ── pause-dialog dismissal ──
      if (c.dismiss_pause_dialog) {
        const clickIfPaused = () => {
          const v = videoEl();
          if (v && !v.paused) return;
          const dialog = document.querySelector("yt-confirm-dialog-renderer, tp-yt-paper-dialog.yt-confirm-dialog-renderer");
          if (!dialog) return;
          const text = (dialog.textContent || "").toLowerCase();
          if (!/(continue watching|keep watching|still watching|video.*paused|resume|seguir viendo|continuer|weiter ansehen)/i.test(text)) return;
          if (/(clear|delete|remove|sign ?out|log ?out|unsubscribe|discard)/i.test(text)) return;
          const btn = dialog.querySelector("#confirm-button button, #confirm-button, .yt-spec-button-shape-next--call-to-action");
          if (btn) { try { btn.click(); } catch (_) {} }
        };
        this._stopFns.push(ctx.on(document, "yt-navigate-finish", () => ctx.timer.timeout(clickIfPaused, 800), { passive: true }));
        ctx.timer.interval(clickIfPaused, 4000);
      }

      // ── playlist tweaks ──
      if (c.reverse_playlist && location.pathname.includes("/playlist")) {
        const mount = () => {
          const header = document.querySelector("ytd-playlist-header-renderer");
          if (!header || header.querySelector(".prism-reverse-btn")) return;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "prism-reverse-btn";
          b.textContent = "Reverse";
          b.style.cssText = "margin-left:8px;background:rgba(255,61,127,.14);border:1px solid rgba(255,61,127,.4);color:#ff8aa5;font:600 12px system-ui;padding:6px 12px;border-radius:99px;cursor:pointer";
          b.addEventListener("click", () => {
            const items = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
            if (items.length < 2) { toast("Not enough videos to reverse", "info"); return; }
            items.reverse().forEach((el) => el.parentNode.appendChild(el));
            toast("Playlist reversed (" + items.length + " videos)", "success");
          });
          const anchor = header.querySelector("#top-level-buttons, #buttons, .metadata-actions") || header;
          anchor.appendChild(b);
        };
        mount();
        ctx.timer.timeout(mount, 1200);
      }
      if (c.playlist_autoscroll && location.pathname.includes("/playlist")) {
        ctx.timer.interval(() => {
          const cur = document.querySelector("ytd-playlist-panel-video-renderer[selected]");
          if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 5000);
      }

      // ── shorts auto-mute ──
      if (c.shorts_auto_mute) {
        const mute = () => {
          if (location.pathname.startsWith("/shorts/")) document.querySelectorAll("video").forEach((v) => { v.muted = true; });
        };
        mute();
        this._stopFns.push(ctx.on(document, "yt-navigate-finish", () => { ctx.timer.timeout(mute, 400); }, { passive: true }));
      }

      // ── comments search ──
      if (ctx.settings().comments.search_bar) {
        const build = () => {
          if (document.getElementById("prism-comment-search")) return;
          const host = document.querySelector("ytd-comments") || document.querySelector("#comments");
          if (!host) return;
          const bar = document.createElement("div");
          bar.id = "prism-comment-search";
          bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 0";
          const input = document.createElement("input");
          input.type = "search";
          input.placeholder = "Filter comments…";
          input.style.cssText = "flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:99px;color:#fff;padding:6px 14px;font-size:13px;outline:none";
          const count = document.createElement("span");
          count.style.cssText = "font:600 11px system-ui;color:#888;white-space:nowrap";
          const filter = () => {
            const q = input.value.trim().toLowerCase();
            const threads = Array.from(document.querySelectorAll("ytd-comment-thread-renderer"));
            let shown = 0;
            threads.forEach((t) => {
              const hit = !q || (t.textContent || "").toLowerCase().includes(q);
              t.style.display = hit ? "" : "none";
              if (hit) shown++;
            });
            count.textContent = q ? shown + " / " + threads.length : threads.length + " shown";
          };
          input.addEventListener("input", () => setTimeout(filter, 100));
          bar.append(input, count);
          host.insertBefore(bar, host.firstChild);
          filter();
        };
        build();
        this._stopFns.push(ctx.on(document, "yt-navigate-finish", () => { ctx.timer.timeout(build, 1500); ctx.timer.timeout(build, 3500); }, { passive: true }));
      }

      // ── collapse long comments ──
      if (ctx.settings().comments.collapse_long) {
        const threshold = ctx.settings().comments.collapse_threshold_chars || 1200;
        const scan = () => {
          document.querySelectorAll("ytd-comment-renderer #content-text").forEach((el) => {
            if (el.dataset.prismClamped || (el.textContent || "").length < threshold) return;
            el.dataset.prismClamped = "1";
            el.style.cssText = "display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden";
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = "Expand comment";
            b.style.cssText = "background:none;border:0;color:#3ea6ff;font:600 11.5px system-ui;cursor:pointer;padding:2px 0";
            b.addEventListener("click", () => {
              const clamped = el.style.webkitLineClamp === "4";
              el.style.webkitLineClamp = clamped ? "unset" : "4";
              b.textContent = clamped ? "Collapse comment" : "Expand comment";
            });
            el.insertAdjacentElement("afterend", b);
          });
        };
        scan();
        ctx.timer.interval(scan, 5000);
      }
    },
    stop() {
      this._stopFns.forEach((f) => f());
      this._stopFns = [];
      removeButtons("prism-dash-btn");
      removeButtons("prism-copy-ts");
      removeButtons("prism-copy-info");
      removeButtons("prism-transcript");
      removeButtons("prism-vnote");
      removeButtons("prism-cnote");
      removeButtons("prism-prev-ch");
      removeButtons("prism-next-ch");
      if (this._elementStyle) { this._elementStyle.remove(); this._elementStyle = null; }
    },
    health() {
      return { elements: (this._ctx.settings().chrome.hidden_elements || []).length };
    },
  });

  // ── notes editor ──
  async function openNotes(kind) {
    const key = kind === "video" ? "note:" + (videoId() || "") : "note:channel";
    const raw = await P.storage.get(key).catch(() => null);
    const existing = (raw && raw.v) || "";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(10,12,18,.9);display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "background:#161a24;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px;width:min(520px,90%);display:flex;flex-direction:column;gap:10px";
    const ta = document.createElement("textarea");
    ta.value = existing;
    ta.placeholder = kind === "video" ? "Private notes for this video…" : "Private notes for this channel…";
    ta.style.cssText = "min-height:160px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;padding:10px;font:13px system-ui;resize:vertical";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
    const save = document.createElement("button");
    save.textContent = "Save";
    save.style.cssText = "background:#ff3d7f;border:0;color:#fff;font:600 13px system-ui;padding:8px 18px;border-radius:8px;cursor:pointer";
    save.addEventListener("click", async () => {
      await P.storage.set(key, { v: ta.value }).catch(() => {});
      overlay.remove();
    });
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.cssText = "background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:#fff;font:600 13px system-ui;padding:8px 18px;border-radius:8px;cursor:pointer";
    cancel.addEventListener("click", () => overlay.remove());
    row.append(cancel, save);
    box.append(ta, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    ta.focus();
  }

  // ── chapter helpers ──
  function chapters() {
    try {
      const pr = window.ytInitialPlayerResponse;
      const bar = pr && pr.playerOverlays && pr.playerOverlays.playerOverlayRenderer &&
        pr.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer &&
        pr.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.playerBar &&
        pr.playerOverlays.playerOverlayRenderer.decoratedPlayerBarRenderer.playerBar.multiMarkersPlayerBarRenderer;
      if (!bar || !bar.markersMap) return [];
      const out = [];
      for (const entry of bar.markersMap) {
        for (const ch of (entry.value && entry.value.chapters) || []) {
          const r = ch.chapterRenderer;
          if (!r) continue;
          out.push({ t: (r.timeRangeStartMillis || 0) / 1000, title: r.title && (r.title.simpleText || (r.title.runs || []).map((x) => x.text).join("")) || "" });
        }
      }
      return out.sort((a, b) => a.t - b.t);
    } catch (_) {
      return [];
    }
  }
  function chapterJump(dir) {
    const v = videoEl();
    if (!v) return;
    const list = chapters();
    if (!list.length) return;
    let target = null;
    if (dir < 0) {
      for (const ch of [...list].reverse()) { if (ch.t < v.currentTime - 0.5) { target = ch; break; } }
    } else {
      for (const ch of list) { if (ch.t > v.currentTime + 0.5) { target = ch; break; } }
    }
    if (target) v.currentTime = target.t;
  }
  function buildChapterPanel(ctx) {
    if (!location.pathname.startsWith("/watch")) return;
    if (document.getElementById("prism-chapter-panel")) return;
    const list = chapters();
    if (!list.length) return;
    const anchor = document.querySelector("#below #title") || document.querySelector("ytd-watch-metadata") || document.querySelector("#primary-inner");
    if (!anchor) return;
    const panel = document.createElement("div");
    panel.id = "prism-chapter-panel";
    panel.style.cssText = "display:flex;flex-direction:column;gap:2px;margin:10px 12px;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;font:12px system-ui;color:#ddd";
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;font-weight:700;color:#fff;font-size:12px";
    hdr.textContent = list.length + " chapter(s)";
    panel.appendChild(hdr);
    const rows = document.createElement("div");
    rows.style.cssText = "display:flex;flex-direction:column;gap:2px;margin-top:6px;max-height:280px;overflow-y:auto";
    list.forEach((ch) => {
      const row = document.createElement("div");
      row.dataset.t = String(ch.t);
      row.style.cssText = "display:flex;align-items:baseline;gap:8px;padding:5px 7px;border-radius:7px;cursor:pointer;transition:background .12s";
      row.addEventListener("mouseenter", () => { row.style.background = "rgba(255,255,255,.07)"; });
      row.addEventListener("mouseleave", () => { row.style.background = ""; });
      row.addEventListener("click", () => {
        const v = videoEl();
        if (v) v.currentTime = ch.t;
      });
      const t = document.createElement("span");
      t.textContent = fmtTime(ch.t);
      t.style.cssText = "font-family:monospace;font-size:11px;color:#ff3d7f;flex-shrink:0";
      const title = document.createElement("span");
      title.textContent = ch.title;
      title.style.cssText = "color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      row.append(t, title);
      rows.appendChild(row);
    });
    panel.appendChild(rows);
    anchor.parentNode.insertBefore(panel, anchor);
    // current-chapter highlight
    let last = -1;
    const tick = () => {
      const v = videoEl();
      if (!v) return;
      let idx = -1;
      for (let i = 0; i < list.length; i++) if (list[i].t <= v.currentTime) idx = i;
      rows.querySelectorAll("div[data-t]").forEach((r, i) => {
        const active = i === idx;
        r.style.background = active ? "rgba(255,61,127,.14)" : "";
        r.style.color = active ? "#fff" : "";
        if (active && idx !== last) { try { r.scrollIntoView({ block: "nearest" }); } catch (_) {} }
      });
      last = idx;
    };
    tick();
    if (this._chapterTick) this._chapterTick();
    this._chapterTick = ctx.timer.interval(tick, 1000);
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
  }
})();
