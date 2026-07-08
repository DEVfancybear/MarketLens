# NEXT TASKS

_Post-monorepo update 2026-07-06._

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
- **Phase 6B - MT5 Bridge Integration:** feature-flagged scaffold implemented: MT5 protocol types,
  WebSocket client, store/runtime hook, mock bridge, execution-mode UI, order routing, MT5
  positions/logs, and simulator fallback. FTMO dry-run bridge is implemented via
  `npm run ftmo-mt5-bridge`; Python MT5 service adapter is implemented under `bridge/ftmo_mt5/` and
  can be started with `npm run ftmo-mt5-python` after installing Python dependencies. Next: run it
  on a Windows/VPS host with MT5 installed, validate login/snapshots/order_check, then tiny demo
  execution. For Exness, IC Markets, and other MT5 brokers, use
  `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md`.

---

## Later phases (from PHASE3_11_PLAN.md)

- **Phase 6 - Push Notifications + MT5 Integration:** see `docs/PHASE6_IMPLEMENTATION_PLAN.md`.
- **Phase 8 — Trading Panel:** TradingView-style order panel.
- **Phase 9 — Position Visualization:** interactive entry/SL/TP lines.
- **Phase 10 — Polish & Optimization:** performance, memory, mobile, accessibility.
