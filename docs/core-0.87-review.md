# par-term emu core 0.87.0 review

Mux XR reviewed the official `par-term-emu-core-rust` v0.87.0 release at commit `6268237684057006fc315ba06ecc970a5a3e2777`, one release after the qualified v0.86.0 pin.

- Mux archive SHA-256: `be0af2cd345288c9b88a090901e17cd988e514389d25db0524a18a51c7d48b1e`, matching the release's own `SHA256SUMS.txt`.
- Streamer binary SHA-256: `ceeb052668c4d17308988e5b5ba2163f17fdf7f633719fc5a448b1ad573d898e`, matching the release's own `.sha256` file.
- Vendored `terminal_pb.ts` SHA-256: `149c4be5e774aae1f6353acd9f036e1d07ae910cbee0ec666954280c1fb1f031`, byte-for-byte identical to the 0.86.0 vendored file: 0.87.0 carries no protocol changes, and `make protocol-check` pins the same hash.

Sources: the [v0.87.0 release](https://github.com/paulrobello/par-term-emu-core-rust/releases/tag/v0.87.0) and the `CHANGELOG.md` at that tag.

## Changes with mux-xr relevance

- **Streamer CSP `connect-src` always permits `blob:`** (core card 01a1ff9b, filed by mux-xr): three.js GLTFLoader's embedded-texture path for GLBs (the standard Blender export shape — mux-xr's observatory GLB) creates a `Blob`, calls `URL.createObjectURL`, and fetches the `blob:` URL through ImageBitmapLoader, which `connect-src` governs. Under the 0.86 streamer's `connect-src 'self' ws: wss:` every embedded-texture GLB failed its textures. The 0.87 streamer serves `connect-src 'self' ws: wss: blob:` unconditionally; the `--csp-allow-blob-connect` opt-in (flag, `PAR_TERM_CSP_ALLOW_BLOB_CONNECT`, `StreamingConfig.allow_blob_connect_src`) is removed and scripts passing it error at startup. Mux-xr never passed the opt-in (grep clean across source and docs), so the removal costs nothing here, and the fixed behavior needs no client change — it requires the 0.87 streamer to serve the app, which the LAN rotation below provides.
- **`par-mux --cmd doctor` reports the daemon's macOS responsible-process attribution** (`5b5de2f6`): the daemon classifies its responsible process as `healthy` (pane children inherit the responsible app's Local Network and TCC grants), `tainted` (self-responsible: bare-fork shapes silently lose LAN egress and TCC consent, the herdr#808 bug class), `unknown`, or off-macOS. Useful for diagnosing the shared default daemon on this host; a daemon restart (not part of this pin) applies nothing here — doctor is diagnostic only.
- **Attach settings integrations page grades detected agents vs installed hooks** (`efa77cde`, `d810eff8`): par-mux TUI UX; no client impact.
- **Windows socket-path test fix** (`d60a3ab8`): test-only.

## A/B evidence for the blob: fix

Same built app (the pin's `dist`), same private 0.87.0 daemon, private streamers on loopback:

- **0.86.0 streamer** (`par-term-streamer 0.86.0`, port 4242): two CSP violations (`Connecting to 'blob:…' violates … "connect-src 'self' ws: wss:"` and the Fetch refusal) and `THREE.GLTFLoader: Couldn't load texture blob:…` — the observatory GLB's embedded texture fails, as recorded in the 0.86 review.
- **0.87.0 streamer** (`par-term-streamer 0.87.0`, port 4241): the same app loads with **no CSP errors and no GLTFLoader error**. The only console errors on either streamer are two `quick-commands.json` 404s — a pre-existing optional config fetch, identical on both.

## Qualification

On November 22, 2026, the official 0.87.0 streamer and par-mux archive ran on loopback against the pin's build.

- `make checkall` and `make checkall-ci` passed in the pin worktree: protocol-check (unchanged binding hash), Biome, strict TypeScript, Vitest, production build, observatory asset checks, Gitleaks, and the high-severity dependency audit.
- `make real-app-check` passed with `MUX_XR_PRIVATE_TEST=1` against a private 0.87.0 daemon (`0.87.0+6268237`) and the 0.87.0 streamer on loopback 4241. Two panes (`%0`, `%1`) in separate sessions attached at 80×24 with zero baseline Resize messages. An explicit 100×30 resize observed 100×30, restored to 80×24, with exactly two wire resizes. Both panes echoed their marker commands. Errors: none. Functional check; 1-minute load 459 during the run (parsight indexing and a hex-world build from other sessions), so no timing claim.
- The 0.87.0 streamer binary passes `codesign --verify --strict`; both Apple binaries carry the Developer ID signature like 0.86.0.
- The Playwright Chromium headless shell was freshly downloaded for this qualification (the pinned Playwright version expects a new cache revision).

## LAN deployment

- `.local/bin/streamer-candidate` holds the pristine release bytes (hash matches the pin), Developer ID signed. The previous 0.86.0 binary is kept as `.local/bin/streamer-candidate-0.86.0`, with `mux-core` rotated the same way (0.87.0 daemon binary installed; `mux-core-0.86.0` kept).
- The LAN streamer pane `%3470` in session `mux-xr-lan` was respawned in place with the 0.87.0 candidate and its existing TLS, origins, api-key-file, `--allow-api-key-in-query` and `--max-sessions 64` flags preserved, serving the default daemon over mux mirror mode on 0.0.0.0:4240. The pane log reports `Version: 0.87.0`. The default daemon was not restarted.
- Verification: the LAN origin served the app with HTTPS 200, the served CSP carries `connect-src 'self' ws: wss: blob:`, and a headless Chromium load of the LAN URL mounted the app with the renderer canvas present and **no GLTF texture error** — the only errors are the optional `quick-commands.json` 404 and `wss://…/ws?metadata=1` authentication failures from the fresh profile without the api-key, matching the 0.86 review's note that the key lives in app settings a fresh headless profile does not carry.
- The merge of this pin rebuilds `dist` in the main checkout, which the streamer serves by path; the post-merge build is the build the LAN preview serves (verified after merge).
