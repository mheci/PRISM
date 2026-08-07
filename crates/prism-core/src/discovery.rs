//! Discovery: momentum ranking, credibility classification, and search
//! remix helpers. Pure scoring functions over parsed video metadata.

use serde::{Deserialize, Serialize};

/// A candidate video for discovery feeds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Video {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    /// Unix ms of publish time (0 = unknown).
    pub published_at_ms: u64,
    pub view_count: u64,
    pub duration_sec: f64,
}

impl Video {
    /// View velocity: views per hour since publish.
    pub fn velocity_per_hour(&self, now_ms: u64) -> f64 {
        if self.view_count == 0 || self.published_at_ms == 0 {
            return 0.0;
        }
        let age_hours = (now_ms.saturating_sub(self.published_at_ms)) as f64 / 3_600_000.0;
        if age_hours <= 0.0 {
            return 0.0;
        }
        self.view_count as f64 / age_hours
    }

    /// Momentum label for a velocity value.
    pub fn momentum_label(velocity: f64) -> String {
        if velocity >= 1000.0 {
            format!("{:.1}K views/hr", velocity / 1000.0)
        } else {
            format!("{:.0} views/hr", velocity)
        }
    }
}

/// Ranks a batch by view velocity (momentum feed).
pub fn rank_by_velocity(mut videos: Vec<Video>, limit: usize, now_ms: u64) -> Vec<(Video, f64)> {
    videos.retain(|v| v.published_at_ms > 0 && v.view_count > 0);
    videos.sort_by(|a, b| {
        b.velocity_per_hour(now_ms)
            .partial_cmp(&a.velocity_per_hour(now_ms))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    videos
        .into_iter()
        .take(limit)
        .map(|v| {
            let vel = v.velocity_per_hour(now_ms);
            (v, vel)
        })
        .collect()
}

/// Reach classification for credibility badges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Reach {
    Unknown,
    Emerging,
    Growing,
    High,
}

impl Reach {
    pub fn as_str(self) -> &'static str {
        match self {
            Reach::Unknown => "unknown",
            Reach::Emerging => "emerging",
            Reach::Growing => "growing",
            Reach::High => "high",
        }
    }
}

/// Classifies reach from a view count.
pub fn classify_reach(views: u64) -> Reach {
    match views {
        0 => Reach::Unknown,
        v if v > 1_000_000 => Reach::High,
        v if v > 10_000 => Reach::Growing,
        _ => Reach::Emerging,
    }
}

/// Age in whole years (0 = under a year).
pub fn age_years(published_at_ms: u64, now_ms: u64) -> u32 {
    if published_at_ms == 0 {
        return 0;
    }
    ((now_ms.saturating_sub(published_at_ms)) / (365 * 24 * 3600 * 1000)) as u32
}

/// Credibility context for a card.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Credibility {
    pub reach: Reach,
    pub views: u64,
    /// Whole years since publish.
    pub age_years: u32,
    /// True when the video is old enough to be potentially outdated.
    pub potentially_outdated: bool,
}

/// Builds the credibility context for a card.
pub fn credibility(
    views: u64,
    published_at_ms: u64,
    now_ms: u64,
    outdated_threshold_years: u32,
) -> Credibility {
    let years = age_years(published_at_ms, now_ms);
    Credibility {
        reach: classify_reach(views),
        views,
        age_years: years,
        potentially_outdated: years >= outdated_threshold_years,
    }
}

/// Parses a compact count ("1.2M", "34K", "500") to a number.
pub fn parse_count(text: &str) -> u64 {
    let t = text.trim();
    let (num, unit) = match t.chars().last() {
        Some(c) if c.is_ascii_alphabetic() => {
            let (n, u) = t.split_at(t.len() - 1);
            (n, u.to_ascii_uppercase())
        }
        _ => (t, String::new()),
    };
    let value: f64 = num.replace(',', "").trim().parse().unwrap_or(0.0);
    match unit.as_str() {
        "K" => (value * 1e3) as u64,
        "M" => (value * 1e6) as u64,
        "B" => (value * 1e9) as u64,
        _ => value as u64,
    }
}

/// Parses "5 hours ago" style strings into a unix-ms timestamp.
pub fn parse_ago_ms(text: &str, now_ms: u64) -> u64 {
    let lower = text.to_ascii_lowercase();
    let mut parts = lower.split_whitespace();
    let value: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let unit = parts.next().unwrap_or("");
    let factor = match unit {
        u if u.starts_with("year") => 365.0 * 86_400.0,
        u if u.starts_with("month") => 30.0 * 86_400.0,
        u if u.starts_with("week") => 7.0 * 86_400.0,
        u if u.starts_with("day") => 86_400.0,
        u if u.starts_with("hour") => 3_600.0,
        u if u.starts_with("minute") => 60.0,
        _ => 0.0,
    };
    if factor == 0.0 {
        return 0;
    }
    now_ms.saturating_sub((value * factor * 1000.0) as u64)
}

/// Parses "12:34" or "1:02:03" durations.
pub fn parse_duration_sec(text: &str) -> f64 {
    let parts: Vec<f64> = text
        .split(':')
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    match parts.as_slice() {
        [a, b, c] => a * 3600.0 + b * 60.0 + c,
        [a, b] => a * 60.0 + b,
        [a] => *a,
        _ => 0.0,
    }
}

/// Search remix parameter presets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RemixPreset {
    Short,
    Medium,
    Long,
    Today,
    Week,
    Month,
    Year,
    Hd,
    Uhd,
    Subtitled,
    Live,
}

impl RemixPreset {
    /// Returns the `sp` innertube search param.
    pub fn sp(self) -> &'static str {
        match self {
            RemixPreset::Short => "EgQQARgB",
            RemixPreset::Medium => "EgQQARgC",
            RemixPreset::Long => "EgQQARgD",
            RemixPreset::Today => "EgIIAg",
            RemixPreset::Week => "EgIIAw",
            RemixPreset::Month => "EgIIBA",
            RemixPreset::Year => "EgIIBQ",
            RemixPreset::Hd => "EgIgAQ",
            RemixPreset::Uhd => "EgIgBA",
            RemixPreset::Subtitled => "EgIoAQ",
            RemixPreset::Live => "EgJAAQ",
        }
    }
}

/// Vibe presets: mapping a user phrase to a filter combination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Vibe {
    pub name: String,
    pub keywords: Vec<String>,
    pub preset: Option<RemixPreset>,
}

/// The built-in vibe catalog.
pub fn vibes() -> Vec<Vibe> {
    vec![
        Vibe {
            name: "chill".into(),
            keywords: vec![
                "chill".into(),
                "relax".into(),
                "calm".into(),
                "cozy".into(),
                "lofi".into(),
            ],
            preset: None,
        },
        Vibe {
            name: "deep dive".into(),
            keywords: vec![
                "documentary".into(),
                "long".into(),
                "deep".into(),
                "in-depth".into(),
            ],
            preset: Some(RemixPreset::Long),
        },
        Vibe {
            name: "quick hit".into(),
            keywords: vec!["short".into(), "quick".into(), "snappy".into()],
            preset: Some(RemixPreset::Short),
        },
        Vibe {
            name: "fresh".into(),
            keywords: vec![
                "new".into(),
                "fresh".into(),
                "recent".into(),
                "this week".into(),
            ],
            preset: Some(RemixPreset::Week),
        },
        Vibe {
            name: "crisp".into(),
            keywords: vec!["hd".into(), "crisp".into(), "high quality".into()],
            preset: Some(RemixPreset::Hd),
        },
    ]
}

/// Finds the best matching vibe for a phrase.
pub fn match_vibe(phrase: &str) -> Option<Vibe> {
    let lower = phrase.to_ascii_lowercase();
    vibes()
        .into_iter()
        .find(|v| v.keywords.iter().any(|k| lower.contains(k)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocity_ranking() {
        let now = 1_000_000_000_000u64;
        let slow = Video {
            video_id: "a".into(),
            title: "a".into(),
            channel: "c".into(),
            published_at_ms: now - 2 * 3600_000,
            view_count: 10_000,
            duration_sec: 100.0,
        };
        let fast = Video {
            video_id: "b".into(),
            title: "b".into(),
            channel: "c".into(),
            published_at_ms: now - 3600_000,
            view_count: 10_000,
            duration_sec: 100.0,
        };
        let ranked = rank_by_velocity(vec![slow, fast], 10, now);
        assert_eq!(ranked[0].0.video_id, "b");
        assert!(ranked[0].1 > ranked[1].1);
    }

    #[test]
    fn momentum_labels() {
        assert_eq!(Video::momentum_label(2500.0), "2.5K views/hr");
        assert_eq!(Video::momentum_label(500.0), "500 views/hr");
    }

    #[test]
    fn reach_buckets() {
        assert_eq!(classify_reach(0), Reach::Unknown);
        assert_eq!(classify_reach(5_000), Reach::Emerging);
        assert_eq!(classify_reach(50_000), Reach::Growing);
        assert_eq!(classify_reach(5_000_000), Reach::High);
    }

    #[test]
    fn count_parsing() {
        assert_eq!(parse_count("1.2M"), 1_200_000);
        assert_eq!(parse_count("34K"), 34_000);
        assert_eq!(parse_count("500"), 500);
        assert_eq!(parse_count("2.5B"), 2_500_000_000);
    }

    #[test]
    fn ago_parsing() {
        let now = 1_000_000_000_000u64;
        let two_days = parse_ago_ms("2 days ago", now);
        let diff = now.saturating_sub(two_days);
        assert!((diff as i64 - 2 * 86_400_000).abs() < 1000);
    }

    #[test]
    fn duration_parsing() {
        assert!((parse_duration_sec("1:02:03") - 3723.0).abs() < 0.001);
        assert!((parse_duration_sec("12:34") - 754.0).abs() < 0.001);
        assert!((parse_duration_sec("45") - 45.0).abs() < 0.001);
    }

    #[test]
    fn credibility_outdated_flag() {
        let now = 1_000_000_000_000u64;
        let old = credibility(1_000, now - 3 * 365 * 86_400_000, now, 2);
        assert!(old.potentially_outdated);
        let fresh = credibility(1_000, now - 86_400_000, now, 2);
        assert!(!fresh.potentially_outdated);
    }

    #[test]
    fn vibe_matching() {
        assert!(match_vibe("something chill to watch").is_some());
        assert_eq!(
            match_vibe("a long documentary").unwrap().preset,
            Some(RemixPreset::Long)
        );
        assert!(match_vibe("zzz").is_none());
    }
}
