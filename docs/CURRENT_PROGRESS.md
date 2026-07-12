# Current Progress

Last updated: 2026-07-12

## Current Milestone

Backend persistence and Google authentication.

## Status

- Drawing maintenance Phase 8 is in progress: Wave A is complete with 13 new catalog tools across
  ranges, channel variants, annotations, and time projections. The manifest now covers 48 persistent
  tools; typecheck, 114 drawing tests, 17 persistence tests, 17 browser gesture tests, lint, and the
  drawing benchmark pass. See `frontend/docs/DRAWING_PHASE8_WAVE_A.md`.

- Replay backend migration: **Phases 0-6 complete** - deterministic Go/PostgreSQL clock,
  aggregation, isolated trading, synchronized layouts, frontend cutover, mandatory legacy deletion,
  and CI client-boundary enforcement. See `REPLAY_BACKEND_PHASE6.md`.
- Frontend trading terminal: implemented and actively evolving.
- Frontend Google auth UI: implemented and verified.
- Frontend backend sync: auth/session is wired; `GET /api/v1/sync/bootstrap` is now consumed after
  backend auth and applies server UI settings, SMC settings, notification defaults, and watchlists.
  Watchlist mutations write back to backend Phase 6 APIs; other UI mutation write-back remains a
  later frontend sync step.
- Backend API: Fiber scaffold; `GET /health`, `GET /health/ready`, `/api/v1/auth/*`,
  `/api/v1/settings`, `/api/v1/watchlists*`, and `/api/v1/sync/bootstrap` exist.
- Backend database: **Phase 1 complete** - pgxpool, golang-migrate runner, `0001_extensions` +
  `0002_auth` migrations, sqlc-generated queries for users/identities/sessions. Live Neon smoke has
  verified auth-table migration and login/register flow.
- Backend auth: **Phases 2, 3 & 4 complete** — Firebase verification + session/token services +
  **Google login/register endpoints** (`POST /api/v1/auth/google|refresh|logout`, `GET /auth/me`,
  `DELETE /auth/sessions`), `RequireAuth` middleware, CORS. 17 auth tests (incl. full flow via
  `app.Test`). Live Neon + Firebase smoke passed: first login creates the user, second login reuses
  it, `/auth/me`, `/auth/refresh`, and `/auth/logout` all pass.
- Backend settings/sync: **Phase 5 complete** - `0003_settings` migration, `internal/settings`
  `GET/PUT/PATCH /api/v1/settings`, and `GET /api/v1/sync/bootstrap` returning settings plus empty
  resource arrays.
- Backend watchlists: **Phase 6 complete** - `0004_watchlists` + `0005_watchlist_layout`
  migrations, `internal/watchlists` CRUD plus active-list and full layout persistence
  (`GET/POST /api/v1/watchlists`, `PUT /active`, `PATCH/DELETE /:id`, `PUT /:id/layout`,
  add/remove symbol compatibility endpoints), user-scoped with cross-user 404, and the
  `sync/bootstrap` watchlists slice populated. Verified live on Neon before the layout extension;
  current code is unit-tested.
  Current backend task: **Phase 7 - drawings** (+ drawing_templates).
- Backend framework: **Fiber** — Phase 0 migrated the code off stdlib `net/http`.

## Completed Since Commit `9691bd1`

- **Backend Phase 6 (Watchlists):** `0004_watchlists` migration (`watchlists` + `watchlist_symbols`)
  plus `0005_watchlist_layout` (`watchlist_sections`, `watchlist_preferences`, `watchlists.shared`);
  `internal/watchlists` model/repo/handler (hand-written pgx, user-scoped, idempotent symbol adds,
  active list, full-layout replace, cross-user 404); endpoints behind `RequireAuth`;
  `sync/bootstrap` watchlists slice filled. Unit-tested via `app.Test`.
- **Backend Phase 5 (Settings & sync bootstrap):** added `0003_settings` migration for
  `user_settings` and `layouts`; added `internal/settings` repo/handler with auto-create-on-read,
  replace, and deep-merge patch semantics; added `internal/workspace` bootstrap envelope; wired the
  protected routes from `cmd/api`; covered merge behavior and Fiber handlers with tests.
- **Backend Phase 4 (Auth endpoints & middleware):** `internal/users/repo.go`
  (`UpsertFromIdentity` transactional login/link/register + `GetUser`), `internal/auth/service.go`
  (`Service` LoginWithGoogle/Refresh/Logout/RevokeAllSessions/GetUser over a `UserUpserter` iface),
  `middleware.go` (`RequireAuth`), `handler.go` (5 Fiber auth routes returning the standard
  envelope), CORS + `/api/v1` group in `httpserver`, and optional auth assembly in `cmd/api`
  (mounted only when DB + Firebase are both configured). Integration-tested via `app.Test`; Firebase
  creds confirmed to initialize the Admin SDK; live Neon/Firebase login smoke passed.
- **Backend Phase 3 (Sessions & tokens):** `internal/auth/jwt.go` (`TokenService` MintAccess/
  ParseAccess, HS256, none-alg guard), `session.go` (`SessionService` Create/Rotate/Revoke/RevokeAll
  over a pgx-free `SessionStore`, reuse detection revokes the family), `session_pgstore.go`
  (`PgSessionStore` adapter over `gen.Queries`), and `cookies.go` (HttpOnly/SameSite=Lax/env-gated
  Secure, refresh scoped to `/api/v1/auth`). 9 new unit tests (jwt + session) via a fake store.
- **Backend Phase 2 (Firebase ID-token verification):** `internal/auth/firebase.go` (Admin SDK init
  from `FIREBASE_*`) + `verify.go` (`VerifyGoogleToken` → `Identity{UID, ProviderUID, Email,
  EmailVerified, Name, PhotoURL}`, all failures as `ErrUnauthorized`, never a partial identity) +
  unit tests via a fake verifier. Real-token check deferred to Phase 4 wiring.
- **Backend Phase 1 (Database layer):** pgxpool (`internal/db/pool.go`), golang-migrate runner
  (`cmd/migrate`, embedded iofs source), migrations `0001_extensions` + `0002_auth` (auth tables +
  enums + `set_updated_at()` trigger), sqlc config + typed queries for users/identities/sessions
  (`internal/db/gen`), and `GET /health/ready` DB readiness probe (liveness stays DB-free). Verified
  build/vet/`sqlc generate`, live health probes, and live Neon auth flow. Keep migrate up/down smoke
  in the checklist for any new schema phase.
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
