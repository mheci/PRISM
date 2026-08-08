//! Diagnostics: bounded log ring, per-feature metrics, health snapshot.
//!
//! The host feeds log lines and metric ticks in; the core keeps fixed-size,
//! allocation-free-after-init structures and can serialize a snapshot for
//! the dashboard.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::error::{Severity, Subsystem};

/// Default log ring capacity.
pub const LOG_CAPACITY: usize = 64;

/// Default feature metric slot capacity.
pub const METRIC_CAPACITY: usize = 256;

/// One log line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogLine {
    pub ts_ms: u64,
    pub subsystem: String,
    pub severity: String,
    pub message: String,
}

/// Per-feature runtime metrics.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FeatureMetrics {
    pub applies: u64,
    pub errors: u64,
    pub quarantined: bool,
    /// Total CPU time spent inside the feature's host callbacks (ms).
    pub total_ms: f64,
    /// Last error envelope, if any.
    pub last_error: Option<String>,
}

/// A process-wide diagnostics store.
#[derive(Debug, Clone)]
pub struct Diagnostics {
    log: VecDeque<LogLine>,
    log_capacity: usize,
    metrics: std::collections::BTreeMap<String, FeatureMetrics>,
    /// LRU order of feature ids (front = least recently touched).
    metric_order: VecDeque<String>,
    started_at_ms: u64,
    /// Quarantined module ids.
    quarantined: Vec<String>,
}

/// Health of the whole runtime.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Health {
    pub uptime_ms: u64,
    pub log_entries: usize,
    pub features: usize,
    pub quarantined: Vec<String>,
    pub metrics: std::collections::BTreeMap<String, FeatureMetrics>,
    pub log: Vec<LogLine>,
}

impl Default for Diagnostics {
    fn default() -> Self {
        Self::new(LOG_CAPACITY, 0)
    }
}

impl Diagnostics {
    /// Creates a store with the given capacities.
    pub fn new(log_capacity: usize, started_at_ms: u64) -> Self {
        Self {
            log: VecDeque::with_capacity(log_capacity),
            log_capacity: log_capacity.max(16),
            metrics: Default::default(),
            metric_order: VecDeque::new(),
            started_at_ms,
            quarantined: Vec::new(),
        }
    }

    /// Records a log line (drops the oldest when full).
    pub fn log(
        &mut self,
        ts_ms: u64,
        subsystem: Subsystem,
        severity: Severity,
        message: impl Into<String>,
    ) {
        if self.log.len() >= self.log_capacity {
            self.log.pop_front();
        }
        self.log.push_back(LogLine {
            ts_ms,
            subsystem: subsystem.as_str().to_string(),
            severity: match severity {
                Severity::Info => "info",
                Severity::Warning => "warn",
                Severity::Error => "error",
                Severity::Critical => "critical",
            }
            .to_string(),
            message: message.into(),
        });
    }

    /// Records a metric tick for a feature.
    pub fn record_metric(&mut self, feature: &str, cpu_ms: f64) {
        // Refresh recency first (drop then re-append).
        if let Some(pos) = self.metric_order.iter().position(|f| f == feature) {
            self.metric_order.remove(pos);
        }
        self.metric_order.push_back(feature.to_string());
        if self.metrics.len() > METRIC_CAPACITY {
            // Evict the least-recently-touched entry (front of the queue).
            if let Some(oldest) = self.metric_order.pop_front() {
                self.metrics.remove(&oldest);
            }
        }
        let m = self.metrics.entry(feature.to_string()).or_default();
        m.total_ms += cpu_ms;
        m.applies = m.applies.saturating_add(1);
    }

    /// Records an error for a feature.
    pub fn record_error(&mut self, feature: &str, error: &crate::error::Error) {
        self.touch_metric(feature);
        let m = self.metrics.entry(feature.to_string()).or_default();
        m.errors = m.errors.saturating_add(1);
        m.last_error = Some(error.to_envelope().to_string());
    }

    /// Marks a feature as quarantined (persistent failure).
    pub fn quarantine(&mut self, feature: &str) {
        self.touch_metric(feature);
        self.metrics
            .entry(feature.to_string())
            .or_default()
            .quarantined = true;
        if !self.quarantined.iter().any(|q| q == feature) {
            self.quarantined.push(feature.to_string());
        }
    }

    fn touch_metric(&mut self, feature: &str) {
        if let Some(pos) = self.metric_order.iter().position(|f| f == feature) {
            self.metric_order.remove(pos);
        }
        self.metric_order.push_back(feature.to_string());
        if self.metrics.len() > METRIC_CAPACITY {
            if let Some(oldest) = self.metric_order.pop_front() {
                self.metrics.remove(&oldest);
            }
        }
    }

    /// Lifts a quarantine (e.g. after an update).
    pub fn unquarantine(&mut self, feature: &str) {
        self.quarantined.retain(|q| q != feature);
        if let Some(m) = self.metrics.get_mut(feature) {
            m.quarantined = false;
        }
    }

    pub fn is_quarantined(&self, feature: &str) -> bool {
        self.quarantined.iter().any(|q| q == feature)
    }

    /// Snapshot for the dashboard.
    pub fn snapshot(&self, now_ms: u64) -> Health {
        Health {
            uptime_ms: now_ms.saturating_sub(self.started_at_ms),
            log_entries: self.log.len(),
            features: self.metrics.len(),
            quarantined: self.quarantined.clone(),
            metrics: self.metrics.clone(),
            log: self.log.iter().cloned().collect(),
        }
    }
}

/// Time-budget math lives with diagnostics-adjacent helpers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Budget {
    pub session_limit_sec: f64,
    pub session_used_sec: f64,
    pub daily_limit_sec: f64,
    pub daily_used_sec: f64,
}

impl Budget {
    /// Remaining session seconds.
    pub fn session_remaining(&self) -> f64 {
        (self.session_limit_sec - self.session_used_sec).max(0.0)
    }

    pub fn session_fraction(&self) -> f64 {
        if self.session_limit_sec <= 0.0 {
            return 0.0;
        }
        (self.session_used_sec / self.session_limit_sec).clamp(0.0, 1.0)
    }

    /// Whether the session budget is exhausted.
    pub fn session_exhausted(&self) -> bool {
        self.session_limit_sec > 0.0 && self.session_used_sec >= self.session_limit_sec
    }

    /// True when the user should start wrapping up (>= 85% used).
    pub fn session_near_limit(&self) -> bool {
        self.session_fraction() >= 0.85
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_ring_drops_oldest() {
        // Constructor enforces a minimum capacity of 16.
        let mut d = Diagnostics::new(4, 0);
        for i in 0..20 {
            d.log(i, Subsystem::Config, Severity::Info, format!("line {i}"));
        }
        let snap = d.snapshot(10);
        assert_eq!(snap.log.len(), 16);
        assert_eq!(snap.log[0].message, "line 4");
        assert_eq!(snap.log[15].message, "line 19");
    }

    #[test]
    fn metrics_track_errors_and_quarantine() {
        let mut d = Diagnostics::new(16, 0);
        d.record_metric("feed", 1.5);
        d.record_metric("feed", 0.5);
        let err = crate::error::Error::transient(Subsystem::History, "load", "boom");
        d.record_error("feed", &err);
        d.quarantine("feed");
        let snap = d.snapshot(1);
        assert_eq!(snap.metrics["feed"].applies, 2);
        assert_eq!(snap.metrics["feed"].errors, 1);
        assert!(snap.metrics["feed"].quarantined);
        assert_eq!(snap.quarantined, vec!["feed"]);
        assert!((snap.metrics["feed"].total_ms - 2.0).abs() < 1e-9);
    }

    #[test]
    fn unquarantine_clears() {
        let mut d = Diagnostics::new(16, 0);
        d.quarantine("x");
        assert!(d.is_quarantined("x"));
        d.unquarantine("x");
        assert!(!d.is_quarantined("x"));
    }

    #[test]
    fn budget_math() {
        let b = Budget {
            session_limit_sec: 600.0,
            session_used_sec: 540.0,
            daily_limit_sec: 0.0,
            daily_used_sec: 0.0,
        };
        assert!(b.session_near_limit());
        assert!(!b.session_exhausted());
        let full = Budget {
            session_used_sec: 600.0,
            ..b
        };
        assert!(full.session_exhausted());
        assert_eq!(full.session_remaining(), 0.0);
    }
}
