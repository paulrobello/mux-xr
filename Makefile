.PHONY: install build test lint fmt typecheck checkall checkall-ci asset-check e2e hierarchy-check auto-entry-check production-label-check update-notice-check arrangement-check focus-mode-check window-preferences-check clipboard-selection-check input-comfort-check terminal-shimmer-check widgets-clarity-check terminal-capacity-check live-check real-app-check pane-create-check pane-create-app-check agent-roster-app-check dev dev-start dev-stop dev-restart preview pre-commit

install:
	bun install --frozen-lockfile
build:
	bun run build
test:
	bun run test
lint:
	bun run lint
fmt:
	bun run fmt
typecheck:
	bun run typecheck
checkall: lint typecheck test build
checkall-ci: checkall asset-check
	gitleaks dir . --redact --no-banner
	bun audit --audit-level high
e2e:
	bun run e2e
.PHONY: background-thumbnails
background-thumbnails:
	bun run scripts/background-thumbnails.ts $(MODES)
.PHONY: publish-commands
publish-commands:
	bun run scripts/publish-commands.ts "$(FILE)"
hierarchy-check:
	bun run scripts/hierarchy-check.ts
.PHONY: input-refinement-check
input-refinement-check:
	bun run scripts/input-refinement-check.ts
auto-entry-check:
	bun run scripts/auto-entry-check.ts
production-label-check:
	bun run scripts/production-label-check.ts
update-notice-check:
	bun run scripts/update-notice-check.ts
arrangement-check:
	bun run scripts/arrangement-check.ts
focus-mode-check:
	bun run scripts/focus-mode-check.ts
window-preferences-check:
	bun run scripts/window-preferences-check.ts
clipboard-selection-check:
	bun run scripts/clipboard-selection-check.ts
.PHONY: placement-motion-check
placement-motion-check:
	bun run scripts/placement-motion-check.ts
input-comfort-check:
	bun run scripts/input-comfort-check.ts
.PHONY: hand-input-check
hand-input-check:
	bun run scripts/hand-input-check.ts
.PHONY: hand-visual-check
hand-visual-check:
	bun run scripts/hand-visual-check.ts
.PHONY: hand-contact-check
hand-contact-check:
	bun run scripts/hand-contact-check.ts
widgets-clarity-check:
	bun run scripts/widgets-clarity-check.ts
.PHONY: perf-gauge-check
perf-gauge-check:
	bun run scripts/perf-gauge-check.ts
.PHONY: host-load-check
host-load-check:
	bun run scripts/host-load-check.ts
.PHONY: keyborb-perf-check
keyborb-perf-check:
	bun run scripts/keyborb-perf-check.ts
terminal-shimmer-check:
	bun run scripts/terminal-shimmer-check.ts
terminal-capacity-check:
	bun run scripts/terminal-capacity-check.ts
.PHONY: damage-audit-check
damage-audit-check:
	bun run scripts/damage-audit-check.ts
live-check:
	bun run scripts/live-terminal-check.ts
real-app-check:
	bun run scripts/real-app-check.ts
pane-create-check:
	bun run scripts/pane-create-check.ts
pane-create-app-check:
	bun run scripts/pane-create-app-check.ts
agent-roster-app-check:
	bun run scripts/agent-roster-app-check.ts
asset-check:
	uv run --no-project python scripts/assets/check-observatory.py
	cmp assets-source/observatory/staging/observatory.glb public/assets/observatory.glb
	cmp assets-source/observatory/maps/planet-basecolor.png public/assets/observatory-planet.png
dev dev-start:
	bun run dev
preview:
	bun run preview
dev-stop:
	bun run scripts/dev-stop.ts
dev-restart: dev-stop dev
pre-commit:
	pre-commit run --all-files

.PHONY: whisper-service-plist install-whisper-service whisper-agent-plist install-whisper-agent uninstall-whisper-agent explorer-controls-check keyborb-check local-dictation-check pane-bell-check pane-lifecycle-check quest-controls-check radial-live-check stream-lifecycle-check terminal-opacity-check terminal-texture-check warp-radial-check xr-visual-check
whisper-service-plist:
	bun run scripts/install-dictation-service.ts --print
install-whisper-service:
	sudo /opt/homebrew/bin/bun run scripts/install-dictation-service.ts --install --migrate-running-listener
whisper-agent-plist:
	bun run scripts/install-dictation-service.ts --print --agent
install-whisper-agent:
	bun run scripts/install-dictation-service.ts --install --agent
uninstall-whisper-agent:
	bun run scripts/install-dictation-service.ts --uninstall --agent
explorer-controls-check:
	bun run scripts/explorer-controls-check.ts
keyborb-check:
	bun run scripts/keyborb-check.ts
local-dictation-check:
	bun run scripts/local-dictation-check.ts
pane-bell-check:
	bun run scripts/pane-bell-check.ts
pane-lifecycle-check:
	bun run scripts/pane-lifecycle-check.ts
quest-controls-check:
	bun run scripts/quest-controls-check.ts
radial-live-check:
	bun run scripts/radial-live-check.ts
stream-lifecycle-check:
	bun run scripts/stream-lifecycle-check.ts
terminal-opacity-check:
	bun run scripts/terminal-opacity-check.ts
terminal-texture-check:
	bun run scripts/terminal-texture-check.ts
warp-radial-check:
	bun run scripts/warp-radial-check.ts
xr-visual-check:
	bun run scripts/xr-visual-check.ts
.PHONY: context-loss-check
context-loss-check:
	bun run scripts/context-loss-check.ts
