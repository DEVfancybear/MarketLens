# Backend Implementation Plan (phased)

> Status: Phases 0-5 are implemented. Phases 6+ remain as the per-resource persistence roadmap.
> Companion to `DATABASE.md` (schema), `AUTH.md` (auth flow), and `API.md` (endpoint contract). Each
> phase is independently shippable and has explicit acceptance criteria so progress is unambiguous.

## ⚠ Framework reconciliation (read first)

The docs (`ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`) declare **Fiber** as the backend framework, but
the code as of commit `64a33b0` actually uses the **Go 1.22 standard library** (`net/http` +
`http.ServeMux` method routing, see `internal/httpserver/server.go`, `internal/health/handler.go`).
`go.mod` has no Fiber dependency.

**Decision for this plan: adopt Fiber in Phase 0** (the documented decision; the current HTTP surface
is ~60 lines, so migration is cheap and the design docs already assume `fiber.Router` handlers).
If the team prefers to stay on stdlib instead, only Phase 0 changes — everything else (pgx, sqlc,
JWT, Firebase verify, repos) is framework-agnostic. Flag this before starting.

## Dependency additions (whole project)

| Purpose                | Module                                             |
| ---------------------- | -------------------------------------------------- |
| HTTP framework         | `github.com/gofiber/fiber/v2`                      |
| Postgres driver + pool | `github.com/jackc/pgx/v5` (`/pgxpool`)             |
| Migrations             | `github.com/golang-migrate/migrate/v4`             |
| Type-safe queries      | `sqlc` (dev tool; generates into `internal/db/gen`)|
| Firebase Admin (verify)| `firebase.google.com/go/v4`                        |
| Access JWT             | `github.com/golang-jwt/jwt/v5`                      |
| Dev env loading        | `github.com/joho/godotenv` (dev only)              |

---

## Phase 0 — Foundation & framework

**Goal:** Fiber app boots, config carries every new env var, shared helpers exist. No behavior change
for clients beyond the framework swap.

**Steps**
1. `go get` the Fiber + tooling deps above.
2. Rewrite `internal/httpserver/server.go` to build a `*fiber.App` (recover + request-id + the
   existing zerolog logging as Fiber middleware). Keep graceful shutdown (`app.ShutdownWithContext`).
3. Port `internal/health` to a Fiber handler; register `GET /health`.
4. Port `internal/middleware/logging.go` to Fiber middleware (or use `fiberzerolog`).
5. Extend `internal/config/config.go` with: `DatabaseURL`, `AuthJWTSecret`, `AuthAccessTTL`,
   `AuthRefreshTTL`, `FirebaseProjectID`, `FirebaseClientEmail`, `FirebasePrivateKey`,
   `CORSAllowedOrigins`. Fail fast if required secrets are missing when `APP_ENV != development`.
6. Add `backend/.env.example` documenting every var (mirror `AUTH.md` §8).
7. Add `internal/httpserver/response.go`: `WriteError(c, code, msg)` producing the standard
   `{ "error": { "code", "message" } }` shape from `API.md`.

**Acceptance**
- `go build ./...` and `go vet ./...` pass.
- Server starts on Fiber; `GET /health` returns the same JSON as before.
- Missing required secret in `production` aborts startup with a clear log line.

**Complexity:** Low–Medium.

---

## Phase 1 — Database layer

**Goal:** A live Postgres pool, a migration runner, and generated query code — no domain logic yet.

**Steps**
1. `internal/db/pool.go`: build a `pgxpool.Pool` from `DatabaseURL`; `Ping` on startup; expose
   `Close()`.
2. Add `backend/migrations/` and wire `golang-migrate` (a `make migrate-up` / small Go runner in
   `cmd/migrate`). Write:
   - `0001_extensions.(up|down).sql` — `pgcrypto`, `citext`.
   - `0002_auth.(up|down).sql` — `users`, `auth_identities`, `sessions`, `push_tokens` + enums +
     `set_updated_at()` trigger (from `DATABASE.md` §5).
3. Add `sqlc.yaml` + `internal/db/queries/*.sql`; generate typed Go into `internal/db/gen`.
   Start with user/identity/session queries only.
4. Add a readiness probe `GET /health/ready` that pings the pool (liveness `/health` stays DB-free).

**Acceptance**
- `migrate up` creates the auth tables on a local Postgres; `migrate down` reverses cleanly.
- `sqlc generate` produces compiling Go.
- `/health/ready` returns 200 when the DB is up, 503 when down.

**Complexity:** Medium.

---

## Phase 2 — Firebase ID-token verification

**Goal:** Given a Firebase ID token string, return verified claims (uid, email, name, picture).

**Steps**
1. `internal/auth/firebase.go`: initialize `firebase.NewApp` once from the service-account env
   (`FIREBASE_*`), expose an `*auth.Client`.
2. `internal/auth/verify.go`: `VerifyGoogleToken(ctx, idToken) (Identity, error)` calling
   `client.VerifyIDToken`; map claims → an internal `Identity{ UID, Email, Name, PhotoURL }`.
3. Distinguish error classes: expired, malformed, wrong audience → all surface as `unauthorized`.

**Acceptance**
- Unit test: a malformed/expired token returns an error, never a partial identity.
- Manual: a real Firebase ID token (from the frontend or Firebase REST) yields correct claims.

**Complexity:** Medium (Firebase Admin Go setup is the main effort).

---

## Phase 3 — Sessions & tokens (no HTTP yet)

**Goal:** Pure session/token services, unit-tested in isolation.

**Steps**
1. `internal/auth/jwt.go`: `MintAccess(userID, sessionID)` → HS256 JWT (`AuthJWTSecret`,
   `AuthAccessTTL`); `ParseAccess(token)` → claims.
2. `internal/auth/session.go`:
   - `Create(userID, ua, ip)` → generate 256-bit opaque refresh token, store SHA-256 hash in
     `sessions`, return raw token + session id.
   - `Rotate(rawRefresh)` → look up by hash; if revoked/expired → error; **reuse detection**: if a
     revoked token is presented, revoke the whole session family; else revoke old + insert new.
   - `Revoke(sessionID)` and `RevokeAll(userID)`.
3. `internal/auth/cookies.go`: `SetAuthCookies` / `ClearAuthCookies` (httpOnly, Secure gated by
   `APP_ENV`, SameSite=Lax, correct paths/max-age).

**Acceptance**
- Unit tests: mint→parse round-trip; expired access rejected; refresh rotate happy path; reuse of a
  revoked refresh token revokes the family.

**Complexity:** Medium.

---

## Phase 4 — Auth endpoints & middleware (the deliverable)

**Goal:** End-to-end Google login/register working from the frontend.

**Steps**
1. `internal/users/repo.go`: `UpsertFromIdentity(identity)` — find `auth_identities` by
   `(google, uid)`; insert user+identity if absent (register), else update profile + `last_login_at`
   (login). Returns `(user, isNewUser)`.
2. `internal/auth/service.go`: `LoginWithGoogle(ctx, idToken, ua, ip)` = verify → upsert → create
   session → mint access. Returns user + tokens.
3. `internal/auth/handler.go` (Fiber):
   - `POST /api/v1/auth/google`
   - `POST /api/v1/auth/refresh`
   - `POST /api/v1/auth/logout`  🔒
   - `GET  /api/v1/auth/me`       🔒
   - `DELETE /api/v1/auth/sessions` 🔒
4. `internal/auth/middleware.go`: `RequireAuth` — read `access_token` cookie, `ParseAccess`, put
   `user_id` + `session_id` in `c.Locals`; on failure return `401`.
5. Add CORS middleware (`CORSAllowedOrigins`, `AllowCredentials: true`). Register the `/api/v1` group
   and mount auth routes in `server.go`.

**Acceptance**
- From the frontend (or curl with a real ID token): `POST /auth/google` sets both cookies and
  returns the user; a second call with the same Google account returns `isNewUser: false`.
- `GET /auth/me` with the access cookie returns the user; without it → 401.
- `POST /auth/refresh` rotates and keeps the session alive after access expiry.
- `POST /auth/logout` revokes the session; subsequent `/me` → 401.

**Complexity:** Medium. **This closes the user's request (Google login/register).**

---

## Phase 5 — Sync bootstrap + first resource (settings)

**Goal:** Prove the authed-resource pattern with the smallest resource, then expose bootstrap.

**Implementation status (2026-07-06): complete.** `0003_settings` creates `user_settings` and
`layouts`; `internal/settings` exposes `GET/PUT/PATCH /api/v1/settings`; `internal/workspace`
exposes `GET /api/v1/sync/bootstrap` with settings plus empty resource arrays. Coverage:
`go test ./...`.

**Steps**
1. Migration `0003_settings.sql` — `user_settings` (sections `ui`/`smc`/`chart`/`notifications`) +
   `layouts` (`DATABASE.md` §6). Note `ui` persists only `{ theme, panels }`; `notifications` holds
   the global `AlertSettings` (used later by Phase 10).
2. `internal/settings`: repo + Fiber handler for `GET/PUT/PATCH /api/v1/settings` (auto-create the
   row on first read). `PATCH` does a jsonb section merge (e.g. just `ui.theme`).
3. `GET /api/v1/sync/bootstrap` returning the workspace envelope (`API.md` §Sync). For now it returns
   settings + empty arrays; each later phase fills in its slice.

**Acceptance**
- Authed user can read defaults, PATCH `ui.theme`, and read it back.
- `sync/bootstrap` returns 200 with the settings section populated.

**Complexity:** Low–Medium (establishes the copy-paste template for all following resources).

---

## Phases 6–13 — Remaining resources (one mini-phase each)

Every phase below follows the **same six-step template**:

1. **Migration** — add/confirm the tables from `DATABASE.md` (the migration file may be shared by
   several phases; apply it once).
2. **Queries** — write `internal/db/queries/<domain>.sql`; run `sqlc generate`.
3. **Repo** — `internal/<domain>/repo.go`, all queries scoped by `user_id` (ownership enforced in SQL,
   never trusted from the client).
4. **Handler** — `internal/<domain>/handler.go`, Fiber routes mounted behind `auth.RequireAuth`;
   register from `httpserver/server.go`.
5. **Bootstrap slice** — fill this resource's array in `GET /api/v1/sync/bootstrap` (Phase 5 seam).
6. **Tests** — repo unit tests + handler integration tests via `app.Test`.

**Shared acceptance for every phase:** CRUD works for the owner; a second user cannot see or mutate
the first user's rows (cross-user access returns `404`, never `403` — don't leak existence); the
resource shows up in `sync/bootstrap` where applicable; the matching frontend store switches from
localStorage-only to write-through (local first, then API) without regressing offline use.

> **Migration ordering (two hard rules, `DATABASE.md` §12):**
> 1. Within `0004_charting`, create `pine_scripts` **before** `indicator_presets`
>    (`indicator_presets.script_id → pine_scripts` FK).
> 2. Create `sim_positions` (`0006_trading`) **before** `journal_entries` (`0007_journal`)
>    (`journal_entries.position_id → sim_positions` FK).
> Migrations 6/7/8/9 all reference `0004_charting`, so that file lands whenever the first of those
> phases starts. `0003`–`0007` may be authored up front or lazily per phase, as long as those two
> rules hold.

---

### Phase 6 — Watchlists + MT5 Tick Streaming

**Goal:** Durable, multi-list watchlists plus a localhost MT5 market-data stream path. The current
single localStorage array (`watchlist`) becomes the user's **"Default"** list; the schema already
supports several named lists. MT5 streaming is intentionally implemented as a sidecar so the Go API
does not link against Python/C++ MT5 libraries.

#### Phase 6A — Watchlists

**Tables:** `watchlists`, `watchlist_symbols` (`DATABASE.md` §7.1). **Frontend store:** `watchlistStore`.

**Steps**
1. Migration `0004_charting` (watchlists portion).
2. Queries: list watchlists + their symbols (one round trip, ordered by `position`); create/rename/
   reorder list; add/remove symbol. Rely on `UNIQUE (watchlist_id, symbol)` for idempotent adds.
3. Repo: on first bootstrap for a user with no lists, seed a "Default" list from the request payload
   (one-time upload of the local array).
4. Handler: `GET/POST /api/v1/watchlists`, `PATCH/DELETE /api/v1/watchlists/:id`,
   `POST /api/v1/watchlists/:id/symbols`, `DELETE /api/v1/watchlists/:id/symbols/:symbol`.
5. Bootstrap: `watchlists` array (each with nested `symbols`).

**Acceptance**
- Add/remove a symbol, rename a list, reorder — all survive reload and appear on a second device.
- Adding a duplicate symbol is a no-op (no 500, no dup row).

#### Phase 6B — MT5 Tick Streaming

**Goal:** Stream live MT5 tick data from a locally installed MetaTrader 5 terminal into Go without
putting MT5/Python dependencies in the Fiber API process.

**Runtime path**

```text
MetaTrader 5 terminal
  -> backend/bridge/mt5_stream/mt5_server.py
  -> ws://localhost:8765
  -> backend/cmd/mt5-stream
```

**Steps**
1. Python sidecar initializes MT5 through the `MetaTrader5` package. It supports either an already
   logged-in terminal or explicit `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` demo-account env vars.
2. Python sidecar runs a local `websockets` server on `MT5_STREAM_HOST:MT5_STREAM_PORT`
   (`localhost:8765` by default).
3. Python sidecar loads the full MT5 symbol catalog with `symbols_get()` and sends it to each Go
   client on connect.
4. Python sidecar streams ticks for `MT5_SYMBOLS` (comma-separated) or, if explicitly enabled,
   every currently visible MT5 symbol through `MT5_STREAM_ALL_VISIBLE=true`. It de-dupes each symbol
   by `time_msc` and broadcasts compact JSON tick messages.
5. Go command `cmd/mt5-stream` connects with `github.com/gorilla/websocket`, decodes the symbol
   catalog plus strong typed `Mt5Tick` values, logs them, and reconnects with exponential backoff.
6. The Go API process also starts a lightweight MT5 stream client. It caches the symbol catalog,
   latest ticks, and on-demand candle history, then exposes `/api/v1/mt5/symbols`,
   `/api/v1/mt5/ticks`, and `/api/v1/mt5/history` for the frontend. The frontend calls the Go API,
   never the Python bridge directly.
7. Candle history uses a request/reply message over the existing local bridge WebSocket:
   Fiber receives `GET /api/v1/mt5/history`, sends `history.request` to Python, waits for the
   matching `history` response, caches the candles briefly, and returns normalized OHLCV bars.
8. Both processes handle graceful shutdown locally; the stream is market-data only and does not
   execute orders.

**Acceptance**
- With MT5 installed and logged in, `python -m bridge.mt5_stream.mt5_server` starts
  `ws://localhost:8765`.
- `go run ./cmd/mt5-stream` logs ticks in the form
  `[EURUSD] Bid: X.XXXXX | Ask: X.XXXXX | Time: HH:mm:ss`.
- `GET /api/v1/mt5/symbols` returns the latest catalog from the Python bridge with connection
  status, stream symbols, and symbol metadata.
- `GET /api/v1/mt5/ticks?symbols=EURUSD` returns the latest cached tick snapshot for requested
  stream symbols.
- `GET /api/v1/mt5/history?symbol=EURUSD&timeframe=15m&limit=1500` returns normalized candles from
  MT5 `copy_rates_from_pos` through the Python bridge.
- Restarting the Python bridge does not require restarting the Go consumer; it reconnects.

**Complexity:** Low–Medium.

---

### Phase 7 — Drawings

**Goal:** Persist chart drawings per symbol. Highest write-volume resource → needs a batch path and
idempotent sync, not one HTTP call per drag.

**Table:** `drawings` (`DATABASE.md` §7.2; geometry/style live untouched in `payload jsonb`, matching
the frontend `DRAWING_OBJECT_MODEL` — the backend stores, never interprets). **Frontend store:**
`chartStore.drawings` (persisted today as `drawings:<symbol>`).

**Steps**
1. Migration `0004_charting` (drawings portion) — note the `UNIQUE (user_id, client_id)` partial index
   used for sync dedupe.
2. Queries: list by `(user_id, symbol)`; insert; update payload/flags; delete; **bulk upsert** keyed on
   `client_id` (`INSERT … ON CONFLICT (user_id, client_id) DO UPDATE`).
3. Repo: `client_id` is the client-generated drawing id → retries and multi-device edits converge
   instead of duplicating.
4. Handler: `GET /api/v1/drawings?symbol=…`, `POST /api/v1/drawings`, `PUT/PATCH/DELETE
   /api/v1/drawings/:id`, `POST /api/v1/drawings/batch` (sync flush).
5. **Also in this phase — `drawing_templates`** (`DATABASE.md` §7.3): the frontend `drawingTemplates`
   key is **global** style presets (not per-symbol). Add CRUD `GET/POST /api/v1/drawing-templates`,
   `PUT/DELETE /api/v1/drawing-templates/:id`; `UNIQUE (user_id, name, family)`.
6. Bootstrap: **omit** the full drawing set (can be large) — load lazily per symbol on first chart
   open. **Include** `drawingTemplates` in bootstrap (small, global, needed everywhere).

**Acceptance**
- Draw → reload → drawing reappears pinned to the same `(time, price)`.
- Flushing the same batch twice (retry) yields no duplicates (`client_id` dedupe).
- `PATCH { locked: true }` / `{ hidden: true }` round-trips.
- Save a style template, apply it on another chart after reload.
- Fetching another user's drawing id → `404`.

**Complexity:** Medium (batch + dedupe is the real work).

---

### Phase 8 — Indicators

**Goal:** Persist indicator presets (built-in EMA/RSI/MACD/… settings + enabled + order).

**Table:** `indicator_presets` (`DATABASE.md` §7.5 — full `IndicatorConfig` in `config jsonb`,
`indicator_type`/`visible`/`position` promoted to columns, `script_id` FK for `CUSTOM`). **Frontend
store:** `chartStore.indicators` (persisted as `indicators`). Pine *scripts* are Phase 9.

**Steps**
1. Migration `0004_charting` (indicator_presets portion — **after** pine_scripts, for the FK).
2. Queries: list ordered by `position`; create; update `config`/`visible`/`position`; delete.
3. Repo: keep `config jsonb` opaque (the full `IndicatorConfig`: length(s), colors, `inputValues`,
   `styleValues`); resolve `script_id` for `CUSTOM` indicators to the user's `pine_scripts` row.
4. Handler: `GET/POST /api/v1/indicators`, `PUT/DELETE /api/v1/indicators/:id`.
5. Bootstrap: `indicators` array.

**Acceptance**
- Add EMA(50), toggle it off, reorder against another indicator, reload — state preserved and ordered.

**Complexity:** Low.

---

### Phase 9 — Pine scripts

**Goal:** Persist user-authored Pine-like source indicators.

**Table:** `pine_scripts` (`DATABASE.md` §7.4 — matches `CustomIndicatorScript`: `source_code`,
`favorite`, `client_id`). **Frontend store:** `chartStore` Pine state (persisted as `pineScripts`).
**Create before `indicator_presets`** in `0004` (FK target).

**Steps**
1. Migration `0004_charting` (pine_scripts portion, first among the FK pair).
2. Queries: list **metadata only** (id, name, favorite, updated_at — **not** `source_code`, keep the
   list light); get one with full `source_code`; create; update `name`/`source_code`/`favorite`/
   `meta`; delete. Dedupe on `client_id`.
3. Repo: cap `source_code` length (e.g. reject > 64 KB); store parsed inputs / last compile status in
   `meta jsonb`.
4. Handler: `GET /api/v1/pine-scripts`, `GET /api/v1/pine-scripts/:id`, `POST /api/v1/pine-scripts`,
   `PUT/DELETE /api/v1/pine-scripts/:id`.
5. Bootstrap: `pineScripts` array (metadata only; fetch source on open).

**Acceptance**
- Save a script, edit its source, toggle favorite, reload → latest state loads; list stays light.
- Oversized source is rejected with `400 bad_request`.
- A `CUSTOM` indicator's `script_id` resolves to the right script (cross-check with Phase 8).

**Complexity:** Low–Medium.

---

### Phase 10 — Alerts + push tokens

**Goal:** Persist price alerts, their trigger history, and per-device FCM tokens. Unlocks
closed-browser push targeting every device.

**Tables:** `alerts`, `alert_events`, `push_tokens` (`DATABASE.md` §8, §5.4). The **global**
`AlertSettings` lives in `user_settings.notifications` (Phase 5), not in `alerts`. **Frontend stores:**
`alertStore` (persisted as the composite `{ alerts, triggeredAlerts, history, settings }` under key
`alerts`), plus the push seam (`usePushAlertSync`, `notificationStore`).

**Steps**
1. Migration `0005_alerts` (alerts + alert_events) — `push_tokens` shipped in `0002_auth`.
2. Queries: alerts CRUD including the **per-alert channel flags** (`sound`/`browser`/`push`/
   `telegram`/`discord`) and `enabled`/`locked`/`note`/`recurring`; pause == `enabled=false`; on
   trigger set `status='triggered'`, `trigger_price`, `triggered_at` **and** insert an `alert_events`
   row (shape = `AlertHistoryEntry`: symbol, condition, target_price, trigger_price, triggered_at);
   list events per alert and per user; upsert push token on `UNIQUE (fcm_token)` (update
   `permission`, `last_seen_at`); delete token.
3. Repo: validate server-side (`above|below|crossUp|crossDown`, `price > 0`); prune `alert_events` to
   the newest ~200 per user (matches the frontend cap).
4. Handler: `GET/POST /api/v1/alerts`, `PATCH/DELETE /api/v1/alerts/:id`,
   `GET /api/v1/alerts/:id/events`, `GET /api/v1/alerts/history`,
   `POST /api/v1/push/tokens`, `DELETE /api/v1/push/tokens/:tok`. Global notification prefs are read/
   written via `/api/v1/settings` (`notifications` section), not here.
5. Bootstrap: `alerts` array + `triggeredAlerts` + recent `history`. Integrate token registration with
   the existing frontend push flow (send the FCM token + `permission` to `/push/tokens`).

**Acceptance**
- Create an alert with specific channels (e.g. push+telegram), pause/resume, delete — all persist.
- A trigger writes an `alert_events` row with target vs trigger price; `/alerts/history` returns it
  newest-first, capped at ~200.
- Registering the same FCM token twice updates `permission` + `last_seen_at`, no dup row.
- Toggling a global channel via `/settings` persists in `user_settings.notifications`.

**Complexity:** Medium.

---

### Phase 11 — Journal + screenshots

**Goal:** Persist trade journal entries and their screenshots. The heaviest phase — introduces
**object storage** (image bytes never touch the DB or the API body).

**Tables:** `journal_entries`, `screenshots` (`DATABASE.md` §10). The journal is **trade-centric**
(`side`, `entry_time`/`exit_time`, `entry_price`/`exit_price`, `quantity`, `pnl`, `rr`,
`risk_amount`, `tags`) — **not** a title/rating note. Screenshots carry a `phase`
(`before`/`after-entry`/`after-exit`). **Frontend store:** `journalStore` (IndexedDB `JournalEntry[]`)
+ screenshot blobs (IndexedDB `{ id, blob }`).

**Steps**
1. Migration `0007_journal` — requires `sim_positions` (`0006_trading`) first for the `position_id`
   FK. If Phase 13 hasn't run, make `position_id` nullable-without-FK and add the FK later.
2. Add an object-storage client (`internal/storage`, S3/R2 via `aws-sdk-go-v2` or MinIO). Config:
   bucket, region, credentials, public/base URL.
3. Queries: journal CRUD with the trade fields above + filters (`symbol`, `tag` via the `gin(tags)`
   index, pagination by `entry_time`); insert/list/delete screenshot metadata by entry + `phase`.
4. Handler:
   - Journal: `GET /api/v1/journal?symbol=&tag=&limit=`, `POST` (body = trade fields), `GET/PUT/DELETE
     /api/v1/journal/:id`.
   - Screenshots (two-step upload — bytes go straight to storage): `POST
     /api/v1/screenshots/upload-url` (returns a pre-signed PUT URL + `storageKey`), `POST
     /api/v1/screenshots` (register metadata: `journalEntryId`, `phase`, dims), `GET
     /api/v1/screenshots/:id` (short-lived signed view URL), `DELETE /api/v1/screenshots/:id`.
5. Bootstrap: **omit** journal/screenshots (large) — fetch lazily when the Journal panel opens.
6. Blob cleanup: on screenshot/entry delete, enqueue the `storage_key` for out-of-band blob removal
   (`DATABASE.md` §13); log the key before the cascade.

**Acceptance**
- Create a trade entry (side/entry/exit/pnl/rr) with tags, filter by tag and by symbol, paginate.
- Upload a `before` screenshot via the pre-signed URL, attach it to an entry, fetch its view URL.
- Deleting the entry removes its screenshot rows and schedules blob deletion.

**Complexity:** High (object storage + pre-signed URLs + cleanup).

---

### Phase 12 — Layouts

**Goal:** Persist saved chart layouts / templates (indicators + drawings + panel snapshot per named
layout), TradingView-style.

**Table:** `layouts` (`DATABASE.md` §6.2 — already created in `0003_settings`, Phase 5). **Frontend:**
the `Layout` menu in `TopToolbar` (currently visual presets only — this makes them persistent).

**Steps**
1. No new migration (reuse `0003_settings`).
2. Queries: list; create; update; delete; enforce **single default** (`is_default`) — setting one
   clears the others in the same statement/transaction.
3. Repo: `state jsonb` bundles the snapshot; keep it opaque.
4. Handler: `GET/POST /api/v1/layouts`, `PUT/DELETE /api/v1/layouts/:id`.
5. Bootstrap: `layouts` array.

**Acceptance**
- Save a layout, mark it default, save another and mark *it* default → exactly one default remains.
- Load a saved layout → indicators/drawings/panels restore from `state`.

**Complexity:** Low–Medium.

---

### Phase 13 — Simulated trading

**Goal:** Persist backtest/replay simulator accounts, orders, and positions so sessions and analytics
survive reloads. **Optional / last** — the fill + SL/TP engine stays in the frontend
(`services/tradeEngine.ts`); the backend is the durable store + analytics aggregator, not a matching
engine.

**Tables:** `sim_accounts`, `sim_positions` (`DATABASE.md` §9). Reconciled with the frontend
`Position`: **one self-contained table** (no separate `orders`) — a pending order is a `sim_positions`
row with `status='pending'`; fills are an embedded `fills jsonb` array (`Fill[]`); side is
`long`/`short`; PnL is split `realized_pnl`/`unrealized_pnl`. **Frontend store:** `tradeStore`
(runtime-only today). The fill/SL/TP engine stays client-side (`services/tradeEngine.ts`).

**Steps**
1. Migration `0006_trading` (before `0007_journal`; enums `trade_side`/`order_type`/`position_status`).
2. Queries: accounts CRUD; upsert position (dedupe on `client_id`) covering the full lifecycle
   `pending → open → closed/cancelled`; update `entry`/`remaining`/`realized_pnl`/`unrealized_pnl`/
   `fills`/`close_time`; list positions by status; analytics aggregate.
3. Repo: analytics computed in SQL where cheap (win rate, profit factor, expectancy, max drawdown,
   R-distribution) — mirror `services/analyticsEngine.ts` so the numbers match the client.
4. Handler: `GET/POST /api/v1/sim/accounts`, `GET /api/v1/sim/accounts/:id/positions`,
   `POST /api/v1/sim/accounts/:id/orders` (creates a `sim_positions` row),
   `POST /api/v1/sim/positions/:id/close`, `GET /api/v1/sim/accounts/:id/analytics`.
5. Bootstrap: **omit** (per-account, fetched when the Trade/Analytics panel opens).

**Acceptance**
- Create an account, place an order → position (with fills) → close it; equity/PnL persist across
  reload; a re-synced position (same `client_id`) doesn't duplicate.
- `/analytics` returns win rate / PF / expectancy / max DD matching the frontend engine on the same
  trade set.

**Complexity:** Medium–High (analytics parity with the client is the tricky part).

---

### Phase order rationale

6–9 are pure CRUD over `0004_charting` and unblock the most-used cross-device features (watchlist,
drawings, indicators, Pine) with the least risk. 10 adds status transitions + push. 11 is gated on
object storage (heaviest infra). 12 is trivial once `0003` exists. 13 is last because it depends on
`0006` and needs analytics parity — and the simulator is usable client-side until then.

---

## Testing strategy

- **Unit** (`go test ./...`): JWT mint/parse, session rotation/reuse, config validation, repo logic
  against a throwaway Postgres.
- **Integration:** spin a disposable Postgres (docker / `testcontainers-go`), run migrations, exercise
  handlers via `app.Test(req)` (Fiber's in-memory test transport) — no network needed.
- **Auth manual smoke:** obtain a Firebase ID token, run the Phase 4 flow with curl (`-c/-b` cookie
  jar) before wiring the frontend.
- Keep domain logic out of handlers so it's testable without HTTP (per `ARCHITECTURE.md`).

## Suggested package layout after Phase 4

```
backend/
  cmd/
    api/main.go
    migrate/main.go            # golang-migrate runner
  migrations/                  # 0001..NNNN .up/.down.sql
  sqlc.yaml
  internal/
    config/                    # + DB/auth/firebase/CORS vars
    db/
      pool.go
      queries/*.sql
      gen/                     # sqlc output
    httpserver/                # Fiber app, response helpers, CORS
    health/                    # /health, /health/ready
    auth/                      # firebase, verify, jwt, session, cookies, service, handler, middleware
    users/                     # repo (upsert from identity)
    settings/                  # first resource (Phase 5)
```

## Rollout checklist

- [ ] Provision Postgres; set `DATABASE_URL`.
- [ ] Firebase console: enable Google provider + add authorized domains (`AUTH.md` §8).
- [ ] Set `AUTH_JWT_SECRET` (32+ bytes), `FIREBASE_*`, `CORS_ALLOWED_ORIGINS`.
- [ ] Run migrations in CI/CD before deploy.
- [ ] Verify Secure-cookie flag is on in production (`APP_ENV != development`).
