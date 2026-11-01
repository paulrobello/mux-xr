.PHONY: install build test lint fmt typecheck checkall checkall-ci asset-check e2e production-label-check update-notice-check live-check real-app-check dev dev-start dev-stop dev-restart preview pre-commit

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
production-label-check:
	bun run scripts/production-label-check.ts
update-notice-check:
	bun run scripts/update-notice-check.ts
live-check:
	bun run scripts/live-terminal-check.ts
real-app-check:
	bun run scripts/real-app-check.ts
asset-check:
	uv run --no-project python scripts/assets/check-observatory.py
	cmp assets-source/observatory/staging/observatory.glb public/assets/observatory.glb
dev dev-start:
	bun run dev
preview:
	bun run preview
dev-stop:
	bun run scripts/dev-stop.ts
dev-restart: dev-stop dev
pre-commit:
	pre-commit run --all-files
