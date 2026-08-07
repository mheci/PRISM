//! Structured error taxonomy.
//!
//! Every fallible operation in the core returns [`Error`], which carries:
//! subsystem, operation, severity, recovery guidance and a telemetry bucket.
//! Expected failures are first-class; nothing is silently swallowed.

use serde::{Deserialize, Serialize};

/// The subsystem that produced the error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Subsystem {
    Config,
    Filter,
    Scrub,
    SponsorBlock,
    History,
    Network,
    Themes,
    Discovery,
    Diagnostics,
    Protocol,
}

impl Subsystem {
    /// Stable, human-readable label for logs and telemetry.
    pub fn as_str(self) -> &'static str {
        match self {
            Subsystem::Config => "config",
            Subsystem::Filter => "filter",
            Subsystem::Scrub => "scrub",
            Subsystem::SponsorBlock => "sponsorblock",
            Subsystem::History => "history",
            Subsystem::Network => "network",
            Subsystem::Themes => "themes",
            Subsystem::Discovery => "discovery",
            Subsystem::Diagnostics => "diagnostics",
            Subsystem::Protocol => "protocol",
        }
    }
}

/// Severity classification. Expected failures are never fatal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Severity {
    Info,
    Warning,
    Error,
    Critical,
}

/// Recommended recovery action the host should take.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Recovery {
    /// Nothing to do; the caller decides.
    None,
    /// Retry with backoff (transient failures).
    Retry,
    /// Rebuild the affected cache/index.
    RebuildCache,
    /// Restart the affected module.
    RestartModule,
    /// Quarantine the module (persistent failure).
    Quarantine,
}

/// Stable error identity used for telemetry; never changes across releases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorCode {
    PayloadTooLarge,
    InvalidJson,
    SchemaViolation,
    UnknownOperation,
    FilterSyntax,
    FilterListTooLarge,
    ScrubDepthExceeded,
    HistoryCorrupt,
    HistoryFull,
    NetworkBucketCorrupt,
    ThemeColorInvalid,
    ThemeCountExceeded,
    DiscoveryEmpty,
    LogRingOverflow,
    Internal,
}

/// A structured, serializable error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Error {
    pub subsystem: Subsystem,
    pub operation: &'static str,
    pub severity: Severity,
    pub recovery: Recovery,
    pub code: ErrorCode,
    pub message: String,
}

impl Error {
    /// Constructs a structured error.
    pub fn new(
        subsystem: Subsystem,
        operation: &'static str,
        severity: Severity,
        recovery: Recovery,
        code: ErrorCode,
        message: impl Into<String>,
    ) -> Self {
        Self {
            subsystem,
            operation,
            severity,
            recovery,
            code,
            message: message.into(),
        }
    }

    /// Convenience: an expected, retryable failure.
    pub fn transient(subsystem: Subsystem, op: &'static str, msg: impl Into<String>) -> Self {
        Self::new(
            subsystem,
            op,
            Severity::Warning,
            Recovery::Retry,
            ErrorCode::Internal,
            msg,
        )
    }

    /// Convenience: invalid external input.
    pub fn invalid(
        subsystem: Subsystem,
        op: &'static str,
        code: ErrorCode,
        msg: impl Into<String>,
    ) -> Self {
        Self::new(subsystem, op, Severity::Warning, Recovery::None, code, msg)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}:{} [{}] {}",
            self.subsystem.as_str(),
            self.operation,
            self.severity_label(),
            self.message
        )
    }
}

impl std::error::Error for Error {}

impl Error {
    fn severity_label(&self) -> &'static str {
        match self.severity {
            Severity::Info => "info",
            Severity::Warning => "warn",
            Severity::Error => "error",
            Severity::Critical => "critical",
        }
    }

    /// Serializes to a compact JSON envelope the host can log or persist.
    pub fn to_envelope(&self) -> serde_json::Value {
        serde_json::json!({
            "subsystem": self.subsystem.as_str(),
            "operation": self.operation,
            "severity": match self.severity {
                Severity::Info => "info",
                Severity::Warning => "warning",
                Severity::Error => "error",
                Severity::Critical => "critical",
            },
            "recovery": match self.recovery {
                Recovery::None => "none",
                Recovery::Retry => "retry",
                Recovery::RebuildCache => "rebuild_cache",
                Recovery::RestartModule => "restart_module",
                Recovery::Quarantine => "quarantine",
            },
            "code": format!("{:?}", self.code),
            "message": self.message,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_to_expected_envelope() {
        let e = Error::invalid(
            Subsystem::Filter,
            "parse",
            ErrorCode::FilterSyntax,
            "bad selector",
        );
        let v = e.to_envelope();
        assert_eq!(v["subsystem"], "filter");
        assert_eq!(v["severity"], "warning");
        assert_eq!(v["code"], "FilterSyntax");
    }

    #[test]
    fn transient_is_retryable_warning() {
        let e = Error::transient(Subsystem::History, "load", "retry");
        assert_eq!(e.severity, Severity::Warning);
        assert_eq!(e.recovery, Recovery::Retry);
    }
}
