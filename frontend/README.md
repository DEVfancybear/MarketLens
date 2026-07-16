# SMC Trading Terminal - Frontend

TradingView-style web terminal focused on Smart Money Concept backtesting, replay, chart drawing,
Pine-like indicators, alerting, simulated trading, journaling, and analytics.

## Current Stack

- Next.js 16 App Router, React 19, TypeScript strict mode
- TailwindCSS, CSS variables, lucide-react
- Jotai atoms for app/runtime state
- TanStack Query for async app infrastructure where needed
- TradingView Lightweight Charts 4.2.3
- `ky` for backend API calls
- Firebase client SDK for Google sign-in and browser/push notification support
- IndexedDB and localStorage for anonymous/local persistence
- Native Web Workers for SMC compute

## Runtime Shape

The frontend is a browser-only terminal mounted from `src/components/Terminal.tsx`. Runtime loops
live under `src/components/layout/GlobalRuntime.tsx` and wire market data, replay playback, alerts,
SMC computation, MT5 bridge state, auth session exchange, and local hydration.

Market data is live-provider based:

- Binance for crypto symbols
- OANDA / FXCM / IC Markets / TwelveData provider modules for supported FX/CFD symbols
- `services/market-data/candleSeries.ts` normalizes, merges, upserts, repairs short candle gaps, and
  detects an MT5 refresh page disconnected from a stale cached tail
- `store/marketDataStore.ts` merges ordinary history/pagination pages but also supports an
  authoritative replacement used to discard a stale MT5 first-paint window after rates warm

The old seeded mock `services/marketData.ts` path is no longer the active market-data model.

## Local Development

```bash
npm install
npm run dev
# open http://localhost:3000
```

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
```

Focused tests live under `frontend/tests/` and compile to `.test-build/`:

```bash
npm run test:chart
npm run test:watchlist
npm run test:position
npm run test:trade
npm run test:drawing
npm run test:ui
```

## Environment

Next runs from the `frontend/` directory. Copy `.env.example` to `.env.local`. On PowerShell:

```powershell
Copy-Item .env.example .env.local
```

For local convenience, `next.config.mjs` also fills missing values from the repository root
`.env.local` / `.env`, but `frontend/.env.local` is the canonical frontend configuration.

Required for Google login:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_VAPID_KEY=...
```

Backend API:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

In development this defaults to `http://localhost:8080`. Production deployments must set it
explicitly.

FCM delivery and closed-browser evaluation run in the Next server and require server-only values:

```env
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=... # PEM with escaped \n newlines
PUSH_WORKER_SECRET=...
PUSH_WORKER_INTERVAL_MS=15000
DISABLE_PUSH_WORKER=true
```

Never prefix Firebase Admin credentials with `NEXT_PUBLIC_`. The Go API uses Admin credentials in
`backend/.env` for authentication, while Next uses them to send FCM. Go stores Phase 10 alert and
device-token ownership data and schedules the Next evaluator via `ALERT_EVALUATOR_*`. See
`.env.example` for all optional quote-provider, external-notification, and MT5 values.

## Project Structure

```text
src/
  app/                 Next App Router shell, providers, route handlers
  components/
    layout/            terminal shell, panes, bottom panel, global runtime
    chart/             price chart, indicator panes, drawing layer, time toolbar
    toolbar/           top toolbar, indicators, interval selector, drawing menus
    watchlist/         watchlist UI, sections, drag/drop
    replay/            bar replay controls, overlays, dashboards
    trade/             order ticket, positions, risk panel
    journal/           journal and screenshot workflows
    analytics/         analytics views
    pine/              Pine editor
    ui/                shared UI primitives
  hooks/               runtime hooks and chart/replay integrations
  services/
    api/               shared ky client and backend resource modules
    auth/              Firebase auth wrapper and backend auth compatibility API
    firebase/          Firebase app/messaging bootstrap
    market-data/       market data service, candle repair, providers
    notifications/     toast/sound/browser/push/external notification dispatch
    smc/               SMC engines
  store/               Jotai atom modules
  types/               shared domain types
  utils/               formatting, ids, math, event helpers
  workers/             SMC worker
tests/                 focused TypeScript tests
```

## Backend Integration

The frontend signs in with Firebase Google Auth, then exchanges the Firebase ID token with the Go
Fiber backend at `/api/v1/auth/google`. Backend session cookies are httpOnly and sent through the
shared `ky` client with `credentials: "include"`.

Remote workspace sync is staged. Auth, settings, and sync bootstrap endpoints exist on the backend;
watchlists, drawings, Pine scripts, indicators, alerts, journal, layouts, and sim-trading persistence
should move slice by slice through `src/services/api/resources/*` and DTO adapters.

See:

- `docs/AUTH_UI.md`
- `docs/BACKEND_API_SYNC_ARCHITECTURE.md`
- `docs/ARCHITECTURE.md`
- `docs/MT5_POSITION_SIZING.md`
