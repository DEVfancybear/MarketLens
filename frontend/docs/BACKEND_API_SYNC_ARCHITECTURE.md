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

- Fiber server scaffold in `backend/internal/httpserver/server.go`.
- `/health` and `/health/ready`.
- Database/auth/session primitives.

Current backend API status from `backend/docs/API.md`:

- `/health` is implemented.
- `/api/v1/*` endpoints are planned contracts, not fully wired yet.

Frontend work should therefore be staged behind a backend availability check and typed adapters.
Do not remove working local behavior for anonymous users until the backend endpoints exist.

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

## Frontend Modules To Add

Create a dedicated API layer under `frontend/src/services/api/`.

Recommended structure:

```text
frontend/src/services/api/
  client.ts               # fetch wrapper, credentials, JSON/error handling
  errors.ts               # ApiError, typed error codes
  dto.ts                  # backend DTO types
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
    authApi.ts
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

`frontend/src/services/auth/authClient.ts` already contains a small best-effort fetch wrapper for
auth. Replace that wrapper with the shared API client so every endpoint uses the same rules.

## API Client Contract

The shared client must:

- Read base URL from `NEXT_PUBLIC_API_BASE_URL`.
- Send `credentials: "include"` for httpOnly session cookies.
- Send and parse `application/json`.
- Normalize backend error shape:

```json
{ "error": { "code": "unauthorized", "message": "human readable detail" } }
```

- Return typed data, not raw `Response`, from resource modules.
- Treat `401` as "remote session invalid"; do not silently fall back to stale local authenticated
  data.
- Keep retries conservative. Retry idempotent reads only; mutations should rely on `clientId` or
  explicit queueing.

Example shape:

```ts
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  if (!res.ok) throw await ApiError.fromResponse(res);
  return (await res.json()) as T;
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
3. If no backend session but Firebase token exists, exchange token through `POST /api/v1/auth/google`.
4. Call `GET /api/v1/sync/bootstrap`.
5. Apply settings first.
6. Apply watchlists.
7. Apply Pine scripts before custom indicators.
8. Apply indicators.
9. Apply drawing templates.
10. Apply alerts and notification settings.
11. Apply layouts metadata.
12. Lazy-load current symbol drawings.

All atom updates from bootstrap should happen in one orchestration action so the UI does not render
half-local, half-remote state.

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
| Watchlists | on add/remove/rename/drop commit |
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

Frontend remote mode should not be enabled globally until these exist:

- `POST /api/v1/auth/google`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/sync/bootstrap`
- `GET/PATCH /api/v1/settings`
- `GET/POST/PATCH/DELETE /api/v1/watchlists`
- `POST/DELETE /api/v1/watchlists/:id/symbols`
- `GET /api/v1/drawings?symbol=...`
- `POST /api/v1/drawings/batch`
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

- Add shared API client and typed DTOs.
- Replace `authClient.ts` internal fetch helper with shared client.
- Add MSW or test fixtures for planned backend JSON.
- No store behavior change yet.

### Phase FE-1: Remote Bootstrap Read Path

- Add `workspaceSyncStore`.
- Call `sync/bootstrap` after backend auth.
- Apply backend JSON into atoms.
- Keep anonymous local mode unchanged.
- Add a feature flag:

```env
NEXT_PUBLIC_WORKSPACE_DATA_SOURCE=local|remote
```

### Phase FE-2: Settings And Watchlist Writes

- Move `uiStore`, `smcStore`, timeframe favorites, notification settings, and `watchlistStore`
  mutations to API calls in remote mode.
- Stop reading local keys when `dataMode === "remote"`.
- Add rollback/error toast for failed writes.

### Phase FE-3: Chart Artifacts

- Move drawings, drawing templates, Pine scripts, and indicator presets to backend.
- Use batch writes for drawings.
- Lazy-load drawings per current symbol.
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
- Keep chart rendering fast by separating "remote commit" from "canvas interaction". Draw locally
  during drag, commit on pointerup.
- Never call settings/watchlist/drawing APIs from render paths.
- Do not let a failed backend write block chart interaction; mark unsynced state and retry or show
  a toast.
- Do not mix old local data into remote state without a deliberate migration step.

