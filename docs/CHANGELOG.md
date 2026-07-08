# CHANGELOG

All notable changes to the SMC Trading Terminal. Dates are UTC.

## [Unreleased]

### Fixed - Drawing render culling and hover redraw (2026-07-08)
- Changed drawing viewport culling to use each tool adapter's `boundingBox()`
  instead of raw anchor points, so extended/ray/fib/position-style geometry is
  not dropped while panning or zooming.
- Added hover and multi-select state to the drawing render memo guard, and
  schedule redraws when the hovered drawing changes.
- Cached the right-side whitespace `toX()` projection fallback by viewport
  version and candle anchors to reduce repeated candle scans while keeping
  future-time drawings pinned to the chart.
- Updated rectangle `Extend` hit-test and bounding-box logic so the visible
  extended region can be selected and is not culled.
- Added TypeScript drawing regression tests for adapter-owned viewport culling,
  rectangle extend geometry, and hover/multi-select render memo keys.

### Fixed - Auth workspace reset boundary (2026-07-08)
- Reset user-scoped frontend workspace state when auth resolves to anonymous, so sign-out no longer
  leaves the previous user's watchlist, settings, drawings, indicators, alerts, Trade prefill, or
  tool favorites visible.
- Kept login restore backend-owned: once the backend session is established, `sync/bootstrap` loads
  the signed-in user's settings/watchlists and drawing resources are loaded through their Phase 7
  APIs.

### Added - Backend Phase 7 drawings API and frontend sync (2026-07-08)
- Added `drawings` and `drawing_templates` migrations plus Go Fiber handlers for
  `GET/POST/PUT/PATCH/DELETE /api/v1/drawings`, `POST /api/v1/drawings/batch`, and
  `GET/POST/PUT/DELETE /api/v1/drawing-templates`.
- Added `drawing_tool_favorites` persistence plus `GET/PUT /api/v1/drawing-tool-favorites`, so
  the drawing toolbar star list no longer depends on `tv:favTools` localStorage for signed-in users.
- Wired `/api/v1/sync/bootstrap` to include global drawing templates while keeping per-symbol
  drawings lazy-loaded.
- Added the frontend `drawingsApi` ky resource and connected `chartStore` to load drawings by
  symbol and flush drawing create/update/delete mutations through a debounced batch sync keyed by
  `clientId`.
- Kept `drawings:<symbol>` and `drawingTemplates` localStorage only as anonymous/cache fallback,
  not as the authenticated source of truth.
- Added backend handler tests for drawing batch idempotency, drawing template CRUD, API error
  mapping, and bootstrap drawing-template hydration.

### Fixed - Watchlist Sort by action (2026-07-08)
- Added backend migration `0006_watchlist_sort_preferences` so each watchlist
  persists `sortKey` and `sortDir` with the server-owned Phase 6 data model.
- Extended `PATCH /api/v1/watchlists/:id` and bootstrap responses with sort
  metadata, so refreshes restore the selected Sort by mode.
- Fixed the frontend row renderer so Sort by applies even when the active
  watchlist has section rows; symbols are sorted inside each section group.
- Stopped realtime quote ticks from re-sorting the entire watchlist parent on
  every update. Sort now uses a quote snapshot at selection/layout time while
  row prices continue updating live.

### Changed - Watchlist Phase 6 backend-owned layout (2026-07-08)
- Added backend migration `0005_watchlist_layout` for `watchlist_sections`,
  `watchlist_preferences`, and `watchlists.shared`, so TradingView-style sections,
  active list, and shared flag persist server-side.
- Added `PUT /api/v1/watchlists/active` and `PUT /api/v1/watchlists/:id/layout`.
  The layout endpoint atomically replaces ordered symbols and section dividers and
  is now the common write path for add/remove/clear symbol, section edits, and
  drag/drop reorder.
- Updated the frontend watchlist API/store so authenticated watchlist actions use
  backend Phase 6 APIs. Browser localStorage is no longer used as a watchlist
  source of truth; Jotai keeps only an optimistic in-memory cache.
- Stopped MT5 symbol catalog refresh from overwriting user watchlists with the
  full symbol catalog. The catalog now only updates symbol search/metadata.

### Changed - Screenshot and watchlist menu parity (2026-07-08)
- Changed the top-toolbar camera button to open a TradingView-style snapshot menu
  with `Download image` (`Ctrl+Alt+S`) and `Copy image` (`Ctrl+Shift+S`) actions.
- Hid the watchlist delete-list icon when only one watchlist exists, so the list
  selector no longer shows a disabled trash affordance.

### Fixed - Watchlist create-list flow keeps existing lists selectable (2026-07-08)
- Replaced the browser `window.prompt` used by "Create new list..." with an in-app
  TradingView-style dialog so watchlist actions do not escape the terminal UI.
- Added active watchlist switching in the title dropdown, showing every saved list
  with its symbol count so a newly created empty list no longer feels like it
  deleted the previous list.
- Added a per-list trash action in the title dropdown; deleting the active list
  selects the nearest remaining list and syncs the delete to the backend when
  the list has a server id.
- Removed `Share list` and `Make a copy...` from the watchlist title menu to
  match the requested TradingView clone surface.
- Preserved the current active watchlist during backend watchlist bootstrap when
  that list still exists in the server response.

### Added - Lazy-load older chart candles on left pan (2026-07-07)
- Added MT5 history pagination end-to-end: frontend requests older pages with
  `before=<first loaded candle time>`, Go forwards that cursor to the Python bridge,
  and the bridge uses MT5 `copy_rates_from` to load bars strictly before the cursor.
- Merged older MT5 history pages into the backend cache instead of replacing the
  latest window, so repeated left-pan loads extend the chart history like TradingView.
- Reduced the initial chart history window and added near-left viewport prefetch
  with in-flight/cursor guards. The chart preserves the current logical range after
  prepending candles, avoiding a visible jump when older bars arrive.

### Changed - Optimized candle render churn (2026-07-07)
- Updated the main chart candle lookup cache to follow the realtime update plan:
  update/append paths now touch only the changed candle entries instead of rebuilding
  the full `Map<time, candle>` on every tick.
- Skipped no-op MT5 history refresh publishes when the merged candle values are
  unchanged, preventing periodic 3-second refreshes from forcing chart, indicator,
  and overlay re-renders.
- Added a chart-store same-reference guard so downstream mirror effects do not
  re-emit the same candle array during realtime updates.

### Fixed - MT5 history requests no longer cascade-timeout chart loads (2026-07-07)
- Moved Python MT5 history loading onto a single dedicated history worker so a slow
  `copy_rates_*` call for `1D`/`1W` does not block the WebSocket event loop and cause unrelated
  history requests to return `candles: []` after a timeout.
- Raised the Go MT5 history request/HTTP budgets to match cold MT5 history downloads and return
  cached candles on timeout when a usable cache exists instead of dropping to an empty chart.
- Reduced frontend initial history limits for high timeframes (`1D`, `1W`, `1M`) and stopped
  retrying immediately after a backend timeout, preventing long spinner loops.

### Fixed - Chart right-whitespace pan/zoom no longer snaps back (2026-07-07)
- Fixed a delayed viewport reset where dragging or zooming the chart into right-side whitespace
  would snap back after the next structural candle refresh. `PriceChart` no longer calls
  `keepLatestBarInView()` for non-replay history refreshes or gap backfills; only replay's blank
  viewport recovery may realign the logical range.
- Updated replay and zoom/viewport docs, plus `check:replay-logic`, to guard against reintroducing
  structural-refresh viewport hijacks.

### Fixed - Replay timeframe changes keep the selected replay time (2026-07-07)
- Fixed Bar Replay losing its selected past region when switching timeframe, e.g. selecting a replay
  bar on `15m` and then changing to `5m`. Replay now stores absolute `anchorTime`/`cursorTime` and
  remaps those timestamps to the new timeframe's candle index instead of treating the old index as
  valid for the new candle array.
- `useMarketData()` now disarms replay only when the symbol changes. Timeframe changes keep replay
  armed, load history around the replay cursor when needed, and reconcile the new history through
  `reconcileReplayToCandlesAtom`.
- Extended `npm run check:replay-logic` to guard timeframe remapping and prevent regression back to
  index-only replay state.

### Fixed - MT5 stock quote snapshots and rejected stream symbols (2026-07-07)
- Fixed blank watchlist rows for slower MT5 symbols such as `AAPL`: the Python sidecar now sends the
  current tick snapshot for every active stream symbol immediately when the Go backend connects, so
  Go does not have to wait for a new broker tick before caching Last/Chg/Chg%.
- Fixed an optimistic stream-state bug where the Go backend marked a requested symbol as
  `streamSymbols` before the Python bridge confirmed `symbol_select()`. Symbols rejected by MT5,
  such as an unavailable `ABBV` in the current terminal, now remain catalog/search-only instead of
  being presented as live streamable data.

### Changed - MT5 watchlist realtime quotes use browser WebSocket (2026-07-07)
- Added backend browser WebSocket `GET /api/v1/mt5/stream` for MT5 quote fan-out. The Go API still
  keeps the single Python MT5 sidecar connection, caches ticks, and now pushes subscribed
  `snapshot`/`tick` envelopes to browser clients.
- Reworked the frontend `Mt5Provider` to use one shared WebSocket with `set_symbols`, `subscribe`,
  `unsubscribe`, reconnect, and automatic resubscribe. Watchlist quote updates no longer poll
  `/api/v1/mt5/ticks` every interval.
- Kept `GET /api/v1/mt5/ticks` as a one-off snapshot/debug endpoint and compatibility path.
  MT5 candles still come only from `/api/v1/mt5/history`; bid/ask ticks are not synthesized into
  chart OHLC bars.

### Fixed - MT5 history gap before the realtime candle (2026-07-07)
- Fixed a gap between loaded history and the live forming candle: MT5 history could lag the live
  tick by many bars (18-2800), leaving the realtime candle floating far to the right. Two causes:
  - **Python bridge** (`bridge/mt5_stream/mt5_server.py`): `copy_rates_from_pos` returns cached
    bars and MT5 only downloads recent history in the background. Added `copy_rates_synced()`, which
    forces the terminal to fetch up-to-now bars (a future-anchored `copy_rates_from`) and retries
    until the last bar is current. Fresh symbols return immediately with no added latency.
  - **Go backend** (`internal/mt5stream/service.go`): the per-symbol history cache was never
    invalidated, so a symbol cached stale at startup (e.g. the default chart symbol requested before
    MT5 synced) was served stale forever. `History()` now re-requests when the cached last bar lags
    the latest streamed tick (`historyIsFresh`); pagination (`before>0`) still uses the cache.
- Added `1M` (monthly) to the timeframe-seconds maps on both sides (using the 31-day upper bound so
  a valid current-month bar passes the freshness check while a months-behind cache is refetched),
  since the chart timeframe selector offers 1 Month. `1m` (minute) and `1M` (month) are distinct.
- Changed the Python bridge retry delay from blocking `time.sleep` to `await asyncio.sleep`, so a
  cold MT5 history sync no longer freezes the WebSocket event loop long enough for Go requests to
  time out. Go history request headroom was raised to cover the Python retry window.
- Fixed the frontend MT5 catalog/history race: the chart now waits for `/api/v1/mt5/symbols` to
  hydrate before deciding a symbol has no route, then reloads history when the catalog becomes ready.
- Raised the browser timeout for `/api/v1/mt5/history` and added one short history retry. MT5 daily
  and higher-timeframe cold loads can exceed the generic 15s API timeout even when the backend
  eventually returns valid candles.
- Removed MT5 tick-to-candle aggregation from the chart path. MT5 ticks now update quotes/watchlist
  only; chart candles refresh from MT5 OHLC history/rates with `refresh=true`.
- Corrected MT5 time handling: `copy_rates_*` bar times are already UTC per MetaQuotes docs, so the
  bridge now leaves candle timestamps unchanged and normalizes only tick timestamps when the
  terminal exposes a broker/workstation offset. This fixes a false 7-hour gap where EURUSD M15
  history appeared to end well before the live tick.
- Verified live against the FTMO MT5 terminal: every streamed symbol's history now ends on the
  current forming bar (gap ~0.4 bars) instead of lagging by up to ~29 days (GBPUSD).
- Fixed MT5 watchlist live quotes when both `MT5_SYMBOLS` and `MT5_STREAM_ALL_VISIBLE=true` are set:
  the bridge now streams every visible Market Watch symbol and treats `MT5_SYMBOLS` as extra
  explicit symbols, instead of accidentally limiting live ticks to only the comma-separated list.
- Added on-demand MT5 tick streaming: when the frontend polls `/api/v1/mt5/ticks?symbols=...` for a
  catalog symbol that was not in the initial bridge stream set, the Go API asks the Python sidecar
  to `symbol_select()` and add that symbol to the tick loop. This prevents watchlist rows such as
  manually-added stocks from staying at `--` until the bridge is restarted.

### Fixed - MT5 chart candles and watchlist live prices (2026-07-07)
- Added backend `GET /api/v1/mt5/ticks` and `GET /api/v1/mt5/history` on top of the local MT5
  Python bridge cache/request path.
- Added frontend `Mt5Provider` so MT5 symbols receive live quotes from the Go API.
- MT5 chart history now loads on demand from backend/Python `copy_rates_from_pos`, so the chart is
  seeded with historical candles instead of showing only one realtime candle.
- MT5 catalog hydration now uses the full catalog for symbol search, but defaults the watchlist to
  `streamSymbols` so rows have live `Last/Chg/Chg%` values.
- Backend workspace/watchlist bootstrap now also uses streamable MT5 symbols instead of overwriting
  the live watchlist with the full MT5 catalog.
- Removed the legacy `MT5_SYMBOL` fallback from the Python stream sidecar; use
  `MT5_STREAM_ALL_VISIBLE=true` to stream visible MT5 Market Watch symbols, and use `MT5_SYMBOLS`
  only for explicit extras.

### Changed - MT5 catalog as frontend symbol source of truth (2026-07-07)
- Removed the frontend hardcoded market symbol seed list. The runtime registry now starts empty and
  is replaced by `GET /api/v1/mt5/symbols`.
- Watchlist, symbol search, and alert symbol pickers now read from the hydrated MT5 catalog instead
  of static local data.
- The active watchlist is replaced with MT5 `streamSymbols` after catalog refresh; the full catalog
  remains available in symbol search.
- MT5 symbols no longer fall through to Binance, TwelveData, or OANDA client-side routes.

### Added - Backend Phase 6 MT5 tick streaming (2026-07-07)
- Added `backend/bridge/mt5_stream/mt5_server.py`, a localhost Python WebSocket sidecar that
  initializes MetaTrader 5 through the `MetaTrader5` package, sends the MT5 symbol catalog on
  connect, and streams de-duplicated ticks for visible Market Watch symbols plus any explicit
  `MT5_SYMBOLS` extras.
- Added `backend/cmd/mt5-stream`, a Go consumer using `github.com/gorilla/websocket` with typed
  `Mt5Tick` decoding, formatted terminal logs, reconnect backoff, and graceful shutdown.
- Added a Go API MT5 catalog cache service and `GET /api/v1/mt5/symbols` so the frontend can read
  the MT5 symbol list from the backend instead of connecting directly to the Python sidecar.
- Added frontend typed API resource `getMt5Symbols()` for that endpoint.
- Added MT5 stream requirements and README under `backend/bridge/mt5_stream/`.
- Updated backend Phase 6 docs so Phase 6 now includes both watchlists and MT5 tick streaming.

### Added - Frontend Phase 6 watchlist API write-through (2026-07-07)
- Expanded the frontend `ky` API client with a shared `deleteJson` helper.
- Added typed Phase 6 watchlist resource calls for create/update/delete lists and add/remove
  symbols.
- `useWorkspaceBootstrap()` now creates a server-side default Watchlist when authenticated backend
  bootstrap returns no watchlists, avoiding local seed symbols being shown as remote data.
- Watchlist create, copy, rename, clear, add-symbol, and remove-symbol actions now optimistically
  update the UI and write through to backend Phase 6 APIs when `backendSession` is active.
- Documented that watchlist sections, section drag/drop, symbol reorder, and sharing remain
  frontend-only until backend exposes those contracts.

### Fixed - TwelveData fallback for OANDA-primary symbols (2026-07-07)
- Fixed OANDA-primary forex/metals/indices fallback so `NEXT_PUBLIC_TWELVEDATA_API_KEY` works even
  when no OANDA key is configured.
- Added common TwelveData symbol mapping (`EURUSD -> EUR/USD`, `XAUUSD -> XAU/USD`, `SPX500 -> SPX`)
  instead of reusing OANDA underscore instruments such as `EUR_USD`.
- Historical REST loading now falls back from OANDA to TwelveData when only the TwelveData key is
  configured, matching the realtime provider routing.
- Added tests for TwelveData fallback symbol mapping.

### Fixed - Chart one-candle viewport race on local WebSocket failures (2026-07-07)
- Added a chart auto-fit policy so a single realtime/forming candle can be shown temporarily without
  permanently locking the viewport before REST history finishes loading.
- `PriceChart` now refits when REST history expands a partial realtime window, preventing the chart
  from staying zoomed into one giant candle after local WebSocket failures/reconnect races.
- Switched the default Binance WebSocket endpoint from `:9443` to standard WSS port 443
  (`wss://stream.binance.com/ws`) to reduce blocked-socket failures in local/dev networks.
- Added chart tests for the partial-realtime-to-history auto-fit path.

### Fixed - Watchlist section drag/drop parity (2026-07-07)
- Made watchlist section rows draggable divider tokens, matching TradingView's section behavior.
- Added shared `moveSectionInList()` token-layout logic so section movement changes group
  boundaries without manually mutating symbol order in the UI.
- Added watchlist tests for moving section dividers before symbols, to the unsectioned top boundary,
  and around other sections that share the same symbol index.
- Updated `frontend/docs/WATCHLIST_ARCHITECTURE.md` with the section-divider drag/drop rules.

### Added - Frontend backend bootstrap read path (2026-07-07)
- Added typed `ky` resource modules for `/api/v1/settings`, `/api/v1/watchlists`, and
  `/api/v1/sync/bootstrap`.
- Added `useWorkspaceBootstrap()` in `GlobalRuntime`; after backend auth succeeds, the frontend now
  loads server settings/watchlists and applies them into Jotai atoms.
- Remote bootstrap currently hydrates UI theme/panels, SMC overlay settings, alert notification
  defaults, and watchlist lists/symbols. Anonymous/local mode remains unchanged.
- Added shared `putJson`/`patchJson` helpers to the backend API client for the next write-sync phase.

### Added - Backend Phase 6: Watchlists (2026-07-06)
- Migration `0004_watchlists` — `watchlists` + `watchlist_symbols` (DATABASE.md §7.1) with the
  shared `set_updated_at()` trigger and `UNIQUE (watchlist_id, symbol)`.
- `internal/watchlists`: `model.go` (`Watchlist{id,name,position,symbols}` + `ErrNotFound`/
  `ErrBadRequest`), `repo.go` (hand-written pgx `Store`, all queries scoped by `user_id`, ownership
  enforced in SQL, cross-user → `ErrNotFound`; single symbol-load query avoids N+1; idempotent add
  via `ON CONFLICT DO NOTHING`), `handler.go` (Fiber CRUD behind `RequireAuth`).
- Endpoints: `GET/POST /api/v1/watchlists`, `PATCH/DELETE /api/v1/watchlists/:id`,
  `POST /api/v1/watchlists/:id/symbols`, `DELETE /api/v1/watchlists/:id/symbols/:symbol`.
- `sync/bootstrap` now fills the `watchlists` slice (via a narrow `WatchlistLister`); wired in
  `httpserver`/`cmd/api`.
- Tests: `handler_test.go` (CRUD flow, cross-user 404, empty-name 400) via `app.Test` + a fake store.
- Verified live against Neon: migrate up to version 4, then login → create → add/dup symbol
  (idempotent) → list → rename → remove symbol → bootstrap (populated) → unknown id 404 → delete.
  Test data cleaned up afterward.

### Changed - Refresh frontend docs for current architecture (2026-07-06)
- Rewrote `frontend/README.md` to match the current Next 16/Jotai/live-market-data frontend instead
  of the old Zustand/mock-data structure.
- Replaced stale `frontend/docs/ARCHITECTURE.md` content with the current monorepo, auth, backend
  API, market-data, persistence, and runtime-loop architecture.
- Updated `frontend/docs/ALERT_ARCHITECTURE.md` to reflect implemented push and external alert
  dispatch channels.
- Corrected active drawing docs that still referred to Zustand selectors/state after the Jotai
  migration.

### Fixed - Google login action after frontend split (2026-07-06)
- Added a monorepo env fallback in `frontend/next.config.mjs` so local frontend builds can read
  missing Firebase/API values from the repository root `.env.local` after the source moved under
  `frontend/`.
- The shared `ky` backend client now defaults to `http://localhost:8080` in local development while
  keeping production explicit via `NEXT_PUBLIC_API_BASE_URL`.
- The Google sign-in button now surfaces missing Firebase config in the toolbar state instead of
  only writing an internal log entry, making failed clicks visible.

### Changed - Frontend auth uses Go backend session API (2026-07-06)
- Added a shared `ky` backend API client and auth resource module for `/api/v1/auth/me`,
  `/auth/refresh`, `/auth/google`, and `/auth/logout` with httpOnly-cookie credentials.
- Updated the Firebase auth bridge so Google sign-in reuses an existing backend session, refreshes
  cookies when possible, and falls back to exchanging the Firebase ID token through the Go backend
  login/register endpoint.
- Updated frontend auth/sync docs to mark backend auth as implemented and wired.

### Fixed - Chart gap backfill preserving full series (2026-07-06)
- Fixed a remaining chart gap case where a targeted REST backfill could replace the store with only
  the fetched window plus newer bars, dropping older live candles around the visible area. History
  merges now preserve live candles outside the fetched history window while letting closed history
  repair the gap inside that window.
- Added chart regression coverage for preserving live candles before and after a backfill window.

### Added - Backend Phase 5: Settings & sync bootstrap (2026-07-06)
- Added `0003_settings` migration for `user_settings` and `layouts`.
- Added `internal/settings` repo/handler for protected `GET/PUT/PATCH /api/v1/settings`.
  `GET` auto-creates a default row, `PUT` replaces all sections, and `PATCH` deep-merges JSON object
  sections.
- Added `internal/workspace` with protected `GET /api/v1/sync/bootstrap`, returning persisted
  settings plus empty arrays for watchlists, drawing templates, indicators, Pine scripts, alerts,
  and layouts until later backend phases fill them.
- Wired Phase 5 routes from `cmd/api` when DB + Firebase auth are configured, and added unit/handler
  coverage for settings merge semantics and bootstrap response shape.

### Fixed - Realtime candle continuity gaps (2026-07-06)
- Fixed a chart gap where candles could disappear until a hard refresh after WebSocket reconnects,
  tab sleep, or out-of-order realtime delivery. `marketDataStore.updateCandleAtom` now upserts
  realtime candles by timestamp instead of dropping every candle older than the latest bar.
- Added `upsertMarketCandleIntoSeries()` and `findRecentCandleGap()` in
  `frontend/src/services/market-data/candleSeries.ts` so candle ordering, delayed corrections, and
  short-gap detection are covered by pure tests.
- `useMarketData()` now triggers a bounded REST history backfill for short gaps in the active
  symbol/timeframe, matching the "reload fills the missing candles" behavior without requiring F5.
- Added chart tests for delayed candle insert, delayed correction replacement, max-window trimming,
  and short-gap backfill detection.

### Added - Backend Phase 4: Auth endpoints & middleware (2026-07-06)
- **Google login/register works end-to-end** (pending a live Postgres to exercise it).
- `internal/users/repo.go`: `Repo.UpsertFromIdentity` (transactional) — finds `auth_identities` by
  `(google, provider_uid)` → login (refresh profile + `last_login_at`); else links a new google
  identity to an existing user by email; else registers a new user + identity. Returns
  `(user, isNewUser)`. Plus `GetUser`. Implements `auth.UserUpserter`.
- `internal/auth/service.go`: `User` DTO + `UserUpserter` interface + `Service` orchestrating
  `LoginWithGoogle` (verify → upsert → create session → mint access), `Refresh` (rotate → mint),
  `Logout`, `RevokeAllSessions`, `GetUser`. (`CreatedSession` now carries `UserID` so refresh can
  mint without a second lookup.)
- `internal/auth/middleware.go`: `RequireAuth` — reads the `access_token` cookie, `ParseAccess`,
  puts `user_id`/`session_id` in `c.Locals`; 401 on failure.
- `internal/auth/handler.go`: Fiber routes `POST /api/v1/auth/google`, `POST /auth/refresh`,
  `POST /auth/logout` 🔒, `GET /auth/me` 🔒, `DELETE /auth/sessions` 🔒. Handlers return
  `fiber.NewError` so the central ErrorHandler renders the standard envelope (no httpserver import →
  no import cycle). Reuse/expired refresh clears cookies.
- `httpserver/server.go`: CORS middleware (`CORSAllowedOrigins`, `AllowCredentials: true`) +
  `/api/v1` group; mounts the auth handler when present. `cmd/api` assembles the auth stack only when
  **both** a DB pool and a Firebase service account are configured (otherwise the routes stay
  unmounted, logged clearly).
- Tests (`handler_test.go` via `app.Test`, no DB/Firebase): full google→me→refresh→logout flow +
  cookie assertions; `/me` without cookie → 401; bad/missing idToken → 401/400; refresh w/o cookie →
  401. 17 auth tests total.
- Verified: `go build/vet/test` pass; real Firebase creds (`tradingview-b36a5`) initialize the Admin
  SDK; server boot with Firebase-but-no-DB disables auth routes as designed. **Verified live
  end-to-end against a Neon Postgres** (2026-07-06): minted a real Firebase ID token and ran
  `/auth/google` (first call `isNewUser:true` → user row created; second call `isNewUser:false`),
  `/auth/me`, `/auth/refresh`, `/auth/me` again, `/auth/logout` — all pass. (Required enabling
  Firebase Authentication in the console first; before that the Identity Toolkit returned
  `CONFIGURATION_NOT_FOUND`.) Test user cleaned up afterward.

### Added - Backend Phase 3: Sessions & tokens (2026-07-06)
- `internal/auth/jwt.go`: `TokenService` — `MintAccess(userID, sessionID)` HS256 JWT
  (`sub`/`sid`/`iat`/`exp`, `AUTH_JWT_SECRET`/`AUTH_ACCESS_TTL`) + `ParseAccess` with
  `WithValidMethods(["HS256"])` (alg-confusion guard). Any failure → `ErrUnauthorized`.
- `internal/auth/session.go`: `SessionService` over a pgx-free `SessionStore` interface —
  `Create` (256-bit crypto refresh token, only its SHA-256 hash stored), `Rotate` (single-use;
  unknown/expired → `ErrUnauthorized`; **reuse of a revoked token → revoke the whole session family
  + `ErrSessionReuse`**; else revoke old + issue new), `Revoke`, `RevokeAll`. Injected clock for
  testable expiry.
- `internal/auth/session_pgstore.go`: `PgSessionStore` adapts the sqlc `gen.Queries` to
  `SessionStore` (pgtype/UUID/timestamptz/inet conversions) — the production store, ready for Phase 4.
- `internal/auth/cookies.go`: `SetAuthCookies`/`ClearAuthCookies` — HttpOnly, SameSite=Lax, Secure
  gated by `APP_ENV` (off only in development); access cookie at `/`, refresh scoped to
  `/api/v1/auth`; Max-Age from each TTL.
- Dep: `github.com/golang-jwt/jwt/v5`.
- Tests (`jwt_test.go`, `session_test.go`): mint→parse round-trip, expired rejected, wrong-secret
  rejected, none-alg rejected; session create, rotate happy path, **reuse revokes the family**,
  unknown/expired rejected. `go build/vet/test` all pass (13 auth tests).

### Added - Backend Phase 2: Firebase ID-token verification (2026-07-06)
- `internal/auth/firebase.go`: `NewVerifier(ctx, cfg)` initializes the Firebase Admin SDK
  (`firebase.google.com/go/v4`) from the `FIREBASE_*` service-account env (builds the minimal
  service-account JSON and passes it via `option.WithCredentialsJSON`), exposing an `*auth.Client`
  behind a small `idTokenVerifier` interface.
- `internal/auth/verify.go`: `VerifyGoogleToken(ctx, idToken) (Identity, error)` calls
  `VerifyIDToken` and maps claims → `Identity{ UID, ProviderUID, Email, EmailVerified, Name,
  PhotoURL }` (ProviderUID = Google `sub` from `firebase.identities["google.com"]`, falling back to
  the Firebase uid). Every failure (empty/malformed/expired/wrong-audience) returns `ErrUnauthorized`
  wrapping the cause — never a partial identity.
- Unit tests (`verify_test.go`, no network/creds via a fake verifier): empty token → unauthorized;
  verification error → unauthorized + zero identity; full claim mapping; ProviderUID uid-fallback.
- Deps: `firebase.google.com/go/v4`, `google.golang.org/api/option` (+ transitive Google SDK).
- Verified: `go build ./...`, `go vet ./...`, `go test ./...` (auth tests pass). Real-token check
  deferred to Phase 4 wiring (needs a live Firebase project + a real ID token).

### Added - Backend Phase 1: Database layer (2026-07-06)
- `internal/db/pool.go`: `pgxpool`-backed pool built from `DatabaseURL`, pings on startup, exposes
  `Ping`/`Close` (sensible pool defaults).
- Migrations `backend/migrations/0001_extensions.(up|down).sql` (pgcrypto, citext) and
  `0002_auth.(up|down).sql` (`users`, `auth_identities`, `sessions`, `push_tokens` + `user_status`/
  `auth_provider`/`push_platform` enums + shared `set_updated_at()` trigger on the mutable auth
  tables), from `DATABASE.md` §5.
- `cmd/migrate`: golang-migrate runner (embedded `iofs` source → cross-platform, no `file://` path
  issues; rewrites `postgres://` → `pgx5://`) supporting `up [N]`, `down [N|all]`, `version`,
  `force V`. Added `backend/Makefile` (`migrate-up`/`migrate-down`/`migrate-version`/`sqlc`).
- sqlc: `sqlc.yaml` (pgx/v5, `citext`→`string` override, pointers for nullables) + typed queries for
  users/identities/sessions in `internal/db/queries/*.sql`; generated `internal/db/gen/*` (models +
  query methods). Enums, `inet`→`*netip.Addr`, `jsonb`→`[]byte` all resolved.
- Readiness: `GET /health/ready` pings the pool (`200 {ready:true,database:"up"}` /
  `503 {..."down"|"unconfigured"}`); liveness `GET /health` stays DB-free. Server/main now build an
  optional pool (dev without `DATABASE_URL` boots and reports `unconfigured`; typed-nil interface
  trap guarded in `httpserver.New`).
- Files: `backend/{go.mod,go.sum,sqlc.yaml,Makefile}`, `backend/migrations/*`,
  `backend/cmd/migrate/main.go`, `backend/cmd/api/main.go`,
  `backend/internal/{db/pool.go,db/queries/*.sql,db/gen/*,health/handler.go,httpserver/server.go}`.
- Verified: `go build ./...`, `go vet ./...`, `sqlc generate` (compiling Go), live `/health` 200 +
  `/health/ready` 503 unconfigured, and the migrate runner aborting cleanly without `DATABASE_URL`.
  **Not yet run against a live Postgres** (none available locally) — `migrate up`/`down` +
  `/health/ready` 200 need a DB to fully verify.

### Added - Backend Phase 0: Fiber foundation & framework (2026-07-06)
- Migrated the Go backend HTTP surface from stdlib `net/http`/`http.ServeMux` to
  `github.com/gofiber/fiber/v2`. `GET /health` returns the same JSON as before.
- `internal/httpserver/server.go` now builds a `*fiber.App` with `requestid` → `recover` →
  zerolog logging middleware, and graceful shutdown via `app.ShutdownWithContext`.
- `internal/httpserver/response.go`: `WriteError(c, status, code, message)` + a central Fiber
  `ErrorHandler` producing the standard `{ "error": { "code", "message" } }` envelope from
  `API.md` (status→slug map: 400 bad_request, 401 unauthorized, 404 not_found, 5xx internal, …).
- `internal/health/handler.go` and `internal/middleware/logging.go` ported to Fiber handlers;
  the logger emits `request_id` and derives the true status from the returned error for error
  responses.
- `internal/config/config.go` extended with `DatabaseURL`, `AuthJWTSecret`, `AuthAccessTTL`,
  `AuthRefreshTTL`, `FirebaseProjectID`, `FirebaseClientEmail`, `FirebasePrivateKey` (un-escapes
  `\n`), and `CORSAllowedOrigins`. `Load()` now returns `(Config, error)` and fails fast when a
  required secret is missing and `APP_ENV != development`; `cmd/api/main.go` handles the error.
- Added `backend/.env.example` documenting every var (mirrors `AUTH.md` §8) and `godotenv`
  best-effort dev loading.
- Files: `backend/{go.mod,go.sum,.env.example}`, `backend/cmd/api/main.go`,
  `backend/internal/{httpserver/server.go,httpserver/response.go,health/handler.go,
  middleware/logging.go,config/config.go}`.
- Verified: `go build ./...`, `go vet ./...`, `/health` 200 with unchanged body, 404 returns the
  error envelope, and production boot with missing secrets aborts with a clear log line.

### Changed - Documentation restored after monorepo split (2026-07-06)
- Restored the pre-`9691bd1` memory docs instead of replacing them with short summaries.
- Moved frontend-specific restored docs into `frontend/docs/`; older milestone, audit, and parity
  reports now live under `frontend/docs/archive/`.
- Kept root `docs/` for cross-project memory: changelog, current state, handoff, next tasks,
  known issues, operations, and project structure.
- Clarified backend status after the split: Fiber is the selected framework, but the current Go
  scaffold still uses stdlib `net/http` until backend Phase 0.
- Added Watchlist architecture notes for the TradingView-style list menu, rename mode, sections,
  and localStorage compatibility.

### Changed - Watchlist menu and section parity (2026-07-06)
- Added TradingView-style Watchlist title menu actions: Share list, Make a copy, Rename, Add
  section, Clear list, and Create new list.
- Removed unsupported actions requested by the user: Upload/Open list and Add alert on the list.
- Added header rename mode with focused selected text and blue outline.
- Added full-width blue section rows with chevron behavior, inline double-click rename, and section
  delete.
- Added symbol drag/drop before a section or inside a section through shared Watchlist layout
  helpers.
- Fixed drag/drop when two section headers share the same symbol index, so dropping DOGE into
  `SECTION 1` is distinct from dropping it into `SECTION 2`.
- Fixed dragging symbols into an empty trailing section by treating most of the section header as
  an inside-section target instead of a before-section target.
- Fixed Section 1 -> Section 2 drops by resolving the final target from the pointer release
  coordinates, not stale React state from the previous pointermove.
- Expanded section hit-testing so the empty body below a trailing section header is still treated as
  that section, matching the way users drag into TradingView watchlist sections.
- Added an unsectioned top drop target so symbols can be dragged out of a section and back into the
  ungrouped Watchlist area.
- Replaced native HTML row dragging with pointer-based Watchlist drag/drop to avoid the browser
  ghost dragging a whole visual cluster and to make section targets deterministic.
- Smoothed Watchlist dragging by moving the ticker ghost with `requestAnimationFrame()` +
  `transform` instead of re-rendering the list on every pointermove.
- Added TradingView-style horizontal insertion lines for unsectioned, section, and symbol drop
  targets so the exact drop position is visible while dragging.
- Expanded the local watchlist store to preserve list metadata while keeping the legacy `watchlist`
  localStorage symbol array synchronized for existing code paths.
- Added `npm run test:watchlist` coverage for section rename/delete, symbol removal index repair,
  and drag/drop index rules.

### Fixed - Chart realtime candle integrity and render batching (2026-07-06)
- Added shared candle-series helpers for normalizing OHLC, merging delayed REST history with
  already-received live candles, and deciding when chart updates are safe to apply incrementally.
- Fixed the race where a history response could overwrite newer realtime/forming candles, leaving
  the chart visually missing candles until a hard refresh.
- Hardened `PriceChart` so Lightweight Charts `series.update()` is used only when the candle-array
  prefix is unchanged; structural history/replay/window changes now use `setData()`.
- Batched chart context version bumps through `requestAnimationFrame()` to reduce duplicate overlay
  renders during rapid candle and viewport updates.
- Added `npm run test:chart` coverage for the realtime/history merge and update-plan rules.

### Changed - Backend docs reconciled with the real frontend data model (2026-07-06)
- Audited the frontend's actual persistence model and updated backend planning docs so implementation
  can match the real app instead of guessing from old mock-era assumptions.
- Added `drawing_templates` to the backend schema plan.
- Expanded user settings, alerts, journal entries, screenshots, simulated trading, Pine scripts, and
  indicator preset contracts.
- Updated `backend/docs/DATABASE.md`, `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`, and
  `backend/docs/API.md`.

### Changed - Backend phases 6-13 expanded (2026-07-06)
- Expanded persistence phases for watchlists, drawings, indicators, Pine scripts, alerts, journal
  and screenshots, layouts, and simulated trading.
- Added per-phase goals, tables, implementation steps, endpoints, acceptance criteria, and
  complexity notes.

### Added - Frontend Google auth UI (2026-07-06)
- Added Firebase Google sign-in/sign-up UI.
- Added auth store, auth session hook, toolbar sign-in control, and user menu.
- Added best-effort backend session exchange that remains a no-op until backend auth endpoints ship.
- Added `frontend/docs/AUTH_UI.md`.

### Added - Backend auth and database planning (2026-07-06)
- Added Google auth plan using Firebase Auth as identity provider and Go backend sessions.
- Added PostgreSQL schema planning.
- Expanded backend API contracts.
- Added phased backend implementation plan.

### Changed - Python MT5 bridge moved under backend (2026-07-06)
- Moved the Python FTMO/MT5 bridge from root `bridge/` into `backend/bridge/`.
- Treated the bridge as backend-owned sidecar infrastructure.
- Updated backend docs and operations notes for the new path.

### Changed - Monorepo split (2026-07-05)
- Moved the Next.js frontend under `frontend/`.
- Added a minimal Go backend under `backend/`.
- Added root documentation for package ownership and operations.

### Changed - Top interval selector popup (2026-07-05)
- Replaced the always-visible top timeframe strip with a TradingView-style
  interval selector: only favorited intervals show on the toolbar, while the
  full grouped list opens in a scrollable popup.
- Added persisted interval favorites under `tv:favoriteTimeframes`; default
  favorites are `1m`, `5m`, and `15m`.
- The active interval remains visible even when it is not favorited, matching
  TradingView's current-resolution affordance.
- Added the `Add custom interval` modal with Type/Interval fields and a
  disabled Add button until the entry maps to a supported chart timeframe.
- Added UI model tests for favorite normalization, toggle order, and active
  interval visibility.

### Fixed - Chart range shortcut viewport and active state (2026-07-05)
- Bottom range shortcuts (`1D`, `5D`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `5Y`,
  `All`) now update the chart viewport and keep the clicked button highlighted.
- Shortcuts now follow TradingView's `time_frames` model by switching to a
  target resolution before applying the range (`All -> 1M`, `5Y -> 1W`,
  `1Y/YTD -> 1D`, `6M -> 2H`, `3M -> 1H`, `1M -> 30m`, `5D -> 5m`,
  `1D -> 1m`), so long-range buttons are no longer constrained to the
  currently loaded `15m` data.
- Added TradingView-style shortcut hover tooltips such as
  `All data in 1 month intervals` and `6 months in 2 hours intervals`.
- Non-`All` shortcuts now use `shortcutLogicalRange()` and
  `setVisibleLogicalRange()` anchored to the latest loaded candle, matching the
  TradingView-style behavior shown in the bottom toolbar.
- `All` still calls `fitContent()`, while Go-to Date/Custom Range clear the
  active shortcut because they are manual navigation modes.
- Added chart tests for shortcut logical-range conversion.

### Changed - Indicator browser API-only catalog (2026-07-05)
- Refactored the `Indicators, metrics, and strategies` popup toward the
  TradingView sidebar layout: Personal, Built-in, and Community sections, with
  the Store tab removed.
- Added `GET /api/indicators/tradingview` plus
  `services/tradingViewIndicatorCatalog.ts` to load and normalize rows from
  TradingView public script pages.
- Removed local hardcoded technical/fundamental/community fallback datasets.
  When TradingView data is unavailable or unparseable, the route now returns
  `source: "pending"` with an empty list so the task remains explicit instead
  of showing fabricated rows.
- Added `npm run test:indicator-catalog` to guard parser behavior and ensure
  unparseable upstream HTML stays empty rather than falling back to local data.

### Fixed - Replay past-jump blank viewport (2026-07-05)
- Added shared replay viewport helpers that detect when the visible logical
  range no longer intersects the replay-visible candle slice.
- `PriceChart` now realigns to the latest replay candle whenever replay is
  active and the viewport is stuck in future/past whitespace, covering Select
  date, Random bar, scrubber jumps, restart/re-select, and backward stepping.
- Replaced the old `scrollToRealTime()` fallback with deterministic
  `setVisibleLogicalRange()` realignment, preserving zoom width while avoiding
  blank chart states after data-window replacement.
- Added chart tests for replay viewport intersection and fallback range math.

### Changed - Default chart volume visibility (2026-07-05)
- Removed the default volume histogram from `PriceChart`, matching the
  TradingView-style expectation that volume is an explicit study/indicator
  rather than part of a clean default candle chart.
- Main chart price-scale margins no longer reserve a bottom volume band, so the
  candle area uses the chart height more naturally.
- Crosshair candle data still preserves OHLCV volume internally for indicators
  and data consumers.

### Changed - Drawing favorites floating toolbar (2026-07-05)
- Drawing tool favorites now render in a separate floating chart toolbar instead
  of being inserted above the main left drawing toolbar.
- The favorite star in every drawing flyout still writes to the shared
  `tv:favTools` set; the floating toolbar reads the same set, supports
  drag-to-move, one-click tool activation, and right-click removal.
- Fixed the floating toolbar's initial-position callback so adding the first
  favorite no longer triggers a render/effect loop and breaks page loading.

### Fixed - Trade ticket formatted price metrics (2026-07-05)
- Trade ticket inputs now parse prefilled prices with thousands separators such
  as `62,751.61`, so Limit/Stop tabs no longer show `Size: NaN` after a
  Long/Short Position fills the ticket.
- Simulator risk math now ignores invalid numeric drafts instead of propagating
  `NaN`, keeping Size, Reward, and R:R stable while the user edits the ticket.
- Added `npm run test:trade` with coverage for formatted price parsing and
  finite Limit-ticket metrics.

### Fixed - Dialog close icon click reliability (2026-07-05)
- Updated the shared draggable dialog hook so nested SVG/icon targets inside
  buttons are treated as no-drag controls. Close buttons and other icon buttons
  no longer have their click swallowed by the drag handler.
- Added UI coverage for SVG icon targets in draggable dialog controls.

### Changed - Long/Short price label and scale-panel parity (2026-07-05)
- Long/Short Position now renders absolute target, entry, and stop prices as
  right-edge price badges, matching TradingView's price-scale treatment.
- The right price-scale strip is now tinted across the take-profit and
  stop-loss zones, so the TP/SL color context continues through the price
  panel instead of stopping at the chart body.
- Target/Stop in-box chips are back to TradingView-style metrics: distance,
  percent, ticks, amount, and hit status instead of duplicating the absolute
  level price.
- Legacy Long/Short drawings without explicit stats or account/risk values now
  use the same default stats/account/risk fallback as newly created positions,
  keeping labels consistent after reloads.

### Added - Chart timezone selector (2026-07-05)
- Added a TradingView-style timezone selector to the bottom-right chart clock.
  The menu includes `UTC`, `Exchange`, and common city/IANA zones with live UTC
  offsets.
- The selected timezone is persisted in `localStorage` and now drives toolbar
  clock formatting, `Go to` dialog defaults, Date/Custom Range parsing, and the
  temporary Go-to marker chip.
- Added timezone parser/formatter coverage to `npm run test:chart`.

### Added - Long/Short position lot sizing prefill (2026-07-05)
- Added `positionLotSizing.ts` as the shared contract for converting
  Long/Short `SL-entry` distance, account risk, symbol tick value, and lot
  step/min/max into a normalized lot quantity.
- Long/Short Position prefill now includes `quantity` when symbol lot metadata
  is available, so the bottom `Trade` panel can fill the `Lot` field directly
  from the drawing.
- The `Trade` ticket now uses the same lot-sizing helper for MT5 risk metrics
  instead of keeping a separate local formula.
- Added `npm run test:position` coverage for risk-to-lot sizing and
  Long/Short prefill quantity.

### Fixed - Go to date jump parity (2026-07-05)
- Widened and tuned the `Go to` dialog to better match TradingView's Date /
  Custom range popup and prevent the date/time input row from overflowing.
- Date mode now jumps to the first loaded candle at or after the selected local
  date/time, matching the expected `2026-07-01 00:00 -> first candle of that
  day` behavior instead of choosing whichever candle is merely nearest.
- Date mode now zooms into a bounded TradingView-like candle window around the
  resolved candle when the current chart is too far zoomed out.
- Added a temporary TradingView-style vertical marker and date chip after a
  successful date jump.
- The temporary marker/chip now dismisses immediately when the user clicks,
  drags, wheels, touches the chart, or presses `Escape`, matching the
  TradingView-style "return to chart interaction" behavior.
- Added chart tests for first-candle date lookup, marker label formatting, and
  bounded Go-to zoom behavior.

### Changed - TradingView-like chart visual profile (2026-07-05)
- Added `chartVisualProfile.ts` as the shared visual contract for main chart and
  indicator pane layout, grid, crosshair, price scale, time scale, candlestick,
  right-offset, and volume overlay options.
- Tuned the chart baseline toward the TradingView reference: neutral dark
  background, fainter grid, stable right price scale width, shallower volume
  overlay, dotted current price line, compact one-line price marker, and
  lightweight indicator legend controls.
- Updated `IndicatorPane` to use the same visual profile as the main chart and
  added re-theme support.
- Added `docs/CHART_VISUAL_PROFILE.md` and
  `tests/chart/chartVisualProfile.test.ts`.

### Added - Shared draggable dialog behavior (2026-07-04)
- Added `useDraggableDialog` as the common TradingView-style drag contract for
  modal/settings dialogs. Dialogs can now be moved by dragging their
  header/title/tab strip while form controls remain editable.
- Applied the shared behavior to indicator settings, drawing object settings,
  Long/Short Position settings, indicator library, delete-script confirmation,
  chart `Go to`, save-template, alert edit, and live-order confirmation dialogs.
- Added viewport clamping so moved dialogs remain reachable after drag or
  browser resize.
- Added `docs/DRAGGABLE_DIALOG_ARCHITECTURE.md` and `npm run test:ui` coverage
  for draggable dialog positioning math.

### Fixed - Go to time navigation placement (2026-07-04)
- Anchored the chart `Go to` dialog to the bottom toolbar calendar button
  instead of the viewport's right edge, preventing it from opening over the
  watchlist/right panel.
- Cleared the Lightweight Charts crosshair after shortcut/date/range navigation
  so the old floating time label does not remain on the chart after a jump.
- Added `goToDialogPosition` coverage to `npm run test:chart`.

### Added - Chart time navigation toolbar (2026-07-04)
- Added a TradingView-style bottom time toolbar with `1D`, `5D`, `1M`, `3M`,
  `6M`, `YTD`, `1Y`, `5Y`, and `All` range shortcuts plus a local clock with
  UTC offset.
- Added a `Go to` date/range dialog with `Date` and `Custom range` modes. Date
  mode pans to the nearest loaded candle while preserving zoom; Custom range
  applies the requested visible time window.
- Added `chartTimeNavigation.ts` as the pure helper contract and
  `tests/chart/chartTimeNavigation.test.ts` under `npm run test:chart`.
- Added `docs/CHART_TIME_NAVIGATION_ARCHITECTURE.md` as the maintainer guide for
  shortcut ranges, date jumps, replay clamping, and viewport ownership.

### Fixed - Chart drag coasting too far (2026-07-04)
- Disabled mouse kinetic scrolling in the main chart so desktop drag-to-pan
  stops when the mouse is released, matching TradingView-style chart behavior.
  Touch kinetic scrolling remains enabled for mobile/tablet gestures.
- Stopped re-applying default `barSpacing` / `rightOffset` on theme/grid option
  updates; those viewport defaults are now re-applied only when timeframe
  changes.

### Changed - Line tools TradingView parity (2026-07-04)
- Updated the Lines flyout to the 9-tool TradingView reference set:
  Trendline, Ray, Info line, Extended line, Trend angle, Horizontal line,
  Horizontal ray, Vertical line, and Crossline. `Channel` remains registered for
  saved drawings but is no longer shown in that flyout.
- Added shared `lineGeometry` helpers for endpoint hit-testing, Ray/Extended
  Line extension hit-testing, Horizontal Ray start-gated hit-testing, full
  viewport bounds, and axis-constrained Horizontal/Vertical Line dragging.
- Added `tests/drawing/lineGeometry.test.ts` coverage under `npm run
  test:drawing`.

### Fixed - Shape tool behavior parity (2026-07-04)
- Added shared `shapeGeometry` helpers for shape plugins and aligned hit-testing
  across Path, Polyline, Triangle, Ellipse, Curve, Arc, and Double Curve.
- Fixed Ellipse selection using the rectangular bounding box, Triangle missing
  closed-edge/interior hits, Curve body selection, and curve-tool viewport
  bounds for Arc/Double Curve.
- Added `tests/drawing` plus `npm run test:drawing` coverage for the shared
  shape-geometry contract.

### Changed - TradingView-style combined shapes flyout (2026-07-04)
- Merged Brush, Highlighter, Arrows, and Shapes into one geometry flyout with
  `BRUSHES`, `ARROWS`, and `SHAPES` sections, matching TradingView's drawing
  toolbar structure.
- Added viewport-aware scrolling for long drawing-tool flyouts.

### Added - Brush and arrow drawing tools (2026-07-04)
- Added TradingView-style Brush flyout coverage for `Highlighter`, `Arrow
  marker`, `Arrow`, and Arrow Mark Up/Down/Left/Right.
- Added shared arrow drawing plugins so the new toolbar entries render, hit-test,
  move, select, and persist through the common drawing engine.

### Fixed - Drawing settings viewport fit (2026-07-04)
- Fixed Fib retracement settings overflowing the viewport by making object
  settings dialogs use viewport-aware max height, responsive width, and a
  shrinkable scroll body so the footer stays visible.

### Added - Responsive architecture research and plan (2026-07-04)
- Added `docs/RESPONSIVE_ARCHITECTURE.md` with TradingView/Binance/tablet UI
  research notes, breakpoint policy, shared viewport state plan, component
  migration phases, and responsive test matrix.

### Changed - Settings popup color sync (2026-07-04)
- Synced drawing, Long/Short position, and indicator settings popups to the Text
  settings palette: dark neutral background, neutral borders, white active tab
  underline, and white `Ok`/outlined `Cancel` footer buttons.
- Rectangle, line, shape, fib, position, indicator, and text setting surfaces now
  share one visual color system instead of mixing terminal-blue and Text-popup
  themes.

### Changed - Text tool settings and selection parity (2026-07-04)
- Standalone Text drawing settings now use the TradingView-style `Text` and
  `Visibility` tabs with the same header/footer shell as the other drawing
  settings popups.
- The Text tab now owns color, font size, bold, italic, text content,
  background, border, and text-wrap controls.
- Selected Text drawings now render a blue bounding box around the text content
  instead of only selecting the invisible anchor point.

### Added - Bottom panel collapse control (2026-07-04)
- Added a TradingView-style collapse button on the bottom-panel divider and a
  small restore button when the panel is hidden, so the chart can reclaim the
  full workspace height.
- Double-clicking the bottom-panel divider also collapses the panel.

### Added - Position drawing to Trade ticket prefill (2026-07-04)
- Placing a new Long/Short Position now opens the bottom `Trade` tab and fills
  the order ticket with entry, stop loss, take profit, risk percent, planned
  side, and inferred limit/stop order type.
- Added `positionTradePrefill.ts` as the shared conversion contract between
  position drawings and order-ticket payloads so future position workflows do
  not duplicate side/target/stop logic in UI components.
- Replaced transient chart-menu prefill events with a versioned
  `orderPrefillAtom`, so prefill still works when the Trade panel was not
  mounted before the action.
- Prefill payloads are now scoped by source `drawingId`; selecting, dragging,
  or editing one Long/Short Position updates the ticket for that position
  without arbitrary overwrites from other Long/Short drawings on the chart.
- Expanded `npm run test:position` coverage for Long/Short prefill payloads.

### Changed - Long/Short position TradingView parity pass (2026-07-04)
- Added `positionGeometry.ts` as the shared contract for Long/Short Position movement, six virtual
  handles, tick snapping, and long/short side clamping.
- The selected position tool now exposes six interactive handles, matching the six handles it
  renders: target/entry/stop on both left and right edges.
- Body drag now uses the same shared geometry helper and preserves box width while snapping prices
  to the active symbol tick.
- Position labels now better match TradingView's risk/reward projection labels: target/stop show
  distance, percent, ticks, and projected account amount; entry shows Open P&L, Qty, and R/R.
- New positions now default to a symmetric 1:1 risk/reward box and enable percent, ticks, amount,
  and risk/reward stats by default.
- Added `docs/POSITION_TOOL_ARCHITECTURE.md` and expanded `npm run test:position` coverage for
  six-handle movement and side clamping.

### Fixed - Long/Short position numeric input editing (2026-07-03)
- Fixed `Ticks`, `Price`, and `Entry price` fields jumping while typing in the Long/Short Position
  settings dialog.
- Position level fields now allow draft text and commit on blur/Enter, so partial values are not
  mirrored around entry or snapped to tick before the user finishes typing.
- Added `positionInput.ts` and typed tests to ensure empty/incomplete numeric drafts are not
  committed as zero.

### Fixed - Long/Short position tick and price settings parity (2026-07-03)
- Replaced Long/Short Position tick calculations with shared `positionMetrics.ts` helpers that use
  the active symbol's `tickSize` instead of inferring ticks from price magnitude.
- `PositionSettingsDialog` now keeps `Ticks`, `Price`, and `Entry price` synchronized with
  TradingView-style tick snapping for both long and short positions.
- `PositionTool` now uses the same helpers for label prices and tick-count stats.
- BTCUSDT tick metadata now matches the app's displayed perpetual-contract behavior (`tickSize:
  0.1`).
- Added typed tests in `tests/position/` and `npm run test:position`.

### Fixed - Drawing viewport repaint on chart zoom (2026-07-03)
- Fixed drawings visually lagging behind candles during wheel zoom until a later repaint.
- `CanvasRenderer` now keeps a short forced repaint window after viewport changes so drawing
  projections follow Lightweight Charts while wheel zoom/autoscale settles across frames.
- Added a shared `chartViewportEvents` helper so `PriceChart` and `DrawingLayer` invalidate overlays
  from the same TradingView-style interaction set: visible logical range, time-scale size, wheel
  zoom, pinch/touch, active axis/pan pointer drags, and double-click scale reset.
- Added `npm run check:drawing-viewport` to guard the repaint contract.
- Added `docs/ZOOM_VIEWPORT_SYNC_ARCHITECTURE.md` as the maintainer guide for chart zoom/pan,
  projection invalidation, drawing repaint, and replay viewport replacement.

### Fixed - Replay jump viewport reset (2026-07-03)
- Fixed Bar Replay date/random/scrubber jumps leaving the chart pointed at empty future whitespace
  after the replay-visible candle slice was replaced.
- `PriceChart` now preserves the current zoom width but moves the logical right edge to the newest
  candle of the replacement data window. One-by-one playback still uses the incremental append path
  and keeps the user's pan/zoom intact.
- Hardened `indexNearestByTime()` so dates before the loaded history clamp to the first candle and
  dates after loaded history clamp to the last candle, while `indexAtOrBefore()` keeps `-1`
  semantics for no-look-ahead MTF snapshots.
- Extended `npm run check:replay-logic` to guard replay date clamping and viewport realignment.
- Added `docs/REPLAY_ARCHITECTURE.md` with the replay state machine, visibility gate, viewport
  contract, no-look-ahead rules, and maintenance checklist.

### Changed - Shared Pine input settings runtime (2026-07-03)
- Replaced the built-in-only indicator settings modal with a shared TradingView-style
  `Inputs / Style / Visibility` dialog for every active indicator.
- CUSTOM indicator settings are now generated from the script's `input.*()` declarations via
  `extractPineInputDefinitions()`. The settings key is the assigned Pine variable name, so each
  active indicator instance can keep its own values without hardcoding VSA, ADR, RSI, or future
  scripts.
- `IndicatorConfig.inputValues` stores per-instance Pine input overrides. `compilePineScript()`
  passes those values through `EvalContext.inputOverrides`, including nested contexts such as
  `request.security`, helper functions, and self-referential series evaluation, then re-executes the
  script with the updated values.
- The indicator legend settings gear now opens the shared settings dialog for CUSTOM indicators.
  The `{}` legend action remains the source-code route into the bottom Pine Editor.
- Pine legend title parameters now come from the parsed input schema plus current overrides instead
  of a regex over raw source.
- Added `docs/SETTTING_ARCHITECTURE.md` as the source-of-truth guide for maintaining common
  settings without per-indicator hardcoding.
- Added common Style-tab schema/runtime support. CUSTOM scripts now extract style rows from
  `plot`, `hline`, `fill`, `line.new`, `box.new`, and `label.new`, persist per-instance
  `styleValues`, and apply visibility/color/line-width/line-style overrides during Pine compile.
- Built-ins now consume the same `styleValues` model through `builtin:primary` and
  `builtin:secondary` keys, so exposed built-in style controls are backed by render logic.
- Added TradingView-style common Style sections for `Output Values` and `Input Values`: precision,
  labels on price scale, values in status line, and inputs in status line.

### Changed - Common Pine object runtime (2026-07-03)
- Added a shared TradingView-style indicator legend for chart overlays and indicator panes with
  show/hide, settings, source-code, and remove controls. Remove deletes the indicator instance
  from the chart without a confirmation dialog.
- Replaced the ADR-specific object adapter with a shared Pine runtime subset for object-style
  scripts using `request.security`, `line.new`, `box.new`, `label.new`, and `table.cell`.
- The runtime now evaluates Pine inputs, one-line custom functions, `time("D")`, `str.*`,
  `color.new`, `ta.crossover/crossunder`, and daily `request.security` values before emitting
  overlay lines, zones, labels, and dashboards.
- Expanded the runtime research pass to cover generic higher-timeframe aggregation for
  `request.security`/`timeframe.change`, broader `barstate.*` identifiers, multi-argument
  one-line helper functions, compound assignments, and object drawing coordinates using
  `x1/y1/x2/y2`, `xloc`, and `extend`.
- Fixed object overlay label placement so `label.style_label_left` labels on the active segment
  follow the right edge of the emitted object line and use a readable fallback background when the
  Pine label background is fully transparent.
- Fixed ADR labels from off-screen historical levels stacking at the left edge by clipping labels
  whose line endpoint is outside the visible chart area.

### Changed - TradingView-style indicator browser (2026-07-03)
- Replaced the compact toolbar indicator dropdown with a TradingView-style modal titled
  `Indicators, metrics, and strategies`, including search, Favorites, My scripts, built-ins,
  author/boost columns, favorite stars, active checkmarks, and settings routing.
- Updated the toolbar trigger to use a chart-combined icon next to `Indicators`.
- Aligned the `My scripts` tab with TradingView: a `SCRIPT NAME` list with favorite star,
  source-code `{}` action, trash action, and a destructive delete confirmation dialog.

### Fixed - Pine Better RSI v3 rendering (2026-07-03)
- Added Pine v3 compatibility needed by `Better RSI`: bare `integer`/`source` inputs, legacy
  functions such as `rsi(...)` and `color(base, transp)`, `hline(...)`, `fill(...)`, and
  indentation-based `if ... else` expressions with self-referential history like `cycler[1]`.
- Custom indicator panes now render horizontal lines, dashed/solid line styles, background fill
  bands, line widths, and per-bar line colors, so RSI, overbought/oversold segments, and the
  cycler line display closer to TradingView.
- Fixed a separate-pane performance regression by reusing Lightweight Charts series between candle
  updates and emitting hline/fill bands as two-point series instead of full-history data.
- Extended Pine hline/fill bands into the chart's right-offset whitespace so Better RSI horizontal
  levels and purple fill continue across the pane like TradingView.
- Fixed a compiler performance regression for self-referential Pine assignments such as
  `cycler[1]` by evaluating them point-by-point instead of rebuilding full series for each bar.
- Fixed Pine call-argument parsing so comparison operators such as `>=` and `<=` inside `plot()`
  expressions are not mistaken for named arguments.

### Fixed - Pine VSA/Wyckoff volume histogram rendering (2026-07-03)
- Fixed Pine source indicators such as `VSA Wyckoff Volume` rendering as a single blue line.
- `IndicatorResult` now supports `type: "histogram"` and per-point `color`, and both
  `IndicatorPane` and `PriceChart` render histogram series with per-bar colors.
- Fixed separate-pane histogram color fallback precedence so Pine per-bar colors are preserved
  instead of being coerced to the pane's bullish fallback color.
- Fixed Pine v4 named call argument handling so `input(defval=20, type=input.integer)` uses the
  `defval` value instead of depending on positional parsing.
- Aligned Pine color constants used by VSA palettes (`color.purple`, `color.red`, `color.orange`,
  `color.green`, `color.blue`, `color.silver`) with TradingView-style colors.
- The Pine compiler now supports the subset needed by the VSA script: typed declarations
  (`float volumeMA = 0`), recursive Wilder-style assignments using `[1]`, comparisons,
  logical `and`/`or`, ternary palettes, Pine enum identifiers such as `input.integer`, and
  `plot(..., style=plot.style_columns)`.
- Guard: extended `npm run check:pine-indicator` to cover VSA-style columns, ternary palettes,
  comparisons/history, and histogram render support.

### Added - Pine Script editor + CUSTOM source-code indicators (2026-07-03)
- New **Pine Editor** bottom-panel tab (`src/components/pine/PineEditor.tsx`): TradingView-style
  layout with a "My scripts" sidebar (search, favorite star, Add/Edit/Delete per script), script
  name field, line-numbered code editor, and New / Run ("Save and add to chart") / Save actions.
  Opening the tab auto-expands the bottom panel to at least 320px.
- New mini Pine interpreter `src/services/pineScript.ts`: parses `indicator()/study()` metadata
  (title, `overlay=`), top-level variable assignments (`=`/`:=`), arithmetic expressions with
  precedence/unary minus/parentheses, source series (`open/high/low/close/volume/hl2/hlc3/ohlc4`),
  and functions `ta.sma/ema/rma/rsi/vwap/highest/lowest/change/atr`, `math.abs/max/min`, `nz`,
  `input.*` passthrough. Each `plot()` becomes one line series with title + color
  (`color.*` names, hex literals, `color.new()`). Compile errors are reported per line/plot and
  block adding the script to the chart.
- New indicator type `CUSTOM` (`IndicatorType = BuiltInIndicatorType | 'CUSTOM'`) carrying
  `name`/`scriptId`/`sourceCode`; `computeIndicator()` routes it through
  `computeCustomIndicator()`. `overlay=true` scripts render on the price chart, `overlay=false`
  in a separate `IndicatorPane` — both reuse the existing multi-series render paths unchanged.
- Scripts persist under the `pineScripts` localStorage key (`CustomIndicatorScript` type) with
  new chartStore atoms: `pineScriptsAtom`, editor atoms, `savePineScriptAtom`,
  `addCustomIndicatorFromScriptAtom`, `addCustomIndicatorFromSourceAtom`, `loadPineScriptAtom`,
  `deletePineScriptAtom`, `togglePineFavoriteAtom`, `newPineScriptAtom`. Saving a script also
  syncs name/source/pane into any chart indicators using it.
- `IndicatorMenu` gained an "Open Pine Editor" entry. CUSTOM indicator source opens through the
  `{}` action, while the settings gear is reserved for the shared input settings dialog.
  `addIndicatorAtom`/`toggleIndicatorAtom` are typed to `BuiltInIndicatorType`.
- Naming: the untouched default editor title ("Untitled script") is treated as a placeholder, so
  a new script takes its name from the source's `indicator("…")` title until the user names it
  explicitly.
- Files: `src/components/pine/PineEditor.tsx` (new), `src/services/pineScript.ts` (new),
  `src/components/layout/BottomPanel.tsx`, `src/components/toolbar/IndicatorMenu.tsx`,
  `src/components/toolbar/IndicatorSettingsDialog.tsx`, `src/components/chart/IndicatorPane.tsx`,
  `src/services/indicators.ts`, `src/store/chartStore.ts`, `src/store/uiStore.ts`,
  `src/types/indicators.ts`, `scripts/check-pine-indicator.mjs`, and
  `docs/INDICATOR_ARCHITECTURE.md`.
- Guard: added `npm run check:pine-indicator` to lock the no-popup bottom-panel contract,
  `pineScripts` persistence, CUSTOM compiler routing, whitelist safety, and source-code routing
  back to the Pine Editor.
- type-check pass, lint pass, build pass, and `npm run check:pine-indicator` pass. End-to-end
  browser verification remains a manual follow-up for this source-code indicator flow.

### Fixed - Path/freeform drawing TradingView parity (2026-07-03)
- Aligned the click-to-add `path` flow with TradingView-style multi-point drawing semantics:
  double-click, right-click, and `Esc` finish an open drawing when enough points exist.
- Fixed multi-point vertex dragging for `path`, `polyline`, and `curve` by carrying explicit
  `anchorIndex` values through hit-testing. This prevents the last point of an N-point path from
  resolving to the second point and lets middle vertices drag as real handles instead of moving the
  whole body.
- Added `npm run check:path-tool` to guard the open path/terminal arrowhead contract, freeform
  `Esc` finish behavior, and explicit vertex-index hit-test flow.

### Changed - Fibonacci tools TradingView parity pass (2026-07-03)
- Expanded the shared Fibonacci preset beyond `0..1` so retracement includes common external
  levels (`1.272`, `1.414`, `1.618`, `2`, `2.618`, `3.618`, `4.236`).
- Added the TradingView-style Fib settings surface to `ObjectSettingsDialog`: Style,
  Coordinates, and Visibility tabs; trend/level line controls; 24 per-level enable/value/color
  rows; extend/background/reverse/prices/levels/labels/text/font/log-scale controls; and
  `#1/#2 (price, bar)` coordinate rows.
- Reworked `FibRetracementTool` to render the source trend line, horizontal level lines,
  subtle background bands, level+price labels, and hit-test each level instead of only the broad
  anchor box.
- Fixed Fib labels overflowing into the chart's right edge/price-scale area by measuring label
  text and clamping it inside the viewport, following the same principle used for the Info Line
  panel overflow fix. Default retracement label placement is now `Left / Middle`, matching the
  TradingView settings reference.
- Follow-up: Fib retracement, legacy fib, and trend-based fib extension now reserve and clip away
  from the right price-scale/current-price label strip, so level lines/background bands cannot draw
  underneath the price axis.
- Follow-up: Fib level labels now match TradingView's left-label layout more closely: default
  labels render outside the left edge of the fib body, use `level (price)` formatting, and keep the
  source trend line on the TradingView-style gray dashed default instead of the drawing accent blue.
- Reworked `FibExtensionTool` into a three-click trend-based extension: A-B is the impulse, C is
  the projection origin, and level price is `C + ratio * (B - A)`. Existing two-point extension
  drawings still render by treating B as C.
- Updated legacy `fib` to mirror modern retracement rendering for saved drawings and old toolbar
  paths.
- Double-clicking a drawing now opens its settings dialog, so fib objects can be edited from the
  chart like TradingView.
- Added `docs/FIBONACCI_TOOLS_MAINTENANCE.md` and `npm run check:fibonacci-tools`.

### Fixed - SMC overlay live visibility and chart readability (2026-07-02)
- Fixed the SMC canvas stacking order so overlays that appear in screenshots are also visible on
  the live chart.
- Added UI-level caps for structure, swings, FVGs, order blocks, liquidity, displacement, sessions,
  and kill zones so enabling every SMC toggle does not flood the chart with historical zones.
- SMC render now prioritizes active/fresh objects, nearby untaken liquidity, and only a few recent
  mitigated/swept objects.
- Cleaned SMC menu checkmarks with a `lucide-react` `Check` icon and replaced fragile canvas glyph
  markers with ASCII labels.
- Added `docs/SMC_OVERLAY_MAINTENANCE.md` and `npm run check:smc-overlay`.

### Fixed - Brush tool continuous freehand drawing (2026-07-02)
- `brush` now uses a TradingView-style pointer-drag flow: press, draw continuously, release to
  commit the full stroke. It no longer behaves like a two-click trendline.
- Added a generic `continuous` tool adapter flag so this behavior is opt-in and does not affect
  trendline, polyline/path click-to-add tools, or single-click tools.
- Selected brush strokes now show endpoint handles, and the brush bounding box includes hit padding
  so thin freehand strokes are not culled too aggressively.
- Added `npm run check:brush-freehand` to guard the continuous pointer-drag contract.

### Changed - Vertical line TradingView date label parity (2026-07-02)
- Replaced the selected vertical line's old center handle with a TradingView-style blue date/time
  chip pinned to the bottom time axis.
- The label format now matches the TradingView reference shape (`Thu 02 Jul 26 19:30`), uses UTC
  chart time, and clamps inside the chart viewport near the left/right edges.
- Added `npm run check:vertical-line` to guard against reintroducing the old center handle or
  removing the date-label path.

### Changed - Info Line measurement panel matches TradingView (2026-07-02)
- Replaced the old one-line blue `InfoLineTool` chip with a TradingView-style dark measurement panel.
- The panel now shows three rows: price change / percent / tick span, bar count + elapsed time +
  pixel distance, and line angle.
- Bar count is derived from the active chart timeframe, while pixel distance and angle are computed
  from the projected canvas geometry.
- The panel now measures its row text, grows within the chart viewport, and ellipsizes only when the
  viewport is too narrow, preventing right-to-left drags from overflowing the panel background.
- Follow-up: the panel now reserves and clips away from the right price-scale/current-price label
  strip, and when the measured segment is near the right edge it prefers opening to the left of the
  segment instead of covering the price axis.
- Added `npm run check:infoline-panel` to prevent the old generic chip from returning.

### Fixed - Trendline text parity with TradingView (2026-07-02)
- Plain `trendline` no longer renders the measurement chip with price change, percent change, and
  angle. Those measurements belong to `infoLine` / `trendAngle`, not the normal Trend Line tool.
- Selected empty trendlines now render a TradingView-style `+ Add text` placeholder along the line;
  clicking it opens the inline text editor and saves text onto the same drawing so it moves and
  rotates with the line.
- Added `npm run check:trendline-text` to guard against reintroducing trendline measurement chips
  or removing the attached-text editor path.

### Fixed - Replay floating toolbar controls receive clicks (2026-07-02)
- Marked the floating replay toolbar and shared dropdown as `data-chart-ui`, so capture-level chart
  drawing/replay handlers no longer treat toolbar clicks as chart clicks before the button action
  can run.
- Removed `overflow-hidden` from the floating replay toolbar container; the compact `Select bar`
  timing dropdown was opening below the toolbar but being clipped, making it look like the button did
  nothing.
- Added `npm run check:replay-toolbar-events` to guard the toolbar/dropdown event contract.

### Changed - Save drawing template uses TradingView-style dialog (2026-07-02)
- Replaced the native browser `window.prompt("Save drawing template as:")` in both the floating
  drawing toolbar and object settings footer with an in-app dark modal matching TradingView's
  `Save drawing template` flow.
- The dialog has `New template name`, focused input, Cancel/Save actions, disabled Save for empty
  names, and a dropdown of existing template names; selecting an existing name overwrites that
  same name within the current style family through the existing `saveTemplateAtom` replace logic.
- Added `npm run check:template-save-dialog` to prevent the native prompt from returning.

### Fixed - Shape add-text editor stays bound to drawing interaction (2026-07-02)
- `TextEditor` is now marked as chart UI and commits/cancels on outside `pointerdown`, so clicking
  `+ Add text` inside a Rectangle/Circle/etc. then dragging the shape no longer leaves the input
  floating at the old location.
- `DrawingLayer` now owns the shape-text edit lifecycle: the first chart `pointerdown` outside the
  inline input commits the text and consumes that event before the drawing drag manager can move the
  rectangle. The editor position is derived from the current shape bounding box instead of a stale
  click-time `x/y` snapshot.
- Added a completion guard so the outside `pointerdown` and native `blur` path cannot double-save
  the same edit.
- Added `npm run check:shape-text-editor` to lock the overlay/drawing-interaction contract.

### Fixed - Replay engine TradingView date/total semantics (2026-07-02)
- `Select date...` and dashboard date jump now choose the candle closest to the requested timestamp,
  matching TradingView's Bar Replay behavior instead of always snapping to the bar at or before the
  timestamp.
- Replay chart-click selection now uses the same nearest-candle helper as date selection, while
  multi-timeframe replay snapshots intentionally keep at-or-before semantics to avoid higher-TF
  lookahead.
- `setTotalAtom` now sanitizes total history length and clamps `anchor`/`cursor` when history
  shrinks; empty history fully disarms replay and resets cursor state.
- Added `npm run check:replay-logic` to guard closest-date selection, MTF no-lookahead behavior, and
  replay total clamping.

### Changed - Replay mode TradingView timing controls (2026-07-02)
- Added a TradingView-style floating Bar Replay toolbar over the chart with replay timing menu,
  play/pause, forward-one-bar, speed slider, latest-bar jump, and exit controls.
- Replaced the old `Quick start (70%)` path with a shared Replay timing menu supporting
  `Select bar`, `Select date...`, `Random bar`, and first-available-day selection.
- Aligned replay speeds to TradingView's visible timing scale: `0.1x`, `0.3x`, `0.5x`, `1x`,
  `3x`, and `10x`; default speed is now `1x`.
- Added TradingView hotkeys `Shift+Down` for play/pause and `Shift+Right` for forward one bar.
  Existing Space and arrow controls remain available.
- Fixed replay date parsing so both `YYYY-MM-DD HH:mm` and `YYYY-MM-DDTHH:mm` inputs work.

### Fixed - Reset chart view TradingView parity (2026-07-02)
- Changed the toolbar `Reset chart view` action to use the same `resetChartView()` flow as the
  chart context menu instead of `timeScale().fitContent()`. Reset now returns to the realtime edge,
  restores the active timeframe's default bar spacing/right offset, and re-enables right price-scale
  autoscale.
- `PriceChart` now publishes the current timeframe viewport defaults to `chartRegistry`, so reset
  view remains consistent after timeframe changes rather than using a stale zoom baseline.

### Changed - Long/Short position settings dialog parity (2026-07-02)
- Reworked the Long/Short position settings dialog shell to more closely match TradingView:
  compact 380px dark panel, larger title, tab underline, scrollable content, and footer controls
  with `Template`, `Cancel`, and `Ok`.
- Removed the custom computed summary card from the Inputs tab so the dialog follows the
  TradingView layout: account size, lot size, risk, entry, leverage, profit level, stop level, and
  QTY precision.
- Double-clicking an existing Long/Short position on the chart now opens the same settings dialog.
  Single-click selection, body drag, handle resize, and the recent TP/SL hit-state drag fixes stay
  on the existing interaction path.

### Fixed - Short/Long position body drag preserves visible width (2026-07-02)
- Fixed a regression where dragging a hit-frozen Long/Short position body could make the box
  widen while moving right or left. TP/SL hit state now changes labels/fill only; it no longer
  extends the drawing's right edge to the hit candle.
- Added `npm run check:position-drag`, a focused regression check that rejects hit-freeze geometry
  patterns and simulates repeated body drags to the right and left while asserting width stays
  constant.

### Fixed - Position hit status survives hard refresh with partial history (2026-07-02)
- Added `resolvePositionHit()` so persisted TP/SL status is preserved when the candle window loaded
  after F5 does not cover the drawing's entry time. This prevents an earlier SL from being
  overwritten by a later visible TP when the chart initially reloads with incomplete history.
- `DrawingLayer` now only clears a persisted hit when the loaded candle data covers the entry time
  and the resolver confirms the position no longer hits anything.
- Added `npm run check:position-hit` to simulate the F5 partial-history case and assert persisted
  SL remains SL even when later visible candles touch TP.

### Fixed - Long/Short position hit-state selection parity (2026-07-02)
- Updated `PositionTool.ts` so selected position labels and the user-defined box are included in
  `hitTest()` and `boundingBox()` without extending the drawing geometry to TP/SL hit candles.
- Position label chips are included in the body hit zone, so clicking `Stop:`, `Target:`, or
  `Entry:` selects the drawing instead of falling through to the chart.
- Position labels now use TradingView-style `Entry:`, `Target:`, and `Stop:` prefixes, and target/
  stop percentages are rendered as absolute distances so short-position target stats do not show as
  negative profit.
- Selected long/short positions now render TradingView-like blue square handles around the position
  box. Dragging still edits the existing three anchors: entry price, target/right edge, and
  stop/right edge.

### Fixed - Chart realtime motion and zoom parity (2026-07-02)
- Tuned `PriceChart.tsx` interaction options toward TradingView behavior: enabled mouse/touch
  kinetic panning, kept the hovered bar stable during wheel zoom/scroll, and preserved live-edge
  shifting when a new realtime bar is appended.
- Added explicit right-offset and minimum-bar-spacing constants so chart creation and theme/
  timeframe option re-application use the same values.
- Kept the existing O(1) `series.update()` realtime path for forming/appended candles; no
  unsupported candlestick animation option is used.

### Fixed - Current price marker uses tick direction (2026-07-02)
- Reworked `PriceChart.tsx` current-price marker to render a TradingView-style DOM marker at
  `candleSeries.priceToCoordinate(price)`.
- Hid the native Lightweight Charts black current-price chip with `lastValueVisible: false`.
- Marker now shows symbol + price + countdown in one bull/bear marker instead of relying on native
  axis labels.
- Marker color compares current price to previous marker price. It no longer uses
  `lastQuote.change`, which is aggregate session/24h change and can show green during a falling
  latest tick.

### Added - Python FTMO MT5 service adapter (2026-07-02)
- Added `bridge/ftmo_mt5/`, a standalone Python WebSocket bridge service for FTMO MT5 copy trading.
  It uses the same Phase 6B protocol as the web app and the Node dry-run bridge, so the frontend can
  connect to either service via `NEXT_PUBLIC_MT5_BRIDGE_URL`.
- Added a real MT5 adapter path using the official `MetaTrader5` Python package:
  terminal initialize/login, account/position/order/symbol snapshots, `order_check` before
  `order_send`, SL/TP modify, single-position close, close-all, and pending cancel.
- Live mode is gated by both `FTMO_BRIDGE_DRY_RUN=false` and `FTMO_BRIDGE_ALLOW_LIVE=true`; dry-run
  remains the default. FTMO credentials stay bridge-only.
- Added `bridge/ftmo_mt5/requirements.txt`, `bridge/ftmo_mt5/README.md`, and `npm run
  ftmo-mt5-python`.

### Added - FTMO MT5 dry-run copy trading bridge (2026-07-02)
- Added `scripts/ftmo-mt5-bridge.mjs`, a standalone FTMO-focused bridge process that speaks the
  Phase 6B MT5 WebSocket protocol and is started with `npm run ftmo-mt5-bridge`.
- The bridge is disabled and dry-run by default. When enabled, it streams FTMO readiness/risk
  snapshots, account/position/order/symbol snapshots, validates order volume, stop loss,
  per-trade risk, daily/max loss guard, daily order count, and message rate limits, then emits
  dry-run `order.ack`, `execution.report`, and position/account updates.
- Added append-only audit JSONL support at `.data/ftmo-mt5-audit.jsonl` by default; `.data/` is
  gitignored so runtime audit evidence and secrets-adjacent operational data are not committed.
- Live FTMO execution is intentionally blocked with `LIVE_ADAPTER_NOT_CONFIGURED` until a real MT5
  adapter is implemented and demo-validated.
- Updated `.env.example` with bridge-only FTMO variables and expanded
  `docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md` with implementation status, dry-run quickstart, and
  milestone checkboxes.

### Added - Multi-broker MT5 copy trading plan (2026-07-02)
- Added `docs/PHASE6B_MULTI_BROKER_MT5_COPY_TRADING_PLAN.md`, a broker-agnostic plan for copying
  web terminal orders to MT5 accounts at brokers such as Exness, IC Markets, Pepperstone, or other
  MT5-compatible brokers.
- The plan covers broker/account profiles, bridge-only secrets, account routing, symbol discovery,
  broker-specific lot sizing, execution differences, dry-run validation, audit logging, QA matrix,
  rollback, and live-mode hardening.

### Added - FTMO MT5 copy trading plan (2026-07-02)
- Added `docs/PHASE6B_FTMO_COPY_TRADING_PLAN.md`, a bridge-side plan for copying live web terminal
  orders into an FTMO MT5 account without exposing FTMO credentials to the browser.
- The plan covers FTMO readiness checks, bridge-only secrets, symbol/lot mapping, dry-run and demo
  validation, loss/risk guards, audit logging, failure handling, rollback, and acceptance criteria.

### Added - Phase 6B MT5 bridge implementation scaffold (2026-07-02)
- Added feature-flagged MT5 bridge runtime behind `NEXT_PUBLIC_MT5_BRIDGE_ENABLED=false` by default:
  typed MT5 protocol models, WebSocket client, runtime hook, Jotai `mt5Store`, command logging,
  heartbeat/stale state, reconnect handling, and client-side order validation.
- Added `npm run mock-mt5`, a dependency-free local mock WebSocket bridge for auth/account/symbol
  snapshots, order ack/reject, execution reports, position updates, close, close-all, and reconnect
  testing.
- Added Trade Panel MT5 UI: Simulator/MT5 execution switch, connection/account status, compact
  MT5 command log, live-order confirmation dialog, MT5 positions table, and MT5 chart entry/SL/TP
  price levels. Simulator mode remains the default and still uses the existing `tradeStore`.
- Order Ticket now routes orders through simulator or MT5 based on explicit execution mode. Chart
  context menu quick orders remain simulator-only unless MT5 mode is active, where they prefill the
  ticket instead of sending a live command automatically.

### Added - Phase 6B MT5 bridge protocol contract (2026-07-02)
- Added `docs/MT5_BRIDGE_PROTOCOL.md`, the browser-to-bridge JSON/WebSocket contract for Phase 6B
  live execution: envelope, auth, heartbeat, snapshots, order commands, execution reports, error
  codes, client risk gates, mock bridge requirements, and rollback behavior.
- Updated Phase 6B planning/status docs to point implementation at the protocol first, then the
  MT5 bridge client/store/mock bridge milestones.

### Changed - Watchlist rebuilt as a 1:1 TradingView clone (2026-07-02)
- **Layout/1:1 parity:** panel header is now "Watchlist ⌄" (list menu stub) + `+` add-symbol /
  grid (visual, disabled) / `⋯` sort menu, matching TradingView's panel header; column header row
  is `Symbol | Last | Chg | Chg%` and every column is click-to-sort with an ▲/▼ indicator (new
  `changeAbs` `SortKey` for the absolute-change column). Rows are 30px with circular symbol logos:
  overlapping country-flag pairs for FX (base in front, quote behind), metal icon + quote flag for
  XAU/XAG, coin logos for crypto, index logos for SPX500/NAS100 — served from TradingView's public
  logo CDN (`s3-symbol-logo.tradingview.com`) with a lettered-circle fallback on load error (new
  `SymbolLogo.tsx`). FX/metal prices render the last (fractional-pip) digit as a raised superscript
  (`1.1379⁴`), negatives use a true minus sign (−), and Chg/Chg% drop the leading "+", all like
  TradingView. The active chart symbol row gets TradingView's rounded outline instead of the old
  blue left border. Numbers now use tabular-nums in the UI sans font (new `.tnum`) instead of the
  mono font. The exchange sub-line was removed (TV shows the symbol only).
- **Tick animation fixed to match TradingView:** the old animation flashed the whole row with a
  translucent tint; TradingView flashes only the **Last cell** with a solid bull/bear block +
  white text that fades out. New `wl-flash-up/down` keyframes (replacing `animate-watch-flash-*`),
  and the flash now re-triggers correctly on consecutive same-direction ticks (the flashing span is
  keyed by a tick sequence number so the CSS animation restarts; the old timeout-based approach
  couldn't restart on same-direction ticks).
- **Both themes:** everything is token-driven so dark/light work; dark-theme `--bull`/`--bear`
  updated from the legacy `#26a69a`/`#ef5350` to TradingView's current `#089981`/`#f23645` (same
  pair as light), and `chartTheme.ts` candles/volume now use that palette in both themes so the
  chart matches the watchlist.
- Files: `src/components/watchlist/Watchlist.tsx` (rewritten),
  `src/components/watchlist/SymbolLogo.tsx` (new), `src/store/watchlistStore.ts` (`changeAbs`),
  `src/app/globals.css` (tokens + flash keyframes + `.tnum`),
  `src/components/chart/chartTheme.ts`.
- Verified via Playwright screenshots against a fresh `next dev` in both themes; type-check ✅
  lint ✅ build ✅.

### Added - "+ Add text" for fillable shapes (2026-07-02)
- Selecting a Rectangle/RotatedRect/Circle/Ellipse/Triangle now shows a TradingView-style
  "+ Add text" affordance centered inside it; click opens the same inline editor the Text tool uses
  and patches the shape's `text` in place. `Circle`/`Ellipse` render `d.text` for the first time
  (only `Rectangle` did before); `Circle`/`Ellipse` also now render their `fillColor` (silently
  missing despite already being settable from the toolbar). New `renderShapeText()` shared helper
  in `plugins/shared.ts`.

### Fixed - every new/duplicated/pasted drawing was inserted twice (2026-07-02)
- `addDrawingWithHistory` (and the Text tool's save handler) called `addDrawing(d)` directly *and*
  ran a `CreateDrawingCommand` for the same `d` — `CommandManager.execute()` already calls
  `addDrawing` internally, so every created drawing was inserted twice under the identical id.
- Ctrl+D and Ctrl+V had the same bug one level up: calling both the `duplicateDrawing` store action
  and `DuplicateDrawingCommand` created two independent copies with two different ids.
- A third, separate cause of the same Ctrl+D symptom: `useHotkeys.ts` and
  `DrawingInteractionManager.ts` are two independent `window.keydown` listeners that both handled
  Delete/Ctrl+A/Ctrl+D — removed the redundant (and non-undo-tracked) versions from `useHotkeys.ts`.
  This also fixes single-selection Delete not being undoable (the non-undo-tracked listener usually
  won the race and removed the drawing before the undo-tracked one saw it).
- Verified via a scripted Playwright repro: create → 1 entry; Ctrl+D → 2; Ctrl+D + Ctrl+V → 3.

### Fixed - hitTest() bounding-box pre-filter (2026-07-02)
- `HitTestEngine.hitTest()` ran every drawing's full per-tool `hitTest()` on every cursor-mode
  pointerdown/hover, even ones nowhere near the click. Added a cheap `adapter.boundingBox()`
  pre-filter (padded by `HANDLE_RADIUS` for safety, since adapters pad their own boxes
  inconsistently) that skips the full test when it can't possibly hit. Purely additive; verified
  via Playwright that miss/hit selection, body drag, and endpoint drag are unaffected.

### Added - Server→client push-trigger reconciliation (2026-07-02)
- A real server-confirmed closed-browser trigger could stay invisible to the client (alert still
  "Active", line still on chart) when the crossing happened inside a chart-timeframe candle that
  started before the alert was armed — the client's own candle-bounded rescan has no way to see a
  sub-candle post-arm crossing, unlike the server's 1-minute-resolution evaluation.
- Server now persists the real `triggerPrice` per alert; new `POST /api/push/alerts/status` returns
  confirmed triggers for a device token (signature-guarded against stale/edited alerts); new
  `usePushTriggerReconcile` hook polls it (mount / tab-visible / 60s) and applies confirmed triggers
  via the existing `triggerAlertAtom`, without re-sending notifications.
- Extracted the shared external-sync-token logic into `useExternalSyncToken.ts`.

### Fixed - Alert falsely triggered from a full-history rescan (2026-07-02)
- `observedSinceArm()` (`src/hooks/useAlertEngine.ts`) re-derived its rescan cutoff from the
  previous tick's candle time; if that was ever `undefined` (candle history not loaded yet, e.g.
  right after creating a fresh alert), the cutoff collapsed to epoch 0 and every later tick rescanned
  the *entire* loaded candle series instead of just what happened since the alert was armed — a past
  dip anywhere in history read as a live crossing, firing a false trigger (+ a real push notification
  for it).
- Fixed by tracking the cutoff as its own field, only ever advanced forward from a real candle time,
  so a tick with missing candle history no longer resets it to 0.

### Fixed - Push TTL too short + duplicate-trigger race (2026-07-02)
- FCM webpush TTL was 300s; if the browser reconnected to the push service after that, the message
  was already dropped, so a closed browser could easily miss a push for good even though the
  server-side send succeeded. Bumped to 86400s (24h) in `src/server/firebaseAdmin.ts`.
- Overlapping `evaluatePushAlerts()` calls (in-process worker interval vs. a manual/cron call
  landing at the same time) could each read Firestore before the other's write landed, firing a
  one-time alert more than once (reproduced live: 3x for one crossing). Added an in-process
  `inFlight` promise lock in `src/server/pushAlertEvaluator.ts` so overlapping calls share one
  evaluation.
- Confirmed Telegram delivery works independently of the browser/service worker (plain server-side
  HTTP call) via `/api/notifications/test` — recommended as the more reliable closed-browser
  channel, since browser push fundamentally requires the browser's background process to stay
  alive, which is outside this codebase's control.

### Fixed - Closed-browser push never fired because no evaluator was running (2026-07-01)
- Closed-browser alert delivery always required a separate always-on process
  (`npm run push-worker` or an external cron hitting `/api/push/evaluate`); with neither running,
  alerts were never evaluated while the tab was closed, even though the FCM send path itself was
  correct.
- Added `src/instrumentation.ts`, which starts the same `evaluatePushAlerts()` loop in-process via
  Next's `register()` hook when the server boots, so `npm run dev`/`npm run start` alone delivers
  closed-browser push. Skipped on Vercel (`process.env.VERCEL`) or with `DISABLE_PUSH_WORKER=true`;
  `scripts/push-alert-worker.mjs` remains for that external-cron case.

### Added - Telegram and Discord alert notifications (2026-07-01)
- Added server-side Telegram Bot API and Discord webhook delivery for alert notifications.
  Browser-open alerts now fan out through `/api/notifications/send`; closed-browser worker alerts
  now send external messages from `/api/push/evaluate`.
- Added `/api/notifications/capabilities` and `/api/notifications/test` so setup can be checked
  without exposing bot tokens or webhook URLs to the browser.
- Added global Alert Center toggles and per-alert edit flags for Telegram and Discord. Existing
  saved alerts/settings migrate both channels to disabled.
- Added external-only alert snapshot sync, so Telegram/Discord closed-browser delivery can run
  without Firebase Messaging being configured.

### Added - Phase 6A Telegram/Discord alert channel plan (2026-07-01)
- Added `docs/PHASE6A_TELEGRAM_DISCORD_PLAN.md`, a detailed implementation plan for server-side
  Telegram Bot API and Discord webhook alert delivery in both browser-open and closed-browser worker
  paths.
- Added `.env.example` placeholders for Telegram/Discord alert delivery and webhook hardening.
- Updated Phase 6 status docs to treat Telegram/Discord as a Phase 6A external-channel extension,
  separate from the already implemented Firebase push channel.

### Fixed - Alert line "jumps" when dragged near the current price (2026-07-01)
- `AlertLines`' reconciliation effect was keyed on `symbolAlerts`, a freshly-allocated array on
  *every* render — including every price tick, since `useChartCtx()` changes reference on each
  tick. That tore down and recreated every alert's native price line dozens of times per second
  regardless of whether anything actually changed, which is what produced the visible "jump"/flicker,
  most noticeable when an alert sits close to the live price (more ticks touching that region).
  Fixed by keying the effect on a stable primitive derived from `id:price` pairs instead of the
  array reference.
- Separately, `AlertLines` could also destroy and recreate an alert's native line *while it was
  being dragged* in `AlertOverlay` (which moves the line imperatively, before the price is
  committed to the store) if the effect happened to re-run for an unrelated alertStore change —
  snapping the line back to its pre-drag position. Added a `draggingAlertIds` guard
  (`alertLineRegistry.ts`) so the reconciliation skips alerts currently mid-drag.
- Files: `src/components/chart/AlertLines.tsx`, `src/components/chart/AlertOverlay.tsx`,
  `src/components/chart/alertLineRegistry.ts`.
- Verified with a scripted Playwright repro (create alert → drag near live price → hold) against a
  clean dev server; confirmed the native price line no longer flickers/reverts.

### Fixed - Alert line stays after price visibly crosses it mid-session (2026-07-01)
- `observedSinceArm`'s "continuing" branch (the normal, browser-still-open path) only ever widened
  the observed high/low forward from the single most-recent tick's candle. Any candle that closed
  during a missed tick — a websocket reconnect, a backgrounded/throttled browser tab, or a brief
  gap in the kline stream — was silently dropped, so a real crossing could go undetected even while
  the tab stayed open and the chart visibly showed the candle piercing the alert line.
- `observedSinceArm` (`hooks/useAlertEngine.ts`) now uses one unified rule for every observation,
  first or continuing: rescan the loaded candle series for anything at/after the last-known point
  and fold it in. Walks the series backward from the newest candle and stops at the cutoff, so the
  common per-tick case only touches 1-2 candles instead of scanning the whole array.
- Files: `src/hooks/useAlertEngine.ts`.

### Fixed - Alert stays "pending" after reopening if the touch happened in an older candle (2026-07-01)
- On reopen/reload, `useAlertEngine`'s recovery only inspected the single most-recent (currently
  forming) candle's high/low. If the price actually crossed the alert level while the browser was
  closed but that touch happened in an already-closed candle (not the latest one), the alert never
  saw it and stayed armed/pending indefinitely, even after the level had clearly been crossed.
- `observedSinceArm` (`hooks/useAlertEngine.ts`) now scans every loaded candle since the alert was
  last armed (`alert.updatedAt`) for alerts that predate the current browser session, aggregating
  high/low across the full gap instead of just the latest bar. Added a guard so the very first
  observation for a pre-existing alert waits for candle history to finish loading rather than
  locking in a single-point range from a live quote that arrived before the REST candle backfill.
- Files: `src/hooks/useAlertEngine.ts`.

### Fixed - Closed-browser push notifications not displaying (2026-07-01)
- `sendFirebasePush` still set `webpush.notification.title/body` even after the earlier "data-first"
  fix (ca600cc). Any FCM message carrying a `notification` payload (top-level or nested under
  `webpush`) is auto-displayed by the browser's built-in FCM handling, which bypasses the custom
  `onBackgroundMessage` handler in `firebase-messaging-sw.js/route.ts` — leaving background delivery
  inconsistent/silent depending on browser. `sendFirebasePush` now sends a pure data-only message
  (no `notification` key anywhere), so the service worker's existing `onBackgroundMessage` handler
  reliably calls `showNotification()` itself for closed-browser delivery.
- File: `src/server/firebaseAdmin.ts`.

### Fixed - Closed-browser push crypto price fetch blocked in production (2026-07-01)
- `fetchBinancePrice` in `pushAlertEvaluator.ts` now calls `data-api.binance.vision` instead of
  `api.binance.com`. The latter returns HTTP 451 for requests from US-hosted server IPs (e.g. Vercel
  serverless functions), which caused every crypto push alert to be silently skipped with
  "price unavailable" even though `errors` stayed empty.
- Binance fetch failures (non-OK response, empty candle set) now throw instead of returning
  `undefined`, so `/api/push/evaluate` surfaces the real failure reason in its `errors` array
  instead of an unexplained skip.

### Fixed - Firestore push sync strips undefined fields (2026-07-01)
- Push alert Firestore writes now remove nested `undefined` values before `.set()`, fixing sync
  failures such as `alerts.0.note` being undefined.

### Fixed - Background FCM payload is data-first (2026-07-01)
- Server push now sends a data-first Web Push payload with `title` and `body` mirrored into `data`,
  an absolute `fcmOptions.link`, TTL/urgency headers, and debug `messageId` reporting from
  `/api/push/evaluate?debug=1`.

### Fixed - Reopened sessions catch existing alert range (2026-07-01)
- Alerts that existed before the current browser session now use the current candle's full high/low
  on first evaluation, so reopening the app after closed-browser time can clear alerts that crossed
  while the browser was closed.

### Fixed - Existing alerts recover range after reload (2026-07-01)
- Browser-open alert evaluation now uses the current candle's full high/low on first evaluation when
  the alert already existed before that candle opened. This prevents a reload/deploy from losing a
  valid crossing that happened while the alert was armed.
- Crossing checks are inclusive at the target line, so exact touches count.

### Fixed - Crossing alerts trigger from observed range (2026-07-01)
- `crossUp` and `crossDown` now evaluate the observed price range, not only the previous tick.
  This fires alerts when candles move through a line and then close back away from it, for both
  browser-open and closed-browser worker evaluation.

### Fixed - Closed-browser worker catches first-minute touches (2026-07-01)
- Server-side push evaluation now includes the first Binance one-minute candle that overlaps the
  alert evaluation window, so cron can catch a touch that happens shortly after the browser closes.
- `/api/push/evaluate?debug=1` now returns per-alert evaluation diagnostics for troubleshooting
  closed-browser push without exposing full FCM tokens.

### Fixed - Alert touches use post-arm candle range (2026-07-01)
- Browser-open alerts now track per-alert observed high/low after the alert is armed. This catches
  a new wick touch without falsely triggering from high/low that existed before the alert was
  created or moved.

### Fixed - Alerts no longer fire from old candle wicks (2026-07-01)
- Browser-open alert evaluation no longer reuses the current candle's historical high/low, preventing
  a newly created or moved alert from firing because of a wick that happened before the alert was
  armed.
- Closed-browser Binance evaluation now looks back 60 one-minute candles and ignores the partial
  candle portion before the alert's server evaluation window.

### Fixed - Push alert sync flushes before tab close (2026-07-01)
- Push-enabled alert snapshots now flush with `fetch(..., { keepalive: true })` on `pagehide` and
  hidden visibility, so the closed-browser worker has the latest alerts even if the user closes the
  tab immediately after creating or editing an alert.

### Fixed - Existing alerts sync when Push is enabled (2026-07-01)
- Turning global Push on now enables Push for existing active alerts, so the closed-browser worker
  receives them instead of evaluating `alerts=0`.
- If an FCM token already exists while global Push is off, pressing Push now re-enables push sync
  instead of unregistering the token.

### Fixed - Alert touches trigger from live candle high/low (2026-07-01)
- Browser-open alert evaluation now uses the latest kline OHLC together with ticker last price, so
  alert lines trigger when the live candle wick touches the level instead of only when the current
  last/close stays beyond it.
- Alert push sync now preserves each alert's persisted `updatedAt` timestamp instead of stamping the
  sync request time, preventing closed-browser worker windows from being reset by opening the app.

### Fixed - Closed-browser push can catch Binance touches between cron runs (2026-07-01)
- Server-side push evaluation now fetches the latest 10 Binance one-minute
  candles for crypto symbols and aggregates high/low from each alert's last
  server evaluation time. `above`/`below` and `crossUp`/`crossDown` alerts can
  now trigger when price touches the level between external cron runs. Vercel
  Cron config was removed; use an external scheduler such as cron-job.org for
  `/api/push/evaluate` on plans without Vercel Cron.

### Fixed - Screenshot overlay clipping (2026-07-01)
- `captureChart()` now crops each overlay canvas to the actual Lightweight Charts
  screenshot bounds before compositing. This prevents SMC/drawing/alert overlays
  from spilling outside the captured chart area or appearing heavier/misaligned
  in exported screenshots.
  File: chartRegistry.ts.

### Fixed - Push subscription waits for active service worker (2026-07-01)
- Fixed Firebase push registration failing with
  `Subscription failed - no active Service Worker` after deployment/service
  worker refreshes. The client now waits for `/firebase-messaging-sw.js` to
  activate before requesting an FCM token, and the service worker uses
  `skipWaiting()` / `clients.claim()` during install/activate.

### Changed - Push alert sync uses Firestore in production (2026-07-01)
- `pushAlertStore` now stores FCM tokens and push-enabled alert snapshots in
  Firestore collection `pushAlertDevices` whenever Firebase Admin env is
  configured. The `.data/push-alerts.json` file remains only as a local fallback
  for development without Firebase Admin.

### Added - Phase 6B MT5 bridge plan docs (2026-07-01)
- Added `docs/PHASE6B_MT5_BRIDGE_PLAN.md`, a detailed MT5 bridge implementation
  plan covering topology, protocol, frontend modules, store design, risk
  controls, symbol mapping, milestones, test plan, rollback, and acceptance
  criteria.

### Added - Closed-browser push alert worker (2026-07-01)
- Added server-side token/alert sync plus `/api/push/evaluate`, allowing FCM
  alert notifications to be sent while the browser/app is closed when a Next
  server and push worker/cron are running.
- Added `npm run push-worker`, backed by `scripts/push-alert-worker.mjs`, which
  polls `/api/push/evaluate`. Push alert snapshots are stored in
  `.data/push-alerts.json`.
- Server-side evaluator supports public Binance crypto prices and OANDA /
  TwelveData server credentials for forex/metals/indices. See
  `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.

### Added - Phase 6A Firebase push notifications (2026-07-01)
- Added an optional FCM push notification channel for price alerts. Alert Center
  now supports Push enable/disable, token registration, permission/error states,
  and per-alert Push flags in the edit dialog.
- Added server-side `/api/push/send` FCM dispatch through `firebase-admin` and a
  dynamic `/firebase-messaging-sw.js` route that injects public Firebase config
  without hardcoding it into `public`.
- Push delivery is failure-safe: alert history, toast, sound, and browser
  notifications continue even when Firebase env, permission, token registration,
  or send fails. Full setup/test docs: `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.
  Files: alertStore.ts, notificationStore.ts, notify.ts, push.ts,
  usePushNotifications.ts, AlertCenter.tsx, AlertEditDialog.tsx.

### Fixed - Alert-line drag still jumped the view near the current price (2026-07-01)
- Follow-up: freezing `handleScroll`/`handleScale`/`autoScale` via
  `chart.applyOptions` was not sufficient. Root cause matches the earlier
  position-tool "view jump" fix: the alert canvas is `pointerEvents:"none"`, so
  the *native* mousedown/mousemove/wheel/touch events the browser dispatches
  alongside pointer events fall straight through to lightweight-charts' own
  canvas underneath and still drive its internal pan/rescale, regardless of the
  applyOptions flags. Added the same document-level capture-phase blocker used
  by `DrawingInteractionManager` — swallows those events for the duration of
  the alert drag so they never reach LWC.
  File: AlertOverlay.tsx.

### Fixed - Chart view jumped while dragging an alert line near the price (2026-07-01)
- Dragging an interactive alert line froze pan/zoom but not the right price
  scale's auto-scaling, so each forming-bar tick re-fit the price range and the
  whole view jumped under the cursor — worst near the current price where the
  live bar moves. The drag now also sets `autoScale: false` on the right price
  scale and restores the prior mode on pointer-up (restoring to the same range
  doesn't move the view). Also disabled the leftover per-tick `ALERT_DEBUG`
  console logging.
  File: AlertOverlay.tsx.

### Fixed - Position stop zones overlapping volume pane (2026-07-01)
- Long/Short position rendering is now clipped to the price pane above the
  volume overlay. Far-away SL/TP levels still show their line and label at the
  nearest visible price-pane edge, but fills, borders, guides, labels, selection
  outlines, and handles no longer draw over the volume bars.
  File: PositionTool.ts.

### Fixed - Position SL labels and side normalization (2026-07-01)
- Stop/target labels on Long/Short position drawings are now clamped inside the
  chart viewport, so an SL near or outside the visible bottom edge no longer
  renders as a clipped chip over the lower pane.
- Editing Entry price now preserves the existing TP/SL distances on the correct
  side for the position direction. Editing Profit/Stop price from the Inputs tab
  normalizes the entered price to the correct side of Entry for Long vs Short,
  preventing inverted green/red zones after changing SL.
  Files: PositionSettingsDialog.tsx, PositionTool.ts.

### Changed - Long/Short Position settings UI parity (2026-07-01)
- Rebuilt the Long/Short Position settings dialog to match TradingView's
  Inputs/Style/Visibility layout from the user reference. Inputs now use compact
  TradingView-like fields and selectors, including Default account currency and
  Default QTY precision.
- Added Style controls for line style/width, stop color, target color, label
  text color/font size, Price labels, Stats multi-select, Compact stats mode,
  and Always show stats.
- `PositionTool` now applies those settings on the canvas: custom line style,
  target/stop colors, configurable label font/text color, percent/ticks/RR/amount
  stats, compact labels, and always-visible stats. Shared label chips now accept
  font size and text color.
- New long/short drawings default to the reference workflow values: account
  `1000`, risk `25%`, lot size `1`, leverage `10000`, Default currency,
  visible price labels, default target/stop/text colors, and percent stats.
  Files: PositionSettingsDialog.tsx, PositionTool.ts, shared.ts, chartStore.ts,
  types/drawing.ts.

### Fixed - Position counted TP/SL before the entry was ever filled (2026-07-01)
- The TP/SL detector evaluated levels from the entry time even if price never
  traded through the entry. A long limit placed below market that first spiked
  UP to the target (without retracing to the entry) was wrongly marked a
  take-profit, even though the order was never filled — and the later crash that
  filled the entry and hit the stop was ignored. Now `detectPositionHit` models
  the order in two phases: (1) it stays *pending* until a bar's range straddles
  the entry (market fill on the entry bar, or a later limit fill), then (2)
  evaluates TP/SL from the fill onward (stop-before-target on ambiguous bars).
  The renderer and the `DrawingLayer` candle subscription now share this single
  detector, so they can never diverge; the old duplicated scan + live-price
  fallback in `DrawingLayer` were removed.
  Files: PositionTool.ts (new exported `detectPositionHit`), DrawingLayer.tsx.

### Fixed - Stale persisted TP hit never corrected to SL (2026-07-01)
- Follow-up to the stop-first fix below: a position whose `tradeStatus` was
  saved as `tp_hit` by the OLD logic stayed wrong forever, because both the
  renderer and the candle subscription **skipped re-checking any position that
  already had a hit status**. Now the candle data is the single source of truth:
  `PositionTool.render` re-derives the outcome via `findHitCandle` on every paint
  (overriding stale persisted status; persisted value used only as a fallback
  when no candles are loaded), and the `DrawingLayer` subscription re-detects
  even resolved positions and rewrites the store only when the value changes
  (clearing it if nothing is hit). Existing wrong positions self-correct on the
  next repaint — no need to re-place them.
  Files: PositionTool.ts, DrawingLayer.tsx.

### Fixed - SL hit lost to TP when one bar pierces both levels (2026-07-01)
- The TP/SL hit scan checked the target before the stop within a single bar, so
  a wide bar that pierced both levels was reported as a take-profit hit even
  though the outcome is ambiguous. Now the stop is evaluated first in all three
  detection sites, so an ambiguous bar conservatively resolves to a stop hit
  (TradingView / standard backtest convention); chronological order across
  separate bars is unchanged.
  Files: PositionTool.ts (`findHitCandle`), DrawingLayer.tsx (candle scan + live
  price fallback).

### Fixed - Chart screenshot failed to save / errored (2026-07-01)
- The download anchor was never attached to the DOM (Firefox/strict browsers
  ignore `click()` on a detached anchor) and `URL.revokeObjectURL` ran
  synchronously right after `click()`, which can abort the download. The anchor
  is now appended/removed around the click and the object URL is revoked after a
  delay. `screenshot()` also wraps `captureChart()` in try/catch and logs.
- `captureChart` now wraps the final `shot.toBlob` (it was outside the
  compositing try) and retries with a clean chart-only screenshot if it throws,
  so a tainted/oversized composite can't reject the whole capture.
  Files: TopToolbar.tsx, chartRegistry.ts.

### Fixed - TP/SL hit status overridden by live price after reversal (2026-06-30)
- When SL was hit first but price later reversed and reached TP, the renderer
  showed both zones as bright and both labels displayed HIT simultaneously.
  Root cause: reachedTarget/reachedStop (live-price) had equal priority to
  isTpHit/isSlHit (persisted) via ||. Reordered ternaries so confirmed hit
  status takes absolute priority. Label HIT badges now only reflect confirmed
  hits, never live price.
  File: PositionTool.ts.

### Changed - Position tool visual parity with TradingView (2026-06-30)
- Replaced alpha-blended bright teal/red fills (`#26a69a` / `#ef5350`) with
  TradingView's pre-mixed dark palette: profit fill `#0E2B26`, loss fill
  `#3C171A`. This avoids stacking alpha every frame and produces the correct
  subtle tint on both dark and light charts.
- Entry line changed from gray `#b2b5be` to teal `#089981` (TradingView's
  entry line colour). TP dashed line now `#089981`, SL dashed line `#F23645`.
- Removed the 2 px glow outline on TP/SL hit zones — TradingView indicates
  hits via label badges (`✓ HIT` / `✕ HIT`) and fill alpha changes only.
- Fills aligned to integer pixels (`Math.round`) and lines offset by 0.5 px
  for odd-integer widths to eliminate canvas anti-alias blur.
- Default line width reduced from 1.5 to 1 px (user-adjustable via
  PositionSettingsDialog still respected).
- Centralised all position colours in an exported `POSITION_COLORS` constant
  at the top of `PositionTool.ts`.
- Removed dead `BULL`/`BEAR` constants from `drawingRenderer.ts`.
- TP/SL/RR labels right-aligned at the box right edge with pre-measured text
  widths instead of the previous hardcoded `midX - 60` centre guess.
- Added TradingView-style dashed selection outline (`#9598a1`, 4 px padding)
  around the entire position when selected.
- Label chip background opacity increased from 0.85 to 0.92 for closer
  TradingView match (new optional `bgAlpha` param on shared `chip()` helper).
- Pixel-aligned the hit-overlay dashed diagonal trajectory line.
- Added 1 px dashed borders on profit/loss rectangles (alpha 0.18).
- Added pre-hit diagonal guide lines (alpha 0.12) from entry right edge to
  TP/SL levels, visible even before a hit occurs.
- Changed TP/SL dash pattern from [5,3] to [4,4] (TradingView ~4 on/4 off).
- Compacted label chips: height 18 to 15 px, horizontal padding 5 to 3 px,
  border radius 4 to 2. Labels now sit ON their respective lines.
- Hit icon spacing reduced from double to single space.
- Added optional weight param to canvasFont(); chip text now weight 500.
- Fixed render order: fills, borders, lines, guides, labels, selection.
  Files: chart/drawing/tools/plugins/PositionTool.ts,
  chart/drawing/tools/plugins/shared.ts,
  chart/drawing/drawingRenderer.ts,
  chart/PositionSettingsDialog.tsx.

### Fixed — Canvas text ignored font size / bold / italic (2026-06-30)
- Changing a text/emoji or rectangle-text object's **font size, Bold or Italic**
  had no visible effect. Root cause: canvas `ctx.font` cannot resolve CSS custom
  properties — `"28px var(--font-sans)"` is an unparseable font string, so the
  whole assignment was silently ignored and the context kept its previous/default
  font. Size + bold + italic therefore never applied.
- Added `fontFamily()` (resolves `--font-sans` once, cached) and `canvasFont(size,
  {bold, italic})` in `plugins/shared.ts`; `TextTool`, `RectangleTool`, `EmojiTool`
  and `chip()` now build valid font strings through it (emoji also honours
  `fontSize`). `SmcLayer` / `ReplaySelectionLayer` label fonts switched to a concrete
  family for the same reason.
  Files: chart/drawing/tools/plugins/{shared,TextTool,RectangleTool,EmojiTool}.ts,
  smc/SmcLayer.tsx, replay/ReplaySelectionLayer.tsx.

### Changed — ObjectSettingsDialog redesigned for TradingView parity (2026-06-30)
- Reworked the generic settings dialog to match TradingView's object dialog
  (user-reported mismatch). Tabs are now **Style · Text · Coordinates · Visibility**
  with a **Template ▼ · Cancel · Ok** footer; edits apply **live for preview** and
  **Cancel reverts** to the snapshot captured on open (full revert, including fields
  added during editing), **Ok** commits.
- **Style tab (rectangle):** _Extend_ (none/left/right/both), _Border_ (colour swatch
  + width/style line widget), _Middle line_ (checkbox + colour + style), _Background_
  (checkbox + colour swatch with an opacity slider). Other shapes show Border +
  Background; lines show a single Line widget.
- **Text tab (rectangle + text/emoji):** colour swatch, font-size select, **Bold** /
  **Italic** toggles, an "Add text" textarea, and (rectangle) vertical + horizontal
  **Text alignment** dropdowns.
- **Rendering wired (not fake UI):** new `Drawing` fields `bold`, `italic`, `textColor`,
  `textHAlign`, `textVAlign`, `extend`, `showMiddleLine`, `middleLineColor`,
  `middleLineStyle`. `RectangleTool` now draws the extension, the middle line, and
  inner aligned/bold/italic text; `TextTool` honours bold/italic + `textColor`. All
  new fields are in `drawingsHash()` (immediate repaint) and `TEMPLATE_STYLE_KEYS`
  (templates capture them).
  Files: chart/ObjectSettingsDialog.tsx, chart/drawing/tools/plugins/RectangleTool.ts,
  chart/drawing/tools/plugins/TextTool.ts, chart/drawing/renderer/CanvasRenderer.ts,
  types/drawing.ts, store/chartStore.ts.

### Added — Drawing toolbar Settings (hexagon) + Style Templates (2026-06-30)
- **⬡ Settings (every object):** the floating `DrawingSettingsToolbar` now shows a
  hexagon settings button for **all** drawings (was previously only the long/short
  gear). New `ObjectSettingsDialog` opens for non-position tools with tabs picked
  by family — line/shape → _Style · Coordinates · Visibility_, text/emoji → _Style ·
  Visibility_. Style tab: colour, line width, line style, and (shapes) fill + opacity;
  update 2026-07-04: standalone Text now uses _Text · Visibility_ to match the
  current TradingView text-object settings dialog.
  Coordinates tab: editable price + date/time per point; Visibility: show/hide on
  chart. The long/short `PositionSettingsDialog` is untouched (still wins for
  positions, so the two dialogs never collide). Plan §1.
- **▦ Templates (style presets):** a templates button saves the selected object's
  style as a named, **global**, family-scoped preset and re-applies it to another
  object of the same family (style-only — never points/id, so a template can't move
  or duplicate objects). New `DrawingTemplate` type + `drawingTemplatesAtom` /
  `saveTemplateAtom` / `applyTemplateAtom` / `deleteTemplateAtom`, persisted via
  `localStore` under `drawingTemplates` and hydrated in `hydrateAtom`. Plan §2.
- **Repaint correctness:** `CanvasRenderer.drawingsHash()` now folds in the style
  fields (`color`, `lineWidth`, `lineStyle`, `fillColor`, `opacity`, `showLabels`,
  `visible`) so toolbar / dialog / template edits repaint immediately instead of
  waiting for the next pan/zoom. Cross-cutting note in the plan.
- **Anchor (plan §3) intentionally deferred** — it needs viewport dimensions threaded
  through the hit-test/drag pipeline (adapters only receive scalar projectors), a high
  blast radius for marginal value; documented in `DRAWING_TOOLBAR_PLAN.md`. No dead
  button was added.
  Files: chart/ObjectSettingsDialog.tsx (new), chart/PositionSettingsDialog.tsx
  (export shared NumberField/Row/SectionTitle), chart/DrawingSettingsToolbar.tsx,
  store/chartStore.ts, types/drawing.ts, components/Terminal.tsx,
  chart/drawing/renderer/CanvasRenderer.ts.

### Added — Drawing toolbar "⋯ More" overflow menu (2026-06-30)
- Added a `⋯` button to the floating `DrawingSettingsToolbar` that opens the same
  action list as the right-click menu (Settings, Clone, Lock/Unlock, Show/Hide,
  Bring to Front, Send to Back, Delete) — TradingView object-toolbar parity
  (plan §4 in `docs/DRAWING_TOOLBAR_PLAN.md`).
- Extracted a single source of truth, `useDrawingActions(drawing, onAfter)`, now
  shared by both `DrawingContextMenu` and the toolbar popover (no duplicated menu
  code). The context menu also gains a "Settings" entry.
  Files: chart/drawing/useDrawingActions.tsx (new), chart/DrawingContextMenu.tsx,
  chart/DrawingSettingsToolbar.tsx.

### Fixed — Screenshot now includes drawings & positions (2026-06-29)
- The chart screenshot only contained candles/axes — drawing tools, long/short
  positions and SMC overlays were missing. Cause: `IChartApi.takeScreenshot()`
  renders only lightweight-charts' own canvases, but those overlays live on
  separate `<canvas>` elements stacked over the chart.
- `captureChart` now composites every overlay canvas onto the base screenshot at
  its on-screen position (scaled to the screenshot's pixel resolution, drawn in
  ascending z-index order). Falls back to the chart-only shot if compositing
  throws. Covers both the toolbar screenshot button and the journal capture.
- Note: `chartElement()` returns LWC's own `div.tv-lightweight-charts` (a child
  of the createChart container); the overlays are siblings one level higher, so
  the implementation walks up ancestors until it finds the scope that actually
  contains the non-LWC canvases.
  Files: chart/chartRegistry.ts.

### Fixed — Can't finish a freeform draw (Path / Polyline) (2026-06-29)
- Double-clicking never finished a Path/Polyline: the finish check relied on
  `PointerEvent.detail >= 2`, but `detail` is 0 on `pointerdown` in most
  browsers, so the second click just dropped another point.
- Now double-click is detected manually (a second primary press within 350ms and
  <6px of the previous), which commits the in-progress freeform draw. Right-click
  still finishes via the contextmenu handler, and non-primary mouse buttons no
  longer drop a stray point first (`hD` ignores `button > 0`).
  Files: chart/drawing/interaction/DrawingInteractionManager.ts.

### Fixed — Path tool now matches TradingView (open + arrowhead) (2026-06-29)
- The Path tool was rendering a **closed, filled polygon**. TradingView's Path is
  a series of connected straight segments that is **open** (never closed/filled)
  with a **single arrowhead at the final point**, aimed along the last segment.
- Rewrote `PathTool.render`: stroke the open polyline, drop `closePath`/fill, and
  draw a filled triangular arrowhead at the terminal point (size scales with line
  width). Added a reusable `arrowHead()` helper in `shared.ts`.
- Hit-testing now also covers the segment bodies (via `distToSegment`), so the
  path line itself is grabbable/movable, not just its vertices.
  Files: chart/drawing/tools/plugins/PathTool.ts, chart/drawing/tools/plugins/shared.ts.

### Fixed — Position box "grows / pins to SL bar" while dragging (2026-06-29)
- When dragging a long/short position *fast* and the live geometry crossed its
  own stop/target, the box suddenly **enlarged and looked pinned at the SL/TP
  candle** mid-drag. Cause: on drag start `handleDown` clears `tradeStatus` +
  `hitTime`, so `PositionTool.render` took the fresh-detect branch every frame;
  the moment `findHitCandle` matched it extended the box's right edge (`geo.xR`)
  to the hit candle.
- Fix: the renderer now marks the live-drag clone with a transient `_dragging`
  flag (set in `CanvasRenderer` when applying `livePoints`), and `PositionTool`
  skips the TP/SL hit-freeze entirely while `_dragging` is set. The freeze is
  re-evaluated normally once the drag commits (the box snaps to the stop-out bar
  only after release, as intended). `_dragging` is render-only, never persisted.
  Files: types/drawing.ts (+`_dragging`), chart/drawing/renderer/CanvasRenderer.ts,
  chart/drawing/tools/plugins/PositionTool.ts.

### Fixed — Residual "view jump" when dragging a position tool fast (2026-06-29)
- Follow-up to the trendline/alert fix below. Dragging or resizing an existing
  drawing (notably the long/short **position tool**, especially within a dense
  candle cluster, and most visibly when dragging right→left which reveals
  history) *fast* still jumped/zoomed the view.
- **Real root cause**: lightweight-charts pans/scales off **mouse events**
  (`mousedown`/`mousemove`), but the interaction manager only ever stopped
  *pointer* events (`pointerdown`). Because the drawing canvas is
  `pointerEvents:"none"`, the raw mouse events flowed straight through to the
  chart underneath. The option-only freeze (`handleScroll`/`handleScale → false`)
  was a band-aid that raced against the first leaked move.
- **Fix**: while a body-move / handle-resize drag is active, swallow the raw
  `mousedown`/`mousemove`/`wheel`/`touchstart`/`touchmove` events in the
  capture phase so they never reach LWC's handlers at all. Gated by a
  synchronous `dragActiveRef` set on pointerdown and cleared on release
  (pointerup / pointerleave / reset). The chart pan/zoom option-freeze
  (`freezeChart(busy)`, threaded from `DrawingLayer`) is kept as a second line
  of defence.
  Files: chart/DrawingLayer.tsx, chart/drawing/interaction/DrawingInteractionManager.ts.

### Added — Replay "Select Bar" feature (TradingView parity) (2026-06-29)
- Added a **Select Bar** button to the replay transport controls that enters a
  dedicated re-select mode while replay is already active. Matches TradingView's
  Bar Replay → Select Bar behaviour.
  - **State machine**: New `reSelectingAtom` boolean creates a 5th replay state
    (`ReSelecting`) — replay remains armed, playback is auto-paused, cursor/anchor
    unchanged during hover.
  - **Transient preview**: Hover data stored in refs (`hoverIdxRef`, `dirtyRef`),
    never React state. Mouse move triggers only a lightweight canvas repaint — zero
    store updates, zero React re-renders, zero candle rebuilds.
  - **Snap-to-candle**: Binary search (`indexAtOrBefore`) snaps to existing candles
    only, never empty pixel positions. Shows vertical guide line + date label chip +
    shaded "future" region (orange tint to distinguish from initial selection).
  - **Click confirms**: Moves replay `anchor` + `cursor` to the chosen bar, rebuilds
    visible candles. Remains paused (TradingView does NOT auto-play).
  - **Cancel**: ESC, Right-click, or pressing Select Bar again cancels without
    changing replay position. Repeatable unlimited times.
  - **Full candle access**: During re-select the overlay reads the FULL candle list
    from `candlesAtom`, so the user can pick any bar including "future" ones past
    the current cursor.
  Files: store/replayStore.ts (+`reSelectingAtom`, `beginReSelectAtom`,
  `cancelReSelectAtom`, `confirmReSelectAtom`), components/replay/ReplayControls.tsx
  (+Select Bar button + re-select UI), components/replay/ReplaySelectionLayer.tsx
  (ref-based hover, dual-mode draw, right-click cancel), hooks/useHotkeys.ts
  (ESC priority: reSelect > select > drawing), components/toolbar/TopToolbar.tsx
  (reSelect toggle + Cancel select label).

### Fixed — Chart "view jump" when dragging a trendline / alert fast (2026-06-29)
- Dragging a drawing (e.g. trendline) or an alert line quickly made the chart
  pan/scroll ("view jump"). Cause: `handleScroll.pressedMouseMove` is on, and on
  a fast drag the pointer/mouse events leak through to the chart's pan handler
  (the drawing canvas is `pointerEvents:none` and the manager can't use pointer
  capture). Fix: **freeze the chart's pan & zoom for the duration of the drag**
  (`handleScroll`/`handleScale` → false) and restore on release.
  - `DrawingLayer`: toggled whenever the interaction machine is not `Idle`
    (covers create, move, and resize).
  - `AlertOverlay`: toggled around the alert-line drag.
  Files: chart/DrawingLayer.tsx, chart/AlertOverlay.tsx.

### Added — Favorites quick-access bar (2026-06-29)
- Starred drawing tools now show as a **quick-access bar** at the top of the
  `DrawingToolbar` (above the tool groups, with a brand-coloured divider). Each
  favorite is a one-click tool button; **right-click removes** it. Driven by the
  same persisted `tv:favTools` set as the flyout stars, so the two stay in sync.
  A module-level `TOOL_BY_ID` lookup resolves icons/labels. File:
  toolbar/DrawingToolbar.tsx.

### Added — Shapes (rectangle) group: multi-point engine + TradingView parity (2026-06-29)
Brought the Shapes toolbar group to TradingView parity (UI + function). See
`docs/SHAPES_GROUP_IMPLEMENTATION.md` for the full design/impact write-up.
- **Multi-point drawing engine** (`DrawingInteractionManager`): added an
  additive, opt-in flow for tools with >2 points. Two new optional plugin fields
  (`maxPoints`, `freeform`) in `ToolRegistry`. First click starts, each click
  appends, fixed-count tools auto-commit at `maxPoints`, freeform tools finish on
  double-click / right-click; pointer-move previews to the cursor; Escape/tool
  change cancels. **1-point and 2-point tool paths are unchanged** (low blast
  radius).
- **Fixed previously-broken tools:** `triangle` & `curve` (needed 3 points but
  only ever got 2 → invisible) now work; `polyline` & `path` are true
  multi-segment; `rotatedRect` is now a **real rotated rectangle** (3-point:
  edge + perpendicular width) with 3 draggable handles.
- **New tools:** `arc` (3-point quadratic through a peak) and `doubleCurve`
  (4-point cubic S-curve). Added to the `DrawingTool` union + `DRAWING_TOOLS`.
- **Toolbar flyout** (`DrawingToolbar`): section headers ("SHAPES"), favorite
  **stars** persisted in `localStorage` (`tv:favTools`), hotkey labels, and the
  Shapes group reordered to TradingView's full SHAPES list (Rectangle, Rotated
  rectangle, Path, Circle, Ellipse, Polyline, Triangle, Arc, Curve, Double
  curve). Brush moved to its own "Brushes" group.
- `HitTestEngine` target union extended with `p3` (4th handle for double curve).
- Deferred (documented): Brushes/Highlighter & Arrows sections; a favorites
  quick-access bar.

### Added — Text font-size control (TradingView-style) (2026-06-29)
- Text/emoji annotations gain a `fontSize` property (default 13). The floating
  toolbar shows a font-size button (current size) with a size-picker popover
  (10–40px), matching TradingView's "16" control. `TextTool` renders at the chosen
  size and scales its hit box / bounding box accordingly; `CanvasRenderer` hashes
  `fontSize` so size changes repaint. Files: types/drawing.ts, chart/drawing/tools/
  plugins/TextTool.ts, chart/drawing/renderer/CanvasRenderer.ts,
  chart/DrawingSettingsToolbar.tsx.

### Changed — Drawing settings toolbar icons match TradingView (2026-06-29)
The floating `DrawingSettingsToolbar` now mirrors TradingView's object toolbar:
- **Line color** uses a **pencil** icon (was a generic palette) with the colored
  underline bar; for text/emoji tools it switches to a **"T"** (text color).
- **Background/fill** uses a **paint-bucket** icon with a colored underline (was a
  plain square swatch).
- **Line width** renders an actual line of the selected thickness next to the
  "Npx" label (was a static dash icon).
File: chart/DrawingSettingsToolbar.tsx.

### Fixed — Long/Short position resizing/disappearing in whitespace (2026-06-29)
Two reported bugs where the position box changed size or vanished when dragged:
1. **Box collapsed/disappeared dragging into whitespace, then snapped larger
   coming back over candles.** Root cause: the `toX` whitespace fallback in
   `DrawingLayer` never extrapolated past the last bar — its extrapolation branch
   only ran for non-last candles (`i + 1 < candles.length`), but the loop hit the
   last candle first and returned that candle's X verbatim. So every whitespace
   time mapped to the last candle's X, pinning the right (and eventually left) edge
   onto it → width collapsed; releasing the pin on the way back → sudden enlarge.
   `toX` now finds the nearest two candles that still project and extrapolates
   linearly with the uniform bar spacing (matching `fromEvent`'s inverse), so the
   box keeps its size everywhere. Fixes all drawings dragged into whitespace, not
   just positions. File: chart/DrawingLayer.tsx.
2. **Entry line is now an independent draggable handle** (TradingView parity).
   Previously only the target/stop handles were grabbable; the entry could only be
   moved by dragging the whole body. Added a `p0` anchor at the entry/left edge —
   dragging it adjusts the entry price only (left-edge time fixed, box width kept).
   Anchor hits dominate body hits, so the small entry dot resizes while the rest of
   the entry line still moves the box. Files: chart/drawing/tools/plugins/
   PositionTool.ts, chart/drawing/hittest/HitTestEngine.ts (added `"p0"` target).

### Fixed — Position/drawing-tool bug pass (2026-06-28)
Four reported bugs around the Long/Short position tool and drawing tools:
1. **Settings toolbar was hard-pinned next to the drawing.** The floating
   `DrawingSettingsToolbar` projected the selection's points and floated directly
   above them. It is now **draggable** — a `GripVertical` handle lets the user move
   it anywhere on the chart; the position is remembered (only clamped into view)
   until the selection clears. Files: chart/DrawingSettingsToolbar.tsx.
2. **Settings toolbar now defaults to the TOP-CENTRE of the chart** (TradingView's
   floating object toolbar) regardless of where the drawing was placed, instead of
   hugging the object. Auto-positions to top-centre on select; user drags override.
   File: chart/DrawingSettingsToolbar.tsx.
3. **TP/SL zones now highlight when price reaches them.** `PositionTool` reads the
   latest price from `candlesAtom` and, direction-agnostically (Long & Short),
   brightens the profit zone when the target is reached and the risk zone when the
   stop is reached (stronger fill + glow outline + "✓ HIT" / "✕ HIT" on the label).
   `DrawingLayer` adds a **non-React** `candlesAtom` subscription that force-repaints
   the canvas on each tick *only when a long/short tool is present* (so idle charts
   stay cheap and the per-tick React-render optimisation is preserved). `RenderLoop.
   markDirty` now accepts an optional `force` flag. Files: chart/drawing/tools/
   plugins/PositionTool.ts, chart/DrawingLayer.tsx, chart/drawing/renderer/CanvasRenderer.ts.
4. **Rectangle (and any tool) dragged smoothly into chart whitespace.** Dragging
   stalled the instant the pointer left the data range because
   `timeScale().coordinateToTime()` returns `null` past the last bar — common when
   placing supply/demand rectangles at the right edge. `DrawingLayer.fromEvent` now
   falls back to extrapolating the time from the fractional logical index and the
   bar interval (mirroring how `timeToCoordinate` maps future times), so drags stay
   smooth everywhere. File: chart/DrawingLayer.tsx.

### Fixed — Single-click tools kept duplicating instead of selecting (2026-06-28)
- Horizontal / Horizontal-ray / Vertical / Cross / Info line / Text / Emoji stayed armed
  after placing one object, so clicking the placed object spawned another endlessly instead
  of selecting it. Now every tool returns to the cursor after one placement (TradingView
  behaviour) — the new object is auto-selected and immediately drag-and-droppable.
  Removed `SINGLE_CLICK_TOOLS`; `addDrawingAtom` always switches to `cursor`.
  File: store/chartStore.ts.

### Added — Position tool settings dialog (TradingView-style) (2026-06-28)
- New `PositionSettingsDialog.tsx` — modal with Inputs / Style / Visibility tabs for the
  Long/Short position tool, opened from a gear button on the floating drawing toolbar.
- Inputs: Account size + currency, Lot size, Risk (% or amount), Entry price, Leverage,
  Profit level (Ticks + Price), Stop level (Ticks + Price), QTY precision — plus a live
  computed summary (Quantity, Risk, Profit, Risk/Reward). Editing prices moves the
  corresponding point; editing Ticks recomputes price from the inferred min-tick on the
  correct side for long/short. Changes apply live.
- Style: line width + zone opacity. Visibility: show/hide on-chart labels.
- `Drawing` gained position fields: `accountSize`, `accountCurrency`, `lotSize`,
  `riskValue`, `riskUnit`, `leverage`, `qtyPrecision`, `showLabels`.
- `PositionTool` render now honours `opacity` (zones), `showLabels`, and prints Qty +
  profit/risk money amounts on the labels when account/risk are set.
- `chartStore` adds `editingDrawingIdAtom` / `setEditingDrawingAtom`; dialog mounted in
  `Terminal`; Escape is guarded in `useHotkeys` so it closes the dialog without deselecting.
  Files: chart/PositionSettingsDialog.tsx (NEW), chart/DrawingSettingsToolbar.tsx,
  chart/drawing/tools/plugins/PositionTool.ts, store/chartStore.ts, types/drawing.ts,
  Terminal.tsx, hooks/useHotkeys.ts.

### Changed — Long/Short position tool rebuilt TradingView-style (2026-06-28)
- The old position tools defaulted `stop`/`target` to `entry`, so the box was invisible and
  there was no way to set risk/reward. Rebuilt as a points-based 3-point box that works with
  the standard drag engine: points[0]=entry, points[1]={rightEdge,target}, points[2]={rightEdge,stop}.
- `chartStore.addDrawingAtom` auto-initialises a single click into a full box — entry at the
  click, target/stop at ±1%×(2:1 R/R) defaults, ~20-bar width derived from the candle interval.
- New `PositionTool.ts` (replaces `LongPositionTool.ts` + `ShortPositionTool.ts`): green profit
  zone (entry→target), red risk zone (entry→stop), entry/target/stop lines, and labels for
  entry / target (+%) / stop (+%) / Risk-Reward ratio. Direction-agnostic renderer shared by
  long & short.
- Draggable handles: target ("p1") and stop ("p2") set their price + the right-edge time;
  dragging the body/entry line moves the whole box. Long/Short now return to the cursor after
  one click (removed from `SINGLE_CLICK_TOOLS`) so handles are immediately adjustable.
  Files: drawing/tools/plugins/PositionTool.ts (NEW), drawing/tools/adapters.ts, store/chartStore.ts;
  removed drawing/tools/plugins/{LongPositionTool,ShortPositionTool}.ts.

### Fixed — Phantom drawing created when picking a tool from the flyout (2026-06-28)
- With an armed single-click tool (e.g. Horizontal ray, which stays active after use),
  clicking a tool in the left toolbar's flyout — which overlays the chart — fired the
  document-capture `pointerdown` first and created a phantom drawing under the menu before
  the button's onClick switched tools. Symptom: "select Cursor → a horizontal ray appears".
- `isOverDrawingUI` now also matches `[data-chart-ui]`; the toolbar flyout (backdrop + menu)
  is tagged with it, so clicks there no longer reach the chart drawing handler.
- Switching the active tool now cancels any in-progress multi-point draw (resets the
  interaction machine) so a half-placed anchor can't bleed into the next tool.
  Files: drawing/interaction/DrawingInteractionManager.ts, toolbar/DrawingToolbar.tsx.

### Added — Floating drawing settings toolbar (2026-06-28)
- Selecting any drawing on the chart now pops a **TradingView-style floating toolbar**
  above it (`DrawingSettingsToolbar.tsx`) for inline editing — no separate dialog needed.
- Controls: stroke colour (palette + custom picker), fill colour (shapes only, with
  "No fill"), line width (1–4px), line style (solid / dashed / dotted), clone, lock/unlock,
  delete. Each control writes via `updateDrawingAtom` / store actions; changes persist.
- Auto-positions above the selection's projected anchor points (falls back below when
  there's no room) and follows the drawing on pan / zoom / resize via `ChartContext.version`.
- `DrawingInteractionManager` now ignores pointer events that originate on the toolbar
  (`isOverDrawingUI` / `[data-drawing-toolbar]`) so clicking a control no longer deselects
  the drawing or starts a drag.
  Files: chart/DrawingSettingsToolbar.tsx (NEW), chart/DrawingLayer.tsx,
  drawing/interaction/DrawingInteractionManager.ts.

### Added — Trend Angle tool + TradingView-style line suite parity (2026-06-28)
- **New `trendAngle` drawing tool** — two-point trend line that always renders the
  visual angle (degrees) between the line and a horizontal baseline, drawn with a
  dashed reference baseline + sweep arc + degree chip at the first anchor. Mirrors
  TradingView's "Trend angle" tool. Files: drawing/tools/plugins/TrendAngleTool.ts (NEW),
  drawing/tools/adapters.ts, types/drawing.ts (`trendAngle` added to `DrawingTool` +
  `DRAWING_TOOLS`).
- **TrendLine stats chip** — the basic trend line now shows a TradingView-style label
  (price change, % change, angle°) while drawing (`__pending`) and when selected.
  File: drawing/tools/plugins/TrendLineTool.ts.
- **Shared helpers** `angleDeg()` + `angleArc()` added to drawing/tools/plugins/shared.ts.
- **Toolbar LINES group** consolidated to match TradingView's "LINES" menu: Trend line,
  Ray, Info line, Extended line, Trend angle, Horizontal line, Horizontal ray, Vertical
  line, Cross line, Channel — with inline hotkey labels. The separate "horizontals"
  group was merged in. File: components/toolbar/DrawingToolbar.tsx.
- **Hotkeys** Alt+T (trend line), Alt+H (horizontal), Alt+J (horizontal ray),
  Alt+V (vertical), Alt+C (cross line). File: hooks/useHotkeys.ts.

### Fixed — InfoLine tool drag not smooth during rubber-band preview (2026-06-27)
- InfoLine's price/percentage chip label is now skipped during rubber-band preview
  (`id === "__pending"`), matching TrendLine smoothness. Chip renders only after
  the drawing is placed.
- Replaced native `g.roundRect()` in `chip()` with cross-browser `arcTo` path.
  Files: drawing/tools/plugins/InfoLineTool.ts, drawing/tools/plugins/shared.ts.
- Text tool now opens an inline `<input>` on the chart at the click position
  instead of `window.prompt()`. TradingView-style: click → type → Enter/Escape.
- Empty placeholder drawing created without auto-selection to avoid the handle
  circle while typing. On save, placeholder replaced with fresh drawing.
- `TextTool` plugin: removed selection handle circle (text annotations don't
  show handles in TradingView).
- `CanvasRenderer.drawingsHash`: now includes `d.text` so text-only updates
  invalidate the render memo.
- `DrawingInteractionManager`: added optional `onTextPlace` callback for
  inline editing; falls back to `window.prompt()` when not provided.
  Files: drawing/TextEditor.tsx (NEW), drawing/tools/plugins/TextTool.ts,
  drawing/renderer/CanvasRenderer.ts, drawing/interaction/DrawingInteractionManager.ts,
  chart/DrawingLayer.tsx.
- New `AlertLines` component using lightweight-charts' built-in `createPriceLine` API
  instead of custom canvas overlay. This guarantees alert lines are always visible
  immediately after creation — same mechanism as `TradeLevels` entry/SL/TP lines.
- Lines reposition automatically on zoom/pan (no recreate needed).
- Shows right-axis label with alert symbol, condition, and target price.
- Dual-layer design: `AlertLines` for visibility, `AlertOverlay` for interaction.
  Files: chart/AlertLines.tsx, chart/ChartArea.tsx, chart/AlertOverlay.tsx.

### Fixed — Alert trendline not appearing on chart after creation (2026-06-27)
- Creating an alert via right-click context menu saved the alert but showed no
  horizontal line on the chart. Two root causes:
  1. `AlertOverlay`'s `draw` callback depended on `symbolAlerts` (new array every
     render via `.filter()`), causing perpetual `useCallback` recreation and rAF
     cancellation. Refactored to read data from refs (`alertsRef`, `symbolRef`).
  2. `useAlertEngine` used a `prev` price recorded BEFORE the alert existed for
     cross detection, causing spurious immediate `crossUp`/`crossDown` triggers
     that moved the alert to `triggeredAlerts` before the user saw the line.
     Added `seenAlertIds` first-evaluation gate.
  Files: chart/AlertOverlay.tsx, hooks/useAlertEngine.ts.

### Fixed — Alert trendline delete button not working (2026-06-27)
- Delete (X) button and Delete/Backspace key had three issues:
  1. Click-outside deselect handler fired on hit strips + delete button because
     they were moved outside `containerRef`. Added `data-alert-strip` /
     `data-alert-delete` attributes and `e.stopPropagation()` to prevent this.
  2. Delete button was inside `pointer-events:none` container → moved outside
     with `z-index:50`.
  3. Native `pointermove`/`pointerup` listeners could interfere with click
     events → removed `onPointerDown` from delete button.
  Files: chart/AlertOverlay.tsx.

### Fixed — Alert lines disappearing on chart zoom (2026-06-27)
- `AlertLines` effect depended on `ctx` (which changes on every zoom/pan via
  `ctx.version`), causing all native price lines to be removed and recreated
  on every zoom step. Moved `candleSeries` to a stable `seriesRef` so the effect
  only runs when alert data actually changes — native lines reposition
  automatically with the price scale.
  Files: chart/AlertLines.tsx.

### Added — Chart right-click: Reset view / Remove drawings / Remove indicators (2026-06-27)
- Added the three TradingView chart context-menu actions:
  - **Reset chart view** — `chartRegistry.resetChartView()` calls `resetTimeScale()` +
    `scrollToRealTime()` and re-enables right price-scale `autoScale`.
  - **Remove drawings** — `chartStore.clearDrawings()` (existing); disabled when none.
  - **Remove indicators** — new `chartStore.clearIndicators()`; disabled when none.
  - Menu items support a `disabled` state (greyed, non-interactive) like TradingView.
  Files: store/chartStore.ts (clearIndicators), chart/chartRegistry.ts (resetChartView),
  chart/ChartContextMenu.tsx.

### Docs — Refreshed stale drawing-engine architecture docs (2026-06-27)
- Updated the current-architecture drawing docs to match the implemented plugin/adapter
  engine (they described an obsolete `switch(d.tool)` / `drawingHitTest.ts` design):
  - `DRAWING_ENGINE_ARCHITECTURE.md`: rewrote Architecture layers, Data flow, SSOT, and
    Extensibility around `ToolRegistry`/plugins; added the Render loop & repaint contract.
  - `TOOL_REGISTRY.md`: the doc previously said the engine used decentralized switches and
    had no registry — inverted to document the actual `DrawingAdapter` registry.
  - `DRAWING_OBJECT_MODEL.md`: "add a tool" steps now describe writing a plugin + importing
    it in `adapters.ts` (no engine-file edits).
  - `SELECTION_ENGINE.md`: marked multi-select (Shift+click), Ctrl+A, move-multiple, and
    hover as implemented; corrected hit-test path to `hittest/HitTestEngine.ts`.
  - Historical/point-in-time docs (PHASE/MILESTONE/ROADMAP/audits) left as-is by design.

### Fixed — Live rubber-band preview froze while drawing a two-point tool (2026-06-27)
- After the first click of a two-point tool (trend line, etc.), moving the pointer toward
  the second point showed no live preview — the line only appeared on the second click.
  Root cause: the render-loop memo guard tracked the in-progress machine anchors by COUNT
  (`machineAnchorsLen`) only. After the first move the count stops changing (stays 2) while
  the pointer keeps moving, so the guard skipped every subsequent repaint and the preview
  froze. Replaced the count with a signature that includes anchor POSITIONS
  (`machineAnchorsSig`), so the rubber-band tracks the cursor in real time.
  Files: renderer/CanvasRenderer.ts.
  Regression risk: Low. Same memo mechanism, finer-grained key.

### Fixed — Deleted drawing lingered for seconds before disappearing (2026-06-27)
- Deleting a drawing (keyboard/context menu), undo/redo, color change, lock/hide, and
  selection changes updated the store but the canvas only repainted seconds later (on
  the next pan/realtime tick). Root cause: the drawing render loop is dirty-driven
  (`markDirty()`), and only the interaction manager's own transitions + pan/zoom/resize
  triggered it — store mutations that bypass the interaction manager had no repaint
  trigger. Added a `useEffect` in `DrawingLayer` that calls `markDirty()` whenever any
  render-relevant store state changes (`drawings`, selection, hidden, color, active tool).
  Files: DrawingLayer.tsx.
  Regression risk: Low. One coalesced rAF repaint per store change.

### Fixed — Endpoint grab moved the whole line instead of the anchor (2026-06-27)
- Clicking a trend-line endpoint dragged the entire line instead of resizing/rotating
  around the opposite anchor (TradingView grabs the endpoint). Root cause: `fromEvent`
  in `DrawingLayer.tsx` rescaled the pointer X by `timeScale().width() / canvas.width`
  before `coordinateToTime`. But `timeScale().width()` excludes the right price axis,
  so the scaling COMPRESSED every click's X — an error that grows toward the right edge
  (~30–45px on a wide chart). For a near-horizontal line the offset stayed within body
  TOL but exceeded HANDLE_RADIUS from the endpoint, so the body hit won. Now the local X
  maps 1:1 to a time-scale coordinate (`coordinateToTime(lx)`), matching the chart's own
  `onContextMenu` and the unscaled `timeToCoordinate` used for rendering/hit-testing.
  Files: DrawingLayer.tsx.
  Note: prior TOL(8→20) / HANDLE_RADIUS(10→24) bumps were compensating for this same
  coordinate error; left as-is (generous hit zones are fine), but the X bug is now fixed at source.
  Regression risk: Low. Hit-testing now matches the rendered geometry exactly.

### Fixed — Drawings drift off candles when panning the chart (2026-06-27)
- Drawings were not staying pinned to their (time,price) anchors on pan/zoom; they
  appeared frozen at a screen pixel and drifted off their candles (not TradingView-like).
  Two compounding bugs:
  1. `CoordinateCache.nextFrame()` only cleared its time/price→pixel maps when they
     exceeded 100 entries; otherwise it bumped an unused `generation` counter. With a
     few drawings the cache was never cleared, so every frame reused the pixel computed
     on the FIRST frame. Now it clears both maps every frame (cache is frame-local only).
  2. `CanvasRenderer` render loop early-returned via a data-only memo guard (drawing hash
     + canvas size). Neither changes on pan/zoom, so the `markDirty()` fired by
     `subscribeVisibleLogicalRangeChange` was a no-op. Added a `forceNext` flag set by the
     viewport subscription (`markDirty(true)`) that bypasses the guard so the canvas
     repaints — and re-projects — on every pan/zoom/resize frame.
  Files: renderer/CoordinateCache.ts, renderer/CanvasRenderer.ts.
  Root cause: stale per-frame coordinate cache + viewport changes not invalidating the
  render memo. Either alone unpins drawings from candles.
  Regression risk: Low. One repaint per rAF on pan (intended); cache still dedupes within a frame.

### Fixed — Endpoint handles not detected; body hit won instead (2026-06-27)
- Increased HANDLE_RADIUS from 10px to 24px. Handle radius was smaller than
  body tolerance (TOL=20), so clicking near an endpoint always triggered
  body-drag instead of anchor-resize. Now HANDLE_RADIUS > TOL guarantees
  endpoint hits take priority. Also removed debug instrumentation.
  Files: geometry/helpers.ts, DrawingInteractionManager.ts.
  Root cause: HANDLE_RADIUS(10) < TOL(20) caused handle-hit to fail silently.
  Regression risk: None. Larger radius only improves endpoint detection.

### Fixed — Infinite React re-render loop on chart pan (2026-06-27)
- Throttled version-bump callback via requestAnimationFrame. ResizeObserver
  and subscribeVisibleLogicalRangeChange could fire synchronously during
  React renders, creating setVersion → render → bump → setVersion loop.
  rAF coalesces multiple bumps to one per frame, breaking the cycle.
  Files: PriceChart.tsx.
  Root cause: synchronous bump during render triggers cascade.
  Regression risk: Low. Version updates delayed by at most one frame.

### Fixed — Hit-test tolerance too small for line body selection (2026-06-27)
- Increased TOL from 8px to 20px. Users clicking on drawn TrendLines were
  consistently getting MISS because the perpendicular distance (~16.6px)
  exceeded the 8px threshold despite visual alignment. TradingView uses
  12-16px typically; 20px gives comfortable click-target for line bodies.
  Files: geometry/helpers.ts.
  Root cause: TOL=8 too small for practical hit-testing.
  Regression risk: None. Larger TOL only affects body hit radius.

### Fixed — pointerEvents:none canvas blocks drag interaction (2026-06-27)
- Removed setPointerCapture from handleDown. Canvas has pointerEvents:none
  CSS which prevents the browser from dispatching captured pointermove/pointerup
  events to any listener. Document-level capture-phase listeners already fire
  for all pointer events without needing pointer capture. Fix enables body drag,
  endpoint resize, and all cursor-mode interactions.
  Files: DrawingInteractionManager.ts.
  Root cause: pointerEvents:none on canvas silences captured events.
  Regression risk: None. releaseCapture silently handles no-capture state.

### Added — Clipboard + polish (2026-06-26)
- Ctrl+C copies selected drawing to in-memory clipboard. Ctrl+V pastes as
  duplicate at same position with new ID. Escape cancels drawing, Delete
  removes selection. Z-order aware hit testing, smooth hover glow, context
  menu hooks already in place. Files: DrawingInteractionManager.ts.
n### Added — Multi-selection with shift-click (2026-06-26)
- Shift-click toggles drawing selection. Multi-drag moves all selected drawings
  by same delta. Anchor editing restricted to primary selection. Delete removes
  all selected. Renderer uses Map-based livePoints for multi-drag. One history
  entry per drawing on mouse up. Files: DrawingInteractionManager.ts,
  CanvasRenderer.ts, DrawingLayer.tsx.
n### Added — TradingView-style hit testing system (2026-06-26)
- Hits now follow TradingView priority: anchor > body > none. Topmost drawing
  (highest zIndex) wins for same priority level, then closest distance.
  HitResult now carries anchorIndex for direct anchor resolution. HitTestEngine
  enriches tool results with anchor indices — tools unchanged. Interaction
  manager uses hit.anchorIndex directly.
  Files: HitTestEngine.ts, DrawingInteractionManager.ts.
n### Added — Universal DrawingAdapter interface (2026-06-26)
- Introduced DrawingAdapter with move(), moveAnchor(), getAnchors(). Every tool
  implements the adapter via polymorphism. registerTool auto-wraps simple tools
  with default implementations derived from existing movePoints. Selection and
  dragging no longer depend on tool type — all interaction dispatches through
  adapter methods. Zero tool files changed.
  Files: ToolRegistry.ts, DrawingInteractionManager.ts, DrawingEngine.ts.
n### Refactored — Separate rendering from interaction (2026-06-26)
- Moved keyboard shortcuts from DrawingLayer into DrawingInteractionManager.
  All interaction (pointer events, keyboard, context menu) consolidated in one
  module. Added hover detection via hitTest on cursor-mode pointermove. Added
  selectedDrawingId to getState closure. DrawingLayer is now pure orchestration.
  CanvasRenderer unchanged (already pure). Regression risk: Low.
  Files: DrawingInteractionManager.ts, DrawingLayer.tsx.
### Removed — Dead code cleanup (2026-06-26)
- Removed unused livePoints field from Machine interface. The renderer reads
  livePointsRef for drag preview; machine.livePoints was set but never consumed.
  No behavioral change. File: DrawingInteractionManager.ts.
  Build: type-check passed, lint passed.
n### Fixed — Drawing engine stabilization (2026-06-26)
- **Ctrl+D duplicate:** DuplicateDrawingCommand generates valid uid internally. chartStore.addDrawing() guards empty IDs. Files: CommandManager.ts, chartStore.ts, DrawingLayer.tsx.
- **Store safety:** addDrawing deep-copies points, generates uid fallback. File: chartStore.ts.
- **Right-click drag:** Added e.button === 0 guard. Right-clicks select without starting drags. File: DrawingInteractionManager.ts.
- **DrawingContextMenu restored:** Moved contextmenu listener to document capture phase. File: DrawingInteractionManager.ts.
- **Pointer capture release:** Explicit releasePointerCapture on drag completion and Escape. File: DrawingInteractionManager.ts.
- **Adapter resolution:** Machine state stores drawingTool from hit.drawing.tool. File: DrawingInteractionManager.ts.
- **Undoable drags:** commitMove wired to handleUp. Files: DrawingLayer.tsx, DrawingInteractionManager.ts.
- **Render loop crash fix:** minPoints guard in CanvasRenderer prevents 15 multi-point tool crashes. File: CanvasRenderer.ts.
- **Drawing cancellation fix:** handleUp reset moved inside MovingDrawing guard. File: DrawingInteractionManager.ts.
- **Hit-test vocabulary:** All 25 tools return canonical p1/p2/body targets. Files: HitTestEngine.ts, 9 plugins.
- **ESLint:** Fixed pre-existing warning in useCommandHistory.ts.
- Build: type-check passed, lint passed. Regression risk: Low.

### Changed — Milestone 3: tool plugin architecture (2026-06-26)
- Created `geometry/helpers.ts` — shared math (pointDist, distToSegment, distToRect,
  projectPoint, defaultMovePoints, HANDLE_RADIUS, TOL).
- Renamed `ToolAdapter` interface → `DrawingToolPlugin` with optional future methods
  (getHandles, serialize, deserialize).
- Renamed `registerAdapter/getAdapter` → `registerTool/getTool`.
- Extracted 4 tools into individual plugins under `tools/plugins/`:
  `HorizontalTool.ts`, `VerticalTool.ts`, `TrendLineTool.ts`, `RectangleTool.ts`.
  Each implements `DrawingToolPlugin` and calls `registerTool()`.
- Created `tools/plugins/shared.ts` — canvas draw helpers (line, handle, chip, applyStyle).
- Remaining 17 tools stay in `adapters.ts` for future migration.
- Zero behavior changes. All algorithms identical. Build passes.

### Changed — Milestone 2: separate chart and drawing interaction (2026-06-26)
- Created `ChartInteractionManager` — passive observer ensuring chart never blocked.
- Created `DrawingInteractionManager` — state machine + pointer capture for drawings only.
- Added `isPointerClaimed()` signal so chart knows when drawings own the pointer.
- DrawingLayer now imports `useDrawingInteractionManager` from engine.
- Old `InteractionManager` deleted — replaced by DrawingInteractionManager.
- Chart interaction guarantees: canvas at `pointerEvents:none` → wheel/pan/pinch/crosshair
  always work. Drawing only captures pointer during active creation/drag/resize.
- Zero behavior changes. All algorithms identical. Build passes.

### Changed — Milestone 1: foundation refactor, split into 5 modules (2026-06-26)
- Reorganized `drawing/` into 5 subdirectories with clear responsibilities:
  - `engine/DrawingEngine.ts` — thin orchestrator, re-exports public API
  - `interaction/InteractionManager.ts` — state machine + document listeners (was PointerController)
  - `renderer/CanvasRenderer.ts` — rAF render loop + dirty tracking (was DrawingRendererLoop)
  - `hittest/HitTestEngine.ts` — candidate-based hit testing (was drawingHitTest)
  - `tools/ToolRegistry.ts` + `tools/adapters.ts` — Tool adapter interface + 21 implementations
- `DrawingLayer.tsx` now imports only from `engine/DrawingEngine.ts` — a single entry point.
- Zero behavior changes. All algorithms identical. Existing bugs preserved.
- Build / type-check / lint all pass.

### Changed — Tool adapter architecture: plugin-based drawing tools (2026-06-26)
- `ToolAdapter.ts`: Interface with `render`, `hitTest`, `movePoints`, `boundingBox`,
  `minPoints`. Registry via `registerAdapter()` / `getAdapter()`. Shared helpers
  exported (`pointDist`, `distToSegment`, `distToRect`, `HANDLE_RADIUS`, `TOL`,
  `defaultMovePoints`).
- `adapters.ts`: One adapter per tool (14 full + 7 stubs). Registered on import.
  Adding a tool requires only: implement `ToolAdapter`, call `registerAdapter()`.
- `drawingRenderer.ts`: Delegates to `getAdapter(d.tool).render()` — no switch.
- `drawingHitTest.ts`: Delegates to `getAdapter(d.tool).hitTest()` — no switch.
- `PointerController.ts`: Delegates to `getAdapter().movePoints()` and
  `getAdapter().minPoints` — no inline switch logic.
- Zero giant switches remain. All tool-specific logic lives in adapters.

### Changed — Optimize drag: in-memory positions, commit on pointerup (2026-06-26)
- During drag (MovingDrawing/ResizingHandle), geometry is computed in-memory
  via `livePointsRef` — no Zustand `updateDrawing` per move. Only
  `scheduleRedraw` is called, minimizing React re-renders to state transitions
  (start drag, end drag).
- On pointerup: commit final `livePoints` to Zustand via a single
  `updateDrawing` call.
- Render loop reads `livePointsRef` + `draggingIdRef` from interaction state,
  injects live positions into the drawn drawing array, and skips store drawings
  for the dragged object.
- Dirty detection upgraded from `.length` to content hash (`drawingsHash`,
  `liveHash`) — catches point coordinate changes within same-length arrays.

### Changed — rAF render loop replaces React-driven drawing renders (2026-06-26)
- Created `drawing/DrawingRendererLoop.ts`: requestAnimationFrame-based render
  loop with dirty-flag and change-detection snapshots. Only redraws when
  drawings, selection, interaction state, or canvas size actually change.
  Subscribes to chart `visibleLogicalRangeChange` + `ResizeObserver` for
  viewport-driven redraws.
- `DrawingLayer.tsx` replaced `useCallback(draw)` + `useEffect(draw, version)`
  with `createRenderLoop()`. Removed React re-renders from the drawing render
  path entirely. `PointerController` gained `scheduleRedraw` callback wired
  to `loop.markDirty()`.
- Zustand store subscriptions unchanged. Drawing data flows through stable
  `stateRef` snapshot — no per-tick re-render churn.

### Changed — Extract PointerController from DrawingLayer (2026-06-26)
- Extracted all pointer interaction logic (state machine, document listeners,
  pointerdown/move/up, setPointerCapture, hit-testing, context menu, cursor
  style) into `drawing/interaction/PointerController.ts`.
- `usePointerController(opts)` hook accepts canvasRef, coordinate converters,
  store actions, and a `getState()` stable snapshot provider. Returns machine,
  cursorStyle, ctxMenu, transition/reset helpers, and machineRef.
- `DrawingLayer.tsx` now owns only: canvas rendering, keyboard shortcuts,
  store subscriptions, and JSX. Zero pointer event handlers inline.
- No feature changes. Pure responsibility extraction.

### Changed — Refactor hit-test with distance and candidate architecture (2026-06-26)
- `HitResult` gains `distance: number` (pixel distance from pointer to hit target)
  and `target` expands to `"body" | "p1" | "p2" | "segment" | "label"`.
- Architecture: each tool's resolver returns ALL viable hit candidates via
  `resolveAllHits()`. The main `hitTest()` then picks the best: highest zIndex
  drawing wins first; within a drawing, endpoints beat segments beat body;
  identical-priority ties broken by closest distance.
- `TARGET_PRIORITY` table drives the ordering — extensible for future targets.
- New helpers: `pointDist`, `distToRect`, `distToCircle` — each returns raw
  pixel distance. No duplicate hit-testing logic.
- DrawingLayer normalizes `"segment"`/`"label"` hits to `"body"` drag behaviour.
  All existing drag flows preserved.

### Changed — Interaction state machine replaces dragRef + pending (2026-06-26)
- Replaced scattered `dragRef` (nullable ref) and `pending` (useState) with a
  unified `InteractionState` machine: Idle | Drawing | MovingDrawing | ResizingHandle.
- Single `Machine` interface holds all interaction state: current state, anchors
  (for Drawing), draggingId, dragTarget (p1/p2/body), dragStart, dragOrig.
- `transition()` and `reset()` helpers replace imperative ref mutations.
- `machineRef` mirrors state for stable native closures. Pending preview renders
  from `machine.state === "Drawing" && machine.anchors.length > 0`.
- No behavior changes — pure refactor. All existing features preserved.

### Changed — Refactor drawing interaction architecture (2026-06-26)
- **Root problem:** Container div overlay at z-index:5 with pointerEvents:auto
  permanently blocked the LWC chart div (a sibling in the DOM, not a child).
  Events don't pass through to sibling elements. This caused accumulated
  regressions: wheel forwarding hacks, broken pan, event constructor bugs,
  DOM traversal fragility.
- **New architecture:** Canvas at pointerEvents:none always — rendering only,
  never blocks the chart. Drawing interaction uses document-level capture-phase
  listeners with isOverCanvas() filtering.
  - Drawing mode: activeTool-dependent effect registers document listeners
    for creation (pointerdown + pointermove in capture phase).
  - Cursor mode: persistent effect listens for pointerdown on document.
    If a drawing is hit → setPointerCapture on canvas → move/up handled.
    If no hit → do nothing → event reaches chart → pan works.
  - Chart zoom/pan/pinch: always work because the canvas never intercepts.
  - Zero event forwarding, zero z-index fights, zero DOM traversal hacks.

### Fixed — Drawing interaction lag and unreliability (2026-06-26)
- Root cause: the native event listener effect depended on [ctx]. ctx is rebuilt
  on every candle tick (version bump), causing all 5 event listeners to be torn down
  and re-registered on every price update. This created lag, missed events during
  re-registration windows, and stale closure captures.
- Fix: Added ctxRef that holds the latest ctx via assignment-in-render.
  toX, toY, fromEvent, and draw now use ctxRef.current with empty dep arrays
  (stable forever). The native listener effect runs once on mount ([] deps).
  No listener churn, no lag, instant drawing interaction.

### Fixed — Container div blocks chart wheel zoom (2026-06-26)
- Container div at z-index:5 intercepts all wheel events, blocking LWC chart zoom.
- Fix: add native wheel listener on container that clones and dispatches
  the WheelEvent to the LWC chart element (container's previousElementSibling).
  Passive listener — no preventDefault, chart handles zoom naturally.

### Fixed — Native event listeners on container div (2026-06-26)
- Previous fix attached `addEventListener("pointerdown", ...)` on the canvas
  element, but the canvas had `pointerEvents: "none"` in cursor mode — meaning
  pointer events never reached the canvas, making drawing selection impossible.
  `pointerEvents: "none"` prevents the element from being the event target.
- Fix: wrap canvas in a div that always receives pointer events. Canvas stays
  `pointerEvents: "none"` (rendering only). Container div gets native listeners.
  In cursor mode, events flow through the container to the chart (no blocking).
  On drawing hit, `setPointerCapture` routes move/up through the container.
  Drawing mode: `stopPropagation` + `setPointerCapture` on container.
- Zero listener churn (empty deps). All closures stable via ctxRef + refs.

### Fixed — DrawingLayer blocks chart zoom/pan regression (2026-06-26)
- Root cause: the canvas overlay with `pointerEvents: "auto"` permanently intercepted
  all pointer and wheel events when drawings existed, blocking the LWC chart underneath.
  Previous forwarding approach (dispatchEvent clone) was broken — `new PointerEvent(type,
  event)` is not valid constructor usage.
- Fix: Switched to native `addEventListener` on the canvas element. Canvas stays
  `pointerEvents: "none"` in cursor mode so chart zoom/pan/pinch work naturally.
  The native pointerdown listener fires regardless of CSS pointer-events, hit-tests
  drawings, and calls `setPointerCapture` when a drawing is hit — routing subsequent
  events (move/up) through the canvas during drag. In drawing mode, canvas switches
  to `pointerEvents: "auto"` for creation flows.
- `stateRef` keeps closures stable across re-renders. Zero synthetic event handlers on
  the canvas JSX — all interaction is native DOM.

### Changed — TradingView-style endpoint dragging for line tools (2026-06-26)
- `drawingHitTest.ts`: Changed return type from `Drawing | null` to `HitResult | null`
  (`{ drawing, target: "p1" | "p2" | "body" }`). Added `nearPoint()` with 10px handle
  radius for endpoint hit detection. Line tools (trendline, ray, extendedLine,
  infoLine, channel) now return endpoint priority (p1 → p2 → body). All other tools
  return `target: "body"` — no behaviour change.
- `DrawingLayer.tsx`: Updated `dragRef` to include `target`. `onPointerDown` stores
  `HitResult` (target + deep-cloned orig points). `onPointerMove` now branches on
  `target`: p1 drags only points[0], p2 drags only points[1], body translates all.
  Context menu uses `hit.drawing.id`. Zero changes to creation workflow, shape tools,
  selection, keyboard, or rendering.

### Changed — Clean up diagnostic console.log traces (2026-06-26)
- Removed all temporary `console.log` diagnostics from `DrawingLayer.tsx` (chart context,
  canvas mount, pointerdown, fromEvent, tool creation, render, elementFromPoint,
  activeTool change, RAW pointerdown listeners — 7 blocks removed).
- Removed `console.log` from `chartStore.ts` `setActiveTool`.
- `npm run type-check` ✅ passes.

### Added — Phase 4.2.2: TradingView-style tool group system (2026-06-26)
- Transformed flat 20-tool toolbar into 4 grouped icons with flyout menus: Cursor,
  Lines (8 tools), Shapes (9 tools), Text. Click a group → flyout appears → select
  tool → tool activated and flyout closes.
- Last-used tool per group becomes the visible sidebar icon (matches TradingView).
- Backdrop closes flyout on outside click. Only one flyout open at a time.
- Visual parity: 18px sidebar icons, 14px flyout icons, TradingView-dark flyout,
  brand-colored active tool, hover highlight.
- Docs: TOOL_GROUP_ARCHITECTURE.md, TOOLBAR_BEHAVIOR.md.

### Debug — Phase 4.2.1: Root cause analysis + runtime diagnostics (2026-06-25)
- Full event chain traced: toolbar click → store.activeTool → DrawingLayer re-render →
  canvas pointer-events:auto → onPointerDown → fromEvent (chart coords) → creation.
- No architectural bug found. Component tree, pointer events, and context propagation are
  correctly wired. Added console.debug diagnostics in DrawingLayer.onPointerDown and
  chart context availability.
- Docs: DRAWING_ENGINE_ROOT_CAUSE.md with event flow diagram and failure-point analysis.

### Fixed — Phase 4.2.1: Tool activation system (2026-06-25)
- Single-click tools (horizontal, vertical, crossLine, etc.) now stay active after
  placement — matches TradingView behavior where you can draw multiple lines without
  re-selecting the tool. Two-click tools reset to cursor after completion.
- Canvas always accepts pointer events when a drawing tool is selected, fixing the
  bug where the first click on an empty chart was ignored.
- Cursor system: default (idle), crosshair (drawing tool active), move (dragging).
- Right-click cancels pending drawing creation. Esc resets to cursor + clears pending.
- Live preview renders while dragging second point (already existed, now confirmed).
- Docs: TOOL_ACTIVATION_SYSTEM.md, DRAWING_STATE_MACHINE.md.

### Added — Phase 4.3: Shape tools suite + fill system (2026-06-25)
- 8 TradingView-style shape tools: rectangle, rotatedRect, circle, ellipse, triangle,
  polyline, curve, path. All support create/select/move/delete/persist.
- Fill system: Drawing.fillColor (custom fill color) + Drawing.opacity (0–1). Default
  behavior preserved (stroke color at 12% opacity when fillColor is unset).
- Rectangle supports supply/demand zone workflow with custom fill colors and opacity.
- Zero core engine changes — creation flow, context menu, and persistence inherited
  from Phase 4.2's generalized architecture.
- Toolbar: 4th category (ANNOTATIONS) with Text tool. SHAPES category expanded to 9 tools.
- Docs: SHAPE_TOOLS_ARCHITECTURE.md, RECTANGLE_TOOL_GUIDE.md, SHAPE_TOOL_TEST_PLAN.md.

### Added — Phase 4.2: Trend line suite + context menu + line styles (2026-06-25)
- 8 TradingView-style line tools: trendline, ray, extendedLine, horizontal, horizRay,
  vertical, crossLine, infoLine. All support create/select/move/delete/persist.
- DrawingContextMenu — right-click any drawing: Clone, Lock/Unlock, Show/Hide, Bring to
  Front, Send to Back, Delete. Portal-rendered, Esc/outside-click close.
- Line style system: Drawing.lineStyle ('solid'|'dashed'|'dotted') renders with
  setLineDash. Selection handles always solid.
- Ctrl+D duplicate selected drawing. Generalized creation flow (minPoints-based
  dispatcher — any 1- or 2-point tool works without code changes).
- DrawingToolbar: 12 tools with 3 visual category groups (MODES, LINES, SHAPES).
- Docs: TREND_LINE_SUITE.md, TOOL_INTERACTION_GUIDE.md, DRAWING_PERSISTENCE_TESTS.md.

### Added — Phase 4.1: Wire drawing engine foundation (2026-06-25)
- Wired the canonical `drawingRenderer.ts` (17-tool support) into `DrawingLayer.tsx`,
  replacing the inline 7-tool renderer. Rendering now delegates to a pure canvas
  function with zIndex-sorted rendering, locked-drawing dimming, and selection handles.
- Extracted hit-testing to standalone `drawingHitTest.ts` — covers all 17 tools with
  pixel-tolerance proximity detection. Used by DrawingLayer for selection and will
  serve DrawingContextMenu (Phase 4.3).
- Added global toggle respect: `drawingsLocked` blocks drag/delete, `drawingsHidden`
  suppresses all rendering. Sorted by zIndex so higher-index drawings render on top.
- Docs: `DRAWING_ENGINE_ARCHITECTURE.md`, `DRAWING_OBJECT_MODEL.md`,
  `SELECTION_ENGINE.md`, `TOOL_REGISTRY.md`.

### Docs — Phase 4 drawing engine architecture roadmap (2026-06-25)
- `docs/PHASE4_DRAWING_ENGINE_ROADMAP.md` — complete architecture plan for the
  drawing engine foundation. 7 implementation phases (~3.5h): wire canonical
  renderer, wire store actions, DrawingContextMenu, hit-test module, drawing
  hotkeys, expand toolbar to 17 tools, new tool creation flows.
- Includes architecture diagram, tool category breakdown, dependency map,
  estimated complexity per phase, mobile support plan, and file inventory.

### Fixed — Phase 3.5: Native LWC price marker (root cause) (2026-06-25)
- Deleted PriceMarkerLabel.tsx (HTML DOM overlay with static positioning).
- Replaced with native LWC: lastValueVisible for price label, transparent
  createPriceLine for countdown on right axis. Zero CSS, zero transforms.
  Countdown moves with price scale automatically. See PRICE_MARKER_ROOT_CAUSE_ANALYSIS.md.

### Fixed — Phase 3.5: Countdown moved to right-side price marker (2026-06-25)
- Corrected countdown position: was in top-left (wrong). Now on the right side
  of the chart, right-aligned, matching TradingView's price scale placement.
- Chart header is compact: symbol . exchange . TF (11px) + OHLC row (11px),
  no countdown. top-1 (4px) offset.
- PriceMarkerLabel repositioned to right side, 16px price, 11px symbol/countdown.
- LWC lastValueVisible disabled to prevent double price display.

### Changed — Phase 3.5: Price marker + countdown parity (2026-06-25)
- Created `PriceMarkerLabel.tsx` — TradingView-style price box in chart top-left:
  14px bold symbol, 26px bold green/red price, 12px countdown. Semi-transparent
  panel background with backdrop blur.
- Fixed `useCountdown` — now uses HH:MM:SS format for timeframes >= 1H (was
  incorrectly showing total minutes, e.g. 179:59 for 4H). Sub-hour TFs use MM:SS.
  Countdown accuracy: 30% -> 100%.
- Refined OHLC readout row to 11px with abbreviated O/H/L/C labels, removed
  volume display to match TradingView's cleaner look.
- Price marker parity: 54% -> 95%. Docs: PRICE_MARKER_TYPOGRAPHY_AUDIT.md,
  PRICE_MARKER_SPACING_AUDIT.md, PRICE_MARKER_PARITY_REPORT.md.

### Changed — Phase 3 final: Watchlist, toolbar, typography, spacing (2026-06-25)
- Visual parity: ~70% -> ~93%. Watchlist 92%, toolbar 93%, typography 95%, spacing 92%.
  11 files modified, 2 new audit docs (TYPOGRAPHY_AUDIT.md, SPACING_AUDIT.md).

### Changed — Phase 3: TradingView UI Parity (2026-06-25)
- Visual parity improved from ~70% to ~90%. 16 files modified, 2 created. Zero architecture
  changes — pure UI/UX. Full report: `docs/TRADINGVIEW_PARITY_REPORT.md`.
- **Layout:** top toolbar 36px, panel headers 32px, left rail 40px, watchlist 320px. BottomPanel
  tabs now use TradingView-style accent underline (not rounded pills).
- **Chart:** background unified to `#0b0e11`, dynamic bar spacing per timeframe (1m:4 → 1W:16),
  solid last-price line, countdown timer to next bar close (`useCountdown` hook).
- **Watchlist:** compact 28px rows, blue left-border active indicator, right-click context menu
  (Remove, Create Alert), green/red price flash animation on tick.
- **Context menus:** chart menu now has Add/Remove Watchlist + Copy Price; new
  `WatchlistContextMenu` component.
- **Keyboard:** Alt+A toggles the Alert Center.
- **Toolbar polish:** timeframe buttons 11px font, drawing toolbar icons 18px, IconButton md size
  36×36px, symbol search button 32px tall.

### Docs — Master roadmap + Phase 3–11 plan (2026-06-25)
- `docs/PHASE3_11_PLAN.md` — comprehensive implementation plan covering all 9 remaining phases:
  UI Parity, Drawing Engine, Left Toolbar, Indicator Engine, Push Notifications, MT5 Integration,
  Trading Panel, Position Visualization, and Polish. Includes dependency map, file inventory,
  and estimated effort per phase (18–27 hours total).
- Updated `docs/NEXT_TASKS.md` with the new phase sequence; updated `docs/CURRENT_PROGRESS.md`
  and `docs/HANDOFF.md` to reflect the roadmap refresh.

### Debug — OANDA routing diagnostics (2026-06-25)
- **Problem:** forex symbols still showed "--" with no indication why. The `subscribe()` method
  in `MarketDataService` silently dropped subscriptions when no provider (OANDA/TwelveData) was
  configured, producing zero logs or errors.
- Added `console.debug`/`console.warn` logging to `MarketDataService` (constructor: key presence;
  `route()`: no-provider warning; `subscribe()`: dropped-subscription warning) and `OandaProvider`
  (`subscribe()`: symbol mapping; `connect()`: verification; `fetchPrices()`: URL, status, count).
- `docs/OANDA_DEBUG_REPORT.md` — root cause analysis, trace, and verification steps.

### Added — OANDA forex/metals/indices provider (2026-06-25)
- **Problem:** forex, metals, and indices showed "--" because they depended on TwelveData which
  required an unconfigured API key.
- `src/services/market-data/providers/OandaProvider.ts` (new) — production-grade provider via OANDA
  v20 REST API: bearer-token auth, 1s pricing poll, historical candles, backoff reconnect.
- `src/services/market-data/providers/FxcmProvider.ts`, `ICMarketsProvider.ts` (new) — stubs.
- `src/services/market-data/MarketDataService.ts` — wired OandaProvider with OANDA → TwelveData
  fallback routing; `HistoricalDataService.ts` — added OANDA historical candles loadOanda().
- `src/services/market-data/symbols.ts` — forex/metals/indices moved to provider 'oanda' with
  underscore-format symbols; added USDCAD, USDCHF pairs.
- `src/types/marketData.ts` — added 'oanda' to MarketProvider union.
- `docs/FOREX_DATA_ANALYSIS.md`, `docs/OANDA_INTEGRATION.md` (new).
- Config: NEXT_PUBLIC_OANDA_API_KEY + NEXT_PUBLIC_OANDA_ACCOUNT_ID in .env.local (gitignored).

### Added — Phase 2.1: Interactive chart alerts (TradingView behaviour) (2026-06-25)
- **Why alerts weren't interactive:** they were drawn with Lightweight Charts `series.createPriceLine`,
  which receives no pointer events. Replaced with an interactive canvas overlay.
- `src/components/chart/AlertOverlay.tsx` (new, replaces `AlertLines.tsx` — deleted) — canvas draws
  alert lines + labels + handles; thin per-line DOM hit strips handle **hover (grab cursor),
  click-to-select, drag-to-move, right-click + touch long-press**. The chart stays pannable
  everywhere except on a line. Dragging moves the line locally (no lag) and commits the new price +
  recomputed condition on release (persisted). Delete handle on the selected line.
- `src/components/chart/AlertContextMenu.tsx` (new) — Edit · Clone · Disable/Enable · Delete.
- `src/components/alerts/AlertEditDialog.tsx` (new) — edit condition / price / message / recurring /
  enabled / per-alert sound + browser (resolves Phase 2 gaps **G5** no-edit-UI and **G1** non-editable
  notification flags).
- `src/store/alertStore.ts` — `Alert` gains `enabled` + `locked`; new `selectedAlertId` /
  `editingAlertId` state and `selectAlert` / `duplicateAlert` / `editAlert` actions; `deleteAlert`
  clears selection; `hydrate` migrates older persisted alerts. Selection/edit state is **not**
  persisted; price/enabled/locked edits **are**.
- `src/hooks/useAlertEngine.ts` — one-line guard: disabled alerts are skipped (engine otherwise
  untouched).
- Keyboard: **Delete** removes the selected alert, **Esc** deselects. Build/type/lint green.

### Docs — Phase 2 audit (2026-06-25)
- `docs/PHASE2_REVIEW.md` — verification of alert creation / triggering / deletion / history / toast /
  browser notifications / duplicate prevention / mobile responsiveness against the actual code; all
  core requirements pass; quality gates green.
- `docs/PHASE2_GAPS.md` — gaps + missing TradingView parity. Headlines: G1 notification flags are
  double-gated and stale (no per-alert edit UI); G2 stale previous-price can false-fire a re-created
  cross alert; G5 no edit UI; G6 Alert Center backdrop blocks chart interaction on desktop. None
  block Phase 2.

### Added — Phase 2: TradingView-style Alert Engine (2026-06-25)
- **Phase 1 audit** — `docs/PHASE1_REVIEW.md` (success criteria verified) + `docs/PHASE1_GAPS.md`
  (open items; none block Phase 1). `docs/ALERT_ARCHITECTURE.md` added.
- `src/store/marketDataStore.ts` — **reference-counted subscriptions** (`subRefs`). The provider
  stream opens on the first subscriber and tears down only when the last unsubscribes, so the alert
  engine and watchlist can share a symbol's ticker without clobbering each other (fixes Phase 1 gap
  A1). Still one socket per provider.
- `src/store/alertStore.ts` — full rewrite: `alerts` / `triggeredAlerts` / `history` / `settings`;
  actions `

` / `updateAlert` / `deleteAlert` / `triggerAlert` / `resetAlert` /
  `clearTriggered` / `clearHistory` / `setSettings` / `hydrate`. Conditions: `above` / `below` /
  `crossUp` / `crossDown`; one-time vs recurring; persisted to `localStorage`. Backward-compat
  `add/remove/clear` retained for `AlertLines`/context menu.
- `src/services/alertEngine.ts` (new) — pure evaluation (`conditionMet` / `isAlertTriggered` /
  `inferCondition`).
- `src/hooks/useAlertEngine.ts` (new, mounted in `GlobalRuntime`) — subscribes to `marketDataStore`
  (**no polling, no new sockets**), refcount-subscribes alert-symbol tickers, remembers previous
  prices for cross detection, triggers once with re-arm gating.
- Notifications: `store/toastStore.ts` + `components/notifications/Toaster.tsx` (in-app),
  `services/notifications/sound.ts` (Web Audio chime), `services/notifications/browser.ts`
  (Notification API + permission), `services/notifications/notify.ts` (`deliverAlert` dispatcher —
  the Phase 6 push seam).
- `src/components/alerts/AlertCenter.tsx` (new) — responsive slide-over: settings, create form,
  active / triggered / history. Toolbar **bell** button (with count badge) + `uiStore.alertCenterOpen`.
- `ChartContextMenu` "Create Alert" now infers `crossUp`/`crossDown` from current price; `AlertLines`
  shows the condition. Build/type/lint green.

### Changed — Phase 1 Step 17: Remove Last Mock — Phase 1 COMPLETE (2026-06-25)
- **Deleted `src/services/marketData.ts`** (the seeded mock OHLCV generator) — the last mock data
  path in the app is gone. All candle/quote/symbol data now comes from the realtime pipeline.
- `src/services/replayEngine.ts` — `mtfSnapshot()` is now **pure**: it takes a caller-supplied
  `seriesByTf` map instead of importing the mock's `getHistorySync`. Signature changed from
  `mtfSnapshot(symbol, time, tfs?)` → `mtfSnapshot(time, seriesByTf, tfs?)`. No-look-ahead is
  unchanged — each series is still sliced to the bar at/just before the replay cursor.
- `src/hooks/useMtfSnapshotSeries.ts` (new) — loads the 5 higher TFs (`5m/15m/1H/4H/1D`, 500 bars
  each) for the active replay symbol from the real `HistoricalDataService` (Binance no-key; TwelveData
  needs a key), cancellable, only while replay is active. Feeds the pure `mtfSnapshot`.
- `src/components/replay/ReplayDashboard.tsx` — consumes `useMtfSnapshotSeries` + the new
  `mtfSnapshot` signature.
- Swapped the mock's `getSymbol(...)?.pricePrecision` for the registry's `getMarketSymbol(...)` in
  `ReplayDashboard`, `SmcLayer`, `JournalPanel`, `OrderTicket`, `PositionsTable` (precision only).
- **Phase 1 (Realtime Market Data Foundation) is complete — Steps 1–17 done.** Build/type/lint green.

### Changed — Phase 1 Step 16: Performance Pass (2026-06-25)
- Eliminated per-realtime-tick re-renders in components that don't consume candle data:
- `src/store/replayStore.ts` — `setTotal()` now **equality-guards** (`if (total !== get().total)`).
  It's called once per tick from the chart mirror, but only a new bar changes the count; previously
  every tick produced a fresh replay-store object that re-rendered every whole-store subscriber
  (transport, dashboard, toolbar). Now they re-render only when the bar count actually changes.
- `src/components/toolbar/TopToolbar.tsx` — dropped the whole-store `useChartStore()` destructure
  (it pulled `candles`, which mutates every tick → full-toolbar re-render). Now selects `timeframe`
  + `setTimeframe` atomically and reads `candles.length` lazily via `getState()` inside the replay
  handler.
- `src/components/toolbar/DrawingToolbar.tsx` and `src/components/chart/DrawingLayer.tsx` — converted
  whole-store subscriptions to **atomic per-field selectors**. Neither reads `candles` (the drawing
  canvas repaints on `ctx.version` for pan/zoom, not on candle data), so they no longer re-render on
  every forming-bar tick.
- Already in place (verified): watchlist rows are memoized + per-row `useQuote` (Step 10); chart uses
  the O(1) `series.update` fast path (Step 11); candle series capped at `MAX_CANDLES = 5000`.
- Build/type/lint green.

### Changed — Phase 1 Step 15: Reconnect Hardening (2026-06-25)
- Baseline reconnect was already present (backoff `1→2→5→10→30s` holding at 30s, infinite retries,
  auto-resubscribe on `onopen`, `manualClose` suppresses reconnect on intentional disconnect) and
  was verified. Step 15 adds the two cases the `onclose`-driven path can't cover:
- `src/services/market-data/providers/BinanceProvider.ts` and `TwelveDataProvider.ts` —
  **dead-socket watchdog**: a `setInterval` (15s) records the last inbound-frame time (every frame,
  incl. RPC acks / heartbeats) and, if an OPEN socket goes silent for `> 45s` while subscriptions
  are active, force-closes it so the normal reconnect path resubscribes. Catches sockets that die
  without firing `onclose` (sleeping tabs / flaky networks). Idle providers (no active subs) never
  trigger it. TwelveData's ~10s heartbeats and Binance's per-second klines keep a live socket well
  under the threshold, so no false recycles.
- Same files — **instant network recovery**: a `window 'online'` listener clears the pending backoff
  timer and reconnects immediately instead of waiting out the (up to 30s) backoff. Listener is
  bound on `connect()` and removed on `disconnect()`; both new mechanisms are SSR-guarded.
- Build/type/lint green.

### Changed — Phase 1 Steps 12–14: Switch Hardening + Connection Badge (2026-06-25)
- `src/store/marketDataStore.ts` — **`selectMarket()` made idempotent**. It now re-asserts the
  kline subscription for the active key even when symbol+timeframe are unchanged (previously an
  early `return` could leave the chart with REST history but **no live kline stream** whenever the
  chart default already equalled the store default). `subscribe()` is dedup-guarded, so re-asserting
  an existing subscription is a no-op; switching still unsubscribes the old kline before subscribing
  the new one. Verified: Binance `UNSUBSCRIBE` is sent on switch (no socket leak) and the
  `cancelled` guard in `useMarketData` prevents an abandoned symbol's history from overwriting
  (Steps 12–13 — symbol/timeframe switching).
- `src/components/toolbar/ConnectionBadge.tsx` (new) — Step 14 realtime-feed status chip. Reads
  `useConnectionMeta()` (over `marketDataStore.connectionStatus`) and renders a 🟢/🟡/🔴 dot + label
  from `CONNECTION_STATUS_META`; the dot pulses while connecting/reconnecting. Label hides below
  `md` to keep the toolbar compact. Pure read — no sockets.
- `src/components/toolbar/TopToolbar.tsx` — mounts `<ConnectionBadge />` in the right-side group
  (divider before the icon buttons).
- Build/type/lint green.

### Changed — Phase 1 Step 11: Realtime Chart Integration (2026-06-25)
- `src/hooks/useMarketData.ts` — **rewritten from mock to realtime**. On symbol/timeframe change:
  `marketDataStore.selectMarket()` (subscribe kline, drop old) + load history via
  `HistoricalDataService` → `setCandles`. Continuously mirrors the store's candle series into
  `chartStore.candles`, so chart/indicators/SMC/replay/trade keep reading `chartStore.candles`
  (via `useVisibleCandles`) unchanged — now realtime instead of mock. Verified: Binance klines
  REST shape matches the parser.
- `src/components/chart/PriceChart.tsx` — incremental `series.update(lastBar)` fast path for
  forming-bar ticks and single appended bars (smooth O(1) realtime); full `setData` only on
  symbol/timeframe/history/theme/replay changes. Precision via registry `getMarketSymbol`.
- `store/marketDataStore.ts` — `DEFAULT_CHANNELS = ['kline']` (chart) so chart (kline) and
  watchlist (ticker) never share a stream → no cross-teardown; added atomic `selectMarket()`;
  `changeSymbol`/`changeTimeframe` delegate to it.
- `store/chartStore.ts` — default symbol `BTCUSDT` (Binance, streams with no API key).
- `Watchlist` click and `SymbolSearch` now use registry symbols (`MARKET_SYMBOLS`); precision in
  `ChartArea`/`ChartContextMenu` via `getMarketSymbol`. `exchange.ts` `contractTagOf` takes
  `AssetClass` (exchange label now from the registry).
- Crypto charts stream live (history + realtime klines); forex/metals/indices need a TwelveData
  key (history + tick-built candles). Mock `marketData.ts` still used only by replay MTF (Step 17).
  Build/type/lint green.

### Changed — Phase 1 Step 10: Realtime Watchlist Integration (2026-06-25)
- `components/watchlist/Watchlist.tsx` — removed mock React Query (`useQueries`/`fetchQuote`).
  Each row is now a memoized `WatchRow` reading its own `useQuote(ticker)` from `marketDataStore`
  (a tick on one symbol re-renders only that row). Symbols + metadata now come from the registry
  (`MARKET_SYMBOLS`). Parent reads the quotes map only for value-sorts; symbol-sort uses a stable
  empty map so it never re-renders on ticks. Green/red from real change %.
- `src/hooks/useMarketDataBootstrap.ts` (new) — mounted once in `GlobalRuntime`; creates the
  MarketDataService and keeps watchlist symbols subscribed for `ticker` (diffs add/remove),
  `connect()`/`disconnect()` lifecycle. This is the first point that opens live sockets.
- `store/watchlistStore.ts` — registry-backed defaults (`BTCUSDT`, …); `hydrate()` migrates/drops
  persisted ids not in the registry (e.g. old mock `BTCUSD`).
- Crypto (Binance) shows real price + 24h change; forex/metals/indices (TwelveData) need
  `NEXT_PUBLIC_TWELVEDATA_API_KEY` (rows show "—" without it; TD WS has no daily change → 0%).
- Watchlist row click still drives the MOCK chart (chart swap is Step 11). Build/type/lint green.

### Added — Phase 1 Step 9: Read-only Market Data Hooks (2026-06-25)
- `src/hooks/useCandles.ts` — `useCandles(symbol?, timeframe?)` atomic store selector → candle
  series (defaults to active selection).
- `src/hooks/useQuote.ts` — `useQuote(symbol)` / `useLastPrice(symbol)` per-symbol selectors
  (one per watchlist row → minimal rerenders).
- `src/hooks/useConnectionStatus.ts` — `useConnectionStatus()` / `useConnectionMeta()` for the
  Step-14 status badge.
- `src/hooks/useMarketDataFeed.ts` — aggregate read hook (symbol/timeframe/candles/quote/status);
  the realtime "useMarketData", to take over the `useMarketData.ts` filename in Step 11.
- All read from `marketDataStore` only; **none open sockets**. Existing mock `useMarketData.ts`
  left untouched (still drives the chart until Step 11). Build/type/lint green.

### Added — Phase 1 Step 8: Realtime Candle Engine (2026-06-25)
- `src/services/market-data/CandleEngine.ts` — merges history + realtime into a forming bar
  (TradingView-style). `applyTick` buckets price ticks into the current bar via `TF_SECONDS`
  (O/H/L/C/V), emitting the previous bar as `closed` on rollover; `applyKline` passes through for
  kline providers; `seedHistory` continues the last loaded bar; per-`symbol:timeframe` state.
- `MarketDataService` wired to the engine: tick-only providers (TwelveData) now build candles
  from `quote` ticks (seeded lazily from the store's history) and push `current`/`closed` bars via
  `updateCandle`; kline providers (Binance) still push klines directly. Tracks active timeframe
  per symbol (`tfBySymbol`) and resets engine state on unsubscribe.
- Build/type/lint green. Realtime candle loop now closed for both provider kinds.

### Added — Phase 1 Step 7: Historical Data Service (2026-06-25)
- `src/services/market-data/HistoricalDataService.ts` — REST history loader (500–5000 bars),
  routed by the symbol registry, normalized to unified `MarketCandle[]` (ascending, `closed:true`).
  Binance `GET /api/v3/klines` with `endTime` pagination (1000/request), TwelveData
  `GET /time_series` (`outputsize`, `order=ASC`). `before` cursor for paging; dedupe + sort.
  TwelveData key from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (throws clearly if missing).
- Pure fetch service — callers push into `marketDataStore.setCandles` (Steps 9–13).
  `getHistoricalDataService()` singleton. Build/type/lint green.

### Added — Phase 1 Step 6: Market Data Service + Symbol Registry (2026-06-25)
- `src/services/market-data/MarketDataService.ts` — owns BinanceProvider + TwelveDataProvider,
  routes each symbol to the right provider (via the registry), fans normalized
  `MarketDataEvent`s into `marketDataStore` (`updateQuote`/`updateCandle`/`setConnectionStatus`),
  and aggregates a single `connectionStatus` (only providers with active subs count). Implements
  `MarketDataServiceBinding`; `getMarketDataService()` lazily creates it and calls
  `attachMarketDataService()`. Pure service, no UI.
- `src/services/market-data/symbols.ts` — canonical symbol registry (config, not mock data):
  `MARKET_SYMBOLS` with provider routing + `providerSymbol` (Binance "BTCUSDT", TwelveData
  "XAU/USD"), `getMarketSymbol()`, `twelveDataSymbolMap()`.
- Resolves the canonical↔provider symbol mapping flagged in Step 5. Not bootstrapped into the app
  yet (Steps 10–13). Build/type/lint green.

### Added — Phase 1 Step 5: TwelveData Provider (2026-06-25)
- `src/services/market-data/providers/TwelveDataProvider.ts` — single price WebSocket
  (`wss://ws.twelvedata.com/v1/quotes/price`) for forex/metals/indices; one socket multiplexes
  symbols via `subscribe`/`unsubscribe`. Emits unified `quote` events (TwelveData WS is
  price-only; candles come from REST + CandleEngine). Backoff reconnect + auto-resubscribe;
  implements `MarketDataServiceBinding`. Optional `symbolMap` (canonical ↔ "EUR/USD") with
  reverse mapping on emitted events.
- API key from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (graceful error if missing). Added `.env.example`
  template; hardened `.gitignore` (`.env`, `.env*.local`, keep `!.env.example`). No key committed.
- Standalone until Step 6/10–13. Build/type/lint green.

### Added — Phase 1 Step 4: Binance Provider (2026-06-25)
- `src/services/market-data/providers/BinanceProvider.ts` — single combined WebSocket to
  `wss://stream.binance.com:9443/ws`; dynamic `SUBSCRIBE`/`UNSUBSCRIBE` (one socket, never one
  per symbol) for `@ticker`, `@miniTicker`, `@kline_<interval>`.
- Normalizes Binance payloads → unified `MarketDataEvent` (`quote` / `candle` / `status`).
- Auto-reconnect walking `RECONNECT_BACKOFF_MS` (1→2→5→10→30s, infinite) with full
  auto-resubscribe of active streams on reopen; SSR-guarded (`typeof WebSocket`).
- Implements `MarketDataServiceBinding` (connect/disconnect/subscribe/unsubscribe) so it can be
  attached to `marketDataStore` directly or via `MarketDataService` (Step 6).
- Standalone (not bootstrapped into the app yet — Step 6/10–13). Build/type/lint green.

### Added — Phase 1 Step 3: Market Data Store (2026-06-25)
- `src/store/marketDataStore.ts` — Zustand single source of truth: `quotes, candles,
  selectedSymbol, selectedTimeframe, connectionStatus, subscriptions, lastUpdate` + actions
  `connect/disconnect/subscribe/unsubscribe/changeSymbol/changeTimeframe` (intents) and
  `updateQuote/updateCandle/setCandles/setConnectionStatus` (ingress) + selectors.
- Pure store — no socket/provider logic; a `MarketDataServiceBinding` is attached at runtime via
  `attachMarketDataService()` (Step 6) to avoid a store↔service cycle.
- `updateCandle` does the TradingView-style realtime merge (upsert last bar by time; trim to
  `MAX_CANDLES = 5000`).
- Path note: placed in `src/store/` (existing convention), not `src/stores/` from the roadmap,
  to avoid a duplicate store directory.
- Standalone; not yet wired to chart/watchlist (Steps 10–13). Build/type/lint green.

### Added — Phase 1 Step 2: Market Data Types (2026-06-25)
- `src/types/marketData.ts` — unified market-data model contract: `MarketQuote`,
  `MarketCandle`, `MarketSymbol`, `ConnectionStatus` (+`ConnectionState`), `Timeframe`
  (re-exported single-source from `market.ts`), plus supporting `MarketProvider`,
  `AssetClass`, `MarketChannel`, `MarketSubscription`, `MarketDataEvent`,
  `MarketDataListener`, `HistoryRequest`, and constants `SUPPORTED_TIMEFRAMES`,
  `RECONNECT_BACKOFF_MS`, `CONNECTION_STATUS_META`, `subscriptionKey()`.
- `src/types/index.ts` — re-export `./marketData` from the barrel (no `Timeframe` collision:
  same symbol re-exported from `market`).
- Types only; no runtime/UI wired yet, no mock data touched. Build/type/lint green.

### Added — 2026-06-25
- `docs/`: `ARCHITECTURE.md`, `CURRENT_STATE.md`, `CURRENT_PROGRESS.md`, `NEXT_TASKS.md`,
  `HANDOFF.md`, `CHANGELOG.md` (Phase 1 Step 1 codebase analysis + handoff package).
- `docs/PROJECT_ARCHITECTURE.md` + `docs/KNOWN_ISSUES.md` to complete the project memory set
  required by `.claude/CLAUDE.md`. `HANDOFF.md` now records branch / last commit / next action.

### Added — Drawing toolbar overhaul (IN PROGRESS, unwired)
- `types/drawing.ts`: new tools (channel, brush, measure, long, short, emoji, eraser,
  crosshair) and per-drawing `zIndex/locked/visible/stop/target`.
- `store/chartStore.ts`: `duplicateDrawing, lockDrawing, hideDrawing, bringToFront, sendToBack,
  toggleLockAll, toggleHideAll` + `drawingsLocked/drawingsHidden`; `addDrawing` now assigns
  `zIndex/visible/locked`.
- `components/chart/drawing/drawingRenderer.ts`: pure renderer for all drawing types incl.
  position RR boxes and the measure overlay. **Not yet wired into `DrawingLayer`.**

### Added — Chart right-click context menu
- `components/chart/ChartContextMenu.tsx` (portal, viewport-clamped, Esc/outside-close, arrow
  nav), wired in `PriceChart` via `coordinateToPrice`/`coordinateToTime`.
- `store/alertStore.ts` + `components/chart/AlertLines.tsx` (alert price lines).
- `utils/bus.ts`: `trade:prefill` event; `OrderTicket` consumes it. `types/trade.ts`:
  `OrderPrefill`. Menu actions: create alert, sell-limit, buy-stop, add-order, draw hline.
- Replaced broken `framer-motion` usage with a CSS pop-in animation.

### Added — Replay bar-selection
- `replayStore`: `selecting` + `beginSelect/cancelSelect`.
- `components/replay/ReplaySelectionLayer.tsx`: TradingView-style click-to-pick start bar
  (snapping cursor, disables chart pan/zoom while selecting, Esc cancels).

### Fixed
- Indicator menu: clicking an enabled indicator now **toggles it off** (`toggleIndicator`),
  previously add-only (duplicated series).
- SMC overlay coordinate mapping: always resolve via `timeToCoordinate`; bound to `timeScale
  .width()` (excludes price axis) — fixes "compressed at right" + label overlap. Added
  `window.__SMC_DEBUG__` trace.
- SMC menu reactivity: forced rAF redraw on settings change; added missing **displacement**
  render path.
- `IndicatorPane`: guard against double-free of series on unmount (chart already disposed).
- ADR indicator: emit empty data instead of `time:0` duplicate points (fixed Lightweight Charts
  "data must be asc ordered by time" assertion).
- Hydration: stores now init with deterministic SSR-safe defaults and hydrate post-mount;
  terminal loaded via `dynamic(ssr:false)`.

### Changed — Chart UI redesign (TradingView dark)
- `chartTheme.ts`/`PriceChart.tsx`: `#131722` background, subtle grid, dashed crosshair +
  floating labels, colored last-price line, time/price scale styling, interaction options.
- Toolbar: symbol header (ticker + contract tag + exchange via `services/exchange.ts`),
  segmented timeframes, `ChartSettingsMenu` (grid/theme/reset). SMC labels as chips + price tags.

## [0.1.0] — Initial build (Modules 1–6)
- M1 Architecture: Next 15 + TS + Tailwind, typed domain models, IndexedDB/localStorage,
  resizable terminal shell, theme system.
- M2 Chart engine + mock market data (seeded generator), indicators, drawings, watchlist,
  toolbars.
- M3 Replay engine (no look-ahead), controls, dashboard, hotkeys, multi-timeframe.
- M4 SMC engine (structure/FVG/OB/liquidity/displacement/sessions) + Web Worker + overlay.
- M5 Trade simulator + risk panel + journal (screenshots, CSV/Excel).
- M6 Analytics dashboard (equity/drawdown/distribution/monthly) + README.
