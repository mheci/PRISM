# PRISM Developer Handbook

## Getting started

```sh
npm install
npm run build
npm run test
```

Rust 1.80+ with the `wasm32-unknown-unknown` target is required:

```sh
rustup target add wasm32-unknown-unknown
```

## Repo map

| Path | Purpose |
|---|---|
| `crates/prism-core/` | Pure logic library (serde-only) |
| `crates/prism-wasm/` | WASM ABI shim (`prism_handle` dispatch) |
| `content/runtime.js` | Module registry, lifecycle, quarantine, scheduler |
| `content/modules/*.js` | Feature modules |
| `content/bridge.js` | Isolated-world bridge (wasm + storage) |
| `content/boot.js` | Starts the runtime after registration |
| `background.js` | Event page (storage, badge) |
| `popup/` | Toolbar popup |
| `options/` | Dashboard |
| `scripts/` | build/check/test/sign/smoke |
| `.github/workflows/` | CI + release |

## Adding a feature

1. **Add the settings** to `crates/prism-core/src/config.rs` (typed, bounded,
   with a default). Add a UI entry in `options/options.js` (`GROUPS`).
2. **Add pure logic** (if any) to the core with unit tests, then expose it as
   an op in `crates/prism-wasm/src/lib.rs`.
3. **Add a module** under `content/modules/` that registers with the runtime:
   ```js
   P.registerModule({
     id: "my-feature",
     deps: [],
     async init(ctx) {},
     async start(ctx) {
       // ctx.timer.interval / ctx.timer.timeout / ctx.on / ctx.core / ctx.settings
     },
     stop() {},
     health() { return {}; },
   });
   ```
4. Add the file to `CONTENT_FILES` in `scripts/build.mjs`.
5. `npm run build && npm run test && npm run check`.

## Testing

- **Rust unit tests** (`cargo test --workspace`): every module has coverage —
  completion rules, scrub fixtures, filter parsing, budget thresholds, palette
  math, resume decisions, ring-buffer behavior.
- **WASM ABI smoke** (`npm run test:wasm`): instantiates the real optimized
  wasm in Node and exercises every op.
- **Engine unit tests** (`npm run test:engine`): loads the bundled engine in a
  DOM mock and verifies registration, lifecycle and quarantine.
- **Pre-release checks** (`npm run check`): manifest, bundle, wasm exports,
  icons, secret scan.

## Signing & releases

```sh
AMO_JWT_ISSUER=user:...:... AMO_JWT_SECRET=... node scripts/sign.mjs
```

The script always uses the `unlisted` channel. To cut a release: bump
`manifest.json`, commit, tag `vX.Y.Z`, push. The GitHub Actions workflow signs
and publishes the XPI.

## Troubleshooting

- **"bridge timeout"** in the engine log: the isolated bridge failed to load
  the wasm (check `dist/prism-core.wasm` exists and the extension is fresh).
- **"core error: SchemaViolation"**: settings blob has a field with an invalid
  type — the core falls back to defaults and reports the issue path.
- **Quarantined module**: open the dashboard → Diagnostics; quarantine clears
  on extension reload.
