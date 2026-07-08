# API Reference

Base URL (dev): `http://localhost:8080`
API prefix: `/api/v1` (except `/health`).

> Status: `/health`, `/health/ready`, `/api/v1/auth/*`, `/api/v1/settings`, and
> `/api/v1/sync/bootstrap` are **implemented**. The remaining `/api/v1` resources are planned
> contracts that the Go Fiber handlers will implement in Phase 6+ according to
> `BACKEND_IMPLEMENTATION_PLAN.md`. See `AUTH.md` for the auth flow and `DATABASE.md` for the tables
> behind each resource.

## Conventions

- **Auth:** protected endpoints require the httpOnly `access_token` cookie (see `AUTH.md`). Marked
  `🔒` below. Send `credentials: 'include'`.
- **Content type:** `application/json` for request and response bodies.
- **IDs:** UUID strings.
- **Timestamps:** RFC 3339 UTC (`2026-07-06T12:00:00Z`).
- **Errors:** consistent shape —
  ```json
  { "error": { "code": "unauthorized", "message": "human readable detail" } }
  ```
  Codes: `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404),
  `conflict` (409), `rate_limited` (429), `internal` (500).
- **Ownership:** every `/api/v1` resource is scoped to the authenticated user; cross-user access
  returns `404` (not `403`, to avoid leaking existence).

---

## Health

### `GET /health`  *(implemented)*

**Response** `200 OK`

```json
{ "status": "ok", "timestamp": "2026-07-05T12:00:00Z" }
```

---

## Auth

See `AUTH.md` for the full flow and token model.

### `POST /api/v1/auth/google`

Login **or** register with a Google account. First sign-in creates the user; later sign-ins reuse
it. No auth required (this is where you get authed).

**Request**
```json
{ "idToken": "<firebase-id-token>" }
```

**Response** `200 OK` — sets `access_token` + `refresh_token` httpOnly cookies.
```json
{
  "user": {
    "id": "0c…",
    "email": "trader@gmail.com",
    "displayName": "Jane Trader",
    "photoUrl": "https://lh3.googleusercontent.com/…",
    "createdAt": "2026-07-06T12:00:00Z"
  },
  "isNewUser": false
}
```
Errors: `401 unauthorized` (invalid/expired ID token), `429 rate_limited`.

### `POST /api/v1/auth/refresh`

Rotates the refresh token and issues a fresh access token. Requires the `refresh_token` cookie.

**Response** `200 OK` — new cookies set. Body: `{ "ok": true }`.
Errors: `401` (missing/revoked/reused refresh token → all sessions revoked).

### `POST /api/v1/auth/logout`  🔒

Revokes the current session and clears both cookies. `200 { "ok": true }`.

### `GET /api/v1/auth/me`  🔒

**Response** `200 OK` → the `user` object (same shape as above).

### `DELETE /api/v1/auth/sessions`  🔒

Sign out of every device (revoke all sessions). `200 { "ok": true }`.

---

## Sync bootstrap

### `GET /api/v1/sync/bootstrap`  protected, implemented

One call that returns the user's whole workspace for hydrating local stores on sign-in
(`DATABASE.md` section 11). Phase 5 returns persisted settings plus empty arrays; later phases fill
each resource slice.

**Response** `200 OK`
```json
{
  "settings":         { "ui": {}, "smc": {}, "chart": {}, "notifications": {} },
  "watchlists":       [],
  "drawingTemplates": [],
  "indicators":       [],
  "pineScripts":      [],
  "alerts":           [],
  "layouts":          []
}
```
Loaded lazily by their own endpoints (larger / scoped payloads), **not** in bootstrap: per-symbol
`drawings`, `journal`, `screenshots`, and sim-trading.

---

## Settings  protected, implemented

Backed by `user_settings` (1:1). See `DATABASE.md` section 6.1. `GET` auto-creates the row for a
new authenticated user, `PUT` replaces all four sections, and `PATCH` deep-merges object sections.

| Method | Path                    | Purpose                                   |
| ------ | ----------------------- | ----------------------------------------- |
| GET    | `/api/v1/settings`      | Get `{ ui, smc, chart, notifications }`   |
| PUT    | `/api/v1/settings`      | Replace all sections                      |
| PATCH  | `/api/v1/settings`      | Merge a partial (e.g. just `ui.theme`)    |

---

## Watchlists  🔒

Backed by `watchlists`, `watchlist_symbols`, `watchlist_sections`, and
`watchlist_preferences`. The backend owns the full watchlist layout; frontend
Jotai state is only an optimistic in-memory cache.

| Method | Path                                            | Purpose                                  |
| ------ | ----------------------------------------------- | ---------------------------------------- |
| GET    | `/api/v1/watchlists`                            | List with symbols, sections, active flag |
| POST   | `/api/v1/watchlists`                            | Create `{ name }`                        |
| PUT    | `/api/v1/watchlists/active`                     | Set active list `{ id }`                 |
| PATCH  | `/api/v1/watchlists/:id`                        | Rename / reorder / shared / sort metadata |
| DELETE | `/api/v1/watchlists/:id`                        | Delete a list                            |
| PUT    | `/api/v1/watchlists/:id/layout`                 | Replace full symbols/sections layout     |
| POST   | `/api/v1/watchlists/:id/symbols`                | Add `{ symbol }` compatibility endpoint  |
| DELETE | `/api/v1/watchlists/:id/symbols/:symbol`        | Remove a symbol compatibility endpoint   |

Watchlist shape:

```json
{
  "id": "uuid",
  "name": "Watchlist",
  "position": 0,
  "symbols": ["EURUSD", "XAUUSD"],
  "sections": [{ "id": "uuid", "title": "SECTION 1", "index": 1 }],
  "shared": false,
  "sortKey": "symbol",
  "sortDir": "asc",
  "active": true
}
```

Metadata patch accepts any subset of:

```json
{
  "name": "Majors",
  "position": 0,
  "shared": false,
  "sortKey": "price",
  "sortDir": "desc"
}
```

Full-layout write:

```json
{
  "symbols": ["EURUSD", "XAUUSD"],
  "sections": [{ "title": "SECTION 1", "index": 1 }]
}
```

Use `PUT /api/v1/watchlists/:id/layout` for add/remove/clear symbol,
section add/rename/delete, and drag/drop reorder. It is the common persistence
path for TradingView-style watchlist gestures.

---

## MT5 Tick Stream

MT5 tick streaming starts as a localhost Python sidecar stream and is exposed to
the frontend only through the Go Fiber API. The browser must not connect to the
Python sidecar directly.

| Component | Path / Address | Purpose |
| --- | --- | --- |
| Python bridge | `backend/bridge/mt5_stream/mt5_server.py` | Reads MT5 symbol catalog/ticks via `MetaTrader5` and broadcasts JSON |
| WebSocket | `ws://localhost:8765` | Local tick stream (`MT5_STREAM_HOST`/`MT5_STREAM_PORT`) |
| Go consumer | `backend/cmd/mt5-stream` | Consumes the stream with `github.com/gorilla/websocket` |
| Go API | `GET /api/v1/mt5/symbols` | Returns the latest MT5 symbol catalog cached from the Python bridge |
| Go API WebSocket | `GET /api/v1/mt5/stream` | Browser-facing realtime quote stream; clients send subscribe messages and receive pushed ticks |
| Go API | `GET /api/v1/mt5/ticks?symbols=EURUSD,GBPUSD` | One-off latest cached tick snapshot/debug endpoint; also requests on-demand streaming for requested catalog symbols |
| Go API | `GET /api/v1/mt5/history?symbol=EURUSD&timeframe=15m&limit=1500&refresh=true` | Returns MT5 OHLC candles; `refresh=true` bypasses the cache for active chart updates |

Symbol catalog payload, sent when a Go client connects:

```json
{
  "type": "symbols",
  "source": "mt5",
  "count": 1200,
  "stream_symbols": ["EURUSD", "GBPUSD"],
  "symbols": [
    {
      "name": "EURUSD",
      "path": "Forex\\Majors",
      "description": "Euro vs US Dollar",
      "visible": true,
      "digits": 5,
      "point": 0.00001,
      "spread": 10,
      "trade_mode": 4,
      "currency_base": "EUR",
      "currency_profit": "USD",
      "currency_margin": "EUR"
    }
  ]
}
```

After the catalog, the Python bridge immediately sends the current tick snapshot for every active
stream symbol. This avoids blank watchlist rows for low-frequency symbols whose `time_msc` may not
change for a while after the Go backend reconnects.

Tick payload:

```json
{
  "type": "tick",
  "source": "mt5",
  "symbol": "EURUSD",
  "bid": 1.08425,
  "ask": 1.08437,
  "timestamp": 1760000000,
  "time_msc": 1760000000123
}
```

The stream is local-only by default and must not be exposed directly to the internet.
Use `MT5_STREAM_ALL_VISIBLE=true` to stream the visible Market Watch symbols. `MT5_SYMBOLS` adds
explicit symbols on top of that visible set; it no longer disables visible-symbol streaming. Set
`MT5_STREAM_ALL_VISIBLE=false` with an empty `MT5_SYMBOLS` value only when you want catalog-only
mode.

Frontend/backend API response:

```json
{
  "connected": true,
  "bridgeUrl": "ws://localhost:8765",
  "source": "mt5",
  "count": 1200,
  "streamSymbols": ["EURUSD", "GBPUSD"],
  "symbols": [
    {
      "name": "EURUSD",
      "path": "Forex\\Majors",
      "description": "Euro vs US Dollar",
      "visible": true,
      "digits": 5,
      "point": 0.00001,
      "spread": 10,
      "trade_mode": 4,
      "currency_base": "EUR",
      "currency_profit": "USD",
      "currency_margin": "EUR"
    }
  ],
  "updatedAt": "2026-07-07T12:00:00Z",
  "lastError": ""
}
```

Latest tick API response:

```json
{
  "connected": true,
  "bridgeUrl": "ws://localhost:8765",
  "source": "mt5",
  "ticks": [
    {
      "type": "tick",
      "source": "mt5",
      "symbol": "EURUSD",
      "bid": 1.08425,
      "ask": 1.08437,
      "timestamp": 1760000000,
      "time_msc": 1760000000123
    }
  ],
  "updatedAt": "2026-07-07T12:00:00Z",
  "lastError": ""
}
```

Browser realtime quote stream:

```json
// client -> server
{ "type": "set_symbols", "symbols": ["EURUSD", "GBPUSD"] }

// client -> server
{ "type": "subscribe", "symbols": ["XAUUSD"] }

// client -> server
{ "type": "unsubscribe", "symbols": ["GBPUSD"] }

// server -> client
{
  "type": "snapshot",
  "connected": true,
  "source": "mt5",
  "symbols": ["EURUSD"],
  "ticks": [
    { "type": "tick", "source": "mt5", "symbol": "EURUSD", "bid": 1.08425, "ask": 1.08437, "timestamp": 1760000000 }
  ],
  "updatedAt": "2026-07-07T12:00:00Z"
}

// server -> client
{
  "type": "tick",
  "connected": true,
  "source": "mt5",
  "tick": { "type": "tick", "source": "mt5", "symbol": "EURUSD", "bid": 1.08426, "ask": 1.08438, "timestamp": 1760000001 },
  "updatedAt": "2026-07-07T12:00:01Z"
}
```

The frontend `Mt5Provider` uses `/api/v1/mt5/stream` for subscribed watchlist/chart
quotes. It must not poll `/api/v1/mt5/ticks` on an interval; `/ticks` is retained
for one-off snapshots, debugging, and compatibility. MT5 chart candles must come
from `/api/v1/mt5/history` because bid/ask ticks are not a full OHLC source.
Active MT5 charts pass `refresh=true` with a small `limit` to bypass the backend
cache and update the latest bars from MT5 rates. The `streamSymbols` array from
`/api/v1/mt5/symbols` is the confirmed live set from the Python bridge. If the browser later
subscribes to a catalog symbol that is not in that initial set, the Go API sends a
`stream.subscribe` message to the Python bridge and waits for the bridge catalog update to confirm
the symbol is selectable. Symbols rejected by `symbol_select()` remain catalog/search-only and
should not be shown as live streamable rows.

MT5 history candle `time` values are the UTC bar-open seconds returned by
MetaQuotes `copy_rates_*`. Do not apply broker/local timezone offsets to candle
times. The bridge may normalize tick timestamps before publishing them so quote
freshness checks compare ticks and rates in the same UTC domain.

---

## Drawings  protected, implemented

Backed by `drawings`. Payload mirrors the frontend `DRAWING_OBJECT_MODEL`.

| Method | Path                            | Purpose                                        |
| ------ | ------------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/drawings?symbol=BTCUSDT` | List drawings for a symbol                    |
| POST   | `/api/v1/drawings`              | Create `{ symbol, toolType, payload, clientId }` |
| PUT    | `/api/v1/drawings/:id`          | Replace payload/flags                          |
| PATCH  | `/api/v1/drawings/:id`          | Partial (e.g. `{ locked: true }`)              |
| DELETE | `/api/v1/drawings/:id`          | Delete one                                     |
| POST   | `/api/v1/drawings/batch`        | Bulk upsert (sync flush; dedupes on `clientId`)|

## Drawing templates  protected, implemented

Global (not per-symbol) style presets — backed by `drawing_templates`.

| Method | Path                              | Purpose                                     |
| ------ | --------------------------------- | ------------------------------------------- |
| GET    | `/api/v1/drawing-templates`       | List style presets                          |
| POST   | `/api/v1/drawing-templates`       | Create `{ name, family, style }`            |
| PUT    | `/api/v1/drawing-templates/:id`   | Update                                      |
| DELETE | `/api/v1/drawing-templates/:id`   | Delete                                      |

## Drawing tool favorites  protected, implemented

Global ordered star list for the drawing toolbar/floating favorites toolbar — backed by
`drawing_tool_favorites`.

| Method | Path                              | Purpose                           |
| ------ | --------------------------------- | --------------------------------- |
| GET    | `/api/v1/drawing-tool-favorites`  | Get `{ tools }`                   |
| PUT    | `/api/v1/drawing-tool-favorites`  | Replace ordered `{ tools: [] }`   |

---

## Indicators  🔒

Backed by `indicator_presets`.

| Method | Path                        | Purpose                          |
| ------ | --------------------------- | -------------------------------- |
| GET    | `/api/v1/indicators`        | List presets                     |
| POST   | `/api/v1/indicators`        | Create `{ indicatorType, name, settings }` |
| PUT    | `/api/v1/indicators/:id`    | Update settings/enabled/position |
| DELETE | `/api/v1/indicators/:id`    | Remove                           |

---

## Pine scripts  🔒

Backed by `pine_scripts`.

| Method | Path                          | Purpose                        |
| ------ | ----------------------------- | ------------------------------ |
| GET    | `/api/v1/pine-scripts`        | List                           |
| GET    | `/api/v1/pine-scripts/:id`    | Get one (with `source`)        |
| POST   | `/api/v1/pine-scripts`        | Create `{ name, source }`      |
| PUT    | `/api/v1/pine-scripts/:id`    | Update `{ name, source, meta }`|
| DELETE | `/api/v1/pine-scripts/:id`    | Delete                         |

---

## Alerts  🔒

Backed by `alerts` + `alert_events`. The alert body carries per-alert delivery channels; the
**global** notification defaults (`AlertSettings`) are read/written via `/api/v1/settings`
(`notifications` section), not here.

| Method | Path                          | Purpose                                   |
| ------ | ----------------------------- | ----------------------------------------- |
| GET    | `/api/v1/alerts`              | List (filter `?status=active`)            |
| POST   | `/api/v1/alerts`              | Create (see body below)                   |
| PATCH  | `/api/v1/alerts/:id`          | Update / pause (`enabled:false`) / resume |
| DELETE | `/api/v1/alerts/:id`          | Delete                                    |
| GET    | `/api/v1/alerts/:id/events`   | Trigger history for one alert             |
| GET    | `/api/v1/alerts/history`      | All trigger events (newest-first, ~200 cap)|

**Create/update body**
```json
{
  "symbol": "BTCUSDT",
  "condition": "crossUp",           // above | below | crossUp | crossDown
  "price": 65000,
  "note": "breakout",
  "recurring": false,
  "enabled": true,
  "locked": false,
  "channels": { "sound": true, "browser": false, "push": true, "telegram": false, "discord": false }
}
```

**Event** (`AlertHistoryEntry`): `{ id, alertId, symbol, condition, targetPrice, triggerPrice, triggeredAt }`.

### Push tokens (FCM)

| Method | Path                       | Purpose                                            |
| ------ | -------------------------- | -------------------------------------------------- |
| POST   | `/api/v1/push/tokens`      | Register/refresh `{ fcmToken, platform, permission }` |
| DELETE | `/api/v1/push/tokens/:tok` | Unregister a device token                          |

---

## Journal  🔒

Backed by `journal_entries` + `screenshots`.

| Method | Path                                   | Purpose                                   |
| ------ | -------------------------------------- | ----------------------------------------- |
| GET    | `/api/v1/journal?symbol=&tag=&limit=`  | List (paginated by `entryTime`, filterable) |
| POST   | `/api/v1/journal`                      | Create (trade-centric body below)         |
| GET    | `/api/v1/journal/:id`                  | Get one with its screenshots              |
| PUT    | `/api/v1/journal/:id`                  | Update                                    |
| DELETE | `/api/v1/journal/:id`                  | Delete (cascades screenshots)             |

**Create/update body** (matches frontend `JournalEntry`)
```json
{
  "symbol": "BTCUSDT",
  "side": "long",                    // long | short
  "entryTime": "2026-07-06T10:00:00Z",
  "exitTime":  "2026-07-06T12:30:00Z",
  "entryPrice": 64000, "exitPrice": 65500,
  "quantity": 0.5, "pnl": 750, "rr": 2.1, "riskAmount": 350,
  "notes": "clean BOS entry", "tags": ["breakout","london"],
  "positionId": null
}
```

### Screenshots

Two-step upload so bytes go straight to object storage, not through the API.

| Method | Path                                    | Purpose                                        |
| ------ | --------------------------------------- | ---------------------------------------------- |
| POST   | `/api/v1/screenshots/upload-url`        | Get a pre-signed PUT URL + `storageKey`        |
| POST   | `/api/v1/screenshots`                   | Register `{ storageKey, journalEntryId?, phase, width, height }` (`phase`: before \| after-entry \| after-exit) |
| GET    | `/api/v1/screenshots/:id`               | Get a (short-lived signed) view URL            |
| DELETE | `/api/v1/screenshots/:id`               | Delete metadata + schedule blob removal        |

---

## Layouts  🔒

Backed by `layouts`.

| Method | Path                       | Purpose                                  |
| ------ | -------------------------- | ---------------------------------------- |
| GET    | `/api/v1/layouts`          | List saved layouts                       |
| POST   | `/api/v1/layouts`          | Save `{ name, symbol, timeframe, state }`|
| PUT    | `/api/v1/layouts/:id`      | Update                                    |
| DELETE | `/api/v1/layouts/:id`      | Delete                                    |

---

## Simulated trading  🔒

Backed by `sim_accounts` + `sim_positions` (one self-contained table; a pending order is a position
with `status=pending`, fills embedded). Optional / later phase — the replay simulator can stay
client-side until durable backtests are needed.

| Method | Path                                    | Purpose                                |
| ------ | --------------------------------------- | -------------------------------------- |
| GET    | `/api/v1/sim/accounts`                  | List accounts                          |
| POST   | `/api/v1/sim/accounts`                  | Create `{ name, startingEquity }`      |
| GET    | `/api/v1/sim/accounts/:id/positions`    | Positions (filter `?status=open`)      |
| POST   | `/api/v1/sim/accounts/:id/orders`       | Place `{ symbol, side, type, qty, price?, sl?, tp? }` (`side`: long \| short) → creates a `sim_positions` row |
| POST   | `/api/v1/sim/positions/:id/close`       | Close a position                       |
| GET    | `/api/v1/sim/accounts/:id/analytics`    | Win rate, PF, expectancy, DD, R-dist   |

---

## Adding a new endpoint

1. Create a package under `internal/` for the domain area, e.g. `internal/drawings/`.
2. Keep request/response DTOs near the handler.
3. Expose a `RegisterRoutes(r fiber.Router)` function; mount protected groups behind the
   `auth.RequireAuth` middleware (`AUTH.md` §6).
4. Register the route group from `internal/httpserver/server.go`.
5. Back it with an `sqlc`-generated repo; keep business logic out of handlers so it's testable
   without an HTTP server.
