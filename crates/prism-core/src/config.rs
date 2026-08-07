//! Typed configuration schema.
//!
//! The host persists a single JSON blob; the core validates, normalizes and
//! migrates it. All settings are grouped by subsystem and every value has a
//! bounded domain validated at load time. Unknown keys are preserved for
//! forward compatibility; invalid values fall back to defaults and are
//! reported as validation issues.

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Recovery, Severity, Subsystem};

/// A single validation issue discovered while loading a settings blob.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}

/// Player playback controls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PlayerSettings {
    /// Default playback rate; clamped to [0.0625, 16].
    pub speed_default: f64,
    /// Remember per-channel rates.
    pub speed_per_channel: bool,
    /// Per-channel rate memory capacity (channels).
    pub speed_capacity: usize,
    /// Native loop.
    pub loop_video: bool,
    /// A-B loop points in seconds; `None` = unset.
    pub ab_loop_a: Option<f64>,
    pub ab_loop_b: Option<f64>,
    /// Preferred quality label (e.g. "hd1080", "auto").
    pub quality_pref: String,
    /// Forward/rewind step in seconds.
    pub seek_step_sec: f64,
    /// Wake-lock while playing.
    pub keep_screen_awake: bool,
    /// Screenshot defaults.
    pub screenshot_format: ShotFormat,
    pub screenshot_scale: f64,
    pub screenshot_clipboard: bool,
    /// Sleep timer minutes.
    pub sleep_timer_min: u32,
    /// Pause when hidden / blurred.
    pub auto_pause_hidden: bool,
    pub auto_pause_blurred: bool,
    pub resume_auto_paused: bool,
    pub pause_background_tabs: bool,
    pub confirm_leave_playing: bool,
    pub auto_recover_video: bool,
    pub skip_ads: bool,
    pub default_original_audio: bool,
    pub hfr_allow: bool,
    pub restore_fs_scroll: bool,
    pub theater_default: bool,
    pub theater_wide: bool,
    pub theater_wide_min_width: u32,
    pub cinema_opacity: f64,
    pub ambient_blur_px: u32,
    pub ambient_opacity: f64,
    pub flip_h: bool,
    pub flip_v: bool,
    /// Video filter chain (percent/degs).
    pub filter_brightness: f64,
    pub filter_contrast: f64,
    pub filter_saturation: f64,
    pub filter_hue_deg: f64,
    pub filter_grayscale: bool,
    pub filter_zoom_pct: f64,
    pub top_progress_bar: bool,
    pub remaining_badge: bool,
    pub clock_badge: bool,
    pub end_soon_warn: bool,
    pub end_soon_sec: u32,
    pub force_watched_account: bool,
    pub force_watched_local: bool,
    /// Idle dim (blur the video after inactivity).
    pub idle_dim: bool,
    pub idle_dim_delay_sec: u32,
    pub idle_dim_blur_px: u32,
}

impl Default for PlayerSettings {
    fn default() -> Self {
        Self {
            speed_default: 1.0,
            speed_per_channel: false,
            speed_capacity: 200,
            loop_video: false,
            ab_loop_a: None,
            ab_loop_b: None,
            quality_pref: "hd1080".into(),
            seek_step_sec: 10.0,
            keep_screen_awake: false,
            screenshot_format: ShotFormat::Png,
            screenshot_scale: 1.0,
            screenshot_clipboard: false,
            sleep_timer_min: 30,
            auto_pause_hidden: false,
            auto_pause_blurred: false,
            resume_auto_paused: false,
            pause_background_tabs: false,
            confirm_leave_playing: false,
            auto_recover_video: false,
            skip_ads: false,
            default_original_audio: false,
            hfr_allow: false,
            restore_fs_scroll: false,
            theater_default: false,
            theater_wide: false,
            theater_wide_min_width: 1600,
            cinema_opacity: 0.85,
            ambient_blur_px: 24,
            ambient_opacity: 0.5,
            flip_h: false,
            flip_v: false,
            filter_brightness: 100.0,
            filter_contrast: 100.0,
            filter_saturation: 100.0,
            filter_hue_deg: 0.0,
            filter_grayscale: false,
            filter_zoom_pct: 100.0,
            top_progress_bar: false,
            remaining_badge: false,
            clock_badge: false,
            end_soon_warn: false,
            end_soon_sec: 20,
            force_watched_account: true,
            force_watched_local: true,
            idle_dim: false,
            idle_dim_delay_sec: 60,
            idle_dim_blur_px: 6,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShotFormat {
    Png,
    Jpeg,
}

/// Caption (always-on captions) settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CaptionSettings {
    pub enabled: bool,
    /// Preferred language code ("" = player default).
    pub lang: String,
    /// Fallback language codes, in order.
    pub fallback_langs: Vec<String>,
    /// Track kind preference.
    pub kind_pref: TrackKind,
    pub auto_translate: bool,
    pub translate_to: String,
    pub skip_music: bool,
    pub skip_shorts: bool,
    pub respect_manual_off: bool,
    pub reengage_after_ad: bool,
    pub native_prefs: bool,
    pub font_size_px: u32,
    pub font_family: String,
    pub font_weight: u16,
    pub text_color: String,
    pub bg_color: String,
    pub bg_opacity_pct: u8,
    pub text_shadow: ShadowMode,
    pub line_height: f64,
    pub letter_spacing_em: f64,
    pub position: CaptionPos,
    pub radius_px: u32,
    pub uppercase: bool,
}

impl Default for CaptionSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            lang: String::new(),
            fallback_langs: vec!["en".into(), "en-US".into(), "en-GB".into()],
            kind_pref: TrackKind::Any,
            auto_translate: false,
            translate_to: String::new(),
            skip_music: false,
            skip_shorts: false,
            respect_manual_off: false,
            reengage_after_ad: false,
            native_prefs: false,
            font_size_px: 28,
            font_family: "Roboto, Arial, sans-serif".into(),
            font_weight: 700,
            text_color: "#ffffff".into(),
            bg_color: "#000000".into(),
            bg_opacity_pct: 72,
            text_shadow: ShadowMode::Outline,
            line_height: 1.25,
            letter_spacing_em: 0.0,
            position: CaptionPos::Bottom,
            radius_px: 4,
            uppercase: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Any,
    Human,
    Asr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShadowMode {
    Outline,
    Soft,
    Heavy,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptionPos {
    Bottom,
    Middle,
    Top,
    Left,
    Right,
}

/// SponsorBlock settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SponsorBlockSettings {
    pub enabled: bool,
    pub privacy: bool,
    pub toasts: bool,
    pub seekbar_marks: bool,
    pub hud: bool,
    /// Per-category action overrides; absent = category default.
    pub category_actions: std::collections::BTreeMap<String, crate::sponsorblock::CategoryAction>,
    /// Video IDs hidden from processing.
    pub hidden_videos: Vec<String>,
}

impl Default for SponsorBlockSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            privacy: false,
            toasts: false,
            seekbar_marks: true,
            hud: true,
            category_actions: Default::default(),
            hidden_videos: Vec::new(),
        }
    }
}

/// Session history settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct HistorySettings {
    pub enabled: bool,
    pub resume_mode: ResumeMode,
    pub max_sessions_per_video: usize,
    pub history_capacity: usize,
    pub track_clicks: bool,
    pub watch_insights: bool,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            resume_mode: ResumeMode::Silent,
            max_sessions_per_video: 50,
            history_capacity: 20_000,
            track_clicks: false,
            watch_insights: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResumeMode {
    Silent,
    Card,
    Overlay,
}

/// Feed filtering settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FeedSettings {
    pub channel_blocklist: String,
    pub hide_blocked_watch: bool,
    pub hide_blocked_browse: bool,
    pub hide_blocked_comments: bool,
    pub keywords: String,
    pub watched_mode: WatchedMode,
    pub number_results: bool,
    pub highlight_long: bool,
    pub highlight_short: bool,
    pub long_min_sec: u64,
    pub short_max_sec: u64,
    pub hide_live: bool,
    pub hide_premieres: bool,
    pub hide_top_live_games: bool,
    pub blur_thumbnails: bool,
    pub blur_px: u32,
    pub disable_previews: bool,
    pub dense_grid: bool,
    pub remove_shorts: bool,
    pub shorts_redirect: bool,
    pub shorts_dom_clean: bool,
    pub shorts_api_filter: bool,
    pub hide_auto_dubbed: bool,
    pub restore_original_audio: bool,
}

impl Default for FeedSettings {
    fn default() -> Self {
        Self {
            channel_blocklist: String::new(),
            hide_blocked_watch: false,
            hide_blocked_browse: false,
            hide_blocked_comments: false,
            keywords: String::new(),
            watched_mode: WatchedMode::Off,
            number_results: false,
            highlight_long: false,
            highlight_short: false,
            long_min_sec: 1200,
            short_max_sec: 60,
            hide_live: false,
            hide_premieres: false,
            hide_top_live_games: false,
            blur_thumbnails: false,
            blur_px: 12,
            disable_previews: false,
            dense_grid: false,
            remove_shorts: false,
            shorts_redirect: false,
            shorts_dom_clean: false,
            shorts_api_filter: false,
            hide_auto_dubbed: false,
            restore_original_audio: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WatchedMode {
    Off,
    Dim,
    Hide,
}

/// Comments settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CommentSettings {
    pub collapse_long: bool,
    pub collapse_threshold_chars: usize,
    pub highlight_creator: bool,
    pub highlight_timestamps: bool,
    pub search_bar: bool,
}

impl Default for CommentSettings {
    fn default() -> Self {
        Self {
            collapse_long: false,
            collapse_threshold_chars: 1200,
            highlight_creator: false,
            highlight_timestamps: false,
            search_bar: false,
        }
    }
}

/// Geo/cookies/privacy.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PrivacySettings {
    pub geo_override: bool,
    pub geo_region: String,
    pub geo_lang: String,
    pub geo_timezone: String,
    pub patch_fetch: bool,
    pub patch_xhr: bool,
    pub patch_beacon: bool,
    pub patch_navigator: bool,
    pub cookie_control: bool,
    pub cookie_live: bool,
    pub privacy_shield: bool,
    pub block_yt_ai: bool,
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            geo_override: false,
            geo_region: "US".into(),
            geo_lang: "en".into(),
            geo_timezone: String::new(),
            patch_fetch: false,
            patch_xhr: false,
            patch_beacon: false,
            patch_navigator: false,
            cookie_control: false,
            cookie_live: false,
            privacy_shield: false,
            block_yt_ai: false,
        }
    }
}

/// Network monitor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkSettings {
    pub monitor: bool,
    pub badge: bool,
    pub patch_fetch: bool,
    pub patch_xhr: bool,
    pub patch_beacon: bool,
    pub track_qualities: bool,
    pub budget_enabled: bool,
    pub budget_gb: f64,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self {
            monitor: false,
            badge: false,
            patch_fetch: true,
            patch_xhr: true,
            patch_beacon: true,
            track_qualities: false,
            budget_enabled: false,
            budget_gb: 50.0,
        }
    }
}

/// Performance mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct PerfSettings {
    pub enabled: bool,
    pub tier: PerfTier,
    pub auto_enable: bool,
    pub fps_counter: bool,
    pub fps_pos: Corner,
    pub buffer_health: bool,
    pub dropped_frames: bool,
    pub dropped_pos: Corner,
    pub dropped_show_rate: bool,
    pub dropped_reset_on_nav: bool,
    pub long_task_warn: bool,
    pub long_task_threshold_ms: u32,
    pub stats_overlay: bool,
    pub profiler: bool,
    pub diag_console: bool,
}

impl Default for PerfSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            tier: PerfTier::Balanced,
            auto_enable: false,
            fps_counter: false,
            fps_pos: Corner::TopLeft,
            buffer_health: false,
            dropped_frames: false,
            dropped_pos: Corner::TopRight,
            dropped_show_rate: false,
            dropped_reset_on_nav: true,
            long_task_warn: false,
            long_task_threshold_ms: 50,
            stats_overlay: false,
            profiler: false,
            diag_console: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerfTier {
    Balanced,
    Aggressive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Theme engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeSettings {
    pub enabled: bool,
    /// Theme id; "none" = YouTube default.
    pub selected: String,
    pub glass_overhaul: bool,
    pub accent_hue: u16,
    pub focus_ring: bool,
    pub sidebar_active: bool,
    /// Last base color used by the generator.
    pub gen_color: String,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            selected: "none".into(),
            glass_overhaul: false,
            accent_hue: 215,
            focus_ring: false,
            sidebar_active: false,
            gen_color: "#ff3d7f".into(),
        }
    }
}

/// Discovery / search intelligence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct DiscoverySettings {
    pub time_machine: bool,
    pub time_machine_years: u32,
    pub small_creator: bool,
    pub small_creator_max_subs: u64,
    pub anti_rec: bool,
    pub momentum: bool,
    pub feed_size: usize,
    pub vibe_search: bool,
    pub credibility: bool,
    pub search_remix: bool,
    pub outdated_detector: bool,
    pub watch_genome: bool,
    pub algo_intelligence: bool,
    pub collections: bool,
}

impl Default for DiscoverySettings {
    fn default() -> Self {
        Self {
            time_machine: false,
            time_machine_years: 1,
            small_creator: false,
            small_creator_max_subs: 10_000,
            anti_rec: false,
            momentum: false,
            feed_size: 20,
            vibe_search: false,
            credibility: false,
            search_remix: false,
            outdated_detector: false,
            watch_genome: false,
            algo_intelligence: false,
            collections: false,
        }
    }
}

/// Playback intelligence (scene jump, video DNA, smart speed).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct IntelligenceSettings {
    pub scene_jumper: bool,
    pub video_dna: bool,
    pub smart_speed: bool,
    pub smart_speed_base: f64,
    pub smart_speed_fast: f64,
    pub smart_queue: bool,
}

impl Default for IntelligenceSettings {
    fn default() -> Self {
        Self {
            scene_jumper: false,
            video_dna: false,
            smart_speed: false,
            smart_speed_base: 1.0,
            smart_speed_fast: 1.5,
            smart_queue: false,
        }
    }
}

/// Page chrome (player buttons, notes, chapters, presets).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ChromeSettings {
    pub player_dash_button: bool,
    pub copy_timestamp_btn: bool,
    pub copy_info_btn: bool,
    pub transcript_btn: bool,
    pub video_notes: bool,
    pub channel_notes: bool,
    pub chapter_hotkeys: bool,
    pub chapter_buttons: bool,
    pub chapter_panel: bool,
    pub fwd_rewind_buttons: bool,
    pub stop_button: bool,
    pub flip_buttons: bool,
    pub pip_button: bool,
    pub logo_to_subs: bool,
    pub default_channel_tab: String,
    pub auto_expand_desc: bool,
    pub disable_autoplay: bool,
    pub remove_redirects: bool,
    pub shorten_share: bool,
    pub dismiss_pause_dialog: bool,
    pub reverse_playlist: bool,
    pub playlist_autoscroll: bool,
    pub compact_playlist: bool,
    pub shorts_auto_mute: bool,
    pub shorts_hide_comments: bool,
    pub top_bar_hide: bool,
    pub hide_banner_ads: bool,
    pub compact_ui: bool,
    pub hide_recs: bool,
    pub hide_comments: bool,
    pub hide_endscreen: bool,
    pub hide_livechat: bool,
    pub hide_watermark: bool,
    pub hide_info_cards: bool,
    pub always_progress_bar: bool,
    /// element-control hidden item ids.
    pub hidden_elements: Vec<String>,
}

impl Default for ChromeSettings {
    fn default() -> Self {
        Self {
            player_dash_button: true,
            copy_timestamp_btn: false,
            copy_info_btn: false,
            transcript_btn: false,
            video_notes: false,
            channel_notes: false,
            chapter_hotkeys: false,
            chapter_buttons: false,
            chapter_panel: false,
            fwd_rewind_buttons: false,
            stop_button: false,
            flip_buttons: false,
            pip_button: false,
            logo_to_subs: false,
            default_channel_tab: "featured".into(),
            auto_expand_desc: false,
            disable_autoplay: false,
            remove_redirects: false,
            shorten_share: false,
            dismiss_pause_dialog: false,
            reverse_playlist: false,
            playlist_autoscroll: false,
            compact_playlist: false,
            shorts_auto_mute: false,
            shorts_hide_comments: false,
            top_bar_hide: false,
            hide_banner_ads: false,
            compact_ui: false,
            hide_recs: false,
            hide_comments: false,
            hide_endscreen: false,
            hide_livechat: false,
            hide_watermark: false,
            hide_info_cards: false,
            always_progress_bar: false,
            hidden_elements: Vec::new(),
        }
    }
}

/// Time budget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct BudgetSettings {
    pub enabled: bool,
    pub session_minutes: u32,
    pub daily_minutes: u32,
}

impl Default for BudgetSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            session_minutes: 60,
            daily_minutes: 0,
        }
    }
}

/// External signals (DeArrow / RYD / local AI).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[derive(Default)]
pub struct SignalSettings {
    pub dearrow: bool,
    pub ryd: bool,
    pub local_ai: bool,
}

/// The complete, typed settings tree.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Schema version for migrations.
    pub schema_version: u32,
    /// Active profile name ("" = default).
    pub profile: String,
    /// Global kill switch for tracking features (privacy shield).
    pub privacy_shield: bool,
    /// Toast verbosity ("off", "minimal", "normal").
    pub toasts: String,

    pub player: PlayerSettings,
    pub captions: CaptionSettings,
    pub sponsorblock: SponsorBlockSettings,
    pub history: HistorySettings,
    pub feed: FeedSettings,
    pub comments: CommentSettings,
    pub privacy: PrivacySettings,
    pub network: NetworkSettings,
    pub perf: PerfSettings,
    pub theme: ThemeSettings,
    pub discovery: DiscoverySettings,
    pub intelligence: IntelligenceSettings,
    pub chrome: ChromeSettings,
    pub budget: BudgetSettings,
    pub signals: SignalSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: crate::PROTOCOL_VERSION,
            profile: String::new(),
            privacy_shield: false,
            toasts: "normal".into(),
            player: PlayerSettings::default(),
            captions: CaptionSettings::default(),
            sponsorblock: SponsorBlockSettings::default(),
            history: HistorySettings::default(),
            feed: FeedSettings::default(),
            comments: CommentSettings::default(),
            privacy: PrivacySettings::default(),
            network: NetworkSettings::default(),
            perf: PerfSettings::default(),
            theme: ThemeSettings::default(),
            discovery: DiscoverySettings::default(),
            intelligence: IntelligenceSettings::default(),
            chrome: ChromeSettings::default(),
            budget: BudgetSettings::default(),
            signals: SignalSettings::default(),
        }
    }
}

impl Settings {
    /// Parses + validates a raw JSON blob. Unknown fields are dropped,
    /// invalid values fall back to defaults with a recorded [`Issue`].
    pub fn from_json(raw: &str) -> Result<(Self, Vec<Issue>), Error> {
        if raw.len() > crate::MAX_PAYLOAD_BYTES {
            return Err(Error::invalid(
                Subsystem::Config,
                "from_json",
                ErrorCode::PayloadTooLarge,
                "settings payload exceeds limit",
            ));
        }
        let value: serde_json::Value = serde_json::from_str(raw).map_err(|e| {
            Error::invalid(
                Subsystem::Config,
                "from_json",
                ErrorCode::InvalidJson,
                format!("settings blob is not valid JSON: {e}"),
            )
        })?;
        let mut issues = Vec::new();
        let settings = Self::from_value(&value, &mut issues);
        settings.validate(&mut issues);
        Ok((settings, issues))
    }

    /// Deep-merges `patch` into `base` (objects merge recursively, everything
    /// else replaces). Never panics; malformed patches are ignored.
    fn deep_merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
        match (base, patch) {
            (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
                for (k, v) in p {
                    match b.get_mut(k) {
                        Some(existing) => Self::deep_merge(existing, v),
                        None => {
                            b.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
            (b, p) => *b = p.clone(),
        }
    }

    /// Overlays one typed group with a raw JSON patch, falling back to the
    /// group default on any error (recorded as an [`Issue`]).
    fn patch_group<T>(
        slot: &mut T,
        group_name: &str,
        patch: &serde_json::Value,
        issues: &mut Vec<Issue>,
    ) where
        T: serde::de::DeserializeOwned + Clone + Default + serde::Serialize,
    {
        let mut v = serde_json::to_value(slot.clone()).unwrap_or(serde_json::Value::Null);
        Self::deep_merge(&mut v, patch);
        match serde_json::from_value::<T>(v) {
            Ok(t) => *slot = t,
            Err(e) => issues.push(Issue {
                path: group_name.into(),
                message: format!("invalid group, using defaults: {e}"),
            }),
        }
    }

    fn from_value(value: &serde_json::Value, issues: &mut Vec<Issue>) -> Self {
        let mut s = Self::default();
        let Some(obj) = value.as_object() else {
            issues.push(Issue {
                path: "<root>".into(),
                message: "settings root must be an object".into(),
            });
            return s;
        };
        // Top-level scalars we understand.
        if let Some(v) = obj.get("schema_version") {
            if let Some(n) = v.as_u64() {
                s.schema_version = n as u32;
            }
        }
        if let Some(v) = obj.get("profile") {
            if let Some(p) = v.as_str() {
                s.profile = p.to_string();
            }
        }
        if let Some(v) = obj.get("privacy_shield") {
            if let Some(b) = v.as_bool() {
                s.privacy_shield = b;
            }
        }
        if let Some(v) = obj.get("toasts") {
            if let Some(t) = v.as_str() {
                s.toasts = t.to_string();
            }
        }
        // Grouped settings, each resilient to malformed input.
        if let Some(g) = obj.get("player") {
            Self::patch_group(&mut s.player, "player", g, issues);
        }
        if let Some(g) = obj.get("captions") {
            Self::patch_group(&mut s.captions, "captions", g, issues);
        }
        if let Some(g) = obj.get("sponsorblock") {
            Self::patch_group(&mut s.sponsorblock, "sponsorblock", g, issues);
        }
        if let Some(g) = obj.get("history") {
            Self::patch_group(&mut s.history, "history", g, issues);
        }
        if let Some(g) = obj.get("feed") {
            Self::patch_group(&mut s.feed, "feed", g, issues);
        }
        if let Some(g) = obj.get("comments") {
            Self::patch_group(&mut s.comments, "comments", g, issues);
        }
        if let Some(g) = obj.get("privacy") {
            Self::patch_group(&mut s.privacy, "privacy", g, issues);
        }
        if let Some(g) = obj.get("network") {
            Self::patch_group(&mut s.network, "network", g, issues);
        }
        if let Some(g) = obj.get("perf") {
            Self::patch_group(&mut s.perf, "perf", g, issues);
        }
        if let Some(g) = obj.get("theme") {
            Self::patch_group(&mut s.theme, "theme", g, issues);
        }
        if let Some(g) = obj.get("discovery") {
            Self::patch_group(&mut s.discovery, "discovery", g, issues);
        }
        if let Some(g) = obj.get("intelligence") {
            Self::patch_group(&mut s.intelligence, "intelligence", g, issues);
        }
        if let Some(g) = obj.get("chrome") {
            Self::patch_group(&mut s.chrome, "chrome", g, issues);
        }
        if let Some(g) = obj.get("budget") {
            Self::patch_group(&mut s.budget, "budget", g, issues);
        }
        if let Some(g) = obj.get("signals") {
            Self::patch_group(&mut s.signals, "signals", g, issues);
        }
        s
    }

    /// Validates bounded domains; collects issues, does not fail hard.
    pub fn validate(&self, issues: &mut Vec<Issue>) {
        let p = &self.player;
        if !(0.0625..=16.0).contains(&p.speed_default) {
            issues.push(Issue {
                path: "player.speed_default".into(),
                message: "playback rate out of range; clamped".into(),
            });
        }
        if !(0.0..=0.95).contains(&p.cinema_opacity) {
            issues.push(Issue {
                path: "player.cinema_opacity".into(),
                message: "opacity out of range".into(),
            });
        }
        if self.network.budget_gb <= 0.0 {
            issues.push(Issue {
                path: "network.budget_gb".into(),
                message: "budget must be positive".into(),
            });
        }
        if self.perf.long_task_threshold_ms < 20 || self.perf.long_task_threshold_ms > 1000 {
            issues.push(Issue {
                path: "perf.long_task_threshold_ms".into(),
                message: "threshold out of range".into(),
            });
        }
    }

    /// Returns a normalized copy with all bounded values clamped.
    pub fn normalized(&self) -> Self {
        let mut s = self.clone();
        s.player.speed_default = s.player.speed_default.clamp(0.0625, 16.0);
        s.player.cinema_opacity = s.player.cinema_opacity.clamp(0.0, 0.95);
        s.player.ambient_opacity = s.player.ambient_opacity.clamp(0.0, 1.0);
        s.player.ambient_blur_px = s.player.ambient_blur_px.min(80);
        s.player.screenshot_scale = s.player.screenshot_scale.clamp(0.25, 4.0);
        s.player.seek_step_sec = s.player.seek_step_sec.max(1.0);
        s.player.sleep_timer_min = s.player.sleep_timer_min.max(1);
        s.captions.font_size_px = s.captions.font_size_px.clamp(10, 96);
        s.captions.bg_opacity_pct = s.captions.bg_opacity_pct.min(100);
        s.captions.radius_px = s.captions.radius_px.min(30);
        s.feed.long_min_sec = s.feed.long_min_sec.max(60);
        s.feed.short_max_sec = s.feed.short_max_sec.max(5);
        s.feed.blur_px = s.feed.blur_px.clamp(1, 30);
        s.history.max_sessions_per_video = s.history.max_sessions_per_video.clamp(1, 200);
        s.history.history_capacity = s.history.history_capacity.clamp(100, 500_000);
        s.intelligence.smart_speed_base = s.intelligence.smart_speed_base.clamp(0.25, 4.0);
        s.intelligence.smart_speed_fast = s.intelligence.smart_speed_fast.clamp(0.25, 4.0);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_valid() {
        let mut issues = Vec::new();
        Settings::default().validate(&mut issues);
        assert!(issues.is_empty(), "defaults must be clean: {issues:?}");
    }

    #[test]
    fn parses_empty_blob_to_defaults() {
        let (s, issues) = Settings::from_json("{}").unwrap();
        assert_eq!(s, Settings::default());
        assert!(issues.is_empty());
    }

    #[test]
    fn invalid_json_is_structured_error() {
        let err = Settings::from_json("{not json").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidJson);
        assert_eq!(err.subsystem, Subsystem::Config);
        assert_eq!(err.severity, Severity::Warning);
    }

    #[test]
    fn garbage_blob_yields_defaults_and_issues() {
        let (s, _issues) = Settings::from_json("{\"player\": {\"speed_default\": 99}}").unwrap();
        // 99 is out of range -> clamped on normalize, flagged on validate.
        let mut v = Vec::new();
        s.validate(&mut v);
        assert!(!v.is_empty());
        let n = s.normalized();
        assert!(n.player.speed_default <= 16.0);
    }

    #[test]
    fn partial_group_patch_merges_over_defaults() {
        let (s, issues) = Settings::from_json(
            r#"{"player": {"loop_video": true, "seek_step_sec": 30}, "feed": {"watched_mode": "dim"}}"#,
        )
        .unwrap();
        assert!(issues.is_empty());
        assert!(s.player.loop_video);
        assert_eq!(s.player.seek_step_sec, 30.0);
        assert_eq!(s.player.speed_default, 1.0); // untouched default survives
        assert_eq!(s.feed.watched_mode, WatchedMode::Dim);
    }

    #[test]
    fn malformed_group_falls_back_to_default() {
        let (s, issues) =
            Settings::from_json(r#"{"captions": {"position": "not-a-position"}}"#).unwrap();
        assert!(!issues.is_empty(), "invalid enum must produce an issue");
        assert_eq!(s.captions.position, CaptionPos::Bottom);
    }

    #[test]
    fn normalization_clamps_bounds() {
        let s = Settings {
            player: PlayerSettings {
                speed_default: 42.0,
                screenshot_scale: 9.0,
                ..PlayerSettings::default()
            },
            ..Settings::default()
        };
        let n = s.normalized();
        assert_eq!(n.player.speed_default, 16.0);
        assert_eq!(n.player.screenshot_scale, 4.0);
    }

    #[test]
    fn oversized_blob_rejected() {
        let big = "x".repeat(crate::MAX_PAYLOAD_BYTES + 1);
        let err = Settings::from_json(&big).unwrap_err();
        assert_eq!(err.code, ErrorCode::PayloadTooLarge);
        assert_eq!(err.recovery, Recovery::None);
    }
}
