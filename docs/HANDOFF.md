# HANDOFF

> Universal MT5 Windows VM connector handoff (2026-08-12): read
> `UNIVERSAL_MT5_WINDOWS_VM_CONNECTOR_PLAN.md` and
> both Phase validation records before connector work. The old
> TickerAll/MetaApi plan and fixtures were deleted. One Rust agent manages a
> bounded set of isolated MT5 terminal/Python-adapter pairs per private Windows
> VM; users connect from MarketLens web and install nothing. Phase 0 is complete.
> The Phase 1 local prototype is implemented and 21 Rust plus ten Python tests
> pass; the credentialed live test is ignored by default. The driver now owns a
> pool of separately installed signed terminal slots with pinned instance server
> catalogs. The FTMO provision, two clean restarts, forced-crash recovery,
> heartbeat, graceful stop, and settled one-pair resource sample pass through the
> explicit Application Control test host. Phase 1 is `CONDITIONAL_PASS`, not
> complete: produce a signed/reputable agent and rerun the normal authenticated
> stdio path, independently match FTMO web, then use a second disposable demo
> credential and second installed slot to prove live cross-account isolation and
> aggregate idle load. Continue from
> `MT5_WINDOWS_VM_CONNECTOR_PHASE1_VALIDATION.md`. Do not start Phase 2, raise terminal
> density, or add public credential routes, migrations, production secrets, or
> order execution before that exit gate passes.

> Trade execution handoff (2026-07-26): never restore or follow the old FTMO
> verifier/Connector workflow below. Continue from
> `TRADE_EXECUTION_ARCHITECTURE.md` and
> `TRADE_PRODUCTION_SECURITY_RUNBOOK.md`.

_Post-monorepo update 2026-07-06._

This handoff keeps the full pre-`9691bd1` history below. Apply these path changes before following
older references:

- Run frontend commands from `frontend/`.
- Frontend docs referenced below as `docs/*.md` now generally live in `frontend/docs/`.
- Older frontend milestone/audit/parity reports live in `frontend/docs/archive/`.
- Run backend commands from `backend/`.
- Backend framework is now **Fiber**. Backend Phases 0-6 are done: framework, database layer,
  Firebase verification, sessions/tokens, auth endpoints, settings persistence,
  `/api/v1/sync/bootstrap`, and watchlists CRUD. Next is Phase 7 drawings. **Protected routes only
  mount when both a DB and Firebase are configured**. Neon is migrated to version 4.
- The Python MT5 bridge path is now `backend/bridge/ftmo_mt5/`.

Recent post-split work:

- **Auth bootstrap/security and Push sync hardening (2026-07-26):**
  New frontend code calls `POST /api/v1/auth/session` once to reuse, rotate, or
  create only the backend session matching the verified Google/Firebase user.
  Cookies are HttpOnly/Secure/SameSite=Strict; JWT issuer/audience/TTL are
  bounded; refresh rotation is atomic; unsafe cookie requests require an
  allowed Origin; auth establishment is rate-limited. Push alert sync has an
  eight-second deadline and reports retryable worker/database failures as
  `503`, ownership conflicts as `409`. Backend-first is preferred; when backend
  deployment is explicitly deferred, only session `404`/`405` falls back once
  to `/auth/google`. Use
  `backend/docs/AUTH.md`, `docs/SECURITY.md`, and `docs/OPERATIONS.md` as the
  maintained contracts; older phase notes below are historical.

- **Production backend operator runbook (2026-07-19):**
  Treat the phrases **build backend production** and **run backend** as exactly
  `.\run-backend-production.ps1` from the repository root, with no switches in the normal case.
  The runner pulls, provisions/import-checks `backend/.venv-mt5`, builds a staged API, migrates,
  safely replaces only repo-owned listeners, starts the MT5 stream and Go API, and gates success on
  local/public health. `build-production.ps1` only creates artifacts and must not substitute for
  the runner. Port `8787` remains browser/account-local and is intentionally excluded.

- **Generic Pine source runtime and legacy Swing S/R removal (2026-07-19):**
  replay cutoff is enforced before backend evaluation, the submitted Pine v5
  Swing Highs/Lows script is covered as a generic source fixture, and the old
  `SWING_SR` source/catalog entry is removed. Do not restore a formula-specific
  Swing branch. Persisted legacy rows may be migrated to saved Pine source; the
  archived `docs/PIVOT_FORMATION_ALERT_PLAN.md` is historical context only.

- **Drawing maintenance Phase 8 Wave C complete (2026-07-12):** 11 harmonic/Elliott/time-cycle
  tools added through a manifest-labeled pattern framework, taking the persistent catalog to 73.
  `NEXT_PUBLIC_DRAWING_PHASE8_WAVE_C=false` disables creation while preserving saved-object decode.
  All gates pass, including 19/19 Playwright tests. Continue with data-contract-first Wave D; read
  `frontend/docs/DRAWING_PHASE8_WAVE_C.md`.

- **Drawing maintenance Phase 8 Wave B complete (2026-07-12):** 14 Fib/Gann/fan/radial/Pitchfork
  tools added through shared geometry families, taking the persistent manifest to 62 tools. The
  `NEXT_PUBLIC_DRAWING_PHASE8_WAVE_B=false` creation kill switch preserves saved-object decoding.
  All gates pass, including 18/18 Playwright tests. Continue with independently gated Wave C; read
  `frontend/docs/DRAWING_PHASE8_WAVE_B.md`.

- **Drawing maintenance Phase 8 Wave A complete (2026-07-12):** 13 tools added through four
  reusable families (`RangeTools`, `ChannelVariantsTool`, `AnnotationTools`,
  `TimeProjectionTools`), taking the persistent manifest to 48 tools without shared interaction or
  persistence dispatch. Full gates pass, including 17/17 Playwright drawing tests. Continue with
  Wave B only; read `frontend/docs/DRAWING_PHASE8_WAVE_A.md` and
  `frontend/docs/DRAWING_TOOLS_MAINTENANCE_REFACTOR_PLAN.md`.

- **Replay backend Phase 6 complete:** backend Replay is default for authenticated users; the old
  frontend clock, cursor store, engine, provider-history/MTF Replay logic, and Replay trade feed are
  deleted. `NEXT_PUBLIC_REPLAY_BACKEND_V1=false` now disables Replay UI only. CI runs
  `check:replay-client-boundary`, Replay client tests, typecheck, and production build. Continue from
  `docs/REPLAY_BACKEND_PHASE6.md`; do not restore a local fallback engine.

- **Backend Phase 6 complete (watchlists):** `0004_watchlists` (`watchlists` + `watchlist_symbols`,
  `UNIQUE (watchlist_id, symbol)`); `internal/watchlists` = `model.go`/`repo.go`/`handler.go`
  following the Phase 5 pattern (hand-written pgx `Store`, all queries scoped by `user_id`, ownership
  in SQL → cross-user `ErrNotFound` = 404, idempotent symbol add via `ON CONFLICT DO NOTHING`,
  one symbol-load query to avoid N+1). Routes `GET/POST /api/v1/watchlists`, `PATCH/DELETE /:id`,
  `POST /:id/symbols`, `DELETE /:id/symbols/:symbol` behind `RequireAuth`; `sync/bootstrap` fills the
  `watchlists` slice via a narrow `WatchlistLister`. `httpserver.New` + `cmd/api` gained the
  watchlists handler. `app.Test` unit tests + a live Neon E2E (create/add/dup/list/rename/remove/
  bootstrap/404/delete) passed. **Next: Phase 7 drawings** (batch upsert on `client_id`) +
  `drawing_templates`.

- **Backend Phase 5 complete (settings & bootstrap):** `0003_settings` creates `user_settings` and
  `layouts`; `internal/settings` provides repo + Fiber handlers for `GET/PUT/PATCH
  /api/v1/settings` with auto-create defaults and deep merge patching; `internal/workspace` provides
  `GET /api/v1/sync/bootstrap` returning settings plus empty arrays for future resources. Covered by
  settings/workspace tests and `go test ./...`.

- **Backend Phase 4 complete (auth endpoints & middleware):** `internal/users/repo.go`
  (`UpsertFromIdentity` — transactional: login by `(google, provider_uid)`, else link by email, else
  register; + `GetUser`; implements `auth.UserUpserter`), `internal/auth/service.go` (`User` DTO +
  `UserUpserter` iface + `Service` LoginWithGoogle/Refresh/Logout/RevokeAllSessions/GetUser),
  `middleware.go` (`RequireAuth` → `access_token` cookie → `c.Locals`), `handler.go` (Fiber
  `POST /api/v1/auth/google|refresh|logout`, `GET /auth/me`, `DELETE /auth/sessions`; handlers return
  `fiber.NewError` so the central ErrorHandler formats the envelope — auth imports neither httpserver
  nor users, avoiding cycles). `httpserver` adds CORS + the `/api/v1` group; `cmd/api` assembles the
  auth stack only when DB + Firebase are both present. Tested via `app.Test` (google→me→refresh→logout
  + 401/400 paths); `CreatedSession` gained `UserID`. **To smoke-test live:** provision Postgres, set
  `DATABASE_URL`, `make migrate-up`, boot `go run ./cmd/api`, then `POST /api/v1/auth/google` with a
  real Firebase ID token.

- **Backend Phase 3 complete (sessions & tokens):** `internal/auth/jwt.go` (`TokenService`
  MintAccess/ParseAccess — HS256, `sub`/`sid`/`iat`/`exp`, `WithValidMethods` none-alg guard),
  `session.go` (`SessionService` Create/Rotate/Revoke/RevokeAll over a pgx-free `SessionStore`;
  256-bit refresh token, only SHA-256 hash stored; Rotate does single-use rotation and **revokes the
  whole session family on reuse** → `ErrSessionReuse`), `session_pgstore.go` (`PgSessionStore`
  adapter over `gen.Queries`, the production store for Phase 4), and `cookies.go`
  (`SetAuthCookies`/`ClearAuthCookies` — HttpOnly, SameSite=Lax, Secure gated by `APP_ENV`, access at
  `/`, refresh scoped to `/api/v1/auth`). Unit-tested (jwt round-trip/expired/wrong-secret/none-alg;
  session create/rotate/reuse/unknown/expired) with a fake store — no DB. Phase 4 wires these into
  `internal/auth/{service,handler,middleware}.go` + `internal/users/repo.go`.
- **Backend Phase 2 complete (Firebase ID-token verification):** `internal/auth/firebase.go`
  (`NewVerifier` builds the Admin SDK from `FIREBASE_*` via a service-account JSON) + `verify.go`
  (`VerifyGoogleToken(ctx, idToken) → Identity{UID, ProviderUID, Email, EmailVerified, Name,
  PhotoURL}`; `ProviderUID` = Google `sub`, uid fallback; all failures return `ErrUnauthorized`
  wrapping the cause, never a partial identity). The Firebase client is abstracted behind an
  `idTokenVerifier` interface so `verify_test.go` covers empty/error/mapping/fallback with a fake —
  no network or real creds. Not wired into HTTP yet (Phase 4).

- **Backend Phase 2 complete (Firebase ID-token verification):** `internal/auth/firebase.go`
  (`NewVerifier` builds the Admin SDK from `FIREBASE_*` via a service-account JSON) + `verify.go`
  (`VerifyGoogleToken(ctx, idToken) → Identity{UID, ProviderUID, Email, EmailVerified, Name,
  PhotoURL}`; `ProviderUID` = Google `sub`, uid fallback; all failures return `ErrUnauthorized`
  wrapping the cause, never a partial identity). The Firebase client is abstracted behind an
  `idTokenVerifier` interface so `verify_test.go` covers empty/error/mapping/fallback with a fake —
  no network or real creds. Not wired into HTTP yet (Phase 4). Continue with Phase 3 (jwt/session/
  cookies) in `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`.

- **Backend Phase 1 complete (database layer):** `internal/db/pool.go` (pgxpool + Ping + Close);
  migrations `backend/migrations/0001_extensions` + `0002_auth` (users/auth_identities/sessions/
  push_tokens + enums + `set_updated_at()`); `cmd/migrate` golang-migrate runner (embedded iofs
  source, `postgres://`→`pgx5://`, `up/down/version/force`) + `backend/Makefile`; sqlc (`sqlc.yaml`,
  `internal/db/queries/*.sql`, generated `internal/db/gen/*`) for users/identities/sessions; and
  `GET /health/ready` (pings the pool, 503 when down/unconfigured — liveness `/health` stays
  DB-free). `cmd/api` builds an optional pool (dev boots without `DATABASE_URL`). **To fully verify:**
  set `DATABASE_URL`, run `make migrate-up` (then `make migrate-down N=2`), and hit `/health/ready`
  (expect 200 `{"database":"up"}`) — not done here (no local Postgres). Regenerate query code with
  `make sqlc` (needs `sqlc` on PATH: `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`).
  Continue with Phase 2 in `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`.
- **Backend Phase 0 complete:** Fiber app boot (requestid → recover → zerolog logging), Fiber
  `/health`, standard error envelope (`internal/httpserver/response.go`: `WriteError` + central
  `ErrorHandler`), extended `config.Load() (Config, error)` with DB/auth/Firebase/CORS vars +
  fail-fast in non-dev, and `backend/.env.example`. Build/vet/`/health` verified.
- Backend planning docs were added under `backend/docs/`.
- Google auth UI was added under the frontend.
- Watchlist menu/rename/section state was updated toward TradingView parity; see
  `frontend/docs/WATCHLIST_ARCHITECTURE.md`.
- Watchlist section/order rules now live in `frontend/src/store/watchlistLayout.ts`; keep future
  UI/backend sync paths using those helpers. Guard with `npm run test:watchlist`.

_Engineer handoff for the MarketLens. Last updated 2026-07-03 (Pine Editor + source-code indicators)._

You are taking over a **TradingView/FXReplay/TradeZella-style** web terminal for Smart Money
Concept backtesting. **All 11 Zustand stores have been migrated to Jotai atoms** for fine-grained
render optimisation — components subscribe only to the atoms they need via `useAtomValue`/`useSetAtom`.
`zustand` has been removed from dependencies. It is feature-rich and builds clean. **Phase 1 (realtime market data) and Phase 2 (alert engine) are
both COMPLETE, along with the OANDA integration.** The watchlist, chart, and replay MTF panel all stream live (Binance crypto with no
API key; forex/metals/indices via OANDA with a bearer token, or TwelveData as fallback); **there is no mock data anywhere**
(`services/marketData.ts` deleted). Phase 2 adds a TradingView-style alert engine (above/below/
crosses), toast + browser + sound notifications, a responsive Alert Center, and **interactive chart
alerts** (Phase 2.1 — select / drag-to-reprice / delete / edit / right-click + long-press).
**Phase 3 (TradingView UI Parity) is COMPLETE** — 95% visual parity.
**Phase 4.3 (Shape Tools Suite) is COMPLETE** — 8 shapes + fill system + supply/demand zones.
**Phase 4.2.2 (Tool Group System) is COMPLETE** — flyout menus fixed via `createPortal`.
**Phase 4.4 (Fibonacci Suite) is COMPLETE** — fib retracement + trend-based fib extension drawing tools.
**Phase 5 (Left Toolbar / Indicator Engine) is COMPLETE** — 9-group toolbar, indicator settings
dialogs, hotkey system, and bottom-panel Pine Editor for source-code indicators.
The next milestone is **Phase 6 — Push Notifications / MT5 Integration**. Phase 6A push
notifications are implemented, including closed-browser delivery when `npm run push-worker` (or a
cron calling `/api/push/evaluate`) runs next to the Next server. Continue with Phase 6B MT5 Bridge
from `docs/MT5_BRIDGE_PROTOCOL.md` and `docs/PHASE6B_MT5_BRIDGE_PLAN.md`. MT5 access is now granted
per signed-in user after backend credential verification; the former build-wide enable flag has
been removed.

Read in this order: `PROJECT_ARCHITECTURE.md` / `ARCHITECTURE.md` → `CURRENT_STATE.md` →
`NEXT_TASKS.md` → `KNOWN_ISSUES.md`.

Recent drawing UI note: `Save drawing template` no longer uses native `window.prompt`; both the
floating drawing toolbar and `ObjectSettingsDialog` open `SaveDrawingTemplateDialog`, with a
TradingView-style `New template name` input plus dropdown of existing template names. Choosing an
existing name overwrites that template in the current style family via `saveTemplateAtom`.

Recent drawing parity note: plain `trendline` now uses attached `+ Add text`; measurement values
belong to `infoLine` / `trendAngle`. `InfoLineTool.ts` renders the TradingView-style dark
measurement panel with price/%/ticks, bars/time/pixel distance, and angle. The panel width is
measured from row text and clamped/ellipsized inside the chart viewport so right-to-left info-line
drags do not overflow the grey panel. It also reserves/clips away from the right price-scale and
current-price label strip; keep `RIGHT_PRICE_SCALE_GUARD` and `g.clip()` in `InfoLineTool.ts`.

Recent vertical-line parity note: selected `VerticalTool.ts` now matches TradingView by showing a
bottom time-axis chip such as `Thu 02 Jul 26 19:30` instead of the old white center handle. The
chip clamps inside the chart viewport; body hit-test/drag remains unchanged.

Recent brush parity note: `BrushTool.ts` now opts into the `continuous` adapter path. It starts on
pointerdown, records points on pointermove, and commits the stroke on pointerup; do not route brush
through the normal two-click trendline path. Guard with `npm run check:brush-freehand`.

Recent path parity note: `PathTool.ts` is a TradingView-style open click-to-add path with one
terminal arrowhead; do not restore the stale closed/fill behavior. Freeform `path`, `polyline`, and
`curve` commit on double-click, right-click, or `Esc` when enough points exist. Their vertex hits
must keep explicit `anchorIndex` values through `HitTestEngine`; otherwise middle handles become
body drags and the last point of an N-point path can resolve to point index `1`. Guard with
`npm run check:path-tool`.

Recent SMC overlay note: `SmcLayer.tsx` must keep `z-[2]`; otherwise the live chart can hide the
SMC canvas while screenshot export still composites it. SMC render now caps every noisy family and
prioritizes active/fresh zones. Read `docs/SMC_OVERLAY_MAINTENANCE.md` and guard with
`npm run check:smc-overlay`.

Recent Fibonacci parity note: `FibRetracementTool.ts` now uses a TradingView-style preset/settings
model with 24 per-level rows, renders source trend line/background bands/level+price labels, and
hit-tests each level. Default left labels are measured and positioned outside the fib body with
`level (price)` formatting; do not restore the old `left + padding` or `right + padding` placement
because it puts labels into the colored bands or overlaps the right edge/price scale. The default
fib source trend line is gray/dashed (`#787b86`) unless the user sets a custom color. Fib settings
live in `ObjectSettingsDialog` with Style/Coordinates/Visibility tabs and `#1/#2 (price, bar)`
coordinates. Fib renderers also reserve/clip away from the right price-scale/current-price label
strip; keep `FIB_RIGHT_PRICE_SCALE_GUARD`, `usableFibRight()`, and `g.clip()` in the fib plugins.
Double-clicking any drawing opens settings. `FibExtensionTool.ts` is a three-click trend-based
extension: A-B impulse, C projection origin, `C + ratio * (B - A)`, with explicit `p3` anchor
mapping. Legacy `fib` mirrors retracement for saved drawings. Read
`docs/FIBONACCI_TOOLS_MAINTENANCE.md` and guard with `npm run check:fibonacci-tools`.

Recent indicator note: Pine source-code indicators now live in the bottom `Pine Editor` tab, with
an embedded `My scripts` sidebar rather than a popup. Saved scripts persist under `pineScripts`;
active chart instances remain in `indicators` as type `CUSTOM`. Custom scripts are parsed by the
whitelist compiler in `backend/internal/pineruntime`; the frontend only calls Pine runtime APIs and
renders returned `IndicatorResult` payloads. Do not introduce `eval`, `new Function`, or any general
JavaScript execution path for user source. Read `docs/INDICATOR_ARCHITECTURE.md`,
`docs/PINE_RUNTIME_GO_MIGRATION.md`, and guard with backend runtime tests.

## Repo state
- **Branch:** `master`
- **Remote:** `origin → https://github.com/DEVfancybear/tradingview.git`
- **Phase 1 progress:** **COMPLETE — Steps 1–17 ✅.** Realtime watchlist + chart + replay MTF,
  switch hardening, connection badge, reconnect hardening (watchdog + online recovery), perf pass,
  and the **last mock deleted**. **The chart streams live** (history via REST + realtime klines).
  Reconciliation chosen: `chartStore` stays the chart's selection + candle source
  (drawings/indicators/tool too); `useMarketData` bridges it to `marketDataStore` (select → history
  → mirror candles). `useVisibleCandles` replay gate intact. `selectMarket()` is idempotent so
  the active kline is always (re)asserted on the active key.
- **Phase 2 progress:** **COMPLETE ✅** (engine + audit + Phase 2.1). `alertStore`
  (alerts/triggeredAlerts/history/settings + `selectedAlertId`/`editingAlertId`), pure
  `services/alertEngine.ts`, `hooks/useAlertEngine.ts` (mounted in `GlobalRuntime`; evaluates off
  `marketDataStore` with reference-counted ticker subs — no polling, no new sockets), toast +
  browser + sound notifications, responsive `AlertCenter` (toolbar bell). `marketDataStore`
  subscriptions are now refcounted (`subRefs`). Audited in `PHASE2_REVIEW.md` / `PHASE2_GAPS.md`.
- **Phase 2.1 (interactive chart alerts):** `AlertOverlay` (replaces deleted `AlertLines`) — canvas
  lines + DOM hit strips give **hover / select / drag-to-reprice / delete / right-click + touch
  long-press**; `AlertContextMenu` (Edit/Clone/Disable/Delete), `AlertEditDialog`. `Alert` gained
  `enabled`+`locked`; the engine skips disabled alerts. Selection is ephemeral; price/enabled/locked
  persist. See `docs/ALERT_ARCHITECTURE.md` §"Interactive chart alerts".
- **Phase 4.4 (Fibonacci Suite):** `FibRetracementTool` (2-point, internal/external retracement
  levels through `4.236`, dashed source trend line, background bands, level+price labels) +
  `FibExtensionTool` (three-click trend-based extension: A-B impulse, C projection origin,
  `C + ratio * (B - A)`, with `p3` as a real draggable anchor). Both registered in `adapters.ts`,
  exposed in the Fibonacci flyout. Legacy `fib` tool + `FibTool` plugin retained for backward
  compat and mirrors retracement. See `docs/FIBONACCI_TOOLS_MAINTENANCE.md`.
- **Drawing engine stability fixes (2026-06-26):** Ctrl+D duplicate bug fixed (empty-id
  corruption eliminated), store now guards against empty IDs + deep-copies points, explicit
  pointer capture release added, adapter resolution during drag fixed, drag operations now
  undoable via commitMove. See `CURRENT_PROGRESS.md` for details.
- **Phase 5 (Left Toolbar / Indicator Engine):** `DrawingToolbar` reorganised into 9 tool groups
  (mode, trend lines, horizontals, shapes, freeform, fibonacci, positions, annotations) with
  25+ tools. `IndicatorSettingsDialog` modal for customising indicator type, length(s), colours,
  pane assignment, and visibility. `IndicatorMenu` shows active indicators with settings gear and
  remove-all action. `IndicatorPane` shows settings gear. `useHotkeys` extended with drawing
  shortcuts (1–9 tool switch, Delete, Ctrl+D duplicate, Ctrl+A select all, Ctrl+I toggle SMA,
  Escape deselect/cancel). Source-code indicators are handled by the bottom `Pine Editor` tab
  and backend `internal/pineruntime`; see `docs/INDICATOR_ARCHITECTURE.md`. Left rail width
  increased 40->52px. See `CURRENT_PROGRESS.md`.
- **Position settings dialog (updated 2026-07-01):** `chart/PositionSettingsDialog.tsx` is a
  TradingView-style Inputs/Style/Visibility modal for the long/short tool, opened via the gear
  on the floating drawing toolbar (`editingDrawingIdAtom` / `setEditingDrawingAtom`, mounted in
  `Terminal`). Inputs cover account size/currency (including Default), lot size, risk (%/amount),
  entry, leverage, profit & stop (ticks+price), qty precision, with a live Qty/Risk/Profit/RR
  summary. Style now matches the TradingView reference: Lines picker, Stop color, Target color,
  Text color/font size, Price labels, Stats multi-select, Compact stats mode, and Always show
  stats. `Drawing` now includes the position account/risk fields plus `stopColor`, `targetColor`,
  `positionStats`, `compactStats`, and `alwaysShowStats`; `PositionTool` applies line style,
  colors, text style, and selected stats on-canvas. Tick/price math now lives in
  `drawing/tools/positionMetrics.ts`; both the dialog and canvas labels must use symbol `tickSize`
  rather than price-magnitude inference. Position Entry/Ticks/Price fields commit on blur/Enter so
  replacement drafts do not snap or mirror while typing. Position movement now uses
  `drawing/tools/positionGeometry.ts` with six virtual handles matching the six rendered handles;
  see `docs/POSITION_TOOL_ARCHITECTURE.md` and `CHANGELOG.md`.
- **Long/Short position tool (2026-06-28):** Rebuilt TradingView-style in `PositionTool.ts`
  (replaces the old `LongPositionTool`/`ShortPositionTool`). Points-based geometry
  (`[0]=entry, [1]={rightEdge,target}, [2]={rightEdge,stop}`) so the drag engine moves it.
  `chartStore.addDrawingAtom` auto-expands a single click into a default box (±1%, 2:1 R/R,
  ~20-bar width from candle interval). Green profit / red risk zones, entry/target/stop lines,
  and labels (prices, %, R/R). Target handle = `p1`, stop handle = `p2` (both set right-edge
  time); body/entry drag moves all. `long`/`short` removed from `SINGLE_CLICK_TOOLS` so they
  return to cursor after placement. See `CHANGELOG.md`.
- **Floating drawing settings toolbar (2026-06-28):** Selecting a drawing pops a
  TradingView-style floating toolbar (`chart/DrawingSettingsToolbar.tsx`, mounted in
  `DrawingLayer`) with inline stroke colour / fill / line width / line style / clone / lock /
  delete. **It now defaults to the chart's top-centre (not pinned next to the object) and is
  draggable via a `GripVertical` handle — the dragged position is kept (clamped) until the
  selection clears (2026-06-28 bug pass).** `DrawingInteractionManager` ignores pointer events
  over `[data-drawing-toolbar]` (`isOverDrawingUI`) so clicks don't deselect/drag. See `CHANGELOG.md`.
- **Position/drawing-tool bug pass (2026-06-28):** (1) settings toolbar draggable + top-pinned;
  (2) Long/Short tool highlights the profit/risk zone when price reaches target/stop
  (`PositionTool.ts` reads `candlesAtom`; `DrawingLayer` force-repaints per tick only when a
  position tool exists; `RenderLoop.markDirty(force?)`); (3) `DrawingLayer.fromEvent` extrapolates
  time in chart whitespace so dragging (esp. rectangles at the right edge) no longer stalls. See
  `CHANGELOG.md` / `KNOWN_ISSUES.md`.
- **Line suite parity (2026-06-28):** Added the **`trendAngle`** tool (`TrendAngleTool.ts`) —
  a 2-point line that always renders its screen angle in degrees (dashed baseline + sweep arc +
  degree chip), matching TradingView's "Trend angle". The plain `trendline` must not show
  measurement stats; it now shows TradingView-style `+ Add text` when selected and stores attached
  text on the same drawing. Measurement labels belong to `infoLine` / `trendAngle`. New
  `angleDeg()`/`angleArc()` helpers in `plugins/shared.ts`. The toolbar **LINES** group was consolidated to mirror
  TradingView's LINES menu (Trend line, Ray, Info line, Extended line, Trend angle, Horizontal
  line, Horizontal ray, Vertical line, Cross line, Channel) with inline hotkey labels, and
  Alt+T/H/J/V/C hotkeys were added. See `CHANGELOG.md`.
- **Jotai migration (2026-06-28):** All 11 Zustand stores (`create()`) replaced with Jotai
  atoms (`atom()`). Each store module now exports individual state atoms, write atoms for
  actions, a backward-compatible `useXStore()` hook, and a `getXState()` non-React accessor.
  Components use `useAtomValue`/`useSetAtom` for fine-grained subscriptions — updating
  `candlesAtom` no longer re-renders `TopToolbar`, `DrawingToolbar`, or other unrelated
  components. `zustand` removed from dependencies. See `ARCHITECTURE.md` for full details.
- **Drawing toolbar parity (2026-06-30):** floating `DrawingSettingsToolbar` gained a
  **⬡ Settings** button for every object (new `ObjectSettingsDialog` — Style/Coordinates/
  Visibility tabs by family; long/short keeps `PositionSettingsDialog`) and a **▦ Templates**
  popover (global, family-scoped, style-only presets — `DrawingTemplate` +
  `saveTemplateAtom`/`applyTemplateAtom`/`deleteTemplateAtom`, persisted under
  `drawingTemplates`). `CanvasRenderer.drawingsHash()` now folds in style fields so edits
  repaint immediately. Plan §3 (Anchor) intentionally deferred — needs viewport dims in the
  hit-test pipeline. See `docs/DRAWING_TOOLBAR_PLAN.md`. (Plan §4 More was already shipped.)
- **Alert line "jumps" near live price — fixed (2026-07-01):** `AlertLines.tsx`'s reconciliation
  effect was keyed on `symbolAlerts`, a fresh array every render (including every price tick, since
  `useChartCtx()` changes reference each tick) — this destroyed and recreated the native price line
  dozens of times/sec unconditionally, the actual cause of the reported "nhảy view" when dragging an
  alert near the current price. Fixed by keying on a stable `id:price` string instead. Also added
  `draggingAlertIds` (`alertLineRegistry.ts`) so the reconciliation doesn't fight `AlertOverlay`'s
  imperative mid-drag price update. Confirmed via a scripted Playwright repro against a clean `next
  dev` instance (stale/leftover dev servers gave misleading results — always verify against a
  freshly started server for this kind of chart-render bug).
- **Alert line survives a visible mid-session crossing (2026-07-01):** `observedSinceArm`'s
  continuing (browser-still-open) branch previously only widened the observed high/low forward
  from the single most-recent tick's candle, so a websocket reconnect, backgrounded/throttled tab,
  or kline-stream gap could silently drop a candle — a crossing visibly happening on the chart
  wasn't detected and the alert line never disappeared. Unified with the reopen-recovery path: every
  observation now rescans the loaded candle series since the last-known point (walking backward from
  the newest candle, stopping at the cutoff for O(1-2) cost per tick in the steady state).
- **Alert stuck "pending" after reopen (2026-07-01):** `useAlertEngine`'s reopen recovery
  (`observedSinceArm` in `hooks/useAlertEngine.ts`) only looked at the latest forming candle's
  high/low, so a level crossed while the browser was closed inside an already-closed (older)
  candle was never detected and the alert stayed armed indefinitely after reopening. Fixed by
  scanning every loaded candle since `alert.updatedAt` for alerts that predate the browser
  session, plus a guard that waits for candle history to load before locking in the recovered
  range.
- **Closed-browser push — notifications weren't displaying (2026-07-01):** `sendFirebasePush`
  (`firebaseAdmin.ts`) still set `webpush.notification.title/body` after the earlier "data-first"
  attempt (ca600cc), which made FCM auto-display the notification and skip the SW's custom
  `onBackgroundMessage` handler — background delivery stayed silent/inconsistent even when alerts
  triggered correctly server-side (confirmed `triggered`/`messageId` in `/api/push/evaluate?debug=1`
  but nothing appeared on device). Fixed by sending a pure data-only FCM message so the existing
  `onBackgroundMessage` → `showNotification()` path in `firebase-messaging-sw.js/route.ts` runs
  every time.
- **Closed-browser push — Binance geo-block fix (2026-07-01):** cron-job.org-triggered
  `/api/push/evaluate` runs were skipping every crypto alert with "price unavailable" and no
  `errors` entry. Cause: `pushAlertEvaluator.ts`'s `fetchBinancePrice` called `api.binance.com`,
  which returns HTTP 451 for requests from US-hosted server IPs (Vercel serverless), and the
  failure was swallowed instead of surfaced. Fixed by switching to `data-api.binance.vision`
  (Binance's unrestricted market-data mirror) and making fetch/parse failures throw so they land
  in the evaluation's `errors` array. See `KNOWN_ISSUES.md` Workarounds.
- **Closed-browser push never fired — no evaluator was running (2026-07-01):** user reported
  closing the browser after setting an alert produced no push notification, only showing up on
  reopen. Root cause: closed-browser delivery needs a second always-on process
  (`npm run push-worker` or an external cron); neither was running (verified via the OS process
  list — no `next` or compiled `push-alert-worker.js` process at all), which is the pre-existing "Worker
  not running" failure mode, not a regression in the FCM/evaluate code fixed earlier the same day.
  Fixed by adding `src/instrumentation.ts`, which starts `evaluatePushAlerts()` in-process via
  Next's `register()` hook on server boot (skipped on Vercel/`DISABLE_PUSH_WORKER=true`), so
  `npm run start`/`npm run dev` alone now delivers closed-browser push. Verified against a real
  `next start` + `/api/push/evaluate?debug=1` call. See `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.
- **Closed-browser push still silent after the in-process worker — TTL + race fix (2026-07-02):**
  user retested and still got no FCM notification. Investigated the live server directly (Firestore
  device/alert docs, `/api/push/evaluate?debug=1`, `/api/notifications/test`) rather than guessing:
  confirmed Telegram delivery works and doesn't depend on the browser at all (recommended as the
  reliable channel); found FCM `webpush.headers.TTL` was only 300s, meaning the push service drops
  the message if the browser doesn't reconnect within 5 minutes — bumped to 86400s in
  `firebaseAdmin.ts`; found and fixed a real duplicate-trigger race (overlapping
  `evaluatePushAlerts()` calls read Firestore before each other's write landed, firing a one-time
  alert 3x in the live log) with an in-process `inFlight` promise lock in `pushAlertEvaluator.ts`.
  Also documented (`PHASE6A_PUSH_NOTIFICATIONS.md` "Web Push's Fundamental Limitation") that
  browser push delivery inherently requires the browser's background process to stay alive even
  with all tabs closed — fully quitting the browser defeats any web push implementation, not just
  this one.
- **Alert falsely triggered from a full-history rescan (2026-07-02):** while live-testing the
  closed-browser push fixes with the user, a freshly created `BTCUSDT crossDown` alert fired
  (line removed + toast + real push delivered) even though price never actually reached the target.
  Root cause: `observedSinceArm()` in `useAlertEngine.ts` derived its rescan cutoff from the
  previous tick's `candleTime`, defaulting to epoch 0 if that was ever `undefined` (candle history
  not loaded yet — plausible right after creating a new alert), which made every later tick rescan
  the *entire* loaded candle series instead of just since-armed — any historical dip below the
  target read as a live crossing. Fixed by tracking the cutoff as its own persisted field, only
  ever advanced forward from a real candle time. Client-side fix — needs a page reload to take
  effect, not just a server restart.
- **Server→client trigger reconciliation added (2026-07-02):** after the false-trigger fix, found a
  *legitimate* remaining gap live with the user — a real server-confirmed trigger (push received)
  stayed "Active" client-side because the client's reopen-recovery scan is bounded by the currently
  selected chart timeframe (15m), and the crossing happened inside a candle that started before the
  alert was armed, an inherent blind spot the server (1-minute resolution) doesn't have. Rather than
  chasing finer client-side history, added a reconciliation path: server persists the real
  `triggerPrice`; new `POST /api/push/alerts/status` returns confirmed per-alert triggers
  (signature-guarded); new `usePushTriggerReconcile` hook (mounted in `GlobalRuntime`) polls it and
  applies confirmed triggers via the existing `triggerAlertAtom`, without re-notifying. See
  `CHANGELOG.md` for the full file list.
- **Shape "+ Add text" + 3 drawing double-insert bugs fixed (2026-07-02):** implemented
  TradingView-style "+ Add text" for fillable shapes (Rectangle/RotatedRect/Circle/Ellipse/Triangle)
  — new `renderShapeText()` shared helper, floating add/edit affordance in `DrawingLayer.tsx`
  reusing `TextEditor`; also fixed `Circle`/`Ellipse` silently not rendering `fillColor`. While
  verifying it, found and fixed **3 separate double-insert bugs**, all confirmed via a scripted
  Playwright repro (create → 1 entry; Ctrl+D → 2; Ctrl+D+Ctrl+V → 3): (1) every created drawing was
  inserted twice under the identical id (`addDrawingWithHistory` called `addDrawing()` directly
  *and* ran a `CreateDrawingCommand`, which already calls `addDrawing()`); (2) Ctrl+D/Ctrl+V created
  two independent copies the same way one level up; (3) a separate root cause of the same Ctrl+D
  symptom — `useHotkeys.ts` and `DrawingInteractionManager.ts` are two independent global keydown
  listeners that both handled Delete/Ctrl+A/Ctrl+D. Removed the redundant, non-undo-tracked
  handlers from `useHotkeys.ts`; this also fixed single-selection Delete not being undoable (it was
  losing a race against the two listeners). See `DRAWING_ENGINE_ARCHITECTURE.md` for full detail,
  including a correction to the `DragTarget` doc (p0/p3 anchors do exist for 3+-anchor tools via a
  separate index-based resolution path, contra what was documented earlier the same day). Follow-up:
  the inline `TextEditor` is now `data-chart-ui` and commits/cancels on outside `pointerdown`, so a
  user cannot click "+ Add text" then drag the rectangle away while the input remains at the old
  location. `DrawingLayer` also consumes the chart pointerdown before body-drag can start and derives
  the editor position from the current shape bounds instead of the original click point. Guarded by
  `npm run check:shape-text-editor`.
- **Watchlist rebuilt as a 1:1 TradingView clone (2026-07-02):** `Watchlist.tsx` rewritten —
  TradingView panel header ("Watchlist ⌄", + / grid / ⋯), sortable `Symbol|Last|Chg|Chg%` columns
  (new `changeAbs` `SortKey`), 30px rows with circular symbol logos (new `SymbolLogo.tsx`;
  overlapping FX flag pairs / metal / crypto / index icons from TradingView's public logo CDN,
  lettered fallback on error), superscript fractional-pip last digit for FX/metals, true minus
  sign + no leading "+", rounded-outline active row. Tick animation now flashes only the Last cell
  (solid bull/bear + white text fading, `wl-flash-up/down`), keyed by tick sequence so consecutive
  same-direction ticks restart the animation. Dark-theme `--bull`/`--bear` and `chartTheme.ts`
  candles updated to TradingView's current `#089981`/`#f23645` in **both** themes. Verified with
  Playwright screenshots (dark + light) against a fresh `next dev`.
- **Recommended next action:** Continue **Phase 6B — MT5 Bridge Integration** by verifying an MT5
  demo account for the signed-in user, running `npm run mock-mt5` for protocol checks or the real
  bridge, and exercising connect/auth, account matching, order ack/reject, execution reports,
  close, and close-all from the Trade Panel. Phase 6A push docs:
  `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.
- **OANDA diagnostics:** **DEBUG LOGGING ADDED** — `MarketDataService` and `OandaProvider` now log
  key presence, routing decisions, subscription attempts, and API call results to the console. Open
  the browser console to see why forex symbols show "--". See `docs/OANDA_DEBUG_REPORT.md`.
- **OANDA Integration:** **COMPLETE ✅** — forex/metals/indices via OANDA v20 REST (pricing poll +
  historical), fallback to TwelveData. Fxcm/ICMarkets stubs in place.
- **Runtime:** `npm run dev` → BTCUSDT chart + watchlist stream live from Binance (no key).
  OANDA (forex/metals/indices) needs `NEXT_PUBLIC_OANDA_API_KEY` + `NEXT_PUBLIC_OANDA_ACCOUNT_ID`
  in `.env.local`; TwelveData is the fallback for those symbols.
- **Mock status:** **none.** The chart, watchlist, and replay multi-timeframe panel are all
  realtime. The mock generator `services/marketData.ts` has been deleted (Step 17).

---

## 1. Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
npm run type-check   # tsc --noEmit
npm run lint         # next lint
```
- Node 18+ (built/verified on Node 24, npm 11, Windows). Next 15.3.9, React 19.
- **Windows build note:** Next's page-data worker occasionally fails with
  `Cannot find module './<chunk>.js'` / `/_not-found` during "Collecting page data". This is a
  known Next-on-Windows race (the project sits under `Downloads`, which AV/sync tools watch),
  **not** a code error — re-run `npm run build` once (warm chunks) and it passes.

## 2. Current status (verified 2026-06-28)
- type-check ✅ · lint ✅ (0 warnings) · build ✅ · no TODO/FIXME markers.

## 3. Existing architecture (1-minute version)
- Browser-only Next app; the whole terminal is a `dynamic(ssr:false)` client chunk.
- **11 Jotai atom modules** (`ui`, `chart`, `replay`, `smc`, `trade`, `journal`, `analytics`, `watchlist`, `alert`, `marketData`, `toast`). Each exports individual `atom()` primitives, write atoms for actions, and a backward-compatible `useXStore(selector?)` hook. The realtime feed has its own single-source-of-truth `marketDataStore`; the chart's selection + candle series live in `chartStore` and are bridged from `marketDataStore` by `useMarketData`.
- Chart = Lightweight Charts + **canvas overlays** (SMC, drawings, replay picker, alerts) that
  project (time,price)→pixels and repaint on `ChartContext.version`.
- **`useVisibleCandles()` is the single visibility gate** — the no-look-ahead replay guarantee;
  it reads from `candlesAtom` (realtime master series, Jotai atom).
- Pure domain engines (indicators, SMC, trade, analytics) consume only the candle array → safe.

## 4. Realtime market data — current implementation (Phase 1 COMPLETE, Steps 1–17)
Live pipeline: `provider → MarketDataService → marketDataStore → hooks → UI`.
- **Types** `src/types/marketData.ts` (unified `MarketQuote/MarketCandle/MarketSymbol/
  ConnectionStatus/Timeframe` + events/consts).
- **Store** `src/store/marketDataStore.ts` — quotes/candles/selection/status/subscriptions;
  `updateCandle` does the TradingView-style forming-bar upsert; `selectMarket()` (chart) and
  `subscribe/unsubscribe` (watchlist).
- **Providers** `services/market-data/providers/` — `BinanceProvider` (one combined WS, kline +
  ticker + miniTicker, backoff reconnect + auto-resubscribe) and `TwelveDataProvider` (price WS,
  forex/metals/indices). Both implement `MarketDataServiceBinding`.
- **Orchestration** `MarketDataService.ts` (routes via `symbols.ts` registry, fans events into
  the store, aggregates status; `getMarketDataService()` attaches) + `HistoricalDataService.ts`
  (REST 500–5000 bars, paginated) + `CandleEngine.ts` (builds candles from tick-only feeds).
- **Hooks** `useCandles/useQuote/useConnectionStatus/useMarketDataFeed` (read-only) +
  `useMarketDataBootstrap` (subscribes watchlist tickers, mounted in `GlobalRuntime`) +
  `useMarketData` (chart: select → history → mirror candles into `chartStore`).
- **Connection badge** `components/toolbar/ConnectionBadge.tsx` (Step 14) — 🟢/🟡/🔴 chip in the
  `TopToolbar` right group via `useConnectionMeta()`.
- **Reconnect (Step 15)** lives in the providers: backoff `1→2→5→10→30s`, infinite, auto-resubscribe
  on `onopen`; plus a dead-socket watchdog (recycle an OPEN-but-silent socket after 45s) and instant
  reconnect on `window 'online'`. Both SSR-guarded.
- **Perf (Step 16):** per-tick re-renders removed from non-candle consumers — `replayStore.setTotal`
  equality-guarded; `TopToolbar`/`DrawingToolbar`/`DrawingLayer` use atomic selectors (don't pull
  `candles`).
- **Remaining Phase 1:** none — Steps 1–17 done. Full plan + Phase 2 roadmap in `NEXT_TASKS.md`.
- **Still mock:** nothing — `services/marketData.ts` is deleted; replay MTF reads real higher-TF
  history via `useMtfSnapshotSeries` → `HistoricalDataService`.

## 5. TradingView features already completed
- ✅ **Realtime candles + watchlist** (Binance crypto no-key; TwelveData forex/metals/indices),
  TradingView dark theme, crosshair w/ floating labels, last-price line, incremental
  `series.update` for the forming bar.
- ✅ Indicators: SMA/EMA/VWAP/RSI/MACD/ADR (toggleable).
- ✅ Drawings: trend/horizontal/vertical/rectangle/text/fib (create/move/delete, persisted).
- ✅ Right-click chart context menu (alert / sell-limit / buy-stop / add-order / hline).
- ✅ Bar Replay with click-to-select start, transport, speeds, scrubber, jump-to-date, MTF.
- ✅ SMC suite (structure, FVG, OB, liquidity, displacement, sessions/kill-zones) off-thread.
- ✅ Trade simulator + risk panel + journal (screenshots, CSV/Excel) + analytics dashboard.
- ✅ **Alert engine (Phase 2)** — price above/below + crosses above/below, once-only/recurring,
  evaluated off `marketDataStore` (no polling/sockets), toast + browser + sound, responsive Alert
  Center (toolbar bell), persisted alerts + history. **Interactive chart alerts (2.1):** lines are
  selectable / draggable-to-reprice / deletable / editable, right-click + long-press menu, Delete/Esc
  keys, per-alert enable/lock. See `docs/ALERT_ARCHITECTURE.md`.
- ✅ Watchlist (add/remove/sort, realtime), symbol search (registry), timeframe switching, theme
  toggle, fullscreen, screenshot export, resizable panels.

## 6. Remaining / missing features
- ✅ **Phase 1 — Realtime Market Data Foundation: COMPLETE (Steps 1–17).** No mock data remains.
- ✅ **Phase 2 — Alert Engine: COMPLETE.** Triggering + toast/browser/sound + Alert Center.
- ✅ **OANDA Integration: COMPLETE.** Forex/metals/indices stream live via OANDA v20 REST
  (pricing poll + historical candles). Fallback to TwelveData. Extension points for Fxcm and
  ICMarkets providers.
- ✅ **Phase 4.4 — Fibonacci Suite: COMPLETE.** Fib retracement + trend-based fib extension
  drawing tools with full plugin support. Legacy `fib` tool retained for backward compatibility.
- ✅ **Phase 5 — Left Toolbar / Indicator Engine: COMPLETE.** 9-group toolbar (25+ tools),
  indicator settings dialog (type/length/colour/pane/visibility), bottom Pine Editor for
  source-code indicators, and hotkey system (1–9 switch, Delete, Ctrl+D, Ctrl+A, Ctrl+I, Escape).
- ❌ Real broker/MT5 order routing + Firebase mobile push (Phase 6 — alert dispatch seam ready in
  `services/notifications/notify.ts`).

## 7. Where to continue (Phase 6 — Push Notifications / MT5 Integration)
1. **Phase 6B — MT5 Bridge Integration.** Phase 6A Firebase push notifications are implemented in
   `docs/PHASE6A_PUSH_NOTIFICATIONS.md`. Continue real broker order routing from the protocol in
   `docs/MT5_BRIDGE_PROTOCOL.md` and the implementation plan in
   `docs/PHASE6B_MT5_BRIDGE_PLAN.md`.
2. Manual smoke test for Phase 2: open the toolbar **bell**, create `BTCUSDT crosses above <price>`
   and `BTCUSDT > <below-current>` — the latter fires immediately (level), the former on the next
   upward cross; confirm one toast + chime, the alert moves to Triggered, and a History row is added.
   Enable "Browser" to verify the system notification permission flow.

## 8. Known issues / gotchas
- **`framer-motion` is broken** in this install (`motion-dom` export mismatch). It is **not
  imported** anywhere (the context menu uses a CSS pop animation). If you need motion later,
  pin a matching `framer-motion`/`motion-dom` pair; otherwise consider removing it from
  `package.json`.
- **✅ Adapter resolution during drag — FIXED (2026-06-26):** Machine state now stores `drawingTool`
  from `hit.drawing.tool` during cursor-mode drag start. No more fallback to `"trendline"`.
- **✅ Ctrl+D duplicate — FIXED (2026-06-26):** `DuplicateDrawingCommand` generates its own valid
  `uid("dw")` internally — no double-create, no empty-id corruption. `chartStore.addDrawing()` now
  guards against empty/falsy IDs with `id: d.id || uid("dw")`.
- **✅ Drag operations undoable — FIXED (2026-06-26):** `commitMove` wired from `useCommandHistory`
  through to `DrawingInteractionManager.handleUp`, so drags are recorded as `MoveDrawingCommand`
  and Ctrl+Z can undo them.
- **✅ addDrawing deep-copies points — FIXED (2026-06-26):** `chartStore.ts` now does
  `d.points.map(p => ({...p}))` to eliminate shared-reference risk.
- **✅ Hit-test vocabulary — FIXED (2026-06-26):** All 25 drawing tools now return only canonical
  `"p1"`, `"p2"`, `"body"` targets. `HitTestEngine` type + `TARGET_PRIORITY` narrowed.
- **✅ Pointer capture release — ADDED (2026-06-26):** `DrawingInteractionManager` now explicitly
  releases pointer capture via `activePointerIdRef` in `handleUp`, `reset()`, and Escape paths.
  No more leaked captures blocking chart interaction.
- **✅ DrawingContextMenu restored (2026-06-26):** Moved `contextmenu` listener from canvas
  (blocked by `pointerEvents:"none"`) to document capture phase. Right-clicking a drawing now
  opens the drawing-specific context menu (Clone, Delete, Lock, Hide, Bring/Send).
- **Context menu bypasses undo history:** `DrawingContextMenu.tsx` calls store actions directly
  (`removeDrawing`, `duplicateDrawing`, etc.) without creating Command history. Keyboard
  equivalents (Delete, Ctrl+D) DO create history (and, as of 2026-07-02, no longer double-create —
  see the entry above). `DrawingSettingsToolbar`'s style patches (color/fill/width/style) and the
  new "+ Add text" shape-label patches are in the same boat (direct `updateDrawing`, no Command) —
  same known gap, not fixed here.
- **Drawing tools fully wired:** All drawing tools (line, shape, fib) use the production
  `DrawingToolPlugin` architecture via `ToolRegistry`. `renderDrawing` + `HitTestEngine` delegate
  through adapters. No giant switch statements remain. The old note about "unwired refactor" in
  previous handoffs is obsolete — the subsystem has been fully integrated and extended.
- **Legacy types may be orphaned:** with `services/marketData.ts` deleted, the legacy `Symbol` and
  `Quote` interfaces in `types/market.ts` may now be unused — verify with a grep before removing.
- **⚠ Jotai compat hook + useEffect danger:** The `useXStore(selector)` compatibility hooks
  (e.g. `useAlertStore((s) => s.hydrate)`) create **unstable function references** on every
  render because they recompute the state object from all atoms. Never use them in `useEffect`
  dependency arrays for actions that mutate atoms — it causes infinite re-render loops.
  **Fix:** use `useSetAtom(writeAtom)` directly for actions, as it returns a stable reference.
- **Git on Windows:** `git` is installed but not on PATH — invoke it by full path
  `C:\Program Files\Git\cmd\git.exe`. Repo `origin → github.com/DEVfancybear/tradingview` on
  branch `master`. `.claude/settings.local.json` is gitignored (machine-local).
- **Secrets:** keyed providers (TwelveData) must read from `.env.local` (gitignored). Never
  commit keys/tokens. (`.env`, `.env*.local` are gitignored; `.env.example` is the template.)

## 9. Useful entry points (files)
- Realtime feed: `services/market-data/{MarketDataService,HistoricalDataService,CandleEngine,
  symbols}.ts`, `services/market-data/providers/*`, `store/marketDataStore.ts`.
- Chart bridge / data: `hooks/useMarketData.ts` (chart), `hooks/useMarketDataBootstrap.ts`
  (watchlist feed), `hooks/{useCandles,useQuote,useConnectionStatus}.ts`, `store/chartStore.ts`.
- Chart: `components/chart/PriceChart.tsx`, `ChartContext.tsx`, `ChartArea.tsx`.
- Drawing subsystem: `components/chart/DrawingLayer.tsx`,
  `components/chart/drawing/drawingRenderer.ts`,
  `components/chart/drawing/hittest/HitTestEngine.ts`,
  `components/chart/drawing/tools/{ToolRegistry,adapters}.ts`,
  `components/chart/drawing/tools/plugins/{FibRetracement,FibExtension}Tool.ts` (Phase 4.4).
- Left toolbar + indicators (Phase 5): `components/toolbar/DrawingToolbar.tsx`,
  `components/toolbar/IndicatorMenu.tsx`, `components/toolbar/IndicatorSettingsDialog.tsx`,
  `components/chart/IndicatorPane.tsx`, `components/pine/PineEditor.tsx`,
  `services/pineRuntimeCache.ts`, `services/api/resources/pineRuntimeApi.ts`, `hooks/useHotkeys.ts`.
  Architecture: `docs/INDICATOR_ARCHITECTURE.md`.
- Visibility gate: `hooks/useVisibleCandles.ts`.
- Watchlist: `components/watchlist/Watchlist.tsx`, `store/watchlistStore.ts`.
- Runtime loops: `components/layout/GlobalRuntime.tsx`.
- Replay MTF real-data path: `hooks/useMtfSnapshotSeries.ts` → `services/replayEngine.ts`
  (`mtfSnapshot`) → `components/replay/ReplayDashboard.tsx`.
- Alerts (Phase 2): `store/alertStore.ts`, `services/alertEngine.ts`, `hooks/useAlertEngine.ts`,
  `components/alerts/AlertCenter.tsx`, `store/toastStore.ts` + `components/notifications/Toaster.tsx`,
  `services/notifications/{notify,sound,browser}.ts`. Architecture: `docs/ALERT_ARCHITECTURE.md`.
- Interactive chart alerts (Phase 2.1): `components/chart/AlertOverlay.tsx` (canvas + DOM hit strips;
  replaces the deleted `AlertLines.tsx`), `components/chart/AlertContextMenu.tsx`,
  `components/alerts/AlertEditDialog.tsx`. Audit: `docs/PHASE2_REVIEW.md` / `docs/PHASE2_GAPS.md`.
