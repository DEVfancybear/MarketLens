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
watchlists, Phase 7 drawings/drawing templates/drawing tool favorites, Phase 8 indicator presets,
and Phase 9 Pine scripts are live. Alerts, journal, layouts, and sim trading remain phase-by-phase
work. Frontend work should remain staged behind `backendSession` and typed adapters.
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
    indicatorsApi.ts      # implemented: GET/POST/PUT/DELETE indicator presets
    pineScriptsApi.ts     # implemented: metadata list, full-source get, save/update/delete
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
- On `401`, attempt backend session recovery in the shared client: refresh cookies, then exchange
  the current Firebase ID token when available, then retry the original request once. If recovery
  still fails, treat the remote session as invalid; do not silently fall back to stale local
  authenticated data.
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
8. Apply Pine scripts before custom indicators when Phase 9 is available.
9. Apply indicators.
10. Apply drawing templates.
11. Apply alerts and notification settings.
12. Apply layouts metadata.
13. Lazy-load current symbol drawings.

The same refresh/exchange order is also used after startup by the shared API client whenever a
resource call returns `401`; the auth endpoints themselves are excluded from recovery to prevent
recursive retries.

All atom updates from bootstrap should happen in one orchestration action so the UI does not render
half-local, half-remote state.

Authenticated watchlist bootstrap treats backend data as authoritative. If the backend returns an
empty watchlist array, the frontend creates a default backend "Watchlist" through
`POST /api/v1/watchlists` and then applies the returned server id. If that create fails, the UI keeps
a stable empty local shell and logs a warning instead of falling back to the browser-local default
symbols. This prevents accidental display of local seed data as server state.

Logout is the inverse boundary. When auth resolves to `anonymous`, `useWorkspaceBootstrap()` resets
user-scoped atoms to defaults and clears their browser cache keys. This prevents a signed-out screen
from showing the previous user's watchlists or workspace settings. The reset intentionally leaves
public market data infrastructure alone; MT5 symbols/quotes can continue streaming, but no
server-owned watchlist layout, drawings, indicator config, alert state, or tool favorites remain in
view.

Workspace defaults must match TradingView's quiet first-load behavior:

- The bottom panel is collapsed by default (`ui.bottomOpen: false`). Opening Replay/Trade/Pine still
  persists the user's current choice under the `ui` key.
- SMC overlays are all disabled by default. The frontend persists the new shape under
  `smc-settings-v2`; the previous `smc-settings` key is cleared during hydration because it may
  contain the old all-on default.
- Backend `user_settings` rows that contain `{}` are normalized by the API to these explicit
  defaults before bootstrap reaches frontend atoms.

Suggested module:

```text
frontend/src/store/workspaceSyncStore.ts
```

Responsibilities:

- Track `dataMode`, `bootstrapStatus`, `lastSyncedAt`, `syncError`.
- Expose `bootstrapRemoteWorkspaceAtom`.
- Expose `applyBootstrapAtom`.
- Expose `resetRemoteWorkspaceAtom` for logout. The current implementation keeps this logic inside
  `useWorkspaceBootstrap()` and calls per-store reset atoms (`resetUIToDefaultsAtom`,
  `resetSmcToDefaultsAtom`, `resetAlertsToDefaultsAtom`,
  `resetChartWorkspaceToDefaultsAtom`, `resetTradeAtom`, and
  `resetNotificationsToDefaultsAtom`).

## Store Mapping

| Current frontend data | Current local key | Backend resource |
| --- | --- | --- |
| UI panels/theme/bottom state | `ui` | `user_settings.ui` through `/api/v1/settings` |
| SMC toggles | `smc-settings-v2` | `user_settings.smc` through `/api/v1/settings` |
| Timeframe favorites/timezone/chart prefs | `tv:favoriteTimeframes`, `chartTimeZone`, `drawingSyncMode`, `drawingToolPreferences` | `user_settings.chart`; favorites use `/api/v1/settings/chart/favorite-timeframes`, other preferences use `/api/v1/settings` |
| Alert global settings | inside `alerts` key | `user_settings.notifications` through `/api/v1/settings` |
| Watchlist lists/sections/symbols | `watchlist`, `watchlist:lists`, `watchlist:activeId` | `watchlists` + `watchlist_symbols` |
| Drawings per symbol | `drawings:<symbol>` | `drawings.payload` |
| Drawing templates | `drawingTemplates` | `drawing_templates.style` |
| Drawing tool favorites | `tv:favTools` | `drawing_tool_favorites.tools` |
| Indicator presets | `indicators` | `indicator_presets.config` |
| Pine scripts | `pineScripts` | `pine_scripts` |
| Alerts and history | `alerts` | `/api/v1/alerts*` backed by `alerts` + retained `alert_events` |
| Journal entries | IndexedDB `journal` | `journal_entries` |
| Screenshots | IndexedDB `screenshots` | `screenshots` metadata + object storage |
| Layouts | in-memory Jotai projection | `layouts.state` through `/api/v1/layouts` |
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
- For indicator presets, send `IndicatorConfig.id` as `clientId`; the backend upserts by
  `(user_id, client_id)` and stores the full config JSON verbatim.
- For alerts, send `Alert.id` as `clientId`, serialize mutations per alert,
  and use the dedicated trigger endpoint so lifecycle and history stay atomic.
- For custom indicators, resolve script links after Pine scripts have been adapted.

## Mutation Strategy

Do not write to backend on every render or pointer move.

| Resource | Mutation timing |
| --- | --- |
| Settings | debounce 300-500ms or save on dialog OK |
| Watchlists | on create/rename/delete/active-list/change-layout commit; section and reorder use the same layout endpoint |
| Drawings | create on completion; update on pointerup/settings OK; batch drag updates |
| Drawing templates | explicit create/update/delete |
| Drawing tool favorites | replace whole ordered list on star toggle |
| Indicators | add/remove/toggle immediately; style/settings on OK |
| Pine scripts | explicit Save |
| Layouts | explicit save/overwrite/default/delete from the top toolbar |
| Alerts | create/update/delete/trigger action; serialize by optimistic client ID |
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

Current indicator implementation note: `chartStore` writes optimistically,
keeps `indicators` localStorage only as anonymous/cache fallback, and debounces
remote add/update/delete into `/api/v1/indicators`. The backend stores each
`IndicatorConfig` payload verbatim and dedupes by the frontend `IndicatorConfig.id`
sent as `clientId`.

Current Pine script implementation note: bootstrap and `GET /api/v1/pine-scripts`
return metadata only. `chartStore.loadPineScriptAtom()` and
`addCustomIndicatorFromScriptAtom()` fetch the full source through
`GET /api/v1/pine-scripts/:id` when the editor or chart needs it. Save,
favorite toggle, and delete write through `/api/v1/pine-scripts` while keeping
the local editor responsive.

Public indicator Store is intentionally outside the private workspace sync
payload. Pine Editor publishes the current script with
`POST /api/v1/pine-scripts/:id/publish`; the indicator browser Store tab reads
`GET /api/v1/indicator-store` without auth and adds those rows to the chart by
source code, scoped with `store:<public-id>` script ids so they do not collide
with private Pine script ids.

Private Pine workspace surfaces are auth-gated in
`frontend/src/services/privateWorkspaceAccess.ts`. Anonymous/loading users see
only the public Store in the indicator browser, and the bottom panel keeps only
`Replay` until Firebase auth resolves to `authed`. This prevents local anonymous
state or a stale hydrated tab from exposing a user's `Favorites`, `My scripts`,
`Trade`, `Journal`, `Analytics`, `Pine Editor`, or `Logs` workspace before
login.

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
- `GET/PATCH /api/v1/settings` - implemented and wired for UI shell/grid/theme, SMC toggles,
  chart timezone/drawing preferences, and notification settings
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
- `GET/PUT /api/v1/drawing-tool-favorites` - backend implemented; frontend drawing toolbar
  read/write path wired
- `GET/POST/PUT/DELETE /api/v1/indicators` - backend implemented; frontend bootstrap read and
  optimistic add/update/delete sync wired
- `GET/POST/PUT/DELETE /api/v1/pine-scripts` - backend implemented; frontend metadata bootstrap,
  full-source lazy load, save, favorite, and delete wired
- `GET/POST/PUT/DELETE /api/v1/layouts` - backend implemented; frontend bootstrap, automatic
  default restore, save/load/overwrite/default/delete paths wired

Everything else can remain lazy or phased:

- alerts,
- journal,
- screenshots,
- simulated trading.

## Rollout Plan

### Phase FE-0: API Foundation

- Add shared API client and typed DTOs. **Auth/settings/sync/watchlist read foundation is
  implemented.**
- Replace `authClient.ts` internal fetch helper with shared client. **Done for auth.**
- Add MSW or test fixtures for planned backend JSON.
- Remaining foundation work: add DTO/adapters for alerts, journal, layouts, and sim-trading as
  backend phases land.

### Phase FE-1: Remote Bootstrap Read Path

- Call `sync/bootstrap` after backend auth. **Implemented via `useWorkspaceBootstrap()`.**
- Apply backend JSON into atoms. **Implemented for UI, SMC, chart and notification settings,
  watchlists, drawing templates, Pine script metadata, and indicators.**
- Keep anonymous mode usable as current-tab memory only; do not persist watchlists to localStorage.
  **Implemented.**
- Future backend slices still need resource-specific adapters as they land.
- Add a feature flag:

```env
NEXT_PUBLIC_WORKSPACE_DATA_SOURCE=local|remote
```

### Phase FE-2: Settings And Watchlist Writes

- Move `uiStore`, `smcStore`, timeframe favorites, notification settings, and `watchlistStore`
  mutations to API calls in remote mode. **Implemented; settings writes are debounced and ordered.**
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
  - templates hydrate from bootstrap and save/delete through `/api/v1/drawing-templates`,
  - drawing toolbar favorites read/write through `/api/v1/drawing-tool-favorites`.
- Indicator presets are implemented for Phase 8:
  - presets hydrate from bootstrap,
  - add/remove/toggle/settings changes sync through `/api/v1/indicators`,
  - `clientId` keeps frontend indicator ids stable across retries and reloads.
- Pine scripts are implemented for Phase 9:
  - metadata hydrates from bootstrap,
  - full source lazy-loads when opening or adding a script,
  - save/favorite/delete sync through `/api/v1/pine-scripts`.
- Remaining Phase FE-3 work: none for indicators/Pine; future work is richer Pine runtime support.
- Ensure Pine scripts hydrate before custom indicators.

### Phase FE-4: Alerts, Journal, Layouts, Sim

- Move alerts and alert history to `/api/v1/alerts`.
- Load journal lazily from `/api/v1/journal`.
- Use screenshot upload URL flow.
- Save/load layouts through `/api/v1/layouts`. **Implemented**, including versioned snapshots,
  bootstrap hydration, automatic default restore, overwrite, default switching, and delete.
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
