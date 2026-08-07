# PRISM Architecture Guide

## 1. Design principles

1. **Logic in Rust, DOM in JS.** Every decision that can be pure is pure: the
   core is `crates/prism-core` (a `no_std`-friendly, serde-only library) and
   ships as WASM. The JS shell never makes policy decisions.
2. **Determinism.** Same input → same output, always. No wall-clock dependence
   inside the core except where time is a first-class argument.
3. **Zero idle cost.** All intervals go through the adaptive scheduler; the
   page does nothing while YouTube is idle.
4. **Failure is data.** Errors are structured (`error.rs`), never swallowed,
   and drive quarantine decisions.
5. **No third-party runtime JS.** The shell has zero runtime dependencies;
   dev-only tooling (wasm-opt) is pinned.

## 2. Crate layout

```
crates/prism-core/          pure logic library
  src/error.rs              structured error taxonomy (Subsystem/Op/Severity/Recovery/Code)
  src/config.rs             typed settings tree + deep-merge validation + normalization
  src/filter.rs             uBlock-style cosmetic filter engine (CSS + procedural + paths)
  src/scrub.rs              innertube JSON scrubber (Shorts + auto-dub) + playlist renumbering
  src/sponsorblock.rs       segment model, category actions, skip/mute decisions, cache keys
  src/history.rs            watch records, completion rules, resume decisions, aggregation, eviction
  src/network.rs            byte estimation, itag/quality classification, buckets, budget states
  src/themes.rs             hex/HSL math, palette generation, contrast, CSS var emission
  src/discovery.rs          velocity ranking, reach classification, count/ago/duration parsers
  src/diagnostics.rs        bounded log ring, per-feature metrics, quarantine, budget math
  src/lib.rs                protocol version + payload caps

crates/prism-wasm/          WASM ABI shim
  src/lib.rs                prism_handle / prism_alloc / prism_free + JSON dispatch
```

## 3. Host protocol

Requests are JSON envelopes: `{ "version": 1, "op": "...", "payload": {...} }`.
Responses: `{ "ok": true, "result": ... }` or `{ "ok": false, "error": {...} }`.

The ABI (`prism_handle(req_ptr, req_len, out_len_ptr) -> out_ptr`) copies the
request in, dispatches, and returns an allocated response the host frees with
`prism_free`. Payloads are capped at 8 MB.

## 4. Module lifecycle (JS shell)

Each module: `{ id, deps[], init(ctx), start(ctx), stop(), health() }`.

- `init` reserves resources; `start` begins behavior; `stop` releases
  everything the module created via `ctx.timer` / `ctx.on`.
- The registry starts modules in dependency order, twice (once for roots,
  once for dependents), then runs a watchdog that restarts failed modules.
- Quarantine: 3 consecutive failures disable the module permanently for the
  session; the dashboard shows quarantined modules.

## 5. Storage

All persistence goes through `browser.storage.local` (single writer: the
background page). Keys: `settings`, `history`, `netbuckets`, `clicks`,
`speed-map`, `themes`, `notes:*`, `budget`. Values are JSON strings or plain
objects; the core validates settings on load.

## 6. Performance budget

- Scheduler: `interval = max(150, base * factor * backoff)` where factor is
  8× hidden, 1.5× unfocused, and backoff 1→4 grows when a tick exceeds 12 ms.
- DOM writes go through direct style/text mutation with change-guards
  (no-op when the value didn't change).
- Feature scans yield every 40 cards (`await new Promise(r => setTimeout(r,0))`).
- The `perf` module adds content-visibility, lazy thumbnails, and memory
  trimming at three tiers.

## 7. Security model

- Permission minimization: `storage` only; no `webRequest`, no tabs beyond
  the popup's own queries.
- Origin checks on both directions of the postMessage bridge (token-gated).
- Filter selectors are character-whitelisted before CSS emission.
- Secrets never enter the repo: `scripts/check.mjs` scans the tree; CI uses
  GitHub secrets for AMO credentials.
