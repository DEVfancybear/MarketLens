# CURRENT STATE

_Last updated 2026-07-02 after adding the Phase 6B MT5 bridge protocol contract._

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

MT5 remains disabled unless `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=true`; simulator mode remains default.

## 7. Phase Status

- Phase 1 realtime market data: complete.
- Phase 2 alert engine: complete.
- OANDA integration: complete.
- Phase 3 TradingView UI parity: complete enough for current roadmap.
- Phase 4 drawing engine/tool suites: complete for current line/shape/fib/position tooling.
- Phase 5 left toolbar / indicator engine: complete.
- Phase 6A Firebase push notifications: complete, including closed-browser worker mode.
- Phase 6A Telegram/Discord alert channels: complete.
- Phase 6B MT5 bridge: feature-flagged scaffold implemented; real broker/demo validation still
  pending.

## 8. Current Next Action

Continue Phase 6B implementation from:

- `docs/PHASE6B_MT5_BRIDGE_PLAN.md`
- `docs/PHASE6_IMPLEMENTATION_PLAN.md`

The next recommended milestone is hardening and demo validation:

1. Run `npm run mock-mt5` and enable `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=true` locally.
2. Exercise connect/auth/reconnect, order ack/reject, execution reports, close, and close-all.
3. Add SL/TP modify UI if needed for live position management.
4. Implement `docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md` for FTMO-specific bridge-side credentials,
   risk guards, dry-run validation, and demo execution.
5. Connect a real MT5 demo bridge and validate symbol mapping, lot step, precision, and rejects.

## 9. Known Operational Notes

- Firestore collection `pushAlertDevices` is the production/serverless store for push alert sync.
- `.data/push-alerts.json` is only a local fallback when Firebase Admin is not configured and should
  not be committed if created locally.
- Firebase Admin values must stay server-only and must not use `NEXT_PUBLIC_*`.
- MT5 credentials must remain in the bridge service, never in browser code.
- Phase 6B must keep simulator mode as the default and leave it functional when MT5 is disabled.
