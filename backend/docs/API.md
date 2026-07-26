# API Reference

Base URL (dev): `http://localhost:8080`
API prefix: `/api/v1` (except `/health`).

> Status: health, auth, settings/bootstrap, watchlists, drawings, indicators,
> Pine scripts/runtime, MT5, layouts, and the alert/push API are implemented. Alerts include
> immutable fixed/dynamic technical targets, evidence-verified triggers, expiration, and re-arming.
> Phase 13 resources remain planned contracts. See `AUTH.md` for auth and
> `DATABASE.md` for persistence details.
>
> Backend-owned replay endpoints are implemented. The session, track, command,
> event, and concurrency details are maintained in
> `../../docs/REPLAY_BACKEND_PHASE6.md` and the frontend contract in
> `../../frontend/docs/REPLAY_ARCHITECTURE.md`.

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

## Chart time navigation

These public endpoints own the bottom chart shortcut catalog and range policy.
The browser supplies the latest loaded candle as the anchor and applies the
returned viewport; it must not duplicate shortcut-to-timeframe or date math.

### `GET /api/v1/chart/time-navigation/shortcuts`

Returns the ordered toolbar catalog plus backend-owned Go-to capabilities:

```json
{
  "shortcuts": [
    {
      "id": "1D",
      "timeframe": "1m",
      "tooltip": "1 day in 1 minute intervals"
    }
  ],
  "goTo": {
    "hotkey": { "label": "Alt+G", "key": "g", "altKey": true },
    "specificTimeTimeframes": [
      "1m", "3m", "5m", "15m", "30m", "1H", "2H"
    ]
  },
  "timeZone": {
    "exchange": "Asia/Ho_Chi_Minh",
    "data": "UTC"
  }
}
```

The time field is enabled only when the active chart timeframe appears in
`specificTimeTimeframes`. Longer intervals navigate by calendar date at
`00:00` in the selected chart timezone.

`timeZone.exchange` is the backend-configured IANA timezone used when the chart
selects `Exchange`. `timeZone.data` documents the immutable MT5 candle timestamp
domain. The browser formats UTC timestamps in the selected chart timezone; it
must not shift candle, drawing, replay, or trade coordinates.

### `POST /api/v1/chart/time-navigation/resolve`

Request timestamps are Unix seconds. Calendar shortcuts are resolved in UTC.

```json
{ "shortcut": "YTD", "anchorTime": 1783756800 }
```

Range response:

```json
{
  "shortcut": "YTD",
  "timeframe": "1D",
  "tooltip": "Year to date in 1 day intervals",
  "mode": "range",
  "from": 1767225600,
  "to": 1783756800
}
```

`All` returns `mode: "all"` without `from`/`to`; the frontend then calls
`fitContent()`. Invalid shortcuts or non-positive anchors return `400`.

---

## Auth

See `AUTH.md` for the full flow and token model.

All three session-establishment endpoints accept only Firebase ID tokens whose current provider is
Google, whose Google provider subject is present, and whose email is verified. The auth request
body is capped at a 16 KiB ID token. `/auth/session`, `/auth/google`, and `/auth/refresh` share a
limit of 120 requests per five minutes per client IP.

### `POST /api/v1/auth/google` (compatibility)

Login **or** register with a Google account. First sign-in creates the user; later sign-ins reuse
it. This compatibility endpoint always creates a new backend session. New browser bootstrap code
must use `/auth/session` so it can safely reuse/rotate an existing matching session.

**Request**
```json
{ "idToken": "<firebase-id-token>" }
```

**Response** `200 OK` — sets `access_token` + `refresh_token` HttpOnly, Secure,
SameSite=Strict cookies.
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

### `POST /api/v1/auth/session`

Preferred browser bootstrap endpoint. Accepts the same `{ "idToken": "..." }` body as
`/auth/google`, verifies the current Google/Firebase identity, and then performs exactly one of:

- reuse a valid access cookie belonging to that same user;
- atomically rotate a matching refresh cookie; or
- create a new backend session.

Returns the same `user` and `isNewUser` response as `/auth/google`. Invalid, revoked, disabled,
non-Google, or unverified-email Firebase identities return `401`; oversized tokens return `400`;
repeated auth attempts return `429`. A transient Firebase revocation-check timeout, quota response,
network error, or upstream 5xx returns retryable `503`. Cookies are emitted only for the
rotate/create branches. A valid matching access session returns `200` without rewriting either
cookie.

If Firebase user B calls this endpoint while browser cookies still belong to user A, A's access
cookie is never reused for B. A rotated mismatched refresh descendant is revoked before B receives
a newly created session.

### `POST /api/v1/auth/refresh`

Rotates the refresh token and issues a fresh access token. Requires the `refresh_token` cookie.

**Response** `200 OK` — new cookies set. Body: `{ "ok": true }`.
Rotation is a single PostgreSQL lock/revoke/insert operation, so two concurrent requests cannot
both mint a descendant. Errors: `401` for missing/unknown/expired refresh tokens; replay of an
already-revoked token also returns `401` and revokes all active sessions for that user. Disabled or
deleted users cannot refresh.

### `POST /api/v1/auth/logout`  🔒

Revokes the current session and clears both cookies. `200 { "ok": true }`.

### `GET /api/v1/auth/me`  🔒

**Response** `200 OK` → the `user` object (same shape as above).

### `DELETE /api/v1/auth/sessions`  🔒

Sign out of every device (revoke all sessions). `200 { "ok": true }`.

Auth cookies are `HttpOnly; Secure; SameSite=Strict`. The access cookie uses `Path=/`; the refresh
cookie uses `Path=/api/v1/auth`. Unsafe requests carrying cookies require an allowed `Origin`;
missing/disallowed origins return `403`. See `AUTH.md` for JWT issuer/audience and deployment rules.

---

## Sync bootstrap

### `GET /api/v1/sync/bootstrap`  protected, implemented

One call that returns the user's workspace for hydrating local stores on sign-in
(`DATABASE.md` section 11). Alert history is capped at 200 rows by the repository.

**Response** `200 OK`
```json
{
  "settings":         { "ui": {}, "smc": {}, "chart": {}, "notifications": {} },
  "watchlists":       [],
  "drawingTemplates": [],
  "indicators":       [],
  "pineScripts":      [],
  "alerts":           [],
  "triggeredAlerts":  [],
  "history":          [],
  "layouts":          []
}
```
Loaded lazily by their own endpoints (larger / scoped payloads), **not** in bootstrap: per-symbol
`drawings`, `journal`, `screenshots`, and sim-trading.

`layouts` includes complete small layout rows with their opaque `state`
snapshots, allowing the frontend to restore the default layout without a second request.

---

## Settings  protected, implemented

Backed by `user_settings` (1:1). See `DATABASE.md` section 6.1. `GET` auto-creates the row for a
new authenticated user, `PUT` replaces all four sections, and `PATCH` deep-merges object sections.
The frontend uses `ui` for theme/shell/grid preferences, `smc` for overlay toggles, `chart` for
timezone and drawing-tool preferences, and `notifications` for global alert channels. Mutations
may patch one section without replacing unrelated settings. PATCH transactions lock the user's
settings row while merging, so concurrent updates to different sections cannot overwrite each
other.

Example partial update (omitted sections are preserved):

```json
{
  "ui": { "theme": "dark", "gridVisible": true },
  "smc": { "structure": true },
  "chart": {
    "timeZone": "exchange",
    "drawingSyncMode": "global",
    "drawingToolPreferences": {
      "version": 1,
      "keepDrawing": false,
      "magnetEnabled": false,
      "magnetMode": "weak",
      "toolDefaults": {}
    }
  }
}
```

| Method | Path                                         | Purpose                                          |
| ------ | -------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/v1/settings`                           | Get `{ ui, smc, chart, notifications }`          |
| PUT    | `/api/v1/settings`                           | Replace all sections                             |
| PATCH  | `/api/v1/settings`                           | Merge a partial (e.g. just `ui.theme`)           |
| GET    | `/api/v1/settings/chart/favorite-timeframes` | Get the signed-in user's starred chart intervals |
| PUT    | `/api/v1/settings/chart/favorite-timeframes` | Replace the signed-in user's starred intervals   |

Favorite timeframe requests use this shape:

```json
{ "timeframes": ["1m", "5m", "15m"] }
```

The API canonicalizes duplicates into chart order and accepts only `1m`, `3m`,
`5m`, `15m`, `30m`, `1H`, `2H`, `4H`, `1D`, `1W`, and `1M`. A missing stored
value returns the default `1m`, `5m`, `15m`; an explicit empty array is kept so
users can remove every favorite. The update patches only
`user_settings.chart.favoriteTimeframes`, preserving other chart preferences.

---

## Private integration settings 🔒

MT5, Telegram, and Discord credentials are stored per user in
`user_integrations`. Secret fields are encrypted at rest and are never returned
by GET/PUT responses; each secret is represented only by its `*Configured`
boolean. Non-secret MT5 verification state is returned separately.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/settings/integrations` | Read masked integration status |
| PUT | `/api/v1/settings/integrations` | Save metadata, enable flags, and optional replacement secrets |
| POST | `/api/v1/settings/integrations/verify/mt5` | Verify the signed-in user's saved MT5 credentials |
| POST | `/api/v1/settings/integrations/mt5/connector-ticket` | Issue a two-minute, one-use Connector pairing ticket for the signed-in verified account |
| POST | `/api/v1/settings/integrations/mt5/connector/validate` | Consume a pairing ticket from the loopback Connector and return its account/session boundary |
| POST | `/api/v1/settings/integrations/test/telegram` | Send a Telegram test message |
| POST | `/api/v1/settings/integrations/test/discord` | Send a Discord test message |
| POST | `/api/v1/settings/integrations/deliver` | Deliver a browser-open alert through enabled per-user channels |
| POST | `/api/v1/settings/integrations/worker-deliver` | Service-authenticated closed-browser delivery using a signed user token |

Blank secret strings preserve the existing secret. Set the corresponding
`clearPassword`, `clearBotToken`, or `clearWebhook` flag to remove one.

The masked MT5 response includes `login`, `server`, `passwordConfigured`,
`verified`, and nullable `verifiedAt`. Saving a changed login/server/password or
clearing the password invalidates only that user's previous verification.

`POST /api/v1/settings/integrations/verify/mt5` has no request body. It decrypts
the saved password inside the backend, passes credentials to the short-lived MT5
helper over stdin, and returns a sanitized result. A successful response is:

```json
{
  "ok": true,
  "mt5": {
    "login": "12345678",
    "server": "FTMO-Server4",
    "passwordConfigured": true,
    "verified": true,
    "verifiedAt": "2026-07-19T13:30:00Z"
  },
  "account": {
    "login": "12345678",
    "server": "FTMO-Server4",
    "currency": "USD",
    "tradeAllowed": true
  }
}
```

Credential rejection returns `422`; incomplete/invalid saved credentials return
`400`; a concurrent credential change returns `409`; verifier infrastructure
failures return `502` or `503`, and a bounded verifier timeout returns `504` with
`MT5_VERIFICATION_TIMEOUT`. The production runner automatically supplies an isolated portable
terminal; an unavailable verifier returns only the generic `MT5_VERIFIER_UNAVAILABLE` response,
while operator diagnostics remain in backend logs. Verification updates are conditional on the same
encrypted credential row, so a slow result cannot approve credentials that were edited while the
helper was running.

The browser requests a Connector ticket only after backend verification. The API stores only its
SHA-256 digest, expires it after two minutes, consumes it once, and rejects it if the saved
credential row changed. The packaged loopback Connector validates the ticket, selects the open
FTMO terminal with the same login/server, and receives a 15-minute session boundary. It rechecks
account identity and trading permission before live commands; no MT5 password is returned to the
browser or Connector.

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
  "sections": [{ "title": "SECTION 1", "index": 1 }],
  "sortKey": "manual",
  "sortDir": "asc"
}
```

Use `PUT /api/v1/watchlists/:id/layout` for add/remove/clear symbol,
section add/rename/delete, and drag/drop reorder. It is the common persistence
path for TradingView-style watchlist gestures. `sortKey` and `sortDir` are
optional for compatibility; current clients include them so a drag/drop layout
and its `manual` display mode commit atomically.

The frontend serializes full-layout writes per watchlist, while allowing
different watchlists to sync independently. The backend additionally locks the
owned `watchlists` row with `SELECT ... FOR UPDATE` before its transactional
delete-and-reinsert. This prevents overlapping layout replacements from
interleaving or producing a `watchlist_symbols` unique-constraint `500`.
Cross-device conflict resolution is currently transaction-order
last-write-wins; revision-based conflict responses are not yet implemented.

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
| Go API | `GET /api/v1/mt5/market-status?symbols=EURUSD,GBPUSD` | Returns cached broker-native scheduled session status; missing or expired helper data is `unknown` |
| Go API | `GET /api/v1/mt5/history?symbol=EURUSD&timeframe=15m&limit=1500&refresh=true` | Returns MT5 OHLC candles; `refresh=true` performs a synchronous cache read-through |
| Go API | `GET /api/v1/mt5/history/around?symbol=EURUSD&timeframe=15m&time=1782345600&limit=600` | Returns bounded context around a Go-to timestamp plus explicit `requestedTime` and first tradable `resolvedTime` |

History scheduling:

- The browser must request chart candles from `GET /api/v1/mt5/history`; ticks are quote/watchlist
  data only and must not be used to synthesize missing candles.
- The Go service keeps a per-`symbol:timeframe` candle cache. Ordinary non-refresh requests can
  return a cached latest window immediately and revalidate it in the background. Requests with
  `refresh=true` wait for an MT5 read-through and do not silently accept an unverifiable or stale
  window as success. If MT5 cannot reach the current bar, the response keeps the usable cached
  candles, includes `lastError`, and reports `stale` and/or `refreshExhausted`.
- Older pagination requests (`before > 0`) still wait for MT5 history because they extend the left
  side of the visible chart. Go only reuses a page when that exact strict-before cursor was loaded
  from MT5 with at least the requested limit. It also bounds the cached result to that recorded page,
  so disjoint latest/Go-to cache islands cannot leak into pagination. This rule is also what makes
  Replay `Select date -> First day` resolve against the requested historical window. Cursor coverage
  metadata is bounded per symbol/timeframe; an evicted cursor is safely reloaded from MT5.
- Cursor reads ask MT5 for `limit + 1` bars and return at most `limit`. This makes `hasMore` exact even
  when the terminal boundary contains exactly `limit` bars. An empty page remains unannotated and
  retryable because a cold MT5 segment cannot be distinguished safely from the true boundary.
- Go-to requests use `/history/around` instead of guessing a pagination cursor. The Python bridge
  loads left context separately and expands its forward range across weekends/market closures;
  Go returns no resolution rather than silently clamping to the first or last cached candle.
- Identical history requests are single-flighted in Go: only one payload is sent to the Python MT5
  bridge and concurrent callers share the result. Each caller waits with its own context, so one
  canceled browser effect does not cancel another active waiter for the same history window.
- History requests are gated by a Go-side concurrency slot before writing to the Python bridge. If
  the browser aborts a stale request while it is queued, the request is canceled before it reaches
  MT5. This is required because the Python bridge executes MT5 history work on a single safe worker.
- When every waiter abandons a request that has already reached the bridge, Go sends
  `history.cancel`. Python cancels the associated asyncio task; executor work that is still queued is
  removed before it can delay the newly selected timeframe. An MT5 call already executing cannot be
  interrupted. If such a response arrives anyway, Go rejects it at the pending-request boundary so it
  cannot overwrite a newer candle.
- The Python bridge also runs tick snapshots, live tick polling, and
  `stream.subscribe` symbol selection through the same single MT5 worker. Do
  not call `MetaTrader5` directly from the asyncio WebSocket loop; doing so can
  block new Go bridge handshakes and make `/api/v1/mt5/symbols` return
  `connected=false` with an `i/o timeout`.
- Frontend timeframe/symbol effects should pass `AbortSignal` to the API call and abort cleanup
  requests on selection changes.
- Freshness is enforced consistently for `1m`, `3m`, `5m`, `15m`, `30m`, `1H`, `2H`, `4H`, `1D`,
  `1W`, and `1M`. Fixed-duration bars are current only when their open is less than one complete
  interval behind the newest normalized MT5 tick. Monthly freshness is calendar based: the minimum
  accepted open is the UTC first of the tick's month minus 48 hours for broker/DST alignment.
- Latest responses expose `freshnessKnown`, `lastBarTime`, and `minimumFreshBarTime`; stale or
  in-progress responses additionally expose `stale`, `refreshPending`, and/or `refreshExhausted`.
  `freshnessKnown=false` means no MT5 tick reference was available and must not be treated as proof
  of freshness. Older bridge versions that omit the whole contract remain rolling-upgrade compatible.
- An ordinary request returns the first non-empty MT5 window for a fast first paint. An explicit
  `refresh=true` request also retries a non-empty stale window within the bounded bridge budget and
  succeeds only with current-bar evidence. Empty responses are retried in both modes.
- After a small active-chart refresh, the frontend checks whether the returned page overlaps or
  directly continues the cached tail. If it begins more than one bar interval later, the browser
  treats the first-paint window as stale, fetches a full authoritative window large enough to
  preserve already paginated depth, and replaces its local `symbol:timeframe` candle cache. Monthly
  continuity allows the full calendar-month range. Cached selections issue one authoritative
  refresh. A cold stale/unknown first paint escalates that first refresh to the full initial window
  after canceling the lower-priority background read, and transient active-refresh failures receive a
  short bounded retry before the normal timeframe interval. Indicator warm-up history for the same
  live symbol/timeframe is invalidated after an authoritative MT5 refresh.

A current latest-window response carries explicit evidence (false status flags are omitted):

```json
{
  "connected": true,
  "source": "mt5",
  "symbol": "USDCHF",
  "timeframe": "15m",
  "freshnessKnown": true,
  "lastBarTime": 1800000000,
  "minimumFreshBarTime": 1799999999,
  "candles": [
    {
      "time": 1800000000,
      "open": 0.8124,
      "high": 0.8127,
      "low": 0.8121,
      "close": 0.8125,
      "volume": 842
    }
  ]
}
```

Successful `/history/around` responses identify both sides of the resolution contract:

```json
{
  "connected": true,
  "source": "mt5",
  "symbol": "EURUSD",
  "timeframe": "15m",
  "requestedTime": 1782370800,
  "resolvedTime": 1782370800,
  "candles": [
    {
      "time": 1782370800,
      "open": 1.1701,
      "high": 1.1708,
      "low": 1.1697,
      "close": 1.1705,
      "volume": 842
    }
  ]
}
```

`resolvedTime` is always the first returned MT5 candle whose open time is greater than or equal to
`requestedTime`. When no such candle exists, the response omits `resolvedTime`, sets `lastError`,
and the frontend keeps the Go-to dialog open instead of moving the viewport.

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

The bridge then sends a `market_status` snapshot sourced from the read-only MQL5
helper. Unlike static `trade_mode` metadata or tick-age heuristics, this status
uses the broker's native `SymbolInfoSessionTrade` windows and expires quickly:

```json
{
  "type": "market_status",
  "source": "mt5-mql5-session",
  "statuses": [
    {
      "symbol": "EURUSD",
      "state": "closed",
      "scheduled_open": false,
      "reason": "outside_trade_session",
      "session_open_at": 0,
      "session_close_at": 0,
      "next_open_at": 1784581200,
      "next_transition_at": 1784581200,
      "server_time": 1784491200,
      "observed_at": 1784491200,
      "valid_until": 1784491215
    }
  ]
}
```

The Python package itself cannot call `SymbolInfoSessionTrade`. Install
`backend/bridge/mt5_session/TradingSessionBridge.mq5` to provide that read-only
local IPC feed. If the helper, terminal, or bridge heartbeat is unavailable,
the state is `unknown`; the system never turns an old tick into a false `closed`
or keeps an expired `open` alive.

`server_time`/`serverTime` and `observed_at`/`observedAt` are UTC heartbeat
reference seconds. The helper evaluates weekly windows with broker server time
and converts the resolved boundaries to UTC. Future boundaries are refreshed
continuously and may adjust when the broker changes its server UTC/DST offset.
This is exact for the broker's configured scheduled sessions and contract life,
not a guarantee that an order will be accepted during a holiday, emergency
halt, or unscheduled maintenance window.

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

Market-status API response:

```json
{
  "connected": true,
  "bridgeUrl": "ws://localhost:8765",
  "source": "mt5-mql5-session",
  "sessions": [
    {
      "symbol": "EURUSD",
      "source": "mt5-mql5-session",
      "state": "closed",
      "scheduledOpen": false,
      "reason": "outside_trade_session",
      "sessionOpenAt": 0,
      "sessionCloseAt": 0,
      "nextOpenAt": 1784581200,
      "nextTransitionAt": 1784581200,
      "serverTime": 1784491200,
      "observedAt": 1784491200,
      "validUntil": 1784491215
    }
  ],
  "updatedAt": "2026-07-19T00:00:00Z"
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
  "sessions": [
    {
      "symbol": "EURUSD",
      "source": "mt5-mql5-session",
      "state": "open",
      "scheduledOpen": true,
      "reason": "within_trade_session",
      "sessionOpenAt": 1759946400,
      "sessionCloseAt": 1760032800,
      "nextOpenAt": 1760119200,
      "nextTransitionAt": 1760032800,
      "serverTime": 1760000000,
      "observedAt": 1760000000,
      "validUntil": 1760000015
    }
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

// server -> client (session transition or helper heartbeat)
{
  "type": "market_status",
  "connected": true,
  "source": "mt5-mql5-session",
  "sessions": [
    {
      "symbol": "EURUSD",
      "source": "mt5-mql5-session",
      "state": "closed",
      "scheduledOpen": false,
      "reason": "outside_trade_session",
      "sessionOpenAt": 0,
      "sessionCloseAt": 0,
      "nextOpenAt": 1760202000,
      "nextTransitionAt": 1760202000,
      "serverTime": 1760032800,
      "observedAt": 1760032800,
      "validUntil": 1760032815
    }
  ],
  "updatedAt": "2026-07-07T21:20:00Z"
}
```

The frontend `Mt5Provider` uses `/api/v1/mt5/stream` for subscribed watchlist/chart
quotes. It must not poll `/api/v1/mt5/ticks` on an interval; `/ticks` is retained
for one-off snapshots, debugging, and compatibility. MT5 chart candles must come
from `/api/v1/mt5/history` because bid/ask ticks are not a full OHLC source.
Active MT5 charts pass `refresh=true` with a small `limit` to bypass the backend
cache and update the latest bars from MT5 rates. The first refresh runs immediately for every
timeframe (including `1W`/`1M`) and rejects stale, pending, exhausted, or explicitly unknown
freshness without overwriting the current chart. A disconnected refresh boundary triggers the
full-window authoritative recovery described above instead of leaving stale and warmed price
segments in one chart series. The `streamSymbols` array from
`/api/v1/mt5/symbols` is the confirmed live set from the Python bridge. If the browser later
subscribes to a catalog symbol that is not in that initial set, the Go API sends a
`stream.subscribe` message to the Python bridge and waits for the bridge catalog update to confirm
the symbol is selectable. Symbols rejected by `symbol_select()` remain catalog/search-only and
should not be shown as live streamable rows.

MT5 history candle `time` values are the UTC bar-open seconds returned by
MetaQuotes `copy_rates_*`. Do not apply broker/local timezone offsets to candle
times. The bridge may normalize tick timestamps before publishing them so quote
freshness checks compare ticks and rates in the same UTC domain. This follows the official
MetaQuotes contracts for
[`copy_rates_from`](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrom_py),
[`copy_rates_from_pos`](https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrompos_py),
and [`symbol_info_tick`](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py).

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

Backed by `indicator_presets`. The backend stores the full frontend
`IndicatorConfig` in `config` and promotes `indicatorType`, `visible`,
`position`, and `clientId` for ordering and idempotent sync. `clientId` is the
frontend `IndicatorConfig.id`; `:id` may be either the backend UUID or that
client id.

| Method | Path                        | Purpose                          |
| ------ | --------------------------- | -------------------------------- |
| GET    | `/api/v1/indicators`        | List presets                     |
| POST   | `/api/v1/indicators`        | Create/upsert by `clientId`      |
| PUT    | `/api/v1/indicators/:id`    | Replace config/visible/position |
| DELETE | `/api/v1/indicators/:id`    | Remove                           |

Request body:

```json
{
  "indicatorType": "EMA",
  "config": { "id": "ind_abc", "type": "EMA", "length": 50, "visible": true },
  "visible": true,
  "position": 0,
  "clientId": "ind_abc"
}
```

Response rows:

```json
{
  "id": "server-uuid",
  "indicatorType": "EMA",
  "config": { "id": "ind_abc", "type": "EMA", "length": 50, "visible": true },
  "visible": true,
  "position": 0,
  "clientId": "ind_abc",
  "createdAt": "2026-07-09T00:00:00Z",
  "updatedAt": "2026-07-09T00:00:00Z"
}
```

---

## Pine scripts  🔒

Backed by `pine_scripts`. List and bootstrap responses are metadata-only
(`sourceCode` omitted) so the script browser stays light. Fetch one script by
id/clientId when the editor needs source text. `clientId` is the frontend
`CustomIndicatorScript.id`; `:id` may be either backend UUID or client id.

| Method | Path                          | Purpose                        |
| ------ | ----------------------------- | ------------------------------ |
| GET    | `/api/v1/pine-scripts`        | List metadata                  |
| GET    | `/api/v1/pine-scripts/:id`    | Get one (with `source`)        |
| POST   | `/api/v1/pine-scripts`        | Create/upsert by `clientId`    |
| POST   | `/api/v1/pine-scripts/:id/publish` | Publish/update in public Store |
| PUT    | `/api/v1/pine-scripts/:id`    | Patch name/source/favorite/meta|
| DELETE | `/api/v1/pine-scripts/:id`    | Delete                         |

Create/upsert body:

```json
{
  "name": "Better RSI",
  "sourceCode": "indicator(\"Better RSI\")\nplot(close)",
  "favorite": true,
  "clientId": "pine_abc",
  "meta": {}
}
```

Favorite-only patch:

```json
{ "favorite": false }
```

Oversized source code above 64 KB returns `400`.

---

## Indicator Store public

Backed by `public_pine_scripts`. Reads do not require auth. Publishing still
requires the owner to save a private Pine script first, then call the protected
publish endpoint above.

| Method | Path                         | Purpose                              |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/api/v1/indicator-store`    | List public indicators               |
| GET    | `/api/v1/indicator-store/:id`| Get one public indicator             |

Query:

```text
GET /api/v1/indicator-store?query=rsi
```

Response rows include `sourceCode` so anonymous visitors can add public scripts
to chart without a private script lookup:

```json
{
  "id": "public-uuid",
  "scriptId": "source-script-uuid",
  "name": "Better RSI",
  "sourceCode": "indicator(\"Better RSI\")\nplot(close)",
  "authorId": "user-uuid",
  "author": "TradeCalmly",
  "boosts": 0,
  "meta": {},
  "createdAt": "2026-07-09T00:00:00Z",
  "updatedAt": "2026-07-09T00:00:00Z"
}
```

---

## Common indicator runtime

Catalog entries, saved scripts, and public scripts use one definition and
compute contract. The frontend contains no catalog list or type-specific
execution branch; it renders backend metadata and returned chart primitives.

| Method | Path                                   | Purpose |
| ------ | -------------------------------------- | ------- |
| GET    | `/api/v1/indicator-runtime/catalog`    | Ordered backend catalog with names, defaults, inputs, styles, pane placement, and history metadata |
| POST   | `/api/v1/indicator-runtime/definition` | Resolve the same definition shape from a catalog type or supplied Pine source |
| POST   | `/api/v1/indicator-runtime/compute`    | Compile a catalog or user-source indicator against OHLCV |

Request:

```json
{
  "indicatorType": "catalog-or-script-key",
  "indicatorId": "ind_abc",
  "sourceCode": "optional Pine source for a saved/public script",
  "timeframe": "15m",
  "symbol": "BTCUSD",
  "symbolType": "crypto",
  "mintick": 0.1,
  "timezone": "UTC",
  "config": {
    "type": "catalog-or-script-key",
    "inputValues": { "period": 25 },
    "styleValues": {}
  },
  "replayCutoff": 1783420800,
  "candles": [
    { "time": 1783420800, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "volume": 100 }
  ]
}
```

Response:

```json
{
  "result": { "id": "ind_abc", "series": [] },
  "errors": [],
  "warnings": []
}
```

The common compiler sorts/deduplicates candles, caps the supplied window at
5,000 bars, maps instance properties to Pine inputs/styles, and emits one
`IndicatorResult` contract. When `sourceCode` is present it wins; otherwise the
backend resolves embedded source by `indicatorType`. Both paths invoke the same
`Compile` function. Backend definitions also expose legacy property bindings so
old persisted presets can be hydrated without frontend type-name dispatch.
The optional market fields supply Pine `syminfo.tickerid`, `syminfo.type`,
`syminfo.mintick`, and `syminfo.timezone`; they are part of runtime cache
identity and should come from the active provider symbol catalog.

### Replay no-lookahead boundary

`replayCutoff` is optional and is an inclusive Unix timestamp in seconds. The
Replay client derives it from the backend's `tracks[0].visibleThrough` value and
must not derive it from a local wall clock or viewport. Omit the field for live
behavior; values outside `1..253402300799` (including JavaScript milliseconds)
are rejected.

When a cutoff is present, the common backend path applies the same boundary to
catalog indicators and saved/public Pine source:

- normalize, sort, deduplicate, and filter candles at or before the cutoff
  before the 5,000-bar cap and Pine compilation;
- remove series and labels that exist only after the boundary;
- clip continuous geometry that crosses the boundary, while never synthesizing
  a boundary sample for histogram/discrete output;
- force `extendToVisibleRange` off for Replay results; and
- include the cutoff in the runtime cache key so live, forward, and rewind
  calculations cannot reuse a look-ahead result.

The backend is authoritative. Frontend projection additionally clips series,
labels, and magnet points as defense in depth, but it must never widen the
backend result.

Swing pivots are emitted only after the complete right-hand strength window
exists, so replay cannot observe a future candle.

The catalog intentionally does not include the legacy `SWING_SR` type anymore.
Persisted rows may still contain that opaque value, but a runtime compute request
for it is unsupported. Clients can offer an explicit unavailable/migration
state; the backend does not silently substitute a formula or keep a hidden
type-specific branch.

---

## Pine runtime

Runtime-only compiler endpoints. These routes do not persist scripts and do not
require auth. Saved script CRUD remains under `/api/v1/pine-scripts`; the
runtime receives source plus candles and returns chart primitives.

| Method | Path                           | Purpose                                      |
| ------ | ------------------------------ | -------------------------------------------- |
| POST   | `/api/v1/pine-runtime/meta`    | Extract `indicator()` / `study()` metadata   |
| POST   | `/api/v1/pine-runtime/inputs`  | Extract Inputs-tab schema                    |
| POST   | `/api/v1/pine-runtime/styles`  | Extract Style-tab schema                     |
| POST   | `/api/v1/pine-runtime/compile` | Compile source against supplied OHLCV bars and optional replay cutoff |

Compile request:

```json
{
  "scriptId": "ind_abc",
  "sourceCode": "//@version=5\nindicator(\"VSA\")\nplot(volume)",
  "timeframe": "15m",
  "symbol": "BTCUSD",
  "symbolType": "crypto",
  "mintick": 0.1,
  "timezone": "UTC",
  "replayCutoff": 1783420800,
  "candles": [
    { "time": 1783420800, "open": 1.1, "high": 1.2, "low": 1.0, "close": 1.15, "volume": 100 }
  ],
  "inputOverrides": {},
  "styleOverrides": {}
}
```

`replayCutoff` is optional and inclusive. When supplied, the backend performs
the same causal boundary as `/api/v1/indicator-runtime/compute`: it retains
pre-cutoff candles supplied in the request as warm-up context (without fetching
missing history), executes only through the selected candle,
removes future objects/labels, clips geometry crossing the boundary, disables
right-side extensions, and includes the cutoff in the cache key. Omit it for
live behavior. It is a Unix timestamp in seconds, not JavaScript milliseconds.

Compile response:

```json
{
  "meta": {
    "name": "VSA",
    "overlay": false,
    "version": 5,
    "properties": { "title": "VSA" }
  },
  "result": { "id": "ind_abc", "series": [] },
  "errors": [],
  "warnings": [],
  "unsupportedFeatures": []
}
```

Current runtime subset covers generic metadata/input/style extraction, source
version/declaration properties, series assignments, recursive/self-referential
series patterns, plot/hline/fill output, fixed higher-timeframe
`request.security()` aggregation for the current symbol (positional or named
required arguments),
and the Pine functions needed by VSA Volume, Better RSI, ADR-style scripts,
and confirmed `ta.pivothigh()` / `ta.pivotlow()` calculations. `plot(...,
style=linebr)` and
`plot.style_linebr` compile into independent chart series split at every `na`
gap so the frontend never bridges conditional plot ranges. `hline()` and
`fill()` reference outputs carry `extendToVisibleRange=true`; clients should
project those sparse series onto the current candle window before rendering so
indicator panes do not show right-side gaps. Object APIs such as `line.new`,
`line.set_*`, `label.new`, `label.set_*`, `box.new`,
`box.set_*`, `table.new`, and `table.cell` compile to chart-ready line, fill,
label, and dashboard payloads. Multiline drawing constructors are coalesced
before vector object scanning, and nested constructors retain every enclosing
branch condition. Omitted `plot()` and `label.new()` colors use the corresponding
Pine defaults, while an explicit `color(na)` remains transparent. Intermediate
series referenced by `request.security()` are re-evaluated in its aggregated
child context rather than frozen from the chart timeframe.

Color expressions accept Pine's `#RRGGBB` and `#RRGGBBAA` literals in both the
vector and stateful execution paths. They remain typed colors when used
directly, assigned to variables, supplied as `input.color()` defaults, or
nested inside `color.new()`. The optional `AA` pair is opacity (`00`
transparent, `FF` opaque); malformed color literals return a structured compile
diagnostic. `color.new(base, transp)` replaces existing alpha using Pine's
`0`-opaque to `100`-invisible transparency scale. Catalog callers do not need
legacy top-level color fields to make source-defined defaults compile.
Plots whose evaluated color is a series retain their per-bar palette even when
an older caller supplies one scalar Style color. Definition extraction marks
those plots as not supporting the current single-color editor, preventing new
instances from manufacturing a palette-destroying default override.

Pine sources (`indicator()` and legacy `study()` declarations; strategy/library
execution remains explicitly unsupported) execute sequentially on closed bars:
OHLCV/bar-state values are
updated, the source runs with data available on that bar, and series/history
and object state are committed before the next bar. The backend intentionally
does not emulate realtime tick rollback or `varip`. Unsupported language or
declaration features fail closed with structured diagnostics. See TradingView's
[execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/)
and [declaration statements](https://www.tradingview.com/pine-script-docs/language/declaration-statements/)
for the compatibility contract.

The declaration metadata contract preserves literal/enum-valued positional and
named arguments for `title`, `shorttitle`, `overlay`,
`format`, `precision`, `scale`, `max_bars_back`, `timeframe`,
`timeframe_gaps`, `explicit_plot_zorder`, `max_lines_count`,
`max_labels_count`, `max_boxes_count`, `calc_bars_count`,
`max_polylines_count`, `dynamic_requests`, and `behind_chart`. Metadata presence
does not imply full visual/execution parity: the API exposes overlay/timeframe
for caller-side placement/routing, and both execution paths apply line/label/box
retention limits (default 50). A non-empty declaration timeframe and the `timeframe_gaps`,
`calc_bars_count`, or `dynamic_requests` properties fail closed because their
execution semantics are not implemented. Formatting, z-order, polylines, and
behind-chart behavior remain metadata-only compatibility gaps. Features on the
explicit unsupported list fail closed; other syntax is supported only where
covered by compiler diagnostics and regression fixtures. Input changes trigger
a fresh historical evaluation. Missing/pre-v5 annotations and v6 return an
explicit compatibility warning; versions newer than v6 fail closed. Pine
v5/v6 semantic differences beyond the supported subset are not otherwise
version-gated.

### Generic Swing Highs/Lows fixture

The regression source
`backend/internal/pineruntime/testdata/swing_high_low_luxalgo.pine` is the
user-provided Pine v5 Swing Highs/Lows script. It exercises multiline string
continuations/escaped newlines, grouped inputs, a `pattern` UDT and
`pattern.new()`, positional/named UDT fields with declaration defaults, pivot
confirmation/history, nullable UDT ternaries, and `label.new()`
style/text-color/tooltip properties. Regression coverage includes an actual
Shooting Star match, its dynamic description tooltip, input color overrides,
and Replay cutoff causality. It is compiled through this generic endpoint, not
registered as `SWING_SR`. LuxAlgo attribution and the CC BY-NC-SA 4.0 notice
remain in the fixture.

---

## Alerts - browser protected / worker service-authenticated, implemented

Backed by `alerts` + `alert_events`. The alert body carries per-alert delivery channels; the
**global** notification defaults (`AlertSettings`) are read/written via `/api/v1/settings`
(`notifications` section), not here.

| Method | Path                            | Purpose                                      |
| ------ | ------------------------------- | -------------------------------------------- |
| GET    | `/api/v1/alerts`                | List; optional `?status=active|triggered|expired` |
| POST   | `/api/v1/alerts`                | Idempotent create/upsert by `clientId`       |
| PATCH  | `/api/v1/alerts/:id`            | Update / pause (`enabled:false`) / re-arm    |
| DELETE | `/api/v1/alerts/:id`            | Delete alert; retained history is unaffected |
| POST   | `/api/v1/alerts/:id/trigger`    | Atomically trigger and append one event      |
| POST   | `/api/v1/alerts/worker-trigger` | Service-authenticated closed-browser trigger |
| GET    | `/api/v1/alerts/:id/events`     | Trigger history for one alert                |
| GET    | `/api/v1/alerts/history`        | All events, newest-first, max 200            |
| DELETE | `/api/v1/alerts/history`        | Clear the authenticated user's event history |

**Create/update body**
```json
{
  "clientId": "alert_abc123",
  "symbol": "BTCUSDT",
  "condition": "crossUp",           // above | below | crossUp | crossDown
  "price": 65000,
  "note": "breakout",
  "recurring": false,
  "enabled": true,
  "locked": false,
  "channels": { "sound": true, "browser": false, "push": true, "telegram": false, "discord": false },
  "technicalTarget": {
    "version": 1,
    "kind": "dynamic-line",
    "a": { "time": 1783420800, "price": 64000 },
    "b": { "time": 1783424400, "price": 65000 },
    "domain": "ray",
    "interpolation": "linear"
  }
}
```

`clientId` is the frontend alert ID. The backend keeps its own UUID and accepts
either ID in `:id`, allowing optimistic create/update/trigger/delete operations
to remain ordered without replacing IDs in chart overlays.

**Trigger body**

```json
{
  "armingRevision": 3,
  "previous": { "price": 64980, "timestamp": 1783424380 },
  "current": { "price": 65012.5, "timestamp": 1783424410 },
  "triggerPrice": 65012.5,
  "targetPrice": 65008.3333333333
}
```

`current` and `armingRevision` are required. `previous` is required by crossing,
channel-enter/exit, and directional-boundary operators; level operators do not
need it. Timestamps are normalized UTC epoch seconds (fractional seconds are
accepted). `triggerPrice` and `targetPrice` are optional compatibility claims:
the backend recomputes the immutable line/channel target and condition from the
evidence and rejects mismatched claims, stale revisions, out-of-order evidence,
or a condition that was not actually met.

The trigger response is `{ "alert": Alert, "event": AlertEvent }`. An exact
retry returns `200 { "alreadyTriggered": true, "event": AlertEvent }` without a
second history row. Attempt identity is
`(alert_id, arming_revision, triggered_at)`, with `triggered_at` taken from the
accepted current-evidence timestamp. Reusing that timestamp for the same alert
revision means retrying the same immutable market observation; a conflicting
price or target is rejected rather than treated as a new trigger. A one-time
alert moves to `triggered`; a recurring alert remains `active` and receives new
`triggeredAt`/`triggerPrice` values. Event shape:
`{ id, alertId, symbol, condition, targetPrice, triggerPrice, triggeredAt, delivered, armingRevision }`.
`delivered` is a legacy/reserved field and is not authoritative evidence that a
provider accepted a notification. The stable `event.id` groups FCM work with a
device recipient and Telegram/Discord work by `(event.id, channel)` within one
evaluator run after either a new or idempotent acknowledgement.
`triggeredAt` is the accepted `current.timestamp`, not API receive time. Events
retain their stable `alertId` after an alert is deleted. Finite targets may be
patched to `status:"expired"`; snapshot/bootstrap responses expose those rows in
`expiredAlerts`. Re-arming with `status:"active"` increments `armingRevision`.

`POST /api/v1/alerts/worker-trigger` accepts the same trigger/evidence fields plus
`alertId` and a signed `deliveryToken`. It is not a browser-auth route: callers
must also send `x-push-worker-secret`, and the backend derives the alert owner
only from the signed token. Missing server configuration, a wrong worker secret,
or an invalid token fails closed. The Next evaluator must receive this durable
acknowledgement before any channel dispatch. `alreadyTriggered:true` proves the
same immutable event exists and may still drain caller-local pending delivery;
it does not prove any provider accepted a notification. Callers retain immutable
evidence after transport, invalid/truncated responses, 401/403, 408/425/429, or
5xx failures. Alert-specific permanent 4xx responses require corrected alert
state instead of an infinite retry loop.

### Push tokens (FCM), protected, implemented

| Method | Path                       | Purpose                                            |
| ------ | -------------------------- | -------------------------------------------------- |
| POST   | `/api/v1/push/tokens`      | Register/refresh `{ fcmToken, platform, permission }` |
| DELETE | `/api/v1/push/tokens/:tok` | Unregister a device token                          |

Next's closed-browser worker uses service-authenticated PostgreSQL device
routes. Every request requires `x-push-worker-secret`; browser code must never
call them directly.

| Method | Path                                 | Purpose |
| ------ | ------------------------------------ | ------- |
| POST   | `/api/v1/push/worker-devices/ensure` | Create/return a Firebase-owned device row |
| POST   | `/api/v1/push/worker-devices/get`    | Read one owned device, or one worker device |
| GET    | `/api/v1/push/worker-devices`        | List devices requiring evaluator work |
| POST   | `/api/v1/push/worker-devices/put`    | Compare-and-swap a complete device snapshot |
| POST   | `/api/v1/push/worker-devices/delete` | Delete an owned device row |

The browser-facing Next route `POST /api/push/alerts/sync` is intentionally outside the Go
`/api/v1` prefix. It verifies the Firebase bearer token, validates the complete device snapshot,
then calls the worker-device API with an eight-second end-to-end deadline:

- `200`: snapshot committed, including the resulting state version;
- `400`/`413`: malformed, duplicate, or oversized snapshot;
- `401`: Firebase identity missing/invalid;
- `409`: the FCM device token belongs to another Firebase user (not retryable);
- `503` plus `Retry-After: 1`: PostgreSQL/worker transport unavailable or deadline exceeded
  (retryable).

The deadline abort signal is propagated to the in-flight Go worker request. Logs include only a
safe error name/code and never bearer tokens, FCM tokens, alert payloads, or user IDs.

---

## Journal  protected, implemented

Backed by `journal_entries` + `screenshots`.

| Method | Path                                   | Purpose                                   |
| ------ | -------------------------------------- | ----------------------------------------- |
| GET    | `/api/v1/journal?symbol=&tag=&limit=&before=` | List; `before` is an RFC3339 entry-time cursor, max limit 100 |
| POST   | `/api/v1/journal`                      | Create (trade-centric body below)         |
| GET    | `/api/v1/journal/:id`                  | Get one with its screenshots              |
| PUT    | `/api/v1/journal/:id`                  | Update                                    |
| DELETE | `/api/v1/journal/:id`                  | Delete (cascades screenshots)             |

**Create/update body** (matches frontend `JournalEntry`)
```json
{
  "clientId": "jrn_local_123",
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
| POST   | `/api/v1/screenshots/upload-url`        | Send `{ contentType }`; get `uploadUrl`, `storageKey`, `expiresIn` |
| POST   | `/api/v1/screenshots`                   | Register `{ storageKey, journalEntryId, phase, width?, height?, sizeBytes?, contentType }` |
| GET    | `/api/v1/screenshots/:id`               | Get a (short-lived signed) view URL            |
| DELETE | `/api/v1/screenshots/:id`               | Delete metadata + schedule blob removal        |

Supported upload content types are `image/png`, `image/jpeg`, and `image/webp`. The browser must
`PUT` the bytes directly to `uploadUrl` before registering metadata. Upload URLs expire after 10
minutes; signed view URLs expire after 15 minutes. `journalEntryId` accepts either the server UUID
or the idempotent journal `clientId`.

---

## Layouts  🔒

Backed by `layouts` (implemented). The backend treats `state` as opaque JSON and
guarantees at most one `isDefault: true` row per authenticated user. Creating or
updating a default layout clears the previous default in the same transaction.

| Method | Path                  | Purpose                           |
| ------ | --------------------- | --------------------------------- |
| GET    | `/api/v1/layouts`     | List layouts, default first       |
| POST   | `/api/v1/layouts`     | Create a saved layout             |
| PUT    | `/api/v1/layouts/:id` | Replace metadata and snapshot     |
| DELETE | `/api/v1/layouts/:id` | Delete an owned layout            |

Create and replace requests use the same shape:

```json
{
  "name": "London scalping",
  "symbol": "EURUSD",
  "timeframe": "15m",
  "isDefault": true,
  "state": {
    "version": 1,
    "chartLayoutPreset": "single",
    "replayLayoutMode": "single_chart",
    "indicators": [],
    "drawings": [],
    "panels": {
      "sizes": { "left": 36, "right": 300, "bottom": 240 },
      "rightOpen": true,
      "bottomOpen": false,
      "bottomTab": "replay"
    }
  }
}
```

Responses add `id`, `createdAt`, and `updatedAt`. `PUT` is a full replacement,
so clients resend the existing snapshot when only changing the default flag.
Loading a snapshot restores the frontend view without rewriting the independent
drawing and indicator resources.

---

## Simulated trading  🔒

Backed by `sim_accounts` + `sim_positions` (one self-contained table; a pending order is a position
with `status=pending`, fills embedded). The frontend remains the fill/SL/TP engine and writes each
complete position snapshot through to this durable store.

| Method | Path                                    | Purpose                                |
| ------ | --------------------------------------- | -------------------------------------- |
| GET    | `/api/v1/sim/accounts`                  | List accounts                          |
| POST   | `/api/v1/sim/accounts`                  | Create `{ name, startingEquity }`      |
| PUT    | `/api/v1/sim/accounts/:id`              | Update account name/equity/currency    |
| DELETE | `/api/v1/sim/accounts/:id`              | Delete account and its positions       |
| POST   | `/api/v1/sim/accounts/:id/reset`        | Clear positions and reset equity       |
| GET    | `/api/v1/sim/accounts/:id/positions`    | Positions (filter `?status=open`)      |
| POST   | `/api/v1/sim/accounts/:id/orders`       | Upsert a complete position snapshot by `clientId` |
| POST   | `/api/v1/sim/positions/:id/close`       | Upsert a closed snapshot (`accountId` + position body) |
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
