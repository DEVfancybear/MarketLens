# API Reference

Base URL (dev): `http://localhost:8080`
API prefix: `/api/v1` (except `/health`).

> Status: `/health` is **implemented**. Everything under `/api/v1` is **planned** — this is the
> contract the Go Fiber handlers will implement. See `AUTH.md` for the auth flow and `DATABASE.md`
> for the tables behind each resource.

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

### `GET /api/v1/sync/bootstrap`  🔒

One call that returns the user's whole workspace for hydrating local stores on sign-in
(`DATABASE.md` §11).

**Response** `200 OK`
```json
{
  "settings":   { "ui": {…}, "smc": {…}, "chart": {…} },
  "watchlists": [ … ],
  "drawings":   [ … ],
  "indicators": [ … ],
  "pineScripts":[ … ],
  "alerts":     [ … ],
  "layouts":    [ … ]
}
```
Journal, screenshots, and sim-trading are fetched lazily by their own endpoints (larger payloads).

---

## Settings  🔒

Backed by `user_settings` (1:1). See `DATABASE.md` §6.1.

| Method | Path                    | Purpose                                   |
| ------ | ----------------------- | ----------------------------------------- |
| GET    | `/api/v1/settings`      | Get `{ ui, smc, chart }`                  |
| PUT    | `/api/v1/settings`      | Replace all sections                      |
| PATCH  | `/api/v1/settings`      | Merge a partial (e.g. just `ui.theme`)    |

---

## Watchlists  🔒

Backed by `watchlists` + `watchlist_symbols`.

| Method | Path                                            | Purpose                    |
| ------ | ----------------------------------------------- | -------------------------- |
| GET    | `/api/v1/watchlists`                            | List with their symbols    |
| POST   | `/api/v1/watchlists`                            | Create `{ name }`          |
| PATCH  | `/api/v1/watchlists/:id`                        | Rename / reorder           |
| DELETE | `/api/v1/watchlists/:id`                        | Delete a list              |
| POST   | `/api/v1/watchlists/:id/symbols`                | Add `{ symbol }`           |
| DELETE | `/api/v1/watchlists/:id/symbols/:symbol`        | Remove a symbol            |

---

## Drawings  🔒

Backed by `drawings`. Payload mirrors the frontend `DRAWING_OBJECT_MODEL`.

| Method | Path                            | Purpose                                        |
| ------ | ------------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/drawings?symbol=BTCUSDT` | List drawings for a symbol                    |
| POST   | `/api/v1/drawings`              | Create `{ symbol, toolType, payload, clientId }` |
| PUT    | `/api/v1/drawings/:id`          | Replace payload/flags                          |
| PATCH  | `/api/v1/drawings/:id`          | Partial (e.g. `{ locked: true }`)              |
| DELETE | `/api/v1/drawings/:id`          | Delete one                                     |
| POST   | `/api/v1/drawings/batch`        | Bulk upsert (sync flush; dedupes on `clientId`)|

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

Backed by `alerts` + `alert_events`.

| Method | Path                          | Purpose                                   |
| ------ | ----------------------------- | ----------------------------------------- |
| GET    | `/api/v1/alerts`              | List (filter `?status=active`)            |
| POST   | `/api/v1/alerts`              | Create `{ symbol, condition, price, message, recurring }` |
| PATCH  | `/api/v1/alerts/:id`          | Update / pause / resume                   |
| DELETE | `/api/v1/alerts/:id`          | Delete                                    |
| GET    | `/api/v1/alerts/:id/events`   | Trigger history                           |
| GET    | `/api/v1/alerts/history`      | All trigger events for the user           |

### Push tokens (FCM)

| Method | Path                       | Purpose                                 |
| ------ | -------------------------- | --------------------------------------- |
| POST   | `/api/v1/push/tokens`      | Register/refresh `{ fcmToken, platform }` |
| DELETE | `/api/v1/push/tokens/:tok` | Unregister a device token               |

---

## Journal  🔒

Backed by `journal_entries` + `screenshots`.

| Method | Path                                   | Purpose                                   |
| ------ | -------------------------------------- | ----------------------------------------- |
| GET    | `/api/v1/journal?symbol=&tag=&limit=`  | List (paginated, filterable)              |
| POST   | `/api/v1/journal`                      | Create `{ symbol, title, notes, tags, rating, positionId? }` |
| GET    | `/api/v1/journal/:id`                  | Get one with its screenshots              |
| PUT    | `/api/v1/journal/:id`                  | Update                                    |
| DELETE | `/api/v1/journal/:id`                  | Delete (cascades screenshots)             |

### Screenshots

Two-step upload so bytes go straight to object storage, not through the API.

| Method | Path                                    | Purpose                                        |
| ------ | --------------------------------------- | ---------------------------------------------- |
| POST   | `/api/v1/screenshots/upload-url`        | Get a pre-signed PUT URL + `storageKey`        |
| POST   | `/api/v1/screenshots`                   | Register metadata `{ storageKey, journalEntryId?, width, height }` |
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

Backed by `sim_accounts` + `orders` + `positions`. Optional / later phase — the replay simulator can
stay client-side until durable backtests are needed.

| Method | Path                                    | Purpose                                |
| ------ | --------------------------------------- | -------------------------------------- |
| GET    | `/api/v1/sim/accounts`                  | List accounts                          |
| POST   | `/api/v1/sim/accounts`                  | Create `{ name, startingEquity }`      |
| GET    | `/api/v1/sim/accounts/:id/positions`    | Positions (filter `?status=open`)      |
| POST   | `/api/v1/sim/accounts/:id/orders`       | Place `{ symbol, side, type, qty, price?, sl?, tp? }` |
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
