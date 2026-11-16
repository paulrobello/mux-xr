# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Mux XR contributor guide

Mux XR is a TypeScript, Vite and Three.js WebXR client for par-mux. The [README](README.md) is the first-run guide. Read the [architecture](docs/ARCHITECTURE.md) for module ownership, the [workspace guide](docs/WORKSPACE.md) for current controls, and [DESIGN.md](DESIGN.md) for interaction and visual design.

## Development and verification

| Command | Use |
| --- | --- |
| `bun install --frozen-lockfile` | Install dependencies with the Bun version pinned in [package.json](package.json) |
| `make help` | List every Makefile target with a one-line description |
| `make install` | Install dependencies from the frozen lockfile, the same as `bun install --frozen-lockfile` |
| `make dev` | Run Vite on port 4240. Use an isolated port when the LAN preview already owns 4240 |
| `make dev-stop`, `make dev-restart` | Stop the Vite dev server, or stop it and start it again |
| `make preview` | Serve the production build with Vite preview |
| `make checkall` | Run Biome, strict TypeScript, Vitest, and the production build |
| `make checkall-ci` | Run the full local gate, including observatory asset checks, Gitleaks, and the high-severity dependency audit |
| `make asset-check` | Validate the observatory asset and its runtime copies. `make checkall-ci` runs it |
| `make pre-commit` | Run every pre-commit hook on all files. Install both hooks once per clone and worktree with `pre-commit install --hook-type pre-commit --hook-type pre-push`. The pre-push hook runs `make checkall-ci`, and `--no-verify` or a missing install skips it |
| `make e2e` | Run the local GPU browser suite with synthetic streamer fixtures |
| `make real-app-check` | Verify the built app against a private mux daemon and streamer |
| `bun run test tests/<name>.test.ts` | Run one Vitest file. Unit tests live in `tests/` and run under happy-dom |
| `make <feature>-check` | Targeted browser or protocol check, e.g. `make hierarchy-check`, `make focus-mode-check`; see [Testing](docs/TESTING.md) for the flags each one requires |

Documentation-only commits (`.md`, `.txt`, `docs/`) skip the fast gate in the pre-commit hook.

Use [Testing](docs/TESTING.md) for fixture setup, exact flags, and evidence requirements. Any automated check that sends input, resizes a pane, creates a pane, or exercises stream lifecycle must use a private daemon and streamer. The live preview uses the shared default mux daemon. Record browser fixture, real-core and physical Quest results separately.

## Source entry points

- [src/main.ts](src/main.ts) mounts the app and classifies the `?server=` link. [src/app.ts](src/app.ts) builds the presenters and the shared workspace actions, and [src/workspace/pane-controller.ts](src/workspace/pane-controller.ts) owns the attached surfaces, pane selection and open-view restore. [src/settings/store.ts](src/settings/store.ts) owns the device settings both presenters share. [src/contracts.ts](src/contracts.ts) defines the interfaces between views and transport.
- [src/terminal/surface.ts](src/terminal/surface.ts) owns each viewer socket and terminal emulator. [src/workspace/hierarchy.ts](src/workspace/hierarchy.ts) handles hierarchy metadata. Keep the vendored protobuf binding and [core-release.json](core-release.json) in sync when upgrading core.
- [src/ui/index.ts](src/ui/index.ts) and [src/desktop/panels.ts](src/desktop/panels.ts) own the browser presentation. [src/xr/scene.ts](src/xr/scene.ts) orchestrates the Three.js preview and immersive scene.
- [scripts/dictation-server.ts](scripts/dictation-server.ts) starts the optional macOS companion. [src/server/host-service.ts](src/server/host-service.ts) wires its host routes. See [Host setup](docs/HOST-SETUP.md) for local configuration.

## Implementation constraints

- Keep the browser drawer as the input presenter for the page and 3D preview. Use native scene controls during immersion and route both presentations through shared workspace actions.
- Keep input tied to the selected connected pane. Preserve the target guards for delayed input such as clipboard and dictation, and reject unsent input on disconnect. Viewer close and reconnect preserve the underlying process.
- Keep physical transforms, text zoom, filtering, and gaze-based rendering independent of the PTY grid. Send grid resize only on explicit **Apply**. Show the server-confirmed dimensions.
- Preserve the streamer's CSP and the self-hosted label path. Verify glyph pixels on a production build served by the streamer when changing XR labels.
- Keep host-specific paths, runtime details, and secrets in gitignored local files. Preserve existing streamer authentication, origins, and service configuration.
