# NEXT TASKS

## Approved universal MT5 cloud connector initiative

The next cloud-execution initiative is documented in
[`UNIVERSAL_MT5_CLOUD_CONNECTOR_PLAN.md`](UNIVERSAL_MT5_CLOUD_CONNECTOR_PLAN.md).
It adds one broker-neutral backend connector path in which users connect an MT5
account from MarketLens web with login, password, and exact server. Users do not
open or install MT5 Desktop, Mobile, WebTerminal, an EA, or a local connector.

Start with **Plan 0 only**: validate TickerAll across at least three MT5 server
families, prove the complete demo lifecycle and idempotency behavior, collect
sanitized contract fixtures, and resolve broker/provider permission constraints.
Do not add public password routes, migration `0038`, or production provider
secrets before the Plan 0 exit gate passes. MetaApi is the secondary provider
after the common contract and TickerAll vertical slice are proven.

> Trade execution update (2026-07-26): older Phase 6 verifier/Connector tasks
> are cancelled, not pending. The only native-venue completion sequence is the
> fail-closed plan in `TRADE_EXECUTION_ARCHITECTURE.md`.

_Post-monorepo update 2026-07-06._

## Deferred indicator-event alerts

- The former `SWING_SR`-specific pivot alert task is retired with that catalog
  entry. Any future pivot-high/pivot-low alerts must be source-driven and use a
  common backend Pine event contract rather than restoring a hidden formula.
- [`PIVOT_FORMATION_ALERT_PLAN.md`](PIVOT_FORMATION_ALERT_PLAN.md) is retained
  as an archived design reference; its `SWING_SR` payloads are not an active
  implementation target.
- The frontend may configure and render future indicator-event alerts, but it must not
  scan candles, infer events from returned series, or submit pivot triggers.

## Drawing maintenance refactor

- Phase 8 Waves A-C are complete; do not reopen their shared interaction/persistence boundaries to add
  tool-specific branches.
- Next drawing catalog delivery is Wave D from
  `frontend/docs/DRAWING_TOOLS_MAINTENANCE_REFACTOR_PLAN.md`: data-dependent projections/profiles
  and rich content. Define candle/volume/data-source and content-sandbox contracts before adding
  those tools; do not implement them as coordinate-only approximations.

## Approved backend replay initiative (design first)

Replay will migrate from a frontend-owned candle cursor to a deterministic Go/PostgreSQL session
engine. The detailed architecture, database schema, API/WebSocket contracts, frontend ownership
map, test gates, and six implementation phases are in
[`REPLAY_BACKEND_MIGRATION_PLAN.md`](REPLAY_BACKEND_MIGRATION_PLAN.md).

Replay backend Phases 0-6 are complete and repository-verified. Phase 6 physically deleted the
legacy frontend clock/store/engine, provider-history replay path, client MTF aggregation, and replay
trade processing. Backend Replay is now the default authenticated path; the deployment flag is a UI
kill switch only. `npm run check:replay-client-boundary` prevents local Replay authority from being
reintroduced. See [`REPLAY_BACKEND_PHASE6.md`](REPLAY_BACKEND_PHASE6.md).

The next implementation priority returns to backend per-resource persistence, beginning with Phase
7 drawings, plus operational Replay E2E/performance validation against a deployed PostgreSQL/MT5
environment.

The historical roadmap below is preserved. The current top priority after the monorepo split is:

1. ~~Migrate the Go backend scaffold from stdlib `net/http` to Fiber.~~ Done (backend Phase 0).
   ~~Phase 1 - Database layer.~~ Done (auth migrations and sqlc are in place; live Neon smoke has verified auth tables).
   ~~Phase 2 - Firebase ID-token verification (`internal/auth/firebase.go` + `verify.go`).~~ Done.
   ~~Phase 3 - Sessions & tokens (`jwt.go`, `session.go` rotation/reuse, `cookies.go`).~~ Done.
   ~~Phase 4 - Auth endpoints & middleware (`/api/v1/auth/*`, `RequireAuth`, CORS,
   `users.UpsertFromIdentity`).~~ Done (code + `app.Test`; live Neon/Firebase login, refresh, me, and logout smoke passed).
   ~~Phase 5 - Sync bootstrap + settings (`0003_settings`, `internal/settings` GET/PUT/PATCH,
   `GET /api/v1/sync/bootstrap`).~~ Done.
   ~~Phase 6 - Watchlists (`0004_watchlists` + `0005_watchlist_layout`,
   `internal/watchlists` CRUD + full layout + active list, bootstrap slice) + local MT5 tick
   streaming (`bridge/mt5_stream`, `cmd/mt5-stream`).~~ Done (watchlists verified live on Neon;
   MT5 stream code is ready for a Windows host with MT5 installed).
   Current backend step is **Phase 7 - Drawings** (`0005`-ish charting migration: `drawings` +
   `drawing_templates`; batch upsert deduped on `client_id`; `GET /drawings?symbol=`, bulk
   `/drawings/batch`, `drawing-templates` CRUD), then Phases 8-13 per-resource.
2. Implement remaining backend per-resource persistence according to
   `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`, starting with Phase 7 drawings.
3. Add frontend remote workspace sync according to
   `frontend/docs/BACKEND_API_SYNC_ARCHITECTURE.md`: shared `ky` API client, typed adapters,
   `sync/bootstrap` apply path, and feature-by-feature mutations for settings, watchlists,
   drawings, indicators, alerts, journal, layouts, and simulated trading. Bootstrap read/apply is
   now wired for UI settings, SMC settings, notification defaults, and watchlists. Watchlist
   list/symbol/section/reorder/active-list write-through is wired to backend Phase 6. Settings
   write-back remains pending.
4. Keep frontend feature docs under `frontend/docs/`; use `frontend/docs/archive/` for historical
   audit/parity reports.

For frontend changes, continue using the validation baseline from `docs/HANDOFF.md`.

## Current status

- **✅ Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).**
- **✅ Phase 2 — Alert Engine: COMPLETE** (engine + notifications + Alert Center + audit + Phase 2.1
  interactive chart alerts).
- **✅ OANDA Integration: COMPLETE** (forex/metals/indices via OANDA v20 REST; fallback to
  TwelveData; extension points for FxcmProvider + ICMarketsProvider).
- **✅ Phase 3 — TradingView UI Parity: COMPLETE** (90% visual, 85% interaction).
  16 files modified, 2 created. See `docs/TRADINGVIEW_PARITY_REPORT.md`.
- **✅ Phase 4.1 — Drawing Engine Foundation: COMPLETE.**
- **✅ Phase 4.2 — Trend Line Suite: COMPLETE** (8 line tools + DrawingContextMenu + styles).
- **✅ Phase 4.2.1 — Tool Activation: COMPLETE** (state machine, cursor system, live preview).
- **✅ Phase 4.2.2 — Tool Group System: COMPLETE** (4 grouped icons + flyout portal fix).
- **✅ Phase 4.3 — Shape Tools Suite: COMPLETE** (8 shapes + fill + supply/demand zones).
- **✅ Phase 4.4 — Fibonacci Suite: COMPLETE** (fibRetracement + trend-based fibExtension,
  plugin architecture, retracement 2-point creation, extension 3-click creation, auto-levels with
  labels/background bands, full hitTest/movePoints/boundingBox).
- **✅ Phase 5 — Left Toolbar / Indicator Engine: COMPLETE** (see below).
- **✅ Jotai migration — COMPLETE** (all 11 stores converted to atoms, Zustand removed).

## Completed — Phase 5 (Left Toolbar / Indicator Engine)

1. Full 17+ tool TradingView left toolbar with 9 visual groups and separators.
2. Indicator settings dialogs with parameter customization (SMA/EMA length, RSI period, etc.).
3. Indicator style customization (colors, line width, overlay vs. pane).
4. Hotkey system for drawing tools and indicators (1–9 switch tools, Delete, Ctrl+D, Ctrl+A, Ctrl+I, etc.).

---

## Next milestone - Phase 6

Detailed code plan: `docs/PHASE6_IMPLEMENTATION_PLAN.md`.

- **Phase 6A - Push Notifications:** Firebase Cloud Messaging as the next alert delivery channel,
  including closed-browser delivery through `npm run push-worker`. Implemented in
  `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.
- **Phase 6A extension - Telegram/Discord Alert Channels:** server-side external message delivery
  for browser-open and closed-browser alerts. Implemented in
  `docs/PHASE6A_TELEGRAM_DISCORD_PLAN.md`.
- **Phase 6B - MT5 Bridge Integration:** protocol types, WebSocket client, store/runtime hook, mock
  bridge, execution-mode UI, order routing, positions/logs, simulator fallback, and authenticated
  per-user **Save & Verify MT5** are implemented. MT5 selection is unlocked from the current user's
  backend `verified` state; every live command also requires the bridge account login/server to
  match. FTMO dry-run bridge is available via `npm run ftmo-mt5-bridge`; the Python MT5 adapter is
  under `backend/bridge/ftmo_mt5/`. Next: validate Verify success/failure and account isolation on a
  Windows/VPS demo terminal, then exercise snapshots, `order_check`, and tiny demo execution. For
  Exness, IC Markets, and other MT5 brokers, use
  `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md`.

---

## Later phases (from PHASE3_11_PLAN.md)

- **Phase 6 - Push Notifications + MT5 Integration:** see `docs/PHASE6_IMPLEMENTATION_PLAN.md`.
- **Phase 8 — Trading Panel:** TradingView-style order panel.
- **Phase 9 — Position Visualization:** interactive entry/SL/TP lines.
- **Phase 10 — Polish & Optimization:** performance, memory, mobile, accessibility.
