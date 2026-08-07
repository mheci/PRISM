//! Watch history model and aggregation.
//!
//! The host persists records; this module defines the schema, completion
//! rules, resume decisions and aggregation queries (per-day totals, per
//! channel ranking). All logic is pure and deterministic.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Subsystem};

/// Thresholds for "watched enough" heuristics.
pub const COMPLETE_PROGRESS_PCT: f64 = 97.0;
pub const COMPLETE_REMAINING_SEC: f64 = 15.0;

/// One watch session of a single video.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub started_at: u64,
    pub watched_sec: f64,
    /// `"forced"` for force-watched marks.
    pub kind: String,
}

/// A watch record, keyed by video id. Deserialization tolerates partial
/// records (the host may persist incrementally).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WatchRecord {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub channel_id: String,
    pub thumbnail: String,
    pub duration_sec: f64,
    pub last_position_sec: f64,
    pub progress_pct: f64,
    pub completed: bool,
    pub watch_count: u32,
    pub total_watch_sec: f64,
    pub last_watched: u64,
    pub sessions: Vec<Session>,
}

impl Default for WatchRecord {
    fn default() -> Self {
        Self::new("")
    }
}

impl WatchRecord {
    pub fn new(video_id: &str) -> Self {
        Self {
            video_id: video_id.to_string(),
            title: String::new(),
            channel: String::new(),
            channel_id: String::new(),
            thumbnail: String::new(),
            duration_sec: 0.0,
            last_position_sec: 0.0,
            progress_pct: 0.0,
            completed: false,
            watch_count: 0,
            total_watch_sec: 0.0,
            last_watched: 0,
            sessions: Vec::new(),
        }
    }

    /// Updates progress from a watchdog tick. Returns `true` when the
    /// record became newly completed by this tick.
    pub fn tick(
        &mut self,
        position_sec: f64,
        duration_sec: f64,
        now: u64,
        max_sessions: usize,
    ) -> bool {
        if duration_sec.is_finite() && duration_sec > 0.0 {
            self.duration_sec = duration_sec;
            self.last_position_sec = position_sec.clamp(0.0, duration_sec);
            self.progress_pct = (position_sec / duration_sec * 100.0).clamp(0.0, 100.0);
        } else {
            self.last_position_sec = position_sec.max(0.0);
        }
        self.last_watched = now;
        let newly_complete = !self.completed && self.is_complete();
        if newly_complete {
            self.completed = true;
            self.last_position_sec = 0.0;
            self.progress_pct = 100.0;
            self.push_session(now, 0.0, "completed", max_sessions);
        }
        newly_complete
    }

    /// The completion rule: past 97% or under 15s remaining.
    pub fn is_complete(&self) -> bool {
        if self.progress_pct >= COMPLETE_PROGRESS_PCT {
            return true;
        }
        if self.duration_sec > 0.0 {
            let remaining = self.duration_sec - self.last_position_sec;
            if remaining.is_finite() && remaining < COMPLETE_REMAINING_SEC {
                return true;
            }
        }
        false
    }

    /// Seconds remaining (0 when completed).
    pub fn remaining_sec(&self) -> f64 {
        if self.completed {
            return 0.0;
        }
        if self.duration_sec > 0.0 {
            (self.duration_sec - self.last_position_sec).max(0.0)
        } else {
            0.0
        }
    }
    fn push_session(&mut self, now: u64, watched_sec: f64, kind: &str, max_sessions: usize) {
        self.sessions.push(Session {
            started_at: now,
            watched_sec,
            kind: kind.to_string(),
        });
        let cap = max_sessions.max(1);
        if self.sessions.len() > cap {
            let drop = self.sessions.len() - cap;
            self.sessions.drain(..drop);
        }
    }

    /// Records an incremental watchdog sample (called every N seconds).
    pub fn record_progress(
        &mut self,
        position_sec: f64,
        duration_sec: f64,
        now: u64,
        max_sessions: usize,
    ) {
        let before = self.completed;
        self.tick(position_sec, duration_sec, now, max_sessions);
        if self.completed && !before {
            // completed transition already handled
            return;
        }
        if !self.completed && self.sessions.is_empty() {
            self.push_session(now, 0.0, "watch", max_sessions);
        }
    }

    /// Accumulates a single session delta (host calls every tick).
    pub fn add_watch_time(&mut self, delta_sec: f64) {
        self.total_watch_sec += delta_sec.clamp(0.0, 10.0); // clamp runaway deltas
        self.watch_count = self.watch_count.saturating_add(1);
    }
}

/// Resume prompt decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResumeDecision {
    pub show: bool,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
}

/// Whether a resume prompt should appear.
///
/// * `has_t_param` — URL already contains `?t=` (explicit seek wins).
/// * `mode` — resume mode; `Off` never prompts.
pub fn resume_decision(
    record: Option<&WatchRecord>,
    has_t_param: bool,
    mode: ResumeMode,
) -> Option<ResumeDecision> {
    let record = record?;
    if mode == ResumeMode::Off {
        return None;
    }
    if has_t_param || record.completed || record.progress_pct < 1.0 {
        return None;
    }
    if record.last_position_sec <= 0.0 {
        return None;
    }
    Some(ResumeDecision {
        show: true,
        position_sec: record.last_position_sec,
        duration_sec: record.duration_sec,
        title: record.title.clone(),
        channel: record.channel.clone(),
        thumbnail: record.thumbnail.clone(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResumeMode {
    Off,
    Silent,
    Card,
    Overlay,
}

/// Daily aggregation row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DayRow {
    pub day: u64, // UTC day number (days since epoch)
    pub watch_sec: f64,
    pub videos: u32,
}

/// Channel aggregation row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelRow {
    pub channel: String,
    pub watch_sec: f64,
    pub videos: u32,
}

/// Aggregates a batch of records.
pub fn aggregate(records: &[WatchRecord], now: u64) -> Aggregate {
    let today = now / 86_400;
    let mut by_day: BTreeMap<u64, (f64, u32)> = BTreeMap::new();
    let mut by_channel: BTreeMap<String, (f64, u32)> = BTreeMap::new();
    for r in records {
        let day = r.last_watched / 86_400;
        let e = by_day.entry(day).or_insert((0.0, 0));
        e.0 += r.total_watch_sec;
        e.1 = e.1.saturating_add(1);

        let c = by_channel.entry(r.channel.clone()).or_insert((0.0, 0));
        c.0 += r.total_watch_sec;
        c.1 = c.1.saturating_add(1);
    }
    let today_sec = by_day.get(&today).map(|(s, _)| *s).unwrap_or(0.0);
    let mut days: Vec<DayRow> = by_day
        .into_iter()
        .map(|(day, (watch_sec, videos))| DayRow {
            day,
            watch_sec,
            videos,
        })
        .collect();
    days.sort_by_key(|d| std::cmp::Reverse(d.day));
    let mut channels: Vec<ChannelRow> = by_channel
        .into_iter()
        .map(|(channel, (watch_sec, videos))| ChannelRow {
            channel,
            watch_sec,
            videos,
        })
        .collect();
    channels.sort_by(|a, b| {
        b.watch_sec
            .partial_cmp(&a.watch_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Aggregate {
        today_sec,
        days,
        channels,
        total_records: records.len(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Aggregate {
    pub today_sec: f64,
    pub days: Vec<DayRow>,
    pub channels: Vec<ChannelRow>,
    pub total_records: usize,
}

/// Validates a raw history record (host-level sanity check).
pub fn validate_record(r: &WatchRecord) -> Result<(), Error> {
    if r.video_id.is_empty() {
        return Err(Error::invalid(
            Subsystem::History,
            "validate_record",
            ErrorCode::HistoryCorrupt,
            "record without video id",
        ));
    }
    if r.total_watch_sec.is_nan() || r.total_watch_sec < 0.0 {
        return Err(Error::invalid(
            Subsystem::History,
            "validate_record",
            ErrorCode::HistoryCorrupt,
            "negative or NaN watch time",
        ));
    }
    if r.last_position_sec.is_nan() || r.last_position_sec < 0.0 {
        return Err(Error::invalid(
            Subsystem::History,
            "validate_record",
            ErrorCode::HistoryCorrupt,
            "invalid position",
        ));
    }
    Ok(())
}

/// Eviction policy: keep the `capacity` most-recently-watched records.
pub fn evict_to_capacity(records: &mut Vec<WatchRecord>, capacity: usize) -> usize {
    if records.len() <= capacity {
        return 0;
    }
    records.sort_by_key(|r| std::cmp::Reverse(r.last_watched));
    let removed = records.len() - capacity;
    records.truncate(capacity);
    removed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completion_by_percent() {
        let mut r = WatchRecord::new("v1");
        r.duration_sec = 100.0;
        let newly = r.tick(98.0, 100.0, 1, 50);
        assert!(newly);
        assert!(r.completed);
        assert_eq!(r.last_position_sec, 0.0);
    }

    #[test]
    fn completion_by_remaining() {
        let mut r = WatchRecord::new("v2");
        r.duration_sec = 1000.0;
        let newly = r.tick(988.0, 1000.0, 1, 50);
        assert!(newly);
    }

    #[test]
    fn no_completion_before_thresholds() {
        let mut r = WatchRecord::new("v3");
        r.duration_sec = 1000.0;
        assert!(!r.tick(500.0, 1000.0, 1, 50));
        assert!(!r.completed);
    }

    #[test]
    fn resume_skipped_when_completed_or_t_param() {
        let mut r = WatchRecord::new("v4");
        r.duration_sec = 100.0;
        r.tick(50.0, 100.0, 1, 50);
        assert!(resume_decision(Some(&r), false, ResumeMode::Card).is_some());
        assert!(resume_decision(Some(&r), true, ResumeMode::Card).is_none());
        r.tick(100.0, 100.0, 2, 50);
        assert!(resume_decision(Some(&r), false, ResumeMode::Card).is_none());
    }

    #[test]
    fn resume_never_for_fresh_videos() {
        let r = WatchRecord::new("v5"); // progress 0
        assert!(resume_decision(Some(&r), false, ResumeMode::Overlay).is_none());
    }

    #[test]
    fn sessions_capped() {
        let mut r = WatchRecord::new("v6");
        r.duration_sec = 100.0;
        for i in 0..60 {
            r.record_progress(1.0, 100.0, i, 50);
            r.sessions.clear();
            r.push_session(i, 0.0, "watch", 50);
        }
        assert!(r.sessions.len() <= 50);
    }

    #[test]
    fn aggregation_sums_per_day_and_channel() {
        let now = 1_000_000u64;
        let mut a = WatchRecord::new("a");
        a.channel = "ch1".into();
        a.total_watch_sec = 120.0;
        a.last_watched = now;
        let mut b = WatchRecord::new("b");
        b.channel = "ch1".into();
        b.total_watch_sec = 60.0;
        b.last_watched = now - 86_400; // yesterday
        let agg = aggregate(&[a, b], now);
        assert!((agg.today_sec - 120.0).abs() < 0.001);
        assert_eq!(agg.channels[0].channel, "ch1");
        assert!((agg.channels[0].watch_sec - 180.0).abs() < 0.001);
    }

    #[test]
    fn eviction_keeps_newest() {
        let mut records: Vec<WatchRecord> = (0..10)
            .map(|i| {
                let mut r = WatchRecord::new(&format!("v{i}"));
                r.last_watched = i as u64;
                r
            })
            .collect();
        let removed = evict_to_capacity(&mut records, 5);
        assert_eq!(removed, 5);
        assert!(records.iter().all(|r| r.last_watched >= 5));
    }

    #[test]
    fn validate_rejects_empty_video_id() {
        let r = WatchRecord::new("");
        assert!(validate_record(&r).is_err());
    }
}
