# Current Progress

- Edge timeframe-transition stability (2026-08-10): the AUDJPY production
  shake seen while cycling `5m`, `15m`, and `30m` was isolated to two frontend
  viewport writes surrounding asynchronous overlay/pane indicator reconciliation;
  repeated backend `15m` snapshots and the settled chart were stable. Runtime
  option refreshes can no longer write viewport defaults, market boundaries no
  longer autoscale the outgoing series, and native candle/indicator mutations
  complete before the controller's single market reset. The regression harness
  now checks controller/native logical-range agreement, pane geometry, autoscale,
  and one programmatic write across all 11 supported timeframes, including a
  repeat of the reported `5m -> 15m -> 30m -> 15m` sequence.

- Indicator runtime pane recovery (2026-08-10): live-history invalidation now
  refreshes the common active scope snapshot used by every backend indicator.
  Completion notifications from the new history generation can no longer be
  filtered against a memoized previous scope, so RSI and future separate-pane
  scripts render their line, levels, right scale, and dynamic legend value on
  the first non-empty result even when no later market tick arrives. Regression
  coverage exercises the full empty -> invalidate -> non-empty browser path and
  inspects native series points plus pane price ranges.

- Continuous MT5 copier production foundation (2026-08-06): migration
  `0035_execution_continuous_copier` is applied in production and the canonical
  runner completed its Go/Rust build, restart, and local/public health gates.
  The migration uses non-colliding explicit names for cross-column revision
  ordering and fixed-quantity mode checks. The durable lifecycle path remains
  inbox -> leased work -> transactional command outbox -> EA outcome ->
  link/reconciliation. See `MT5_TRADE_COPIER_PLAN.md`.

- Automated prop-firm protection (2026-08-01): the web execution backend now
  owns a versioned, broker-neutral Prop Risk Guard. Locked FTMO 2-Step presets
  and a custom future-firm profile enforce daily/maximum drawdown, Stop Loss,
  per-trade and combined position/pending risk before enqueue. Heartbeats reset
  by firm timezone, persist sticky daily locks, detect unprotected external
  exposure, and automatically block, cancel, or close without daily user
  intervention. Starting capital is resolved from profile-owned reference
  balances in both UI and backend, preventing a drawn-down live balance from
  being mistaken for a fresh loss allowance. Profiles remain provider-neutral:
  rule locking and capital inference are independent metadata, not firm-name
  branches. First enable, re-enable, and same-day changes use a conservative
  baseline until the automatically refreshed heartbeat evaluation arrives. See
  `PROP_RISK_GUARD.md`.

- English/Vietnamese localization (2026-07-29): desktop and mobile now share a persisted locale,
  every drawing tool/group uses stable-ID localization with official TradingView Vietnamese
  terminology, and a bounded compatibility catalog covers existing UI/accessibility copy in both
  directions without translating symbols, timestamps, backend payloads, or user content. See
  `frontend/docs/LOCALIZATION_ARCHITECTURE.md`.

- Deferred offline MT5 copy (2026-07-28): an offline FTMO/Exness target can remain selected and
  enters a PostgreSQL-backed `waiting` state for five minutes. Reconnection alone is not enough:
  the target EA must publish a fresh authenticated account/instrument snapshot, after which Rust
  reruns routing and risk validation before queueing. A background sweep makes expiry terminal
  with `DEFERRED_DELIVERY_EXPIRED`. The UI shows the exact deadline and explains that every account
  requires its own running MT5 terminal/EA. See `TRADE_EXECUTION_ARCHITECTURE.md`.

- Trade step-up/security (2026-07-28): users may enable a separate trade password. It is requested
  once per browser trade session and shared across tabs through a hardened, server-backed session
  cookie. One-time authorizations remain bound to the exact JSON payload, user, active session,
  operation, and short expiry, then atomically consumed by Rust before enqueue. The public Go
  execution client now forwards both the authorization token and authenticated session ID in the
  internal gateway envelopes for routed orders and lifecycle commands. Regressions prevent valid
  orders from failing gateway decode with `422` and prevent cancel, close, or modify from being
  rejected before the durable queue. See `TRADE_PASSWORD_AUTHORIZATION.md`.

- Existing-trade multi-copy (2026-07-28): desktop and mobile MT5 position/pending-order rows now
  expose one Copy action. Its dialog supports multiple ready or temporarily offline target
  accounts, reuses configured allocation rules, excludes the source account, and submits one
  exact-payload multi-target route.
  Each target remains independently validated and reported; later close, cancel, or modify actions
  are not implicitly mirrored. See `TRADE_EXECUTION_ARCHITECTURE.md`.

> Trade execution update (2026-07-27): legacy MT5 verification/Connector
> milestones below are historical. Current implementation and remaining native
> venue work are tracked in `TRADE_EXECUTION_ARCHITECTURE.md`.

Last updated: 2026-08-10

- Chart drag/symbol-switch stability (2026-07-30): the production chart path
  now uses granular market-data subscriptions, revision-safe deferred viewport
  writes, debounced history prefetch, cancellable stale history/indicator work,
  structural candle sharing for MT5 refreshes, and a non-blocking warm-cache
  loading policy. A follow-up hotfix keeps the Alert Center's live quote and
  candle hooks unconditional, preventing the first quote update from changing
  React hook order and crashing the page. The regression suite covers the
  drag → switch → drag flow's main races. Post-deploy Chrome verification
  repeatedly dragged the chart while switching seven Forex symbols; the chart
  stayed responsive and produced no new console errors.

## Current Milestone

Backend persistence, authenticated per-user MT5 access, and drawing maintenance.

## Status

- Auth bootstrap/security: the frontend now uses one `POST /api/v1/auth/session` exchange instead
  of expected 401 probes. Google provider/email verification, Strict/Secure cookies, fixed JWT
  issuer/audience, atomic refresh rotation, cookie-aware Origin checks, disabled-user rejection,
  and auth rate limiting are active. PostgreSQL push alert sync is bounded to eight seconds with
  retryable `503` versus ownership `409`. See `backend/docs/AUTH.md`, `docs/SECURITY.md`, and
  `docs/CHANGELOG.md` for the current contract.

- MT5 execution is now **per signed-in user and broker-neutral** through the
  common EA. No MT5 password is stored. Migration
  `0028_execution_ea_poll_liveness` separates generic session activity from a
  successful command poll; only EA 1.25+ with a poll in the last 15 seconds can
  appear `READY` or receive Live/Demo commands. Migration
  `0029_execution_delivery_outcome_unknown` keeps delivered-but-unacknowledged
  orders reconcilable without redelivery or a false broker-rejection status.

- Backend-owned indicators: **generic Pine source path is active** for the
  documented historical subset, with replay candles truncated before any VM or
  vector evaluation. SMA, EMA, VWAP, RSI, MACD, ADR, and FVG remain embedded
  Pine sources. The former formula-specific `SWING_SR` source/catalog entry has
  been removed; Swing High/Low scripts now use the same saved-source compile
  path as every other user script. `PIVOT_FORMATION_ALERT_PLAN.md` is archived
  and must not be used to restore a `SWING_SR` branch.

- Drawing maintenance Phase 8 is in progress: Waves A-C are complete. Wave C adds 11 harmonic,
  Elliott, and time-cycle tools through a shared labeled-anchor framework. The manifest now covers
  73 persistent tools; 121 drawing tests, 17 persistence tests, 19 browser gesture tests, build,
  typecheck, lint, and benchmark pass. See `frontend/docs/DRAWING_PHASE8_WAVE_C.md`.

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
  **Google login/register endpoints** (`POST /api/v1/auth/session|google|refresh|logout`, `GET /auth/me`,
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

## Historical completion log since commit `9691bd1`

The entries below preserve the implementation state at the time each phase landed. They are not
the current auth/security contract; use the maintained documents linked above for operations.

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
