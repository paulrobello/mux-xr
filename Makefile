.PHONY: install build test lint fmt typecheck checkall checkall-ci asset-check e2e hierarchy-check auto-entry-check production-label-check update-notice-check arrangement-check focus-mode-check window-preferences-check clipboard-selection-check input-comfort-check terminal-shimmer-check widgets-clarity-check terminal-capacity-check live-check real-app-check dev dev-start dev-stop dev-restart preview pre-commit

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
input-comfort-check:
	bun run scripts/input-comfort-check.ts
widgets-clarity-check:
	bun run scripts/widgets-clarity-check.ts
terminal-shimmer-check:
	bun run scripts/terminal-shimmer-check.ts
terminal-capacity-check:
	bun run scripts/terminal-capacity-check.ts
live-check:
	bun run scripts/live-terminal-check.ts
real-app-check:
	bun run scripts/real-app-check.ts
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
