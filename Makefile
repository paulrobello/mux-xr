.PHONY: install build test coverage lint fmt typecheck checkall checkall-ci asset-check e2e hierarchy-check auto-entry-check production-label-check update-notice-check arrangement-check focus-mode-check window-preferences-check clipboard-selection-check input-comfort-check terminal-shimmer-check widgets-clarity-check terminal-capacity-check live-check real-app-check pane-create-check pane-create-app-check agent-roster-app-check dev dev-start dev-stop dev-restart preview pre-commit

install: ## Install dependencies from the frozen lockfile
	bun install --frozen-lockfile
build: ## Build the production app into dist
	bun run build
test: ## Run the Vitest unit tests
	bun run test
coverage: ## Run the unit tests under the V8 coverage report
	bun run test --coverage --testTimeout=120000
lint: ## Run Biome lint with warnings as errors
	bun run lint
fmt: ## Format the sources with Biome
	bun run fmt
typecheck: ## Run strict TypeScript
	bun run typecheck
.PHONY: protocol-check
protocol-check: ## Verify the vendored protobuf binding against core-release.json
	bun run scripts/protocol-check.ts
checkall: protocol-check lint typecheck test build ## Fast gate: protocol check, lint, typecheck, unit tests and build
checkall-ci: checkall asset-check ## CI-parity gate: checkall, asset checks, Gitleaks and the dependency audit
	gitleaks dir . --redact --no-banner
	bun audit --audit-level high
e2e: ## Run the browser suite against a local app with synthetic streams
	bun run e2e
.PHONY: background-thumbnails
background-thumbnails: ## Re-render the Backgrounds picker thumbnails (MODES="koi summit" limits it)
	bun run scripts/background-thumbnails.ts $(MODES)
.PHONY: publish-commands
publish-commands: ## Publish a shared quick-commands file (FILE=path/to/commands.json)
	bun run scripts/publish-commands.ts "$(FILE)"
hierarchy-check: ## Browser check: both hierarchy styles on a private fixture
	bun run scripts/hierarchy-check.ts
.PHONY: input-refinement-check
input-refinement-check: ## Browser check: hierarchy, keyboard curvature, rims and fake speech
	bun run scripts/input-refinement-check.ts
auto-entry-check: ## Browser check: automatic XR entry with and without activation
	bun run scripts/auto-entry-check.ts
production-label-check: ## Browser check: glyph pixels in a built app behind the streamer CSP
	bun run scripts/production-label-check.ts
update-notice-check: ## Browser check: update notice and reload between two builds
	bun run scripts/update-notice-check.ts
arrangement-check: ## Browser check: Row, Grid, Arc and Sphere arrangements
	bun run scripts/arrangement-check.ts
focus-mode-check: ## Browser check: Focus entry, placement and exact restore
	bun run scripts/focus-mode-check.ts
window-preferences-check: ## Browser check: window defaults and Focus preferences
	bun run scripts/window-preferences-check.ts
clipboard-selection-check: ## Browser check: text selection, copy and paste
	bun run scripts/clipboard-selection-check.ts
.PHONY: placement-motion-check
placement-motion-check: ## Browser check: floor clearance and clock grip motion
	bun run scripts/placement-motion-check.ts
input-comfort-check: ## Browser check: radial, keyboard opening and environment motion
	bun run scripts/input-comfort-check.ts
.PHONY: hand-input-check
hand-input-check: ## Browser check: hand rays, pinch and manipulation
	bun run scripts/hand-input-check.ts
.PHONY: hand-visual-check
hand-visual-check: ## Browser check: standard hand meshes and captured pinch metrics
	bun run scripts/hand-visual-check.ts
.PHONY: hand-contact-check
hand-contact-check: ## Browser check: fingertip contact with keys and buttons
	bun run scripts/hand-contact-check.ts
widgets-clarity-check: ## Browser check: native widgets, filters, poses and pixels
	bun run scripts/widgets-clarity-check.ts
.PHONY: perf-gauge-check
perf-gauge-check: ## Browser check: performance gauge update cost
	bun run scripts/perf-gauge-check.ts
.PHONY: host-load-check
host-load-check: ## Browser check: host load meter states from a fake source
	bun run scripts/host-load-check.ts
.PHONY: keyborb-perf-check
keyborb-perf-check: ## Browser check: Keyborb cost against the other keyboards
	bun run scripts/keyborb-perf-check.ts
terminal-shimmer-check: ## Browser check: WebGL terminal sampler modes under gaze
	bun run scripts/terminal-shimmer-check.ts
terminal-capacity-check: ## Browser check: desktop canvas cost for 6, 12 and 18 panes
	bun run scripts/terminal-capacity-check.ts
.PHONY: damage-audit-check
damage-audit-check: ## Painter damage-hint audit against a private daemon
	bun run scripts/damage-audit-check.ts
live-check: ## Terminal-adapter diagnostic against a real streamer
	bun run scripts/live-terminal-check.ts
real-app-check: ## Built app against a private core pair
	bun run scripts/real-app-check.ts
pane-create-check: ## Pane-create protocol against a private streamer
	bun run scripts/pane-create-check.ts
pane-create-app-check: ## Built app New terminal control against a private streamer
	bun run scripts/pane-create-app-check.ts
agent-roster-app-check: ## Built app agent roster against a private daemon
	bun run scripts/agent-roster-app-check.ts
asset-check: ## Validate the observatory asset and its runtime copies
	uv run --no-project python scripts/assets/check-observatory.py
	cmp assets-source/observatory/staging/observatory.glb public/assets/observatory.glb
	cmp assets-source/observatory/maps/planet-basecolor.png public/assets/observatory-planet.png
dev: ## Run the Vite dev server on port 4240
	bun run dev
dev-start: dev ## Alias of dev
preview: ## Serve the production build with Vite preview
	bun run preview
dev-stop: ## Stop the Vite dev server
	bun run scripts/dev-stop.ts
dev-restart: dev-stop dev ## Stop and start the Vite dev server
pre-commit: ## Run every pre-commit hook on all files
	pre-commit run --all-files

.PHONY: whisper-service-plist install-whisper-service whisper-agent-plist install-whisper-agent uninstall-whisper-agent explorer-controls-check keyborb-check local-dictation-check pane-bell-check pane-lifecycle-check quest-controls-check radial-live-check stream-lifecycle-check terminal-opacity-check terminal-texture-check warp-radial-check xr-visual-check
whisper-service-plist: ## Print the dictation LaunchDaemon plist without installing it
	bun run scripts/install-dictation-service.ts --print
install-whisper-service: ## Install the dictation LaunchDaemon (administrator authentication)
	sudo /opt/homebrew/bin/bun run scripts/install-dictation-service.ts --install --migrate-running-listener
whisper-agent-plist: ## Print the dictation LaunchAgent plist without installing it
	bun run scripts/install-dictation-service.ts --print --agent
install-whisper-agent: ## Install the dictation LaunchAgent (needed for host clipboard sync)
	bun run scripts/install-dictation-service.ts --install --agent
uninstall-whisper-agent: ## Remove the dictation LaunchAgent
	bun run scripts/install-dictation-service.ts --uninstall --agent
explorer-controls-check: ## Browser check: hierarchy explorer controls
	bun run scripts/explorer-controls-check.ts
keyborb-check: ## Browser check: Keyborb layout, pinch typing and feedback
	bun run scripts/keyborb-check.ts
local-dictation-check: ## Browser check: local dictation with a fake audio capture
	bun run scripts/local-dictation-check.ts
pane-bell-check: ## Browser check: bell indicator and bell feed
	bun run scripts/pane-bell-check.ts
pane-lifecycle-check: ## Held-pane exit and respawn through a real streamer
	bun run scripts/pane-lifecycle-check.ts
quest-controls-check: ## Controller controls and terminal pixels against a private streamer
	bun run scripts/quest-controls-check.ts
radial-live-check: ## Browser check: live radial menu and glass rendering
	bun run scripts/radial-live-check.ts
stream-lifecycle-check: ## Browser check: four intercepted streams and reconnect
	bun run scripts/stream-lifecycle-check.ts
terminal-opacity-check: ## Browser check: terminal glass opacity pixels
	bun run scripts/terminal-opacity-check.ts
terminal-texture-check: ## Browser check: WebGL pixels against the canvas reference
	bun run scripts/terminal-texture-check.ts
warp-radial-check: ## Browser check: radial Warp editing
	bun run scripts/warp-radial-check.ts
xr-visual-check: ## Native GPU rendering of the spatial keyboard
	bun run scripts/xr-visual-check.ts
.PHONY: context-loss-check
context-loss-check:
	bun run scripts/context-loss-check.ts
.PHONY: help
help: ## List the targets and what they do
	@grep -E '^[a-z0-9-]+:.*## ' Makefile | awk -F':.*## ' '{printf "%-28s %s\n", $$1, $$2}'
