# Backend API Sync Architecture

This document describes how the frontend should move from browser-owned
localStorage/IndexedDB persistence to backend-owned JSON resources.

The goal is not only "call an API". The goal is a clear source-of-truth boundary:

- The Go Fiber backend owns persisted user workspace data.
- The frontend owns live runtime state, rendering, optimistic UI, and temporary drafts.
- Browser storage is not the source of truth for authenticated users.

## Current Backend Readiness

Read these backend docs first:

- `../../backend/docs/API.md`
- `../../backend/docs/DATABASE.md`
- `../../backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`
- `../../backend/docs/AUTH.md`

Current backend code has:

- Fiber server in `backend/internal/httpserver/server.go`.
- `/health` and `/health/ready`.
- Google auth/session API: `/api/v1/auth/google`, `/api/v1/auth/me`, `/api/v1/auth/refresh`,
  `/api/v1/auth/logout`, `/api/v1/auth/sessions`.
- Settings API: `GET/PUT/PATCH /api/v1/settings`.
- Sync bootstrap: `GET /api/v1/sync/bootstrap`.

Current backend API status from `backend/docs/API.md`: auth, settings, bootstrap, Phase 6
watchlists, and Phase 7 drawings/drawing templates are live. Indicators/Pine/alerts/journal/
layouts/sim trading remain phase-by-phase work. Frontend work should remain staged behind
`backendSession` and typed adapters.
Do not remove working local behavior for anonymous users until each resource endpoint exists.

## Source Of Truth Rules

### Authenticated Mode

When a backend session exists:

1. Fetch backend JSON.
2. Apply backend JSON into Jotai atoms.
3. Send mutations to backend.
4. Do not hydrate state from old localStorage keys.

Local storage may still be used only for:

- non-sensitive UI drafts,
- anonymous mode,
- a short-lived offline mutation queue, if explicitly implemented,
- one-time migration from old local data into backend.

### Anonymous Mode

Until login is required globally, anonymous users can keep using localStorage/IndexedDB as a
separate mode. This mode must be explicit in code, not hidden inside every store.

Use a single data-source flag:

```ts
type WorkspaceDataMode = "anonymous-local" | "remote" | "offline-queue";
```

Authenticated users must resolve to `remote` after `GET /api/v1/auth/me` succeeds.

## Frontend API Modules

Use the dedicated API layer under `frontend/src/services/api/`.

Current structure:

```text
frontend/src/services/api/
  client.ts               # ky instance, credentials, JSON/error normalization
  errors.ts               # ApiError, typed error helpers
  resources/
    authApi.ts            # implemented: /auth/me, /auth/refresh, /auth/google, /auth/logout
    settingsApi.ts        # implemented: GET/PUT/PATCH /settings
    syncApi.ts            # implemented: GET /sync/bootstrap
    watchlistsApi.ts      # implemented: GET/POST/PATCH/DELETE lists + add/remove symbols
    drawingsApi.ts        # implemented: drawings batch sync + drawing template CRUD
    mt5Api.ts             # implemented: GET /mt5/symbols, /mt5/ticks snapshots, /mt5/history
```

Target structure as more backend phases land:

```text
frontend/src/services/api/
  dto.ts
  adapters/
    settingsAdapter.ts
    watchlistAdapter.ts
    drawingAdapter.ts
    indicatorAdapter.ts
    pineScriptAdapter.ts
    alertAdapter.ts
    journalAdapter.ts
    simAdapter.ts
  resources/
    syncApi.ts
    settingsApi.ts
    watchlistsApi.ts
    drawingsApi.ts
    drawingTemplatesApi.ts
    indicatorsApi.ts
    pineScriptsApi.ts
    alertsApi.ts
    journalApi.ts
    screenshotsApi.ts
    layoutsApi.ts
    simApi.ts
```

`frontend/src/services/auth/authClient.ts` is now a compatibility re-export over
`services/api/resources/authApi.ts`, so auth uses the same shared `ky` client as future resources.

The frontend standard HTTP client is
[`ky`](https://github.com/sindresorhus/ky). Do not add new raw `fetch()` calls for backend API
resources. `ky` is used because it gives the project one place for prefix URL, credentials,
timeouts, retry policy, JSON request bodies, and error hooks.

## API Client Contract

The shared client must:

- Read base URL from `NEXT_PUBLIC_API_BASE_URL`; in local development only, fall back to
  `http://localhost:8080` to match the Go Fiber default.
- Use `ky.create()` as the only backend HTTP entry point.
- Send `credentials: "include"` for httpOnly session cookies.
- Send JSON bodies through `json: ...` and parse response bodies through `.json<T>()`.
- Normalize backend error shape:

```json
{ "error": { "code": "unauthorized", "message": "human readable detail" } }
```

- Return typed data, not raw `Response`, from resource modules.
- Treat `401` as "remote session invalid"; do not silently fall back to stale local authenticated
  data.
- Keep retries conservative. Configure `ky` to retry idempotent reads only; mutations should rely on
  `clientId` or explicit queueing.

Example shape:

```ts
import ky from "ky";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";
const API_BASE =
  configuredApiBase ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8080" : "");

export const apiClient = ky.create({
  prefixUrl: API_BASE || undefined,
  credentials: "include",
  timeout: 15_000,
  retry: {
    limit: 2,
    methods: ["get"],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
  hooks: {
    beforeError: [
      async (error) => {
        const { response } = error;
        try {
          const body = await response.clone().json() as {
            error?: { code?: string; message?: string };
          };
          if (body.error?.message) {
            return new ApiError(response.status, body.error.code ?? "unknown", body.error.message);
          }
        } catch {
          // Keep ky's original HTTPError when the backend did not return JSON.
        }
        return error;
      },
    ],
  },
});

export async function apiJson<T>(path: string): Promise<T> {
  return apiClient.get(path).json<T>();
}

export async function apiPost<TResponse, TBody>(path: string, body: TBody): Promise<TResponse> {
  return apiClient.post(path, { json: body }).json<TResponse>();
}
```

## Bootstrap Flow

Backend contract:

```http
GET /api/v1/sync/bootstrap
```

Expected JSON:

```json
{
  "settings": {
    "ui": {},
    "smc": {},
    "chart": {},
    "notifications": {}
  },
  "watchlists": [],
  "drawingTemplates": [],
  "indicators": [],
  "pineScripts": [],
  "alerts": [],
  "layouts": []
}
```

Large or symbol-scoped resources are intentionally lazy:

- `drawings` by symbol: `GET /api/v1/drawings?symbol=BTCUSDT`
- `journal`: `GET /api/v1/journal?...`
- `screenshots`: signed URL flow
- simulated trading: `/api/v1/sim/*`

Recommended frontend startup order:

1. Firebase client auth resolves.
2. `backendMe()` checks backend session.
3. If access expired, `POST /api/v1/auth/refresh` rotates backend cookies.
4. If no backend session but Firebase token exists, exchange token through `POST /api/v1/auth/google`.
5. Call `GET /api/v1/sync/bootstrap`.
6. Apply settings first.
7. Apply watchlists.
8. Apply Pine scripts before custom indicators.
9. Apply indicators.
10. Apply drawing templates.
11. Apply alerts and notification settings.
12. Apply layouts metadata.
13. Lazy-load current symbol drawings.

All atom updates from bootstrap should happen in one orchestration action so the UI does not render
half-local, half-remote state.

Authenticated watchlist bootstrap treats backend data as authoritative. If the backend returns an
empty watchlist array, the frontend creates a default backend "Watchlist" through
`POST /api/v1/watchlists` and then applies the returned server id. If that create fails, the UI keeps
a stable empty local shell and logs a warning instead of falling back to the browser-local default
symbols. This prevents accidental display of local seed data as server state.

Suggested module:

```text
frontend/src/store/workspaceSyncStore.ts
```

Responsibilities:

- Track `dataMode`, `bootstrapStatus`, `lastSyncedAt`, `syncError`.
- Expose `bootstrapRemoteWorkspaceAtom`.
- Expose `applyBootstrapAtom`.
- Expose `resetRemoteWorkspaceAtom` for logout.

## Store Mapping

| Current frontend data | Current local key | Backend resource |
| --- | --- | --- |
| UI panels/theme/bottom state | `ui` | `user_settings.ui` through `/api/v1/settings` |
| SMC toggles | `smc-settings` | `user_settings.smc` through `/api/v1/settings` |
| Timeframe favorites/timezone/chart prefs | `tv:favoriteTimeframes`, toolbar local state | `user_settings.chart` |
| Alert global settings | inside `alerts` key | `user_settings.notifications` |
| Watchlist lists/sections/symbols | `watchlist`, `watchlist:lists`, `watchlist:activeId` | `watchlists` + `watchlist_symbols` |
| Drawings per symbol | `drawings:<symbol>` | `drawings.payload` |
| Drawing templates | `drawingTemplates` | `drawing_templates.style` |
| Indicator presets | `indicators` | `indicator_presets.config` |
| Pine scripts | `pineScripts` | `pine_scripts` |
| Alerts and history | `alerts` | `alerts` + `alert_events` |
| Journal entries | IndexedDB `journal` | `journal_entries` |
| Screenshots | IndexedDB `screenshots` | `screenshots` metadata + object storage |
| Layouts | not fully centralized today | `layouts.state` |
| Sim positions/accounts | `tradeStore` runtime today | `sim_accounts` + `sim_positions` |

## Applying Backend JSON

Every backend DTO must go through an adapter before entering atoms.

Do not let backend naming leak directly into drawing, indicator, or watchlist UI internals. The
adapter layer is where these differences belong:

- `id` versus `clientId`
- `createdAt`/`updatedAt` ISO strings versus frontend numeric times
- backend `snake_case` versus frontend `camelCase`, if any endpoint uses snake case
- nested backend rows versus frontend flat arrays
- deleted rows or tombstones

Rules:

- Keep existing frontend object IDs stable where possible by mapping backend `clientId` back to the
  frontend `id`.
- Store backend UUID separately only if needed by API calls.
- For drawings and Pine scripts, send the frontend object id as `clientId` so retries and migration
  are idempotent.
- For custom indicators, resolve script links after Pine scripts have been adapted.

## Mutation Strategy

Do not write to backend on every render or pointer move.

| Resource | Mutation timing |
| --- | --- |
| Settings | debounce 300-500ms or save on dialog OK |
| Watchlists | on create/rename/delete/active-list/change-layout commit; section and reorder use the same layout endpoint |
| Drawings | create on completion; update on pointerup/settings OK; batch drag updates |
| Drawing templates | explicit create/update/delete |
| Indicators | add/remove/toggle immediately; style/settings on OK |
| Pine scripts | explicit Save |
| Alerts | create/update/delete action |
| Journal | create/update/delete action; fetch paginated |
| Screenshots | upload URL -> direct PUT -> register metadata |
| Sim trading | order/close action; runtime can remain local until Phase 13 endpoints exist |

Drawing updates need the batch endpoint:

```http
POST /api/v1/drawings/batch
```

Payload should include upserts and deletes with `clientId` so repeated flushes do not duplicate
objects.

Current implementation note: `chartStore` writes optimistically, keeps `drawings:<symbol>` only as
an anonymous/cache fallback, and debounces remote drawing mutations into
`POST /api/v1/drawings/batch`. The backend stores each drawing payload verbatim and dedupes by the
frontend `Drawing.id` sent as `clientId`.

## Migration From Existing Local Data

Do not silently merge old localStorage into remote state every startup. That creates confusing
duplicates.

Recommended one-time migration flow:

1. On first successful backend login, detect local keys.
2. If migration is enabled, POST old local objects with `clientId`.
3. Backend dedupes by `clientId`.
4. Mark migration complete in `user_settings.chart.localMigration`.
5. From then on, ignore old local keys in authenticated mode.

If product direction is strict "no local saved data", skip migration and only use backend JSON after
login.

## Endpoint Readiness Checklist

Frontend remote mode should not be enabled globally until each required slice exists:

- `POST /api/v1/auth/google` - implemented and wired in frontend
- `POST /api/v1/auth/logout` - implemented and wired in frontend
- `GET /api/v1/auth/me` - implemented and wired in frontend
- `POST /api/v1/auth/refresh` - implemented and wired in frontend
- `GET /api/v1/sync/bootstrap` - backend implemented; frontend read/apply path implemented
- `GET/PATCH /api/v1/settings` - backend implemented; frontend resource module implemented;
  write-sync from UI mutations pending
- `GET/POST/PATCH/DELETE /api/v1/watchlists` - backend implemented; frontend bootstrap read and
  create/rename/delete mutation paths implemented for authenticated sessions
- `PUT /api/v1/watchlists/active` - backend implemented; frontend active-list mutation wired
- `PUT /api/v1/watchlists/:id/layout` - backend implemented; frontend add/remove/clear symbol,
  section edits, and drag/drop reorder write through this full-layout endpoint
- `POST/DELETE /api/v1/watchlists/:id/symbols` - backend compatibility endpoints retained; modern
  frontend watchlist gestures use the layout endpoint
- `GET /api/v1/drawings?symbol=...` - backend implemented; frontend lazy-loads current symbol
- `POST /api/v1/drawings/batch` - backend implemented; frontend debounced upsert/delete path wired
- `GET/POST/PUT/DELETE /api/v1/drawing-templates` - backend implemented; frontend bootstrap,
  save, and delete paths wired
- `GET/POST/PUT/DELETE /api/v1/pine-scripts`
- `GET/POST/PUT/DELETE /api/v1/indicators`

Everything else can remain lazy or phased:

- alerts,
- journal,
- screenshots,
- layouts,
- simulated trading.

## Rollout Plan

### Phase FE-0: API Foundation

- Add shared API client and typed DTOs. **Auth/settings/sync/watchlist read foundation is
  implemented.**
- Replace `authClient.ts` internal fetch helper with shared client. **Done for auth.**
- Add MSW or test fixtures for planned backend JSON.
- Remaining foundation work: add DTO/adapters for drawings, indicators, Pine scripts, alerts,
  journal, layouts, and sim-trading as backend phases land.

### Phase FE-1: Remote Bootstrap Read Path

- Call `sync/bootstrap` after backend auth. **Implemented via `useWorkspaceBootstrap()`.**
- Apply backend JSON into atoms. **Implemented for UI settings, SMC settings, notification
  settings, and watchlists.**
- Keep anonymous mode usable as current-tab memory only; do not persist watchlists to localStorage.
  **Implemented.**
- Remaining read-path work: chart preferences are still component-local, and future backend slices
  need resource-specific adapters.
- Add a feature flag:

```env
NEXT_PUBLIC_WORKSPACE_DATA_SOURCE=local|remote
```

### Phase FE-2: Settings And Watchlist Writes

- Move `uiStore`, `smcStore`, timeframe favorites, notification settings, and `watchlistStore`
  mutations to API calls in remote mode.
- Watchlist write-through is implemented: create, rename, delete, set-active, shared flag,
  add/remove/clear symbol, section edits, and symbol/section reorder call Phase 6 backend APIs after
  optimistic in-memory updates.
- Stop reading local watchlist keys. **Implemented.**
- Add rollback/error toast for failed writes.

### Phase FE-3: Chart Artifacts

- Move drawings, drawing templates, Pine scripts, and indicator presets to backend.
- Drawings and drawing templates are implemented for Phase 7:
  - drawing payloads lazy-load per current symbol from `/api/v1/drawings`,
  - drawing mutations flush through `/api/v1/drawings/batch`,
  - templates hydrate from bootstrap and save/delete through `/api/v1/drawing-templates`.
- Remaining Phase FE-3 work: Pine scripts and indicator presets.
- Ensure Pine scripts hydrate before custom indicators.

### Phase FE-4: Alerts, Journal, Layouts, Sim

- Move alerts and alert history to `/api/v1/alerts`.
- Load journal lazily from `/api/v1/journal`.
- Use screenshot upload URL flow.
- Save/load layouts through `/api/v1/layouts`.
- Move simulated positions only after backend Phase 13 exists.

### Phase FE-5: Remove Authenticated Local Persistence

- Delete localStorage hydration branches for authenticated remote mode.
- Keep local storage only for anonymous mode or remove it entirely if login becomes required.
- Add regression tests that clear localStorage and verify the app still hydrates from backend JSON.

## Testing Plan

Add tests under `frontend/tests/`:

- API client parses success and backend error envelopes.
- DTO adapters convert backend bootstrap JSON into current atom shapes.
- Remote bootstrap ignores stale localStorage for authenticated users.
- Watchlist reorder, section drag/drop, and rename persist through mocked API reload.
- Drawing create/update/delete persists by `clientId` and does not duplicate after retry.
- Pine script plus custom indicator hydrates in correct order.
- LocalStorage cleared + mocked backend bootstrap still restores UI state.

Recommended mocked integration fixture:

```text
frontend/tests/fixtures/backend-bootstrap.json
```

## Implementation Notes

- Keep market candles out of this sync layer. Market data is live provider/runtime data, not user
  workspace persistence.
- MT5 symbol discovery should go through the Go API (`getMt5Symbols()` -> `GET /api/v1/mt5/symbols`).
  The frontend must not connect directly to the localhost Python sidecar.
- The frontend symbol registry is runtime-only. Do not seed `MARKET_SYMBOLS` with a local static
  list. After `getMt5Symbols()` succeeds, replace the registry from the full backend response so
  symbol search can see the actual MT5 catalog.
- The active watchlist should default to `streamSymbols` from `/api/v1/mt5/symbols`, not every
  catalog item. Catalog-only symbols remain searchable, and watchlist rows get live Last/Chg/Chg%
  through one shared browser WebSocket at `/api/v1/mt5/stream`. Do not poll
  `/api/v1/mt5/ticks` from the UI; `/ticks` is a one-off snapshot/debug endpoint.
  `streamSymbols` is the confirmed live set from the Python bridge. The frontend should not treat a
  catalog symbol as streamable until it appears there; symbols rejected by MT5 `symbol_select()` can
  stay searchable but should not be expected to render live quote/chart data.
- MT5 chart candles are loaded and refreshed from `GET /api/v1/mt5/history`. Active charts can pass
  `refresh=true` with a small `limit` to bypass the backend cache and fetch the latest MT5 OHLC bars.
  `/api/v1/mt5/stream` and `/api/v1/mt5/ticks` are quote/watchlist data only; do not synthesize MT5 candles from bid/ask ticks.
  The frontend may subscribe any MT5 catalog symbol in a watchlist or chart; if it was not part of
  the bridge's initial `streamSymbols`, the Go API requests on-demand streaming from the Python
  sidecar.
  MT5 history candle `time` values are UTC bar-open seconds from `copy_rates_*`; the frontend must
  render them unchanged. If the bridge normalizes anything, it is tick timestamps only, and only so
  quote freshness checks compare ticks and rates in the same UTC domain.
  MT5 symbols must not fall through to Binance, TwelveData, or OANDA.
- Keep chart rendering fast by separating "remote commit" from "canvas interaction". Draw locally
  during drag, commit on pointerup.
- Never call settings/watchlist/drawing APIs from render paths.
- Do not let a failed backend write block chart interaction; mark unsynced state and retry or show
  a toast.
- Do not mix old local data into remote state without a deliberate migration step.
