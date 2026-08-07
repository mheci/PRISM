//! Network accounting: byte estimation, quality classification, hourly
//! buckets, and monthly budget thresholds.
//!
//! The host supplies raw request/response sizes or bodies; this module turns
//! them into normalized buckets and budget decisions. Pure, deterministic.

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Subsystem};

/// A request body's kind, used to estimate its byte size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BodyKind {
    String,
    Blob,
    ArrayBuffer,
    FormData,
    UrlSearchParams,
    Unknown,
}

/// Estimates the byte size of a request body of the given kind.
///
/// * Strings: UTF-8 length.
/// * FormData: sum of key lengths + value sizes (string/blob/File).
/// * Blob/ArrayBuffer: host-provided size (we don't inspect memory here).
pub fn estimate_body_bytes(kind: BodyKind, hint_len: Option<u64>) -> u64 {
    match kind {
        BodyKind::String => hint_len.unwrap_or(0),
        BodyKind::Blob => hint_len.unwrap_or(0),
        BodyKind::ArrayBuffer => hint_len.unwrap_or(0),
        BodyKind::FormData => hint_len.unwrap_or(0),
        BodyKind::UrlSearchParams => hint_len.unwrap_or(0),
        BodyKind::Unknown => 0,
    }
}

/// Quality class derived from an itag or label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum QualityClass {
    Uhd, // >= 2160p
    Qhd, // 1440p
    Fhd, // 1080p
    Hd,  // 720p
    Sd,  // 480p
    Ed,  // 360p
    Ld,  // <= 240p
    Audio,
    Other,
}

impl QualityClass {
    pub fn as_str(self) -> &'static str {
        match self {
            QualityClass::Uhd => "4K+",
            QualityClass::Qhd => "1440p",
            QualityClass::Fhd => "1080p",
            QualityClass::Hd => "720p",
            QualityClass::Sd => "480p",
            QualityClass::Ed => "360p",
            QualityClass::Ld => "240p-",
            QualityClass::Audio => "audio",
            QualityClass::Other => "other",
        }
    }
}

/// Classifies a stream by its itag.
///
/// Video itags: 160/133/134/135/136/137/138/264/266/298/299/303/304/305/
/// 308/278/242/243/244/247/248/271/313/315/272.
/// Audio itags: 139/140/141/171/249/250/251.
/// Muxed: 18/22/37/59/43.
pub fn classify_itag(itag: u64) -> QualityClass {
    match itag {
        272 | 315 => QualityClass::Uhd,             // 4320p60 / 2160p60
        138 | 266 | 305 | 313 => QualityClass::Uhd, // 2160p family
        264 | 304 | 308 => QualityClass::Qhd,       // 1440p family
        137 | 299 | 303 => QualityClass::Fhd,       // 1080p family
        22 | 37 => QualityClass::Fhd,               // 720p/1080p muxed
        136 | 247 | 248 | 298 => QualityClass::Hd,  // 720p family
        135 | 59 | 244 => QualityClass::Sd,         // 480p family
        18 | 43 | 134 | 243 => QualityClass::Ed,    // 360p family
        133 | 160 | 242 | 278 => QualityClass::Ld,  // 240p/144p
        139 | 140 | 141 | 171 | 249 | 250 | 251 => QualityClass::Audio,
        _ => QualityClass::Other,
    }
}

/// Classifies by a human label ("1080p", "720p60", "AAC-128k").
pub fn classify_label(label: &str) -> QualityClass {
    let lower = label.to_ascii_lowercase();
    if lower.contains("aac") || lower.contains("opus") || lower.contains("vorbis") {
        return QualityClass::Audio;
    }
    let n = lower
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse::<u32>().ok())
        .next();
    match n {
        Some(p) if p >= 2160 => QualityClass::Uhd,
        Some(p) if p >= 1440 => QualityClass::Qhd,
        Some(p) if p >= 1080 => QualityClass::Fhd,
        Some(p) if p >= 720 => QualityClass::Hd,
        Some(p) if p >= 480 => QualityClass::Sd,
        Some(p) if p >= 360 => QualityClass::Ed,
        Some(_) => QualityClass::Ld,
        None => QualityClass::Other,
    }
}

/// One hourly bucket.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bucket {
    /// Hour number (unix time / 3600).
    pub hour: u64,
    pub down_bytes: u64,
    pub up_bytes: u64,
    pub requests: u64,
    /// Optional quality attribution totals (by QualityClass label).
    pub quality_bytes: std::collections::BTreeMap<String, u64>,
    /// Per-host totals (top N hosts).
    pub host_bytes: std::collections::BTreeMap<String, (u64, u64)>,
}

impl Bucket {
    pub fn new(hour: u64) -> Self {
        Self {
            hour,
            down_bytes: 0,
            up_bytes: 0,
            requests: 0,
            quality_bytes: Default::default(),
            host_bytes: Default::default(),
        }
    }

    /// Adds a transfer record.
    pub fn add(&mut self, down: u64, up: u64, quality: Option<QualityClass>, host: Option<&str>) {
        self.down_bytes = self.down_bytes.saturating_add(down);
        self.up_bytes = self.up_bytes.saturating_add(up);
        self.requests = self.requests.saturating_add(1);
        if let Some(q) = quality {
            let e = self
                .quality_bytes
                .entry(q.as_str().to_string())
                .or_insert(0);
            *e = e.saturating_add(down.saturating_add(up));
        }
        if let Some(h) = host {
            let e = self.host_bytes.entry(h.to_string()).or_insert((0, 0));
            e.0 = e.0.saturating_add(down);
            e.1 = e.1.saturating_add(up);
        }
    }

    /// Merges another bucket in place (for range aggregation).
    pub fn merge(&mut self, other: &Bucket) {
        self.down_bytes = self.down_bytes.saturating_add(other.down_bytes);
        self.up_bytes = self.up_bytes.saturating_add(other.up_bytes);
        self.requests = self.requests.saturating_add(other.requests);
        for (k, v) in &other.quality_bytes {
            let e = self.quality_bytes.entry(k.clone()).or_insert(0);
            *e = e.saturating_add(*v);
        }
        for (k, (d, u)) in &other.host_bytes {
            let e = self.host_bytes.entry(k.clone()).or_insert((0, 0));
            e.0 = e.0.saturating_add(*d);
            e.1 = e.1.saturating_add(*u);
        }
    }
}

/// Range selector for aggregation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Range {
    Hour,
    Day,
    Week,
    Month,
    Year,
    All,
}

impl Range {
    /// Number of hours to look back (None = all).
    pub fn lookback_hours(self) -> Option<u64> {
        match self {
            Range::Hour => Some(1),
            Range::Day => Some(24),
            Range::Week => Some(7 * 24),
            Range::Month => Some(30 * 24),
            Range::Year => Some(365 * 24),
            Range::All => None,
        }
    }
}

/// Monthly budget decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum BudgetState {
    Ok,
    Warn,
    Critical,
    Exceeded,
}

/// Evaluates the budget for a calendar month.
///
/// `used_bytes` must already include the whole month (host aggregates).
pub fn budget_state(used_bytes: u64, budget_gb: f64) -> BudgetState {
    if budget_gb <= 0.0 {
        return BudgetState::Ok;
    }
    let budget_bytes = budget_gb * 1024.0 * 1024.0 * 1024.0;
    let pct = used_bytes as f64 / budget_bytes;
    if pct >= 1.0 {
        BudgetState::Exceeded
    } else if pct >= 0.95 {
        BudgetState::Critical
    } else if pct >= 0.80 {
        BudgetState::Warn
    } else {
        BudgetState::Ok
    }
}

/// Formats a byte count compactly ("1.2 MB").
pub fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b < KB {
        format!("{bytes} B")
    } else if b < MB {
        format!("{:.1} KB", b / KB)
    } else if b < GB {
        format!("{:.2} MB", b / MB)
    } else {
        format!("{:.2} GB", b / GB)
    }
}

/// Aggregates buckets over a range.
pub fn aggregate_buckets(buckets: &[Bucket], range: Range) -> Bucket {
    let mut out = Bucket::new(0);
    match range.lookback_hours() {
        None => {
            for b in buckets {
                out.merge(b);
            }
        }
        Some(hours) => {
            let now_hour = now_hour();
            for b in buckets {
                if now_hour.saturating_sub(b.hour) < hours {
                    out.merge(b);
                }
            }
        }
    }
    out
}

/// Current hour number (unix / 3600).
pub fn now_hour() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 3600)
        .unwrap_or(0)
}

/// Sanity check for a persisted bucket.
pub fn validate_bucket(b: &Bucket) -> Result<(), Error> {
    if b.down_bytes > 1 << 40 || b.up_bytes > 1 << 40 {
        return Err(Error::invalid(
            Subsystem::Network,
            "validate_bucket",
            ErrorCode::NetworkBucketCorrupt,
            "bucket exceeds 1TB sanity cap",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn itag_classification() {
        assert_eq!(classify_itag(137), QualityClass::Fhd);
        assert_eq!(classify_itag(251), QualityClass::Audio);
        assert_eq!(classify_itag(272), QualityClass::Uhd);
        assert_eq!(classify_itag(999), QualityClass::Other);
    }

    #[test]
    fn label_classification() {
        assert_eq!(classify_label("1080p60"), QualityClass::Fhd);
        assert_eq!(classify_label("AAC-128k"), QualityClass::Audio);
        assert_eq!(classify_label("2160p"), QualityClass::Uhd);
        assert_eq!(classify_label("weird"), QualityClass::Other);
    }

    #[test]
    fn bucket_adds_and_merges() {
        let mut a = Bucket::new(1);
        a.add(100, 10, Some(QualityClass::Fhd), Some("googlevideo.com"));
        let mut b = Bucket::new(1);
        b.add(50, 5, Some(QualityClass::Fhd), Some("googlevideo.com"));
        a.merge(&b);
        assert_eq!(a.down_bytes, 150);
        assert_eq!(a.up_bytes, 15);
        assert_eq!(a.requests, 2);
        assert_eq!(a.quality_bytes["1080p"], 165);
    }

    #[test]
    fn budget_thresholds() {
        let gb = 10.0;
        let gb_bytes = (gb * 1024.0 * 1024.0 * 1024.0) as u64;
        assert_eq!(budget_state(gb_bytes / 2, gb), BudgetState::Ok);
        assert_eq!(
            budget_state((gb_bytes as f64 * 0.9) as u64, gb),
            BudgetState::Warn
        );
        assert_eq!(
            budget_state((gb_bytes as f64 * 0.97) as u64, gb),
            BudgetState::Critical
        );
        assert_eq!(budget_state(gb_bytes, gb), BudgetState::Exceeded);
    }

    #[test]
    fn format_bytes_round_trip() {
        assert_eq!(format_bytes(512), "512 B");
        assert!(format_bytes(2048).ends_with("KB"));
        assert!(format_bytes(5 * 1024 * 1024).ends_with("MB"));
    }

    #[test]
    fn range_lookbacks() {
        assert_eq!(Range::Hour.lookback_hours(), Some(1));
        assert_eq!(Range::All.lookback_hours(), None);
    }
}
