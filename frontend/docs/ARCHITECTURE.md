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
| `replayClientStore` | read-only backend Replay snapshot, revealed bars, connection/error state |
| `replayTradingClientStore` | isolated backend Replay account/order/fill/position projection |
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
  -> useChartSeries() (live candles or server-revealed Replay bars)
  -> PriceChart / indicators / SMC
```

`services/market-data/candleSeries.ts` owns candle normalization, merge, realtime upsert, and short
gap detection. This is the common path that prevents WebSocket/history races from dropping candles
until a hard refresh.

Historical first paint is progressive. `services/market-data/historyPolicy.ts` is the single source
of truth for initial/page sizes and MT5 refresh cadence:

| Timeframe | Initial/page bars | Active MT5 refresh |
| --- | ---: | ---: |
| `1m`, `3m`, `5m` | 900 / 1000 | 3s |
| `15m` | 900 / 1000 | 5s |
| `30m` | 720 / 720 | 5s |
| `1H` | 600 / 600 | 15s |
| `2H` | 500 / 500 | 15s |
| `4H` | 400 / 400 | 30s |
| `1D` | 300 / 300 | 60s |
| `1W` | 100 / 260 | 5m |
| `1M` | 60 / 60 | 5m |

`marketDataStore` retains candles per `symbol:timeframe`. `useMarketData()` paints an existing
timeframe cache synchronously and revalidates it in the background, so switching back does not show
the loading overlay or blank a valid chart. A failed revalidation keeps the cached series. Cold
loads request only the policy's initial window; panning left requests another page with
`before=<first candle time>`. MT5 refresh timers run only while the document is visible.

Symbol/timeframe effects pass an `AbortSignal` through `HistoricalDataService` to the Go API. A
selection change cancels obsolete work end-to-end; the active selection must not wait behind queued
history requests for frames the user has already left.
The initial request is deferred by 75ms so React development Strict Mode probes and rapid toolbar
clicks are collapsed before any HTTP work begins.

`PriceChart` uses incremental Lightweight Charts updates only for true latest-bar updates/appends.
History reloads, replay window replacements, symbol/timeframe changes, and non-incremental data
changes must use full `setData()`.

## Replay Safety

`useChartSeries()` is the candle source for chart renderers, indicators, and SMC. During Replay it
returns only bars revealed by the backend session; the browser does not slice full history or own a
cursor. The normal simulator continues to read live candles and is paused from market feeding while
the isolated Replay ledger is active. See `REPLAY_ARCHITECTURE.md`.

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

Current local persistence is the anonymous/cache layer for not-yet-migrated workspace slices.
An initial anonymous/offline load rehydrates that cache so drawing preferences survive a browser
reload; when auth resolves to `anonymous` after an authenticated sign-out, user-scoped atoms are
reset to defaults and their old local cache keys are cleared so the signed-out screen does not
display the previous user's workspace.

- localStorage: anonymous/cache fallback for `ui`, `drawings:<symbol>`, `indicators`,
  `pineScripts`, `drawingTemplates`, legacy `watchlist`, `smc-settings`, `alerts`,
  `pushNotifications`, chart/timezone preferences, interval favorites, and drawing tool favorites.
- IndexedDB: journal entries and screenshots through `services/storage.ts`.
- Backend: auth/session, settings, sync bootstrap, Phase 6 watchlists, MT5 data APIs, Phase 7
  drawings/drawing templates/drawing tool favorites, Phase 8 indicator presets, and Phase 9 Pine
  scripts are live;
  remaining authenticated workspace persistence is pending per resource.

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
