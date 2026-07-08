# Frontend Architecture

This is the active architecture note for the Next.js frontend after the monorepo split. Historical
milestones, audits, and old implementation reports are kept under `archive/`; do not treat archived
phase notes as the current source of truth.

## Runtime Stack

| Concern | Current choice |
| --- | --- |
| Framework | Next.js 16 App Router |
| UI | React 19 |
| Language | TypeScript strict mode |
| State | Jotai atoms |
| Backend HTTP | `ky` shared API client |
| Auth | Firebase Google Auth plus Go Fiber session exchange |
| Charts | TradingView Lightweight Charts 4.2.3 |
| Styling | TailwindCSS and CSS variables |
| Workers | Native Web Worker for SMC compute |
| Persistence | localStorage for anonymous/lightweight state, IndexedDB for journal/screenshots |

The frontend is a browser-only terminal mounted from `src/components/Terminal.tsx`. App-wide runtime
loops mount once from `src/components/layout/GlobalRuntime.tsx`.

## Directory Map

```text
src/
  app/                 Next shell, providers, route handlers, service-worker route
  components/
    layout/            terminal shell, panes, bottom panel, global runtime
    chart/             price chart, indicator panes, drawing layer, time toolbar
    toolbar/           top toolbar, interval selector, indicators, drawing menus
    watchlist/         TradingView-style watchlist, sections, drag/drop
    replay/            bar replay controls, overlays, dashboards
    trade/             order ticket, positions, risk panel
    journal/           journal and screenshot workflows
    analytics/         analytics views
    pine/              Pine editor
    ui/                shared UI primitives
  hooks/               runtime hooks and chart/replay integrations
  services/
    api/               ky client, error normalization, backend resource modules
    auth/              Firebase auth wrapper and auth API compatibility exports
    firebase/          Firebase app and messaging bootstrap
    market-data/       market data service, candle repair, providers
    notifications/     toast, sound, browser, push, external dispatch
    smc/               SMC engines
  store/               Jotai atom modules
  types/               shared domain types
  utils/               formatting, ids, math, event helpers
  workers/             SMC worker
tests/                 focused TypeScript tests
```

## State Model

Each store module exports state atoms, write atoms, and, where needed, a compatibility hook for old
selector-style callers. Prefer `useAtomValue()` for reads and `useSetAtom()` for actions in new code.

Important atom modules:

| Module | Owns |
| --- | --- |
| `authStore` | Firebase identity, auth status/error, backend session flag |
| `uiStore` | theme, panels, bottom tab, bottom/right pane visibility, logs |
| `chartStore` | symbol/timeframe mirror, drawings, indicators, Pine scripts, editor state, selection |
| `marketDataStore` | live quotes/candles, selected market, provider subscriptions, connection status |
| `watchlistStore` | watchlist lists, active list, sections, symbol order, sorting |
| `alertStore` | alerts, triggered alerts, history, alert settings, selected/editing alert |
| `notificationStore` | Firebase push registration and permission state |
| `replayStore` | bar replay cursor, selection, playback, speed, anchor |
| `tradeStore` | simulator positions, order prefill, equity, latest trade market |
| `mt5Store` | MT5 bridge config, status, account snapshot, orders, symbol info, command log |
| `smcStore` | SMC settings and current computed snapshot |
| `journalStore` | journal entries and screenshot attachments |
| `toastStore` | transient in-app notifications |

## Market Data And Chart Flow

Market data is live-provider based, not the old seeded mock service.

```text
MarketDataService
  -> provider modules (Binance, OANDA, FXCM, IC Markets, TwelveData)
  -> marketDataStore
  -> useMarketData()
  -> chartStore.candlesAtom
  -> useVisibleCandles()
  -> PriceChart / indicators / SMC / replay / trade runtime
```

`services/market-data/candleSeries.ts` owns candle normalization, merge, realtime upsert, and short
gap detection. This is the common path that prevents WebSocket/history races from dropping candles
until a hard refresh.

`PriceChart` uses incremental Lightweight Charts updates only for true latest-bar updates/appends.
History reloads, replay window replacements, symbol/timeframe changes, and non-incremental data
changes must use full `setData()`.

## Replay Safety

`useVisibleCandles()` is the only candle source chart renderers, indicators, SMC, and trade runtime
should consume. When replay is active it returns `candles[0..cursor]`; future bars do not exist to
downstream engines. See `REPLAY_ARCHITECTURE.md` for replay viewport and jump behavior.

## Backend And Auth Flow

```text
SignInButton
  -> Firebase Google popup
  -> useAuthSession()
  -> ky client
  -> Go Fiber /api/v1/auth/*
  -> backendSessionAtom
```

Backend API calls must go through `src/services/api/client.ts` and resource modules under
`src/services/api/resources/`. Do not add raw `fetch()` calls for backend resources.

Local development defaults the API base to `http://localhost:8080`; production must set
`NEXT_PUBLIC_API_BASE_URL`. The frontend reads env from `frontend/.env.local` and also fills missing
values from root `.env.local` / `.env` for local monorepo convenience.

Remote workspace sync is staged. Auth, settings, and sync bootstrap exist on the backend; remaining
workspace slices should move behind typed DTO adapters one at a time. See
`BACKEND_API_SYNC_ARCHITECTURE.md`.

## Persistence

Current local persistence is still used for anonymous mode and not-yet-migrated workspace slices:

- localStorage: anonymous/cache fallback for `ui`, `drawings:<symbol>`, `indicators`,
  `pineScripts`, `drawingTemplates`, legacy `watchlist`, `smc-settings`, `alerts`,
  `pushNotifications`, chart/timezone preferences, interval favorites, and drawing tool favorites.
- IndexedDB: journal entries and screenshots through `services/storage.ts`.
- Backend: auth/session, settings, sync bootstrap, Phase 6 watchlists, MT5 data APIs, and Phase 7
  drawings/drawing templates/drawing tool favorites are live; remaining authenticated workspace
  persistence is pending per resource.

## Rendering And Overlays

The chart renders candles and native price lines through Lightweight Charts. Drawing, SMC, alert,
position, replay, and Pine/dashboard overlays project domain coordinates into pixels from the active
chart context. Store time/price/domain coordinates, never persisted pixels.

Viewport invalidation is shared through the chart context/version and helper utilities documented in
`ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md`.

## Runtime Loops

Mounted from `GlobalRuntime`:

- market-data bootstrap and active symbol subscriptions
- replay playback clock
- hotkeys
- SMC worker bridge
- trade runtime
- alert engine
- Firebase/backend auth session bridge
- push notification registration reconciliation
- MT5 bridge runtime when enabled
- local store hydration

## Focused Docs

- `AUTH_UI.md`
- `BACKEND_API_SYNC_ARCHITECTURE.md`
- `CHART_VISUAL_PROFILE.md`
- `CHART_TIME_NAVIGATION_ARCHITECTURE.md`
- `DRAWING_ENGINE_ARCHITECTURE.md`
- `INDICATOR_ARCHITECTURE.md`
- `REPLAY_ARCHITECTURE.md`
- `SETTTING_ARCHITECTURE.md`
- `WATCHLIST_ARCHITECTURE.md`
- `ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md`
