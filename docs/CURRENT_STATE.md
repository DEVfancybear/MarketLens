# CURRENT STATE

_Post-monorepo update 2026-07-07._

This file intentionally preserves the pre-`9691bd1` project state below. Since the monorepo split:

- Frontend runtime code is under `frontend/`.
- Frontend feature docs referenced below as `docs/*.md` have been restored under `frontend/docs/`
  unless they are cross-project memory docs.
- Historical/audit frontend reports are under `frontend/docs/archive/`.
- Backend code is under `backend/`; Fiber is the current framework. Backend Phases 0-6 are complete:
  Fiber, database/auth foundations, Firebase verification, sessions, `/api/v1/auth/*` routes,
  `/api/v1/settings`, `/api/v1/sync/bootstrap`, watchlist persistence, and local MT5 tick
  streaming.
- The Python FTMO/MT5 bridge now lives under `backend/bridge/ftmo_mt5/`. The market-data-only MT5
  tick stream sidecar lives under `backend/bridge/mt5_stream/`, with a Go consumer at
  `backend/cmd/mt5-stream`.
- Backend auth, database, API, and phased implementation docs live under `backend/docs/`.
- Frontend Google auth UI exists and uses Firebase Auth; backend session exchange targets the
  implemented `/api/v1/auth/*` routes. In local development the frontend API client defaults to
  `http://localhost:8080`; production should set `NEXT_PUBLIC_API_BASE_URL`.
- Frontend remote workspace sync is planned in
  `frontend/docs/BACKEND_API_SYNC_ARCHITECTURE.md`. Backend settings/bootstrap/watchlists now exist;
  remaining workspace slices are Phase 7+ and authenticated persistence should stay feature-flagged
  until each resource endpoint ships.
- Frontend now consumes `GET /api/v1/sync/bootstrap` after backend auth and applies server UI
  settings, SMC settings, notification defaults, and watchlists into Jotai atoms. Watchlist
  list/symbol/section/reorder/active-list mutations now call backend Phase 6 APIs in authenticated
  mode; browser localStorage is no longer a watchlist source of truth. Settings write-back and
  future workspace resources are still pending.
- Watchlist UI/store received a TradingView-style menu, rename mode, section rows, symbol
  drag/drop, and draggable section divider rows; see `frontend/docs/WATCHLIST_ARCHITECTURE.md`.
- Backend MT5 streaming is local-only: run `python -m bridge.mt5_stream.mt5_server` from
  `backend/`, then `go run ./cmd/mt5-stream` to consume `ws://localhost:8765`. The Go API also
  connects to that bridge and exposes `GET /api/v1/mt5/symbols`, `GET /api/v1/mt5/ticks`, and
  on-demand `GET /api/v1/mt5/history` for frontend chart/watchlist data.
- Frontend MT5 market data now loads the full symbol catalog into the runtime registry for search
  and metadata while watchlists stay server-owned. Charts load history from the backend and update
  forming candles from backend MT5 ticks. The Go backend single-flights duplicate history requests,
  serves cached latest windows immediately, and refreshes stale rates in the background so timeframe
  changes do not wait behind old MT5 bridge work. It no longer calls third-party market-data APIs
  for MT5 symbols.

_Last updated 2026-07-02 after adding the FTMO MT5 dry-run bridge._

This file replaces the old Phase 1 mock-data audit. The app is now a live-data, Jotai-based
TradingView-style terminal with alerting, drawing tools, simulator trading, Firebase push, and a
feature-flagged MT5 bridge scaffold.

Validation most recently run:

```bash
npm run typecheck
npm run lint
npm run build
```

All passed during Phase 6A closed-browser push implementation.

## 1. Runtime

- Next.js App Router SPA; the terminal UI is mounted as a browser-only client experience.
- React 19, TypeScript strict mode, Tailwind, Lightweight Charts 4.2.3.
- State management is Jotai atoms. Zustand has been removed.
- Persistence uses localStorage for lightweight settings and IndexedDB for journal screenshots/data.
- Global loops mount from `src/components/layout/GlobalRuntime.tsx`.

## 2. Market Data

Realtime market data is implemented. The old mock `services/marketData.ts` path is gone.

Current flow:

```text
market-data provider
  -> MarketDataService
  -> marketDataStore
  -> chartStore bridge/useMarketData
  -> useVisibleCandles()
  -> chart, indicators, SMC, replay, trade runtime
```

Providers:

- Binance provider for crypto symbols with no API key.
- OANDA provider for forex/metals/indices when `NEXT_PUBLIC_OANDA_API_KEY` and
  `NEXT_PUBLIC_OANDA_ACCOUNT_ID` are configured.
- TwelveData fallback/extension path where configured.

The provider architecture uses one socket per provider, not one socket per symbol, with reconnect
and resubscribe handling.

## 3. State Stores

The project uses atom modules under `src/store/`:

- `uiStore`
- `chartStore`
- `replayStore`
- `smcStore`
- `tradeStore`
- `journalStore`
- `analyticsStore`
- `watchlistStore`
- `alertStore`
- `marketDataStore`
- `toastStore`
- `notificationStore`

Each store exposes focused atoms and, where needed, a compatibility hook such as `useAlertStore()`
or `useTradeStore()`.

Important caution: compatibility hooks that return action functions can create unstable references.
Inside effects, prefer `useSetAtom(writeAtom)` for actions.

## 4. Chart And Tools

The chart uses Lightweight Charts with canvas overlays for custom UI:

- SMC overlays.
- Drawing layer.
- Replay selection layer.
- Alert overlay.
- Trade levels and position visualization.

Drawing/tool status:

- Trend line suite, grouped toolbar, shape tools, Fibonacci tools, long/short position tools, and
  object settings/templates are implemented.
- Long/short position settings have TradingView-like Inputs/Style/Visibility dialogs.
- Position rendering is clipped above the volume pane to avoid SL/TP fills covering volume.

## 5. Alerts

Phase 2 alert engine is complete.

Implemented:

- Price above/below/crossUp/crossDown evaluation.
- Once-only and recurring alerts.
- Active, triggered, and history lists.
- Toast, sound, browser notification, and Firebase push channels.
- Telegram and Discord external alert channels.
- Interactive chart alerts with select, drag-to-reprice, edit, delete, context menu, and lock/enable
  flags.
- Closed-browser push delivery through server-side sync and worker evaluation.

Push architecture:

```text
browser alert store + FCM token
  -> /api/push/register + /api/push/alerts/sync
  -> Firestore pushAlertDevices collection (or local .data fallback)
  -> npm run push-worker
  -> /api/push/evaluate
  -> Firebase Admin FCM send
```

Closed-browser push requires a running Next server plus `npm run push-worker` or an external cron
calling `/api/push/evaluate`.

Docs:

- `docs/ALERT_ARCHITECTURE.md`
- `docs/PHASE6A_PUSH_NOTIFICATIONS.md`
- `docs/PHASE6A_TELEGRAM_DISCORD_PLAN.md`

## 6. Trading

Simulator trading is implemented and remains the default execution mode.

Implemented:

- `tradeStore` stores simulator equity, positions, latest trade price/time, and actions.
- `services/tradeEngine.ts` handles risk sizing, pending trigger checks, SL/TP exits, realized and
  unrealized PnL, and R-multiple calculations.
- `useTradeRuntime` feeds visible candles into the simulator.
- Closed simulator trades auto-journal into IndexedDB.
- UI includes `OrderTicket`, `PositionsTable`, `RiskPanel`, `TradePanel`, and `TradeLevels`.

MT5 live execution scaffold is implemented behind a disabled-by-default feature flag:

- `docs/MT5_BRIDGE_PROTOCOL.md`
- `docs/PHASE6B_MT5_BRIDGE_PLAN.md`
- `docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md`
- `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md`

Implemented:

- `src/types/mt5.ts`
- `src/services/mt5/protocol.ts`
- `src/services/mt5/Mt5BridgeClient.ts`
- `src/services/mt5/runtime.ts`
- `src/services/mt5/symbolMapping.ts`
- `src/store/mt5Store.ts`
- `src/hooks/useMt5Bridge.ts`
- `src/components/trade/ExecutionModeSwitch.tsx`
- `src/components/trade/Mt5ConnectionPanel.tsx`
- `src/components/trade/Mt5CommandLog.tsx`
- `src/components/trade/LiveOrderConfirmDialog.tsx`
- `scripts/mock-mt5-bridge.mjs`
- `scripts/ftmo-mt5-bridge.mjs`
- `bridge/ftmo_mt5/`

MT5 remains disabled unless `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=true`; simulator mode remains default.
FTMO bridge execution is currently dry-run only. It validates and audits web order intents, then
simulates bridge-confirmed fills back to the web app. Real FTMO execution is blocked until a real
MT5 adapter is implemented and demo-validated.
The Python service contains the real MT5 adapter path, but it still requires validation on a
Windows host with Python, the `MetaTrader5` package, and the FTMO MT5 terminal installed.

## 7. Phase Status

- Phase 1 realtime market data: complete.
- Phase 2 alert engine: complete.
- OANDA integration: complete.
- Phase 3 TradingView UI parity: complete enough for current roadmap.
- Phase 4 drawing engine/tool suites: complete for current line/shape/fib/position tooling.
- Phase 5 left toolbar / indicator engine: complete.
- Phase 6A Firebase push notifications: complete, including closed-browser worker mode.
- Phase 6A Telegram/Discord alert channels: complete.
- Phase 6B MT5 bridge: feature-flagged scaffold implemented; FTMO dry-run bridge implemented;
  Python MT5 adapter code added; broker/demo validation still pending.

## 8. Current Next Action

Continue Phase 6B implementation from:

- `docs/PHASE6B_MT5_BRIDGE_PLAN.md`
- `docs/PHASE6_IMPLEMENTATION_PLAN.md`

The next recommended milestone is hardening and demo validation:

1. Run `npm run mock-mt5` and enable `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=true` locally.
2. Exercise connect/auth/reconnect, order ack/reject, execution reports, close, and close-all.
3. Add SL/TP modify UI if needed for live position management.
4. Run `bridge/ftmo_mt5/` on Windows/VPS with MT5 terminal installed, validate terminal login,
   account snapshots, symbol metadata, MT5 `order_check`, then tiny demo execution.
5. Implement `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md` for Exness/IC Markets/other
   broker profiles, symbol discovery, lot sizing, dry-run validation, and demo execution.
6. Connect a real MT5 demo bridge and validate symbol mapping, lot step, precision, and rejects.

## 9. Known Operational Notes

- Firestore collection `pushAlertDevices` is the production/serverless store for push alert sync.
- `.data/push-alerts.json` is only a local fallback when Firebase Admin is not configured and should
  not be committed if created locally.
- Firebase Admin values must stay server-only and must not use `NEXT_PUBLIC_*`.
- MT5 credentials must remain in the bridge service, never in browser code.
- Phase 6B must keep simulator mode as the default and leave it functional when MT5 is disabled.
