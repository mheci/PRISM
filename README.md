# PRISM

PRISM is a full-fledged Firefox WebExtension for YouTube, built on a clean-room
architecture: **all logic lives in a Rust core compiled to WASM**; the content
shell is a thin, zero-dependency DOM adapter.

- **Signed by Mozilla** (AMO API, `unlisted` channel) — never published to AMO.
- **Distributed exclusively via GitHub Releases.**
- **Everything on-device** — no accounts, no cloud, no telemetry.

## Architecture

```
┌─────────────────────────── YouTube page (MAIN world) ───────────────────────────┐
│  content/engine.js (bundled)                                                    │
│   ├─ runtime.js   module registry, lifecycle, quarantine, adaptive scheduler    │
│   ├─ modules/*.js styling, player, captions, feed, history, chrome,             │
│   │               sponsorblock, discovery, netmon, misc                          │
│   └─ boot.js      starts the runtime                                             │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                │ window.postMessage (versioned protocol)
┌───────────────────────────────▼─────────────────────────────────────────────────┐
│  content/bridge.js (isolated world)                                             │
│   ├─ fetches + instantiates dist/prism-core.wasm                                │
│   ├─ relays core calls (settings, filters, scrub, sponsor, history, themes…)    │
│   └─ relays storage to the background page                                      │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                │ browser.runtime messaging
┌───────────────────────────────▼─────────────────────────────────────────────────┐
│  background.js  event page: storage, badge, install/update hooks                │
│  popup/         quick actions + health + search                                 │
│  options/       dashboard (groups, command palette, diagnostics, backup)        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Why Rust → WASM

The wasm32 build is a self-contained 500 KB module with a hand-rolled C ABI
(`prism_handle`, `prism_alloc`, `prism_free`) — no wasm-bindgen glue, no build
toolchain drift, deterministic binaries. All decision logic (config validation,
uBlock-style filters, Shorts/auto-dub scrubbing, SponsorBlock decisions, watch
history, theme math, network accounting, discovery ranking) runs there, with
structured errors (`Subsystem / Operation / Severity / Recovery / Code`).

### Runtime guarantees

- **Module lifecycle**: `init → start → stop`, dependency-ordered, with
  per-module resource accounting (timers, listeners) cleared on stop.
- **Crash isolation**: 3 consecutive failures quarantine a module; a watchdog
  restarts failed-but-not-quarantined modules with backoff.
- **Adaptive scheduling**: intervals stretch 8× while hidden, 1.5× unfocused,
  and grow on long ticks — nothing runs while YouTube is idle.
- **No global mutable state**: the `window.__PRISM__` namespace is the only
  shared surface; everything else is closure-scoped.

## Features

The feature contract (128 features across playback, captions, SponsorBlock,
session history, feed filtering, page elements, geo/cookies, network monitor,
performance, themes, discovery, search intelligence, budgets and external
signals) is implemented by the modules in `content/modules/`. Each module
registers with the runtime; the dashboard exposes every setting.

## Build

```sh
npm install
npm run build       # cargo → wasm32 → wasm-opt → bundle → dist/prism.zip
npm test            # Rust unit tests + WASM ABI smoke + engine unit tests
npm run check       # manifest, bundle, wasm ABI, icons, secret scan
npm run lint        # cargo clippy -D warnings
npm run sign        # AMO signing (unlisted) → dist/prism-signed.xpi
```

## Release

Push a tag `vX.Y.Z` matching `manifest.json`. The Release workflow:

1. Runs the full test suite and checks.
2. Builds the extension.
3. Signs it with Mozilla on the **unlisted** channel (secrets
   `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`).
4. Attaches `prism-signed.xpi` to a GitHub release.

## Install

Download `prism-signed.xpi` from the latest GitHub release and install via
`about:addons` → gear → *Install Add-on From File…*.

## License

Unlicense — public domain.
