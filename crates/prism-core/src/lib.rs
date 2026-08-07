//! PRISM core — every piece of extension logic, expressed as a pure Rust
//! library that compiles for native targets (tests, fuzzing, benches) and
//! `wasm32-unknown-unknown` (in-extension execution).
//!
//! Architectural invariants:
//! * No DOM, no timers, no I/O here — the host (JS shell) owns the world.
//! * Every fallible operation returns a structured [`Error`].
//! * All data structures are plain data; the host persists them.
//! * Deterministic: same inputs, same outputs.

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![deny(rust_2018_idioms)]

pub mod config;
pub mod diagnostics;
pub mod discovery;
pub mod error;
pub mod filter;
pub mod history;
pub mod network;
pub mod scrub;
pub mod sponsorblock;
pub mod themes;

/// Protocol version spoken between the host and the core.
pub const PROTOCOL_VERSION: u32 = 1;

/// The maximum size, in bytes, of a request/response payload the core will
/// accept. Guards the host against unbounded allocations.
pub const MAX_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;

/// Common result alias carrying the structured [`error::Error`].
pub type Result<T> = std::result::Result<T, error::Error>;
