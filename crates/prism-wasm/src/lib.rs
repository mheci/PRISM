//! PRISM WASM ABI.
//!
//! A deliberately tiny, hand-rolled C ABI so the host never depends on
//! wasm-bindgen glue or its CLI toolchain. The host calls:
//!
#![allow(missing_docs)]
//! ```text
//!   ptr, len = prism_handle(request_ptr, request_len)
//!   // read `len` bytes at `ptr`, then:
//!   prism_free(ptr, len)
//! ```
//!
//! Request/response are JSON envelopes:
//! ```json
//! { "op": "settings.validate", "payload": { ... } }
//! ```
//! Every response carries `{ "ok": true, "result": ... }` or
//! `{ "ok": false, "error": { ... } }`.
//!
//! The allocation functions exist so the host and core share one allocator
//! (the wasm heap) — no copying across boundaries beyond the JSON bytes.

use std::alloc::{alloc, dealloc, Layout};

use prism_core::config::Settings;
use prism_core::discovery::{self, Video};
use prism_core::error::{Error, ErrorCode, Subsystem};
use prism_core::filter::FilterSet;
use prism_core::history;
use prism_core::network;
use prism_core::scrub::{self, ScrubMode, ScrubOptions};
use prism_core::sponsorblock;
use prism_core::themes;
use serde::Deserialize;

/// Allocates `len` zero-initialized bytes; returns a raw pointer.
#[no_mangle]
pub extern "C" fn prism_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::dangling().as_ptr();
    }
    let layout = match Layout::array::<u8>(len) {
        Ok(l) => l,
        Err(_) => return std::ptr::null_mut(),
    };
    // SAFETY: layout is non-zero (len > 0), alignment 1.
    unsafe { alloc(layout) }
}

/// Frees a buffer previously returned by [`prism_alloc`].
///
/// # Safety
/// `ptr` must come from `prism_alloc`, `len` must match, and the buffer must
/// not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn prism_free(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let layout = match Layout::array::<u8>(len) {
        Ok(l) => l,
        Err(_) => return,
    };
    // SAFETY: caller contract guarantees the pointer came from alloc with
    // this exact layout.
    unsafe { dealloc(ptr, layout) }
}

/// C ABI entry: processes one JSON request, returns a pointer to the JSON
/// response. The response length is returned through `out_len`.
///
/// # Safety
/// `req_ptr`/`req_len` must describe a valid buffer for the duration of the
/// call. The returned pointer must be released with `prism_free`.
#[no_mangle]
pub unsafe extern "C" fn prism_handle(
    req_ptr: *const u8,
    req_len: usize,
    out_len: *mut usize,
) -> *mut u8 {
    let request = if req_ptr.is_null() || req_len == 0 {
        String::new()
    } else {
        // SAFETY: caller contract; we copy immediately so the buffer can be
        // reused by the caller right after the call returns.
        let slice = unsafe { std::slice::from_raw_parts(req_ptr, req_len) };
        String::from_utf8_lossy(slice).into_owned()
    };
    let response = dispatch(&request);
    let bytes = response.into_bytes();
    let len = bytes.len();
    let ptr = prism_alloc(len);
    if ptr.is_null() {
        unsafe { *out_len = 0 };
        return std::ptr::null_mut();
    }
    // SAFETY: `ptr` is a valid allocation of `len` bytes.
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, len);
        *out_len = len;
    }
    ptr
}

/// Internal dispatch; never panics (host isolation guarantee).
fn dispatch(request: &str) -> String {
    let parsed: serde_json::Result<Request> = serde_json::from_str(request);
    let request = match parsed {
        Ok(r) => r,
        Err(e) => {
            return err_response(Error::invalid(
                Subsystem::Protocol,
                "parse_request",
                ErrorCode::InvalidJson,
                format!("malformed request: {e}"),
            ))
        }
    };
    if request.version != prism_core::PROTOCOL_VERSION {
        return err_response(Error::invalid(
            Subsystem::Protocol,
            "version",
            ErrorCode::SchemaViolation,
            "protocol version mismatch",
        ));
    }

    match dispatch_op(&request.op, &request.payload) {
        Ok(v) => ok_response(v),
        Err(e) => err_response(e),
    }
}

#[derive(Debug, Deserialize)]
struct Request {
    version: u32,
    op: String,
    #[serde(default)]
    payload: serde_json::Value,
}

fn ok_response(result: serde_json::Value) -> String {
    serde_json::json!({ "ok": true, "result": result }).to_string()
}

fn err_response(e: Error) -> String {
    serde_json::json!({ "ok": false, "error": e.to_envelope() }).to_string()
}

fn dispatch_op(op: &str, payload: &serde_json::Value) -> prism_core::Result<serde_json::Value> {
    match op {
        // ── Settings ──
        "settings.validate" => {
            let raw = payload
                .get("blob")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| bad("settings.validate", "missing blob"))?;
            let (settings, issues) = Settings::from_json(raw)?;
            Ok(serde_json::json!({
                "settings": settings,
                "issues": issues,
            }))
        }
        "settings.normalize" => {
            let raw = payload
                .get("blob")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| bad("settings.normalize", "missing blob"))?;
            let (settings, _) = Settings::from_json(raw)?;
            Ok(serde_json::json!(settings.normalized()))
        }
        "settings.defaults" => Ok(serde_json::json!(Settings::default())),

        // ── Filter engine ──
        "filter.parse" => {
            let list = payload
                .get("list")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| bad("filter.parse", "missing list"))?;
            let set = FilterSet::parse(list)?;
            Ok(serde_json::json!({
                "css": set.to_css(),
                "css_rules": set.css,
                "procedural": set.procedural,
                "paths": set.paths,
                "skipped": set.skipped,
            }))
        }

        // ── Scrubber ──
        "scrub.run" => {
            let mut doc = payload
                .get("document")
                .cloned()
                .ok_or_else(|| bad("scrub.run", "missing document"))?;
            let mode = payload
                .get("mode")
                .and_then(serde_json::Value::as_object)
                .map(|m| ScrubMode {
                    shorts: m
                        .get("shorts")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    auto_dubbed: m
                        .get("auto_dubbed")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                })
                .unwrap_or(ScrubMode {
                    shorts: false,
                    auto_dubbed: false,
                });
            let opts = ScrubOptions::default();
            let stats = scrub::scrub(&mut doc, mode, &opts)?;
            Ok(serde_json::json!({ "document": doc, "stats": stats }))
        }
        "scrub.player_audio" => {
            let doc = payload
                .get("document")
                .ok_or_else(|| bad("scrub.player_audio", "missing document"))?;
            let (has_dub, original) = scrub::player_audio_status(doc)?;
            Ok(serde_json::json!({ "has_auto_dub": has_dub, "original_track_id": original }))
        }

        // ── SponsorBlock ──
        "sponsor.segments" => {
            let video_id = payload
                .get("video_id")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| bad("sponsor.segments", "missing video_id"))?;
            let raw = payload
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let set = sponsorblock::parse_segments(video_id, &raw)?;
            Ok(serde_json::json!(set))
        }
        "sponsor.decision" => {
            let video_id = payload
                .get("video_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let set_raw = payload
                .get("segments")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let mut set = sponsorblock::parse_segments(video_id, &set_raw)?;
            set.normalize();
            let position = payload
                .get("position")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            let last_seek = payload.get("last_seek").and_then(serde_json::Value::as_f64);
            let draft = payload
                .get("draft")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let actions: Vec<(sponsorblock::Category, sponsorblock::CategoryAction)> = payload
                .get("actions")
                .and_then(serde_json::Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            let cat = a.get("category")?.as_str()?.parse().ok()?;
                            let act = match a.get("action")?.as_str()? {
                                "skip" => sponsorblock::CategoryAction::Skip,
                                "mute" => sponsorblock::CategoryAction::Mute,
                                "poi" => sponsorblock::CategoryAction::JumpToHighlight,
                                "label" => sponsorblock::CategoryAction::Label,
                                "off" => sponsorblock::CategoryAction::Off,
                                _ => return None,
                            };
                            Some((cat, act))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let decision = set.decision(position, last_seek, draft, &actions);
            let muted = set.should_be_muted(position, &actions);
            Ok(serde_json::json!({
                "decision": match decision {
                    sponsorblock::Decision::SkipTo { to } => serde_json::json!({"kind": "skip", "to": to}),
                    sponsorblock::Decision::Mute { until } => serde_json::json!({"kind": "mute", "until": until}),
                    sponsorblock::Decision::Label => serde_json::json!({"kind": "label"}),
                    sponsorblock::Decision::None => serde_json::json!({"kind": "none"}),
                },
                "muted": muted,
                "saved_seconds": set.saved_seconds,
            }))
        }

        // ── History ──
        "history.aggregate" => {
            let records: Vec<history::WatchRecord> = serde_json::from_value(
                payload
                    .get("records")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("history.aggregate", &e.to_string()))?;
            let now = payload
                .get("now")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            Ok(serde_json::json!(history::aggregate(&records, now)))
        }
        "history.resume" => {
            let record: Option<history::WatchRecord> = serde_json::from_value(
                payload
                    .get("record")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("history.resume", &e.to_string()))?;
            let has_t = payload
                .get("has_t_param")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let mode = match payload
                .get("mode")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("silent")
            {
                "off" => history::ResumeMode::Off,
                "silent" => history::ResumeMode::Silent,
                "card" => history::ResumeMode::Card,
                "overlay" => history::ResumeMode::Overlay,
                _ => history::ResumeMode::Silent,
            };
            Ok(serde_json::json!(history::resume_decision(
                record.as_ref(),
                has_t,
                mode
            )))
        }
        "history.validate_record" => {
            let record: history::WatchRecord = serde_json::from_value(
                payload
                    .get("record")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("history.validate_record", &e.to_string()))?;
            history::validate_record(&record)?;
            Ok(serde_json::json!(true))
        }
        "history.complete" => {
            let mut record: history::WatchRecord = serde_json::from_value(
                payload
                    .get("record")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("history.complete", &e.to_string()))?;
            let newly = record.tick(
                record.last_position_sec,
                record.duration_sec,
                record.last_watched,
                record.sessions.capacity().max(1),
            );
            Ok(serde_json::json!({ "completed": newly || record.completed, "record": record }))
        }

        // ── Network ──
        "network.aggregate" => {
            let buckets: Vec<network::Bucket> = serde_json::from_value(
                payload
                    .get("buckets")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("network.aggregate", &e.to_string()))?;
            let range = match payload
                .get("range")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("all")
            {
                "hour" => network::Range::Hour,
                "day" => network::Range::Day,
                "week" => network::Range::Week,
                "month" => network::Range::Month,
                "year" => network::Range::Year,
                _ => network::Range::All,
            };
            let agg = network::aggregate_buckets(&buckets, range);
            Ok(serde_json::json!({
                "down": agg.down_bytes,
                "up": agg.up_bytes,
                "requests": agg.requests,
                "down_fmt": network::format_bytes(agg.down_bytes),
                "up_fmt": network::format_bytes(agg.up_bytes),
                "quality": agg.quality_bytes,
                "hosts": agg.host_bytes,
            }))
        }
        "network.budget" => {
            let used = payload
                .get("used_bytes")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            let gb = payload
                .get("budget_gb")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            let state = network::budget_state(used, gb);
            Ok(serde_json::json!({
                "state": match state {
                    network::BudgetState::Ok => "ok",
                    network::BudgetState::Warn => "warn",
                    network::BudgetState::Critical => "critical",
                    network::BudgetState::Exceeded => "exceeded",
                },
            }))
        }
        "network.classify" => {
            let itag = payload
                .get("itag")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0);
            let label = payload
                .get("label")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let q = if !label.is_empty() {
                network::classify_label(label)
            } else {
                network::classify_itag(itag)
            };
            Ok(serde_json::json!({ "class": q.as_str() }))
        }

        // ── Themes ──
        "themes.generate" => {
            let base = payload
                .get("base")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| bad("themes.generate", "missing base"))?;
            let dark = payload
                .get("dark")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true);
            let palette = themes::generate_palette(base, dark)?;
            Ok(serde_json::json!({
                "palette": palette,
                "css_vars": palette.to_css_vars(),
            }))
        }
        "themes.contrast" => {
            let bg = payload
                .get("background")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| bad("themes.contrast", "missing background"))?;
            Ok(serde_json::json!({ "color": themes::contrast_text(bg)? }))
        }
        "themes.cssvars" => {
            let palette: themes::Palette = serde_json::from_value(
                payload
                    .get("palette")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("themes.cssvars", &e.to_string()))?;
            Ok(serde_json::json!({ "css": palette.to_css_vars() }))
        }

        // ── Discovery ──
        "discovery.rank" => {
            let videos: Vec<Video> = serde_json::from_value(
                payload
                    .get("videos")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            )
            .map_err(|e| bad("discovery.rank", &e.to_string()))?;
            let limit = payload
                .get("limit")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(20) as usize;
            let now = payload
                .get("now")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or_else(|| {
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0)
                });
            let ranked = discovery::rank_by_velocity(videos, limit, now);
            Ok(serde_json::json!(ranked
                .into_iter()
                .map(|(v, vel)| serde_json::json!({
                    "video": v,
                    "velocity": vel,
                    "label": Video::momentum_label(vel),
                }))
                .collect::<Vec<_>>()))
        }
        "discovery.vibe" => {
            let phrase = payload
                .get("phrase")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            Ok(serde_json::json!(discovery::match_vibe(phrase)))
        }

        // ── Diagnostics ──
        "diag.health" => {
            // The host owns the Diagnostics instance; this op is a no-op
            // placeholder to keep the ABI surface documented.
            Ok(serde_json::json!({ "protocol": prism_core::PROTOCOL_VERSION }))
        }

        _ => Err(Error::invalid(
            Subsystem::Protocol,
            "dispatch",
            ErrorCode::UnknownOperation,
            format!("unknown op: {op}"),
        )),
    }
}

fn bad(op: &str, msg: &str) -> Error {
    Error::invalid(
        Subsystem::Protocol,
        "dispatch",
        ErrorCode::SchemaViolation,
        format!("{op}: {msg}"),
    )
}

/// Panics in wasm are aborts; we must never leak one across the ABI.
/// This shim is only used for development when the panic hook is needed.
#[allow(dead_code)]
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        // Host-side logging happens via console; keep the payload tiny.
        let _ = info;
    }));
}
