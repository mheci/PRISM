//! Innertube response scrubber.
//!
//! Removes Shorts and auto-dubbed entries from `browse`/`search`/`next`
//! response JSON, drops shelves left empty, and repairs playlist index
//! numbers. Pure data transformation: walks `serde_json::Value`, mutates in
//! place, returns removal statistics.

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Subsystem};

/// Maximum recursion depth before the walker bails (protects against
/// pathological payloads).
pub const MAX_DEPTH: usize = 64;

/// Renderer keys that identify a Shorts node.
const SHORTS_KEYS: &[&str] = &[
    "reelItemRenderer",
    "reelShelfRenderer",
    "reelVideoRenderer",
    "reelItemRendererViewModel",
    "shortsLockupViewModel",
    "reelPlayerOverlayRenderer",
    "reelPlayerHeaderSupportedRenderers",
    "reelChannelRenderer",
];

/// Renderer keys that wrap card-like content (checked recursively).
const WRAPPER_KEYS: &[&str] = &[
    "videoRenderer",
    "compactVideoRenderer",
    "gridVideoRenderer",
    "reelItemRenderer",
    "lockupViewModel",
    "videoWithContextRenderer",
    "richGridMediaViewModel",
    "notificationRenderer",
    "playlistVideoRenderer",
    "playlistPanelVideoRenderer",
    "playlistPanelVideoWrapperRenderer",
    "chipCloudChipRenderer",
];

/// Shelf-like containers whose empty state should trigger removal.
const SHELF_KEYS: &[&str] = &[
    "richShelfRenderer",
    "shelfRenderer",
    "richSectionRenderer",
    "itemSectionRenderer",
    "horizontalCardListRenderer",
    "gridRenderer",
    "verticalListRenderer",
];

/// What to scrub from a payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScrubMode {
    pub shorts: bool,
    pub auto_dubbed: bool,
}

/// Statistics returned to the host.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScrubStats {
    pub removed: usize,
    pub empty_shelves: usize,
    pub playlists_renumbered: usize,
}

/// Options controlling detection strictness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScrubOptions {
    /// Also drop Shorts *links* anywhere (e.g. in chips).
    pub deep_link_scan: bool,
}

impl Default for ScrubOptions {
    fn default() -> Self {
        Self {
            deep_link_scan: true,
        }
    }
}

fn as_obj(v: &serde_json::Value) -> Option<&serde_json::Map<String, serde_json::Value>> {
    v.as_object()
}

/// Recursively unwraps card-like renderers (incl. `richItemRenderer.content`
/// and `richGridMediaViewModel.content`) down to the innermost renderer
/// object, so endpoint/audio flags nested several levels deep are found.
fn unwrap_renderer(node: &serde_json::Value, depth: usize) -> &serde_json::Value {
    if depth > 8 {
        return node;
    }
    let Some(obj) = as_obj(node) else {
        return node;
    };
    let mut target = WRAPPER_KEYS.iter().find_map(|k| obj.get(*k));
    if target.is_none() {
        if let Some(content) = obj.get("richItemRenderer").and_then(|v| v.get("content")) {
            if WRAPPER_KEYS.iter().any(|k| content.get(*k).is_some()) {
                target = Some(content);
            }
        }
    }
    if target.is_none() {
        if let Some(vm) = obj.get("richGridMediaViewModel") {
            if let Some(content) = vm.get("content") {
                target = WRAPPER_KEYS
                    .iter()
                    .find_map(|k| content.get(*k))
                    .or(Some(content));
            }
        }
    }
    // A view-model object reached directly: descend into its content.
    if target.is_none() {
        if let Some(content) = obj.get("content") {
            if WRAPPER_KEYS.iter().any(|k| content.get(*k).is_some()) {
                target = Some(content);
            }
        }
    }
    if let Some(inner) = target {
        return unwrap_renderer(inner, depth + 1);
    }
    node
}

fn node_is_shorts(node: &serde_json::Value, opts: &ScrubOptions) -> bool {
    let Some(obj) = as_obj(node) else {
        return false;
    };
    if SHORTS_KEYS.iter().any(|k| obj.contains_key(*k)) {
        return true;
    }
    let target = unwrap_renderer(node, 0);
    let Some(obj) = as_obj(target) else {
        return false;
    };
    if SHORTS_KEYS.iter().any(|k| obj.contains_key(*k)) {
        return true;
    }
    if !opts.deep_link_scan {
        return false;
    }
    // navigation endpoints pointing at reel/watch of a short.
    for ep in ["navigationEndpoint", "onTap", "onLongPress"] {
        if let Some(endpoint) = obj.get(ep) {
            if endpoint.get("reelWatchEndpoint").is_some() {
                return true;
            }
            if let Some(url) = endpoint
                .pointer("/urlEndpoint/url")
                .and_then(serde_json::Value::as_str)
            {
                if url_matches_short(url) {
                    return true;
                }
            }
        }
    }
    // thumbnail overlay with SHORTS style.
    if let Some(overlay) = obj.get("thumbnailOverlayTimeStatusRenderer") {
        if let Some(style) = overlay.get("style").and_then(serde_json::Value::as_str) {
            if style.eq_ignore_ascii_case("SHORTS") {
                return true;
            }
        }
    }
    false
}

fn url_matches_short(url: &str) -> bool {
    url.split('/').any(|seg| seg.eq_ignore_ascii_case("shorts")) || url.contains("/shorts")
}

fn text_contains_dub(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("dub") || lower.contains("translated audio")
}

fn node_is_dubbed(node: &serde_json::Value) -> bool {
    // Unwrap card-like renderers so flags nested inside them count.
    let target = unwrap_renderer(node, 0);
    let Some(obj) = as_obj(target) else {
        return false;
    };
    // Direct boolean flags.
    for key in ["isAutoDubbed", "isDubbed", "dubbedAudio"] {
        if obj.get(key).and_then(serde_json::Value::as_bool) == Some(true) {
            return true;
        }
    }
    // audioTrack flag.
    if let Some(at) = obj.get("audioTrack") {
        if at.get("isAutoDubbed").and_then(serde_json::Value::as_bool) == Some(true) {
            return true;
        }
        if let Some(name) = at.get("displayName").and_then(serde_json::Value::as_str) {
            if text_contains_dub(name) {
                return true;
            }
        }
    }
    // audioTracks list.
    if let Some(tracks) = obj.get("audioTracks").and_then(serde_json::Value::as_array) {
        for t in tracks {
            if t.get("isAutoDubbed").and_then(serde_json::Value::as_bool) == Some(true) {
                return true;
            }
            if let Some(name) = t.get("displayName").and_then(serde_json::Value::as_str) {
                if text_contains_dub(name) {
                    return true;
                }
            }
        }
    }
    false
}

/// Decides whether a single node should be dropped entirely.
fn should_drop(node: &serde_json::Value, mode: ScrubMode, opts: &ScrubOptions) -> bool {
    if mode.shorts && node_is_shorts(node, opts) {
        return true;
    }
    if mode.auto_dubbed && node_is_dubbed(node) {
        return true;
    }
    false
}

/// Recursive post-order walk over a subtree.
///
/// Returns `true` when the walked node was a shelf-like container whose
/// contents ended up empty — the parent then removes it too.
fn scrub_value(
    value: &mut serde_json::Value,
    depth: usize,
    mode: ScrubMode,
    opts: &ScrubOptions,
    stats: &mut ScrubStats,
) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    match value {
        serde_json::Value::Array(items) => {
            let mut keep = Vec::with_capacity(items.len());
            for mut item in std::mem::take(items) {
                let drop = should_drop(&item, mode, opts);
                let empty_shelf = scrub_value(&mut item, depth + 1, mode, opts, stats);
                if drop {
                    stats.removed += 1;
                    continue;
                }
                if empty_shelf {
                    // Shelf emptiness is counted in the object branch;
                    // dropping the shell itself is not a "removed card".
                    continue;
                }
                keep.push(item);
            }
            *items = keep;
            renumber_playlist_items(items);
            false
        }
        serde_json::Value::Object(map) => {
            // Post-order: children first. Track shelf-like keys whose
            // contents became empty so their shells are removed too.
            let mut emptied_keys: Vec<String> = Vec::new();
            for key in SHELF_KEYS {
                if let Some(v) = map.get_mut(*key) {
                    // The child already removed its emptied shelf content
                    // (post-removal shape may no longer look "empty"), so
                    // its boolean signal is the source of truth.
                    if scrub_value(v, depth + 1, mode, opts, stats) {
                        emptied_keys.push((*key).to_string());
                    }
                }
            }
            // Non-shelf children (e.g. "content" wrappers) may also report
            // emptiness; propagate it.
            let mut became_empty = false;
            for (key, value) in map.iter_mut() {
                if SHELF_KEYS.contains(&key.as_str()) {
                    continue;
                }
                if scrub_value(value, depth + 1, mode, opts, stats) {
                    became_empty = true;
                }
            }
            for key in &emptied_keys {
                map.remove(key);
            }
            if !emptied_keys.is_empty() {
                stats.empty_shelves += emptied_keys.len();
                // We removed shelf content ourselves: this object is now a
                // shell and must be dropped by its parent.
                return true;
            }
            // The object itself is a shelf-like container whose contents
            // emptied (or a content-wrapper around one).
            if became_empty || is_empty_contents_object(map) {
                if became_empty {
                    stats.empty_shelves += 1;
                }
                return true;
            }
            false
        }
        _ => false,
    }
}

/// True when an object is a container whose `contents` (directly or under
/// `content.<shelf>`) is now empty — i.e. it should be removed by its parent.
fn is_empty_contents_object(map: &serde_json::Map<String, serde_json::Value>) -> bool {
    if let Some(arr) = map.get("contents").and_then(serde_json::Value::as_array) {
        return arr.is_empty();
    }
    if let Some(content) = map.get("content") {
        for key in SHELF_KEYS {
            if let Some(inner) = content.get(*key) {
                if inner
                    .get("contents")
                    .and_then(serde_json::Value::as_array)
                    .map(|a| a.is_empty())
                    .unwrap_or(false)
                {
                    return true;
                }
            }
        }
    }
    false
}

/// After removals, renumber sequential playlist items so index badges stay
/// correct (1, 2, 3, …).
fn renumber_playlist_items(items: &mut [serde_json::Value]) {
    let mut index = 1usize;
    for item in items.iter_mut() {
        // Borrow each key separately to satisfy the borrow checker.
        let key = if item.get("playlistVideoRenderer").is_some() {
            "playlistVideoRenderer"
        } else {
            "playlistPanelVideoRenderer"
        };
        let Some(map) = item.get_mut(key).and_then(serde_json::Value::as_object_mut) else {
            continue;
        };
        if let Some(idx) = map.get_mut("index") {
            if let Some(num) = idx.get("simpleText").and_then(serde_json::Value::as_str) {
                let n = num.trim().parse::<usize>().unwrap_or(0);
                if n != index {
                    if let Some(idx_map) = idx.as_object_mut() {
                        idx_map.insert(
                            "simpleText".into(),
                            serde_json::Value::String(index.to_string()),
                        );
                    }
                }
            }
        }
        index += 1;
    }
}

/// Entry point: scrubs a full innertube JSON document in place.
pub fn scrub(
    document: &mut serde_json::Value,
    mode: ScrubMode,
    opts: &ScrubOptions,
) -> crate::Result<ScrubStats> {
    if matches!(document, serde_json::Value::Null) {
        return Ok(ScrubStats::default());
    }
    let mut stats = ScrubStats::default();
    let mut work = std::mem::take(document);
    scrub_value(&mut work, 0, mode, opts, &mut stats);
    *document = work;
    Ok(stats)
}

/// Extracts the audio-track status for the player response, used by the
/// "restore original audio" feature. Returns (has_auto_dub, original_track_id).
pub fn player_audio_status(document: &serde_json::Value) -> crate::Result<(bool, Option<String>)> {
    let Some(streaming) = document
        .pointer("/streamingData/adaptiveFormats")
        .and_then(serde_json::Value::as_array)
    else {
        return Err(Error::invalid(
            Subsystem::Scrub,
            "player_audio_status",
            ErrorCode::Internal,
            "no adaptive formats in player response",
        ));
    };
    let mut has_auto_dub = false;
    let mut original: Option<String> = None;
    for format in streaming {
        let Some(at) = format.get("audioTrack") else {
            continue;
        };
        if at.get("isAutoDubbed").and_then(serde_json::Value::as_bool) == Some(true) {
            has_auto_dub = true;
        } else if at
            .get("audioIsOriginal")
            .and_then(serde_json::Value::as_bool)
            == Some(true)
            || at.get("isDefault").and_then(serde_json::Value::as_bool) == Some(true)
        {
            if let Some(id) = at.get("id").and_then(serde_json::Value::as_str) {
                original = Some(id.to_string());
            }
        }
    }
    if has_auto_dub && original.is_none() {
        // Fallback: first non-dubbed track.
        for format in streaming {
            let Some(at) = format.get("audioTrack") else {
                continue;
            };
            if at.get("isAutoDubbed").and_then(serde_json::Value::as_bool) != Some(true) {
                if let Some(id) = at.get("id").and_then(serde_json::Value::as_str) {
                    original = Some(id.to_string());
                    break;
                }
            }
        }
    }
    Ok((has_auto_dub, original))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn json(s: &str) -> serde_json::Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn removes_reel_shelf_entry() {
        let mut doc = json(
            r#"{
            "contents": [{
                "richShelfRenderer": {
                    "contents": [
                        {"reelItemRenderer": {"videoId": "x"}},
                        {"videoRenderer": {"videoId": "y"}}
                    ]
                }
            }]
        }"#,
        );
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: true,
                auto_dubbed: false,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
        let shelf = doc["contents"][0]["richShelfRenderer"]["contents"]
            .as_array()
            .unwrap();
        assert_eq!(shelf.len(), 1);
        assert!(shelf[0].get("videoRenderer").is_some());
    }

    #[test]
    fn drops_shelf_emptied_by_removal() {
        let mut doc = json(
            r#"{
            "contents": [{
                "richShelfRenderer": {
                    "contents": [
                        {"reelItemRenderer": {"videoId": "x"}}
                    ]
                }
            }]
        }"#,
        );
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: true,
                auto_dubbed: false,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        // The whole shelf should be gone.
        assert_eq!(stats.removed, 1);
        assert_eq!(stats.empty_shelves, 1);
        assert_eq!(doc["contents"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn removes_dubbed_video() {
        let mut doc = json(
            r#"{
            "contents": [
                {"videoRenderer": {"videoId": "a", "audioTrack": {"isAutoDubbed": true}}},
                {"videoRenderer": {"videoId": "b"}}
            ]
        }"#,
        );
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: false,
                auto_dubbed: true,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
        let contents = doc["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["videoRenderer"]["videoId"], "b");
    }

    #[test]
    fn detects_dub_display_name() {
        let mut doc = json(
            r#"{
            "contents": [
                {"videoRenderer": {"videoId": "c", "audioTracks": [{"displayName": "Hindi (auto-dubbed)"}]}}
            ]
        }"#,
        );
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: false,
                auto_dubbed: true,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
    }

    #[test]
    fn renumbers_playlist_after_removal() {
        let mut doc = json(
            r#"{
            "contents": [
                {"playlistVideoRenderer": {"index": {"simpleText": "1"}}},
                {"playlistVideoRenderer": {"index": {"simpleText": "2"}}},
                {"playlistVideoRenderer": {"index": {"simpleText": "3"}}}
            ]
        }"#,
        );
        // remove index 2 -> indices must become 1,2
        if let Some(items) = doc["contents"].as_array_mut() {
            items.remove(1);
        }
        renumber_playlist_items(doc["contents"].as_array_mut().unwrap());
        let items = doc["contents"].as_array().unwrap();
        assert_eq!(
            items[1]["playlistVideoRenderer"]["index"]["simpleText"],
            "2"
        );
    }

    #[test]
    fn player_audio_status_detects_original() {
        let doc = json(
            r#"{
            "streamingData": {"adaptiveFormats": [
                {"audioTrack": {"id": "dub1", "isAutoDubbed": true}},
                {"audioTrack": {"id": "orig1", "audioIsOriginal": true}}
            ]}
        }"#,
        );
        let (has_dub, original) = player_audio_status(&doc).unwrap();
        assert!(has_dub);
        assert_eq!(original.as_deref(), Some("orig1"));
    }

    #[test]
    fn player_audio_status_falls_back_to_first_nondub() {
        let doc = json!({
            "streamingData": {"adaptiveFormats": [
                {"audioTrack": {"id": "dub1", "isAutoDubbed": true}},
                {"audioTrack": {"id": "alt1"}}
            ]}
        });
        let (has_dub, original) = player_audio_status(&doc).unwrap();
        assert!(has_dub);
        assert_eq!(original.as_deref(), Some("alt1"));
    }

    #[test]
    fn null_document_is_ok() {
        let mut doc = serde_json::Value::Null;
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: true,
                auto_dubbed: true,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 0);
    }

    #[test]
    fn shorts_via_navigation_endpoint() {
        let mut doc = json!({
            "contents": [{
                "richItemRenderer": {
                    "content": {
                        "videoRenderer": {
                            "videoId": "s",
                            "navigationEndpoint": {"reelWatchEndpoint": {"videoId": "s"}}
                        }
                    }
                }
            }]
        });
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: true,
                auto_dubbed: false,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
    }

    #[test]
    fn empty_shelf_removed_through_content_wrapper() {
        let mut doc = json!({
            "richGridRenderer": {"contents": [
                {"richSectionRenderer": {
                    "content": {"richShelfRenderer": {
                        "contents": [{"reelItemRenderer": {"videoId": "x"}}]
                    }}
                }}
            ]}
        });
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: true,
                auto_dubbed: false,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
        let contents = doc["richGridRenderer"]["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 0, "empty section shells must be removed");
        assert!(stats.empty_shelves >= 1);
    }

    #[test]
    fn detects_dubbed_inside_rich_item() {
        let mut doc = json!({
            "contents": [{
                "richItemRenderer": {
                    "content": {
                        "videoRenderer": {"videoId": "d", "audioTrack": {"isAutoDubbed": true}}
                    }
                }
            }]
        });
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: false,
                auto_dubbed: true,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
    }

    #[test]
    fn detects_shorts_inside_rich_grid_media_view_model() {
        let mut doc = json!({
            "contents": [{
                "richGridMediaViewModel": {
                    "content": {
                        "videoRenderer": {
                            "videoId": "s2",
                            "navigationEndpoint": {"reelWatchEndpoint": {"videoId": "s2"}}
                        }
                    }
                }
            }]
        });
        let stats = scrub(
            &mut doc,
            ScrubMode {
                shorts: true,
                auto_dubbed: false,
            },
            &ScrubOptions::default(),
        )
        .unwrap();
        assert_eq!(stats.removed, 1);
    }
}
