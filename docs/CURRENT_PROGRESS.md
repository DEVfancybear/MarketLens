# Current Progress

Last updated: 2026-07-06

## Current Milestone

Backend persistence and Google authentication.

## Status

- Frontend trading terminal: implemented and actively evolving.
- Frontend Google auth UI: implemented and verified.
- Backend API: Fiber scaffold; `GET /health` (liveness) + `GET /health/ready` (DB readiness) exist.
- Backend database: **Phase 1 complete** — pgxpool, golang-migrate runner, `0001_extensions` +
  `0002_auth` migrations, sqlc-generated queries for users/identities/sessions. Not yet applied to a
  live Postgres (none available locally). Phase 2 next: Firebase ID-token verification.
- Backend framework: **Fiber** — Phase 0 migrated the code off stdlib `net/http`.

## Completed Since Commit `9691bd1`

- **Backend Phase 1 (Database layer):** pgxpool (`internal/db/pool.go`), golang-migrate runner
  (`cmd/migrate`, embedded iofs source), migrations `0001_extensions` + `0002_auth` (auth tables +
  enums + `set_updated_at()` trigger), sqlc config + typed queries for users/identities/sessions
  (`internal/db/gen`), and `GET /health/ready` DB readiness probe (liveness stays DB-free). Verified
  build/vet/`sqlc generate` + live health probes; live-DB migrate up/down still pending a Postgres.
- **Backend Phase 0 (Foundation & framework):** migrated the Go backend from stdlib `net/http` to
  Fiber, extended config with DB/auth/Firebase/CORS vars + fail-fast validation, added the standard
  error-envelope helper (`WriteError` + Fiber `ErrorHandler`), and added `backend/.env.example`.
  Verified via `go build`/`go vet`, a live `/health` probe, a 404 envelope check, and a
  missing-secret production-boot abort.
- Restored root project memory docs after the monorepo split.
- Moved restored frontend-specific docs into `frontend/docs/` and archive reports into
  `frontend/docs/archive/`.
- Updated root docs for frontend/backend package ownership.
- Moved the Python FTMO/MT5 bridge into `backend/bridge/` as a backend sidecar.
- Added backend Google auth, PostgreSQL, API, and phased implementation plan docs.
- Added frontend Google sign-in/sign-up UI using Firebase Auth.
- Reconciled backend schema/API plan against the real frontend data model.
- Updated Watchlist UI/store toward TradingView parity:
  - header dropdown actions: share, copy, rename, add section, clear, create list
  - no upload/open-list or add-alert-on-list actions
  - rename mode with selected input in the header
  - blue section rows with chevron, inline double-click rename, and delete
  - symbol drag/drop before sections or inside sections
  - shared `watchlistLayout.ts` helpers for section/order index rules
  - list metadata persisted alongside the legacy symbol array for compatibility

## Recently Changed Files

- Root docs: `docs/{README,CURRENT_STATE,CURRENT_PROGRESS,HANDOFF,NEXT_TASKS,KNOWN_ISSUES,CHANGELOG}.md`
- Backend docs: `backend/docs/{AUTH,DATABASE,API,BACKEND_IMPLEMENTATION_PLAN}.md`
- Frontend auth docs: `frontend/docs/AUTH_UI.md`
- Watchlist docs: `frontend/docs/WATCHLIST_ARCHITECTURE.md`
- Watchlist code: `frontend/src/components/watchlist/Watchlist.tsx`,
  `frontend/src/store/watchlistStore.ts`, `frontend/src/store/watchlistLayout.ts`
- Watchlist tests: `frontend/tests/watchlist/watchlistLayout.test.ts`

## Verification Recently Run

- `cd frontend && npm run typecheck`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`
- `cd frontend && npm run test:watchlist`

Backend Go toolchain is available locally (`go version` works). Backend code was not changed in the
Watchlist/docs work.
