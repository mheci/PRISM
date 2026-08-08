//! SponsorBlock segment model and resolution logic.
//!
//! Pure decision-making: given a set of segments for a video and the current
//! playback position, decide what action to take (skip, mute, label, jump).
//! The host owns all network I/O and DOM; this module owns correctness.

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Subsystem};

/// All SponsorBlock categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Category {
    Sponsor,
    SelfPromo,
    Interaction,
    Intro,
    Outro,
    Preview,
    Hook,
    Filler,
    MusicOffTopic,
    PoiHighlight,
    ExclusiveAccess,
    Chapter,
}

impl Category {
    /// Stable API category string.
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Sponsor => "sponsor",
            Category::SelfPromo => "selfpromo",
            Category::Interaction => "interaction",
            Category::Intro => "intro",
            Category::Outro => "outro",
            Category::Preview => "preview",
            Category::Hook => "hook",
            Category::Filler => "filler",
            Category::MusicOffTopic => "music_offtopic",
            Category::PoiHighlight => "poi_highlight",
            Category::ExclusiveAccess => "exclusive_access",
            Category::Chapter => "chapter",
        }
    }

    /// All categories, in canonical order.
    pub const ALL: [Category; 12] = [
        Category::Sponsor,
        Category::SelfPromo,
        Category::Interaction,
        Category::Intro,
        Category::Outro,
        Category::Preview,
        Category::Hook,
        Category::Filler,
        Category::MusicOffTopic,
        Category::PoiHighlight,
        Category::ExclusiveAccess,
        Category::Chapter,
    ];

    /// Default action when no user override exists.
    pub fn default_action(self) -> CategoryAction {
        match self {
            Category::Sponsor
            | Category::SelfPromo
            | Category::Interaction
            | Category::Intro
            | Category::Outro
            | Category::Preview
            | Category::Hook
            | Category::Filler
            | Category::MusicOffTopic => CategoryAction::Skip,
            Category::PoiHighlight => CategoryAction::JumpToHighlight,
            Category::ExclusiveAccess => CategoryAction::Label,
            Category::Chapter => CategoryAction::Label,
        }
    }

    /// User-selectable actions for this category.
    pub fn allowed_actions(self) -> &'static [CategoryAction] {
        match self {
            Category::ExclusiveAccess => &[
                CategoryAction::Skip,
                CategoryAction::Mute,
                CategoryAction::Label,
                CategoryAction::Off,
            ],
            Category::PoiHighlight => &[
                CategoryAction::Skip,
                CategoryAction::Mute,
                CategoryAction::JumpToHighlight,
                CategoryAction::Label,
                CategoryAction::Off,
            ],
            Category::Chapter => &[CategoryAction::Label, CategoryAction::Off],
            _ => &[
                CategoryAction::Skip,
                CategoryAction::Mute,
                CategoryAction::Label,
                CategoryAction::Off,
            ],
        }
    }
}

impl std::str::FromStr for Category {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s {
            "sponsor" => Category::Sponsor,
            "selfpromo" => Category::SelfPromo,
            "interaction" => Category::Interaction,
            "intro" => Category::Intro,
            "outro" => Category::Outro,
            "preview" => Category::Preview,
            "hook" => Category::Hook,
            "filler" => Category::Filler,
            "music_offtopic" => Category::MusicOffTopic,
            "poi_highlight" => Category::PoiHighlight,
            "exclusive_access" => Category::ExclusiveAccess,
            "chapter" => Category::Chapter,
            _ => return Err(()),
        })
    }
}

/// What to do with a segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CategoryAction {
    Skip,
    Mute,
    JumpToHighlight,
    Label,
    Off,
}

/// A single segment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub category: Category,
    pub start: f64,
    pub end: f64,
    /// True when the segment is currently muted (mutating state, host-owned
    /// but decided here via [`SegmentSet::decision`]).
    pub muted: bool,
}

/// What the host should do right now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Decision {
    /// Seek to `to` because playback is inside a skip segment.
    SkipTo { to: f64 },
    /// Enter/exit muted state for `muted` seconds.
    Mute { until: f64 },
    /// Just expose the label (host renders markers).
    Label,
    /// Nothing to do.
    None,
}

/// A video's full segment set (ordered, non-overlapping per category).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SegmentSet {
    pub video_id: String,
    pub segments: Vec<Segment>,
    /// Total time saved so far this session (seconds).
    pub saved_seconds: f64,
}

/// Cooldown before re-skipping after a user seek (seconds).
pub const POST_SEEK_GRACE: f64 = 3.0;

/// Tolerance for entering a segment (seconds) — we skip slightly early so
/// playback never visibly enters a skip zone.
pub const ENTER_EPSILON: f64 = 0.1;

/// How late we may be before the segment is considered "already past".
pub const EXIT_EPSILON: f64 = 0.5;

impl SegmentSet {
    /// Sorts by (category, start) and merges overlapping segments of the
    /// same category into their union.
    pub fn normalize(&mut self) {
        self.segments.sort_by(|a, b| {
            (a.category as u8)
                .cmp(&(b.category as u8))
                .then(cmp_f64(a.start, b.start))
        });
        let mut merged: Vec<Segment> = Vec::with_capacity(self.segments.len());
        for seg in self.segments.drain(..) {
            if let Some(last) = merged.last_mut() {
                if last.category == seg.category && seg.start <= last.end + 0.01 {
                    last.end = last.end.max(seg.end);
                    continue;
                }
            }
            merged.push(seg);
        }
        self.segments = merged;
    }

    /// The primary decision for the current position.
    ///
    /// * `last_seek` — host-provided timestamp (seconds since navigation) of
    ///   the most recent user-initiated seek; skip decisions are suppressed
    ///   within the grace window.
    /// * `draft` — when true, no skip/mute actions fire (submission preview).
    pub fn decision(
        &self,
        position: f64,
        last_seek: Option<f64>,
        draft: bool,
        actions: &[(Category, CategoryAction)],
    ) -> Decision {
        if position.is_nan() || position < 0.0 {
            return Decision::None;
        }
        if let Some(seek) = last_seek {
            if position < seek + POST_SEEK_GRACE {
                return Decision::None;
            }
        }
        for seg in &self.segments {
            if position + ENTER_EPSILON < seg.start {
                continue;
            }
            if position > seg.end + EXIT_EPSILON {
                continue;
            }
            let action = action_for(actions, seg.category);
            match action {
                CategoryAction::Off | CategoryAction::Label => continue,
                CategoryAction::Skip => {
                    if draft {
                        return Decision::None;
                    }
                    if position + ENTER_EPSILON >= seg.end {
                        continue;
                    }
                    return Decision::SkipTo { to: seg.end };
                }
                CategoryAction::Mute => {
                    if draft {
                        return Decision::None;
                    }
                    return Decision::Mute { until: seg.end };
                }
                CategoryAction::JumpToHighlight => {
                    if draft {
                        return Decision::None;
                    }
                    // poi segments are points: jump only when close.
                    if (position - seg.start).abs() < 2.0 && position >= seg.start {
                        return Decision::SkipTo { to: seg.start };
                    }
                    continue;
                }
            }
        }
        Decision::None
    }

    /// Whether the position falls inside any enabled, visible (non-skip)
    /// segment — used to render active labels.
    pub fn inside_label(&self, position: f64, actions: &[(Category, CategoryAction)]) -> bool {
        self.segments.iter().any(|seg| {
            position >= seg.start
                && position <= seg.end
                && matches!(
                    action_for(actions, seg.category),
                    CategoryAction::Label | CategoryAction::Mute
                )
        })
    }

    /// Total seconds covered by enabled skip segments (for the HUD).
    pub fn skip_cover_seconds(&self, actions: &[(Category, CategoryAction)]) -> f64 {
        self.segments
            .iter()
            .filter(|s| action_for(actions, s.category) == CategoryAction::Skip)
            .map(|s| (s.end - s.start).max(0.0))
            .sum()
    }

    /// True when the position is inside a muted segment (host keeps muted).
    pub fn should_be_muted(&self, position: f64, actions: &[(Category, CategoryAction)]) -> bool {
        self.segments.iter().any(|seg| {
            position >= seg.start
                && position <= seg.end
                && action_for(actions, seg.category) == CategoryAction::Mute
        })
    }
}

fn action_for(actions: &[(Category, CategoryAction)], category: Category) -> CategoryAction {
    actions
        .iter()
        .find(|(c, _)| *c == category)
        .map(|(_, a)| *a)
        .unwrap_or_else(|| category.default_action())
}

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// Builds a cache key for a video's segments.
///
/// NOTE: this is a local-cache key only. In privacy mode the video ID is
/// still embedded (the key never leaves the client); the privacy guarantee
/// is about *outbound requests*, which the host must construct without the
/// raw ID. Do not ship this key to any server.
pub fn cache_key(video_id: &str, privacy: bool, hash_salt: u64) -> String {
    let mut key = String::with_capacity(video_id.len() + 16);
    key.push_str(video_id);
    key.push(':');
    key.push_str(&(hash_salt.wrapping_mul(0x9E37_79B9_7F4A_7C15).to_string()));
    key.push(':');
    key.push(if privacy { 'p' } else { 'o' });
    key
}

/// Parses the SponsorBlock API segment list into a normalized [`SegmentSet`].
pub fn parse_segments(video_id: &str, raw: &serde_json::Value) -> crate::Result<SegmentSet> {
    let mut set = SegmentSet {
        video_id: video_id.to_string(),
        ..SegmentSet::default()
    };
    let Some(arr) = raw.as_array() else {
        return Err(Error::invalid(
            Subsystem::SponsorBlock,
            "parse_segments",
            ErrorCode::InvalidJson,
            "expected segment array",
        ));
    };
    for entry in arr {
        let Some(cat_str) = entry.get("category").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let Ok(category) = cat_str.parse::<Category>() else {
            continue;
        };
        let start = entry
            .get("segment")
            .and_then(|s| s.get(0))
            .and_then(serde_json::Value::as_f64);
        let end = entry
            .get("segment")
            .and_then(|s| s.get(1))
            .and_then(serde_json::Value::as_f64);
        let (Some(start), Some(end)) = (start, end) else {
            continue;
        };
        // Reject NaN/Infinity ranges outright (comparisons silently pass
        // them, which would poison skip decisions).
        if !start.is_finite() || !end.is_finite() || end <= start || start < 0.0 {
            continue;
        }
        set.segments.push(Segment {
            category,
            start,
            end,
            muted: false,
        });
    }
    set.normalize();
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actions() -> Vec<(Category, CategoryAction)> {
        vec![(Category::Sponsor, CategoryAction::Skip)]
    }

    #[test]
    fn skips_inside_sponsor() {
        let mut set = SegmentSet {
            video_id: "v".into(),
            segments: vec![Segment {
                category: Category::Sponsor,
                start: 10.0,
                end: 20.0,
                muted: false,
            }],
            saved_seconds: 0.0,
        };
        set.normalize();
        assert_eq!(
            set.decision(15.0, None, false, &actions()),
            Decision::SkipTo { to: 20.0 }
        );
    }

    #[test]
    fn grace_window_suppresses_skip_after_seek() {
        let set = SegmentSet {
            video_id: "v".into(),
            segments: vec![Segment {
                category: Category::Sponsor,
                start: 10.0,
                end: 20.0,
                muted: false,
            }],
            saved_seconds: 0.0,
        };
        // User just seeked into the middle; give them 3s.
        assert_eq!(
            set.decision(12.0, Some(11.0), false, &actions()),
            Decision::None
        );
        // After grace expires, skipping resumes.
        assert_eq!(
            set.decision(14.5, Some(11.0), false, &actions()),
            Decision::SkipTo { to: 20.0 }
        );
    }

    #[test]
    fn draft_mode_never_skips() {
        let set = SegmentSet {
            video_id: "v".into(),
            segments: vec![Segment {
                category: Category::Sponsor,
                start: 10.0,
                end: 20.0,
                muted: false,
            }],
            saved_seconds: 0.0,
        };
        assert_eq!(set.decision(15.0, None, true, &actions()), Decision::None);
    }

    #[test]
    fn label_only_categories_never_skip() {
        let set = SegmentSet {
            video_id: "v".into(),
            segments: vec![Segment {
                category: Category::Chapter,
                start: 0.0,
                end: 30.0,
                muted: false,
            }],
            saved_seconds: 0.0,
        };
        assert_eq!(set.decision(10.0, None, false, &[]), Decision::None);
    }

    #[test]
    fn merging_overlapping_same_category() {
        let mut set = SegmentSet {
            video_id: "v".into(),
            segments: vec![
                Segment {
                    category: Category::Sponsor,
                    start: 5.0,
                    end: 10.0,
                    muted: false,
                },
                Segment {
                    category: Category::Sponsor,
                    start: 8.0,
                    end: 12.0,
                    muted: false,
                },
            ],
            saved_seconds: 0.0,
        };
        set.normalize();
        assert_eq!(set.segments.len(), 1);
        assert_eq!(set.segments[0].start, 5.0);
        assert_eq!(set.segments[0].end, 12.0);
    }

    #[test]
    fn parse_segments_from_api_payload() {
        let raw = serde_json::json!([
            {"category": "sponsor", "segment": [10.0, 20.0]},
            {"category": "bogus", "segment": [0.0, 1.0]},
            {"category": "intro", "segment": [0.0, 5.0]}
        ]);
        let set = parse_segments("vid", &raw).unwrap();
        assert_eq!(set.segments.len(), 2);
        assert!(set.segments.iter().any(|s| s.category == Category::Sponsor));
        assert!(set.segments.iter().any(|s| s.category == Category::Intro));
    }

    #[test]
    fn parse_rejects_invalid_segment_ranges() {
        let raw = serde_json::json!([
            {"category": "sponsor", "segment": [20.0, 10.0]},
            {"category": "sponsor", "segment": [-5.0, 1.0]}
        ]);
        let set = parse_segments("vid", &raw).unwrap();
        assert!(set.segments.is_empty());
    }

    #[test]
    fn cache_key_differs_by_privacy() {
        let a = cache_key("abc", false, 7);
        let b = cache_key("abc", true, 7);
        assert_ne!(a, b);
        assert_eq!(cache_key("abc", false, 7), cache_key("abc", false, 7));
    }

    #[test]
    fn should_be_muted_inside_mute_segment() {
        let set = SegmentSet {
            video_id: "v".into(),
            segments: vec![Segment {
                category: Category::MusicOffTopic,
                start: 5.0,
                end: 9.0,
                muted: false,
            }],
            saved_seconds: 0.0,
        };
        let actions = vec![(Category::MusicOffTopic, CategoryAction::Mute)];
        assert!(set.should_be_muted(6.0, &actions));
        assert!(!set.should_be_muted(4.9, &actions));
    }
}
