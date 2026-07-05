# PROJECT ARCHITECTURE

_Last updated 2026-07-03. Canonical high-level subsystem architecture._

For lower-level render/data-flow details, see `docs/ARCHITECTURE.md`. For the current handoff and
next action, see `docs/HANDOFF.md` and `docs/CURRENT_STATE.md`.

## 1. Application Shape

The project is a TradingView-style web terminal built on Next.js App Router, React 19, TypeScript,
Tailwind, Jotai, and Lightweight Charts.

The primary terminal experience is browser-rendered. Server routes are now also used for Firebase
push notification dispatch and closed-browser push alert evaluation.

Top-level areas:

```text
src/app          Next routes, layout, Firebase service worker route, push APIs
src/components   chart, alerts, toolbar, trade, layout, pine, notifications
src/hooks        runtime loops and feature hooks
src/services     market data, alert engine, notifications, trade engine
src/server       server-only Firebase/push-alert worker helpers
src/store        Jotai atom modules
src/types        shared domain types
src/workers      browser Web Workers
scripts          local operational scripts such as push-alert worker
docs             architecture, plans, handoff, audits
```

## 2. State Management

State is managed with Jotai atoms. Zustand has been removed.

Major atom modules:

- `uiStore`
- `chartStore`
- `marketDataStore`
- `watchlistStore`
- `alertStore`
- `notificationStore`
- `tradeStore`
- `journalStore`
- `analyticsStore`
- `replayStore`
- `smcStore`
- `toastStore`

Pattern:

- Primitive atoms hold focused state slices.
- Write atoms hold mutations/actions.
- Some stores expose compatibility hooks for older call sites.
- Runtime code should prefer `useSetAtom(writeAtom)` for effect dependencies because compatibility
  hooks can create unstable function references.

## 3. Market Data Architecture

The mock-data architecture has been replaced by live market-data providers.

```text
Provider
  -> MarketDataService
  -> marketDataStore
  -> hooks/useMarketData and read-only market hooks
  -> chartStore candle mirror
  -> useVisibleCandles()
  -> chart, replay, SMC, indicators, trade simulator
```

Provider responsibilities:

- Binance provider streams crypto with no API key.
- OANDA provider handles forex/metals/indices when configured.
- TwelveData remains a keyed fallback/extension path.
- Providers normalize quotes/candles into shared market-data types.
- Subscriptions are reference-counted so watchlist, chart, and alerts can share symbols.

Rules:

- Hooks do not open their own sockets.
- One socket per provider class, not one socket per symbol.
- Reconnect/resubscribe behavior belongs in providers/service layer.
- `marketDataStore` is the realtime source of truth; `chartStore` keeps chart UI selection and a
  candle mirror for existing chart consumers.

## 4. Chart And Rendering Architecture

Lightweight Charts renders the main candle chart and built-in series. Custom TradingView-like
features render through DOM/canvas layers projected from chart coordinates.

Main chart overlays:

- SMC layer.
- Drawing layer.
- Alert overlay.
- Replay selection layer.
- Trade/position levels.

Indicator rendering is split between built-in calculations and source-code indicators:

- `services/indicators.ts` owns the shared `computeIndicator()` dispatch and built-ins.
- `services/pineScript.ts` parses the safe Pine-like subset for `CUSTOM` indicators.
- `components/pine/PineEditor.tsx` is mounted as a bottom-panel tab with embedded script storage.
- `docs/INDICATOR_ARCHITECTURE.md` is the subsystem reference.

The chart context exposes coordinate conversion and a render version so overlays repaint when the
viewport changes.

Drawing tools are plugin-oriented:

- Trend line suite.
- Shape suite.
- Fibonacci retracement/extension.
- Long/short position tool.
- Floating drawing settings toolbar.
- Object settings dialogs and style templates.

## 5. Alert Architecture

Alert evaluation is complete and isolated from notification delivery.

```text
marketDataStore price updates
  -> useAlertEngine
  -> services/alertEngine.ts
  -> alertStore.triggerAlert
  -> services/notifications/notify.ts
  -> toast / sound / browser notification / Firebase push
```

Implemented alert features:

- Above/below/crossUp/crossDown.
- Once-only and recurring alerts.
- Alert Center with active, triggered, and history lists.
- Interactive chart alert lines.
- Toast, sound, browser, and Firebase push delivery.
- Server-side push alert sync and evaluator for closed-browser notifications.

Closed-browser push architecture:

```text
Browser syncs token + push-enabled alerts
  -> /api/push/register
  -> /api/push/alerts/sync
  -> src/server/pushAlertStore.ts
  -> npm run push-worker or external cron
  -> /api/push/evaluate
  -> Firebase Admin FCM
```

Docs:

- `docs/ALERT_ARCHITECTURE.md`
- `docs/PHASE6A_PUSH_NOTIFICATIONS.md`

## 6. Trading Architecture

The implemented trading system is a simulator.

```text
visible candle
  -> useTradeRuntime
  -> tradeStore
  -> services/tradeEngine.ts
  -> positions/equity/journal
```

Simulator responsibilities:

- Market/limit/stop placement.
- Pending order trigger checks.
- SL/TP exits.
- Risk sizing.
- Realized/unrealized PnL.
- R-multiple.
- Auto-journal of closed trades.

UI:

- `OrderTicket`
- `PositionsTable`
- `RiskPanel`
- `TradePanel`
- `TradeLevels`

MT5 live execution scaffold is implemented as a separate feature-flagged execution mode, not by
replacing simulator internals.

Docs:

- `docs/PHASE6B_MT5_BRIDGE_PLAN.md`
- `docs/MT5_BRIDGE_PROTOCOL.md`

## 7. Phase 6B Target Architecture

MT5 topology:

```text
Browser client
  -> WebSocket JSON protocol
  -> MT5 Bridge Service
  -> MT5 terminal / broker account
```

Browser responsibilities:

- Execution mode UI.
- WebSocket bridge client.
- Account/position/order state display.
- Live command confirmation.
- Risk guards and diagnostics.

Bridge responsibilities:

- Broker credentials and MT5 login.
- Symbol metadata.
- Order placement/modification/close.
- Account and position snapshots.
- Execution report mapping.

The simulator remains default and functional when MT5 is disabled.

The browser-to-bridge protocol is documented in `docs/MT5_BRIDGE_PROTOCOL.md`. The first
implementation pass added typed protocol guards, a dependency-free mock bridge, a feature-flagged
WebSocket client, MT5 store/runtime, execution-mode UI, order confirmation, MT5 positions table,
command log, and MT5 chart levels.

## 8. Persistence

Browser-side:

- localStorage for settings, drawings, alerts, templates, and lightweight state.
- IndexedDB for journal entries and screenshots.

Server-side:

- Firestore collection `pushAlertDevices` stores synced push tokens and push-enabled alert snapshots
  for the closed-browser push worker in production/serverless deployments.
- `.data/push-alerts.json` is only a local fallback when Firebase Admin is not configured.

## 9. Operational Commands

Core checks:

```bash
npm run typecheck
npm run lint
npm run build
```

Runtime:

```bash
npm run dev
npm run start
npm run push-worker
```

Closed-browser push requires the Next server and either `npm run push-worker` or an external cron
calling `/api/push/evaluate`.

## 10. Technology Stack

- Next.js 16
- React 19
- TypeScript 5.7 strict mode
- Jotai
- Lightweight Charts 4.2.3
- React Query
- Tailwind CSS
- Firebase / Firebase Admin for push notifications
- IndexedDB via `idb`
- Web Workers for compute-heavy browser work

`framer-motion` remains present but should be treated cautiously; see `docs/KNOWN_ISSUES.md`.
