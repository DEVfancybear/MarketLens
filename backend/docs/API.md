# Backend API reference

This catalog is derived from the Go route registrars in `backend/internal` and the Rust Axum
routers in `backend/execution`. It records the implemented route surface; request/response DTOs in
source remain authoritative.

## Conventions and security classes

- Browser API base: `/api/v1` on the Go API, normally `http://localhost:8080` in development.
- JSON errors use `{"error":{"code":"...","message":"..."}}`. Common statuses are 400, 401,
  403, 404, 409, 410, 428, 429, 500, and 503.
- Protected resources use the HttpOnly `access_token` cookie. Browser clients send credentials.
- Unsafe cookie-bearing requests require an allowed `Origin`; the middleware rejects a missing or
  disallowed Origin before a mutation handler runs.
- Owner scope comes from the authenticated session. Resource lookups do not trust a client-supplied
  owner ID, and cross-owner resources generally resolve as not found.
- Sensitive execution routes additionally verify the session is still active, apply rate limits,
  and may require a short-lived `X-Trade-Authorization` capability bound to the operation/payload.
- Service routes are not browser routes. They use their documented worker token/secret or private
  network boundary.
- WebSocket routes are shown with `GET` because the initial HTTP request upgrades in the handler.

## Health and public EA relay

- `GET /health` - process liveness.
- `GET /health/ready` - readiness; reports database configuration/connectivity.
- `GET /execution-ea/health` - exact public relay to Rust EA health.
- `POST /execution-ea/v1/ea/sessions` - create/restore a paired EA session.
- `POST /execution-ea/v1/ea/poll` - authenticated EA command poll.
- `POST /execution-ea/v1/ea/events` - authenticated EA event/portfolio/instrument upload.

The relay forwards only those four paths to the Rust EA listener. It is not a generic reverse
proxy. Rust ports remain loopback-only.

## Public browser routes

### Chart navigation and market data

- `GET /api/v1/chart/time-navigation/shortcuts`
- `POST /api/v1/chart/time-navigation/resolve`
- `GET /api/v1/mt5/symbols`
- `GET /api/v1/mt5/ticks`
- `GET /api/v1/mt5/market-status`
- `GET /api/v1/mt5/history`
- `GET /api/v1/mt5/history/around`
- `GET /api/v1/mt5/stream` - browser WebSocket.

The `/mt5` family is read-only market data from the private Python sidecar. It cannot place or
authorize orders. Candle times stay in UTC; formatting happens in the selected chart timezone.

### Indicator/Pine runtime and public store

- `GET /api/v1/indicator-store`
- `GET /api/v1/indicator-store/:id`
- `GET /api/v1/pine-runtime/capabilities`
- `POST /api/v1/pine-runtime/meta`
- `POST /api/v1/pine-runtime/inputs`
- `POST /api/v1/pine-runtime/styles`
- `POST /api/v1/pine-runtime/compile`
- `GET /api/v1/indicator-runtime/catalog`
- `POST /api/v1/indicator-runtime/definition`
- `POST /api/v1/indicator-runtime/compute`

Runtime endpoints enforce their own body/complexity limits. Published indicator-store rows are
public; private user scripts are not.

## Authentication

- `POST /api/v1/auth/session` - preferred Firebase Google bootstrap; reuse, rotate, or create a
  matching backend session.
- `POST /api/v1/auth/google` - compatibility login/register endpoint; creates a backend session.
- `POST /api/v1/auth/refresh` - rotate the refresh token and issue a new access token.
- `POST /api/v1/auth/logout` - protected; revoke current session and clear cookies.
- `GET /api/v1/auth/me` - protected current user.
- `DELETE /api/v1/auth/sessions` - protected revoke-all-devices operation.

See [AUTH.md](AUTH.md) for token, cookie, replay, rate-limit, and Origin behavior.

## Protected workspace API

### Bootstrap and settings

- `GET /api/v1/sync/bootstrap`
- `GET /api/v1/settings`
- `PUT /api/v1/settings`
- `PATCH /api/v1/settings`
- `GET /api/v1/settings/chart/favorite-timeframes`
- `PUT /api/v1/settings/chart/favorite-timeframes`
- `GET /api/v1/settings/chart/task-tabs`
- `PUT /api/v1/settings/chart/task-tabs`
- `GET /api/v1/settings/integrations`
- `PUT /api/v1/settings/integrations`
- `POST /api/v1/settings/integrations/test/:channel`
- `POST /api/v1/settings/integrations/deliver`

Secret integration fields are write-only and returned only as configured/not-configured state.
Blank replacement secrets preserve existing values unless the request explicitly clears them.

Chart task tabs are stored inside `settings.chart.taskTabs` and are also returned by sync bootstrap.
The PUT body is `{ "expectedRevision": number, "document": ChartTaskTabsDocumentV1 }`. The server
derives the owner from authentication, locks that owner's settings row, increments revision on an
accepted write, and preserves every unrelated chart setting. Stale revisions return `409`; malformed,
oversized, duplicate-ID, unsupported-version, or out-of-range task documents return `400`. Version 1
allows 1–12 tasks and caps the encoded document at 512 KiB.

### Watchlists

- `GET /api/v1/watchlists`
- `POST /api/v1/watchlists`
- `PUT /api/v1/watchlists/active`
- `PATCH /api/v1/watchlists/:id`
- `DELETE /api/v1/watchlists/:id`
- `PUT /api/v1/watchlists/:id/layout`
- `POST /api/v1/watchlists/:id/symbols`
- `DELETE /api/v1/watchlists/:id/symbols/:symbol`

### Drawings

- `GET /api/v1/drawings`
- `POST /api/v1/drawings`
- `POST /api/v1/drawings/batch`
- `PUT /api/v1/drawings/:id`
- `PATCH /api/v1/drawings/:id`
- `DELETE /api/v1/drawings/:id`
- `GET /api/v1/drawing-templates`
- `POST /api/v1/drawing-templates`
- `PUT /api/v1/drawing-templates/:id`
- `DELETE /api/v1/drawing-templates/:id`
- `GET /api/v1/drawing-tool-favorites`
- `PUT /api/v1/drawing-tool-favorites`

Drawing payloads remain opaque JSON to the backend. Client IDs, revisions, and tombstones provide
retry/multi-device convergence.

### Indicators and private Pine scripts

- `GET /api/v1/indicators`
- `POST /api/v1/indicators`
- `PUT /api/v1/indicators/:id`
- `DELETE /api/v1/indicators/:id`
- `GET /api/v1/pine-scripts`
- `GET /api/v1/pine-scripts/:id`
- `POST /api/v1/pine-scripts`
- `POST /api/v1/pine-scripts/:id/publish`
- `PUT /api/v1/pine-scripts/:id`
- `DELETE /api/v1/pine-scripts/:id`

List responses keep private source payloads light; the item endpoint returns the full owned script.

### Alerts and push tokens

- `GET /api/v1/alerts`
- `POST /api/v1/alerts`
- `PATCH /api/v1/alerts/:id`
- `DELETE /api/v1/alerts/:id`
- `GET /api/v1/alerts/history`
- `DELETE /api/v1/alerts/history`
- `GET /api/v1/alerts/:id/events`
- `POST /api/v1/alerts/:id/trigger`
- `POST /api/v1/push/tokens`
- `DELETE /api/v1/push/tokens/:token`

Trigger attempts are revision/idempotency scoped. Alert state and history commit together before
delivery work is treated as accepted.

### Layouts

- `GET /api/v1/layouts`
- `POST /api/v1/layouts`
- `PUT /api/v1/layouts/:id`
- `DELETE /api/v1/layouts/:id`

Setting a default layout preserves the single-default-per-user database invariant.

### Journal and screenshots

- `GET /api/v1/journal`
- `POST /api/v1/journal`
- `GET /api/v1/journal/:id`
- `PUT /api/v1/journal/:id`
- `DELETE /api/v1/journal/:id`
- `POST /api/v1/screenshots/upload-url`
- `POST /api/v1/screenshots`
- `GET /api/v1/screenshots/:id`
- `DELETE /api/v1/screenshots/:id`

Image bytes use signed object-storage URLs; PostgreSQL stores metadata and durable deletion work.

### Simulated trading

- `GET /api/v1/sim/accounts`
- `POST /api/v1/sim/accounts`
- `PUT /api/v1/sim/accounts/:id`
- `DELETE /api/v1/sim/accounts/:id`
- `POST /api/v1/sim/accounts/:id/reset`
- `GET /api/v1/sim/accounts/:id/positions`
- `POST /api/v1/sim/accounts/:id/orders`
- `POST /api/v1/sim/positions/:id/close`
- `GET /api/v1/sim/accounts/:id/analytics`

Client IDs make position/order synchronization idempotent. This API is separate from live Rust
execution.

### Replay

- `POST /api/v1/replay/sessions`
- `GET /api/v1/replay/sessions/:id`
- `DELETE /api/v1/replay/sessions/:id`
- `POST /api/v1/replay/sessions/:id/commands`
- `GET /api/v1/replay/sessions/:id/events`
- `GET /api/v1/replay/sessions/:id/report`
- `POST /api/v1/replay/sessions/:id/fork`
- `GET /api/v1/replay/sessions/:id/tracks/:trackId/bars`
- `GET /api/v1/replay/sessions/:id/stream` - replay WebSocket.

The backend actor owns replay time, command sequencing, no-lookahead data visibility, fills,
positions, equity, checkpoints, resume events, and optimistic versioning. See
[the phase 6 replay contract](../../docs/REPLAY_BACKEND_PHASE6.md).

## Protected live-execution API

All routes in this section require authentication, active-session verification, owner scoping, and
route-specific rate limits. Mutations that can trade require the operation-bound trade capability
when trade-password protection is enabled.

### Account registry and policy

- `GET /api/v1/execution/accounts`
- `GET /api/v1/execution/account-layout`
- `POST /api/v1/execution/account-layout`
- `GET /api/v1/execution/account-state`
- `GET /api/v1/execution/instruments`
- `POST /api/v1/execution/accounts/:accountId/disconnect`
- `DELETE /api/v1/execution/accounts/:accountId`
- `POST /api/v1/execution/symbol-mappings`
- `GET /api/v1/execution/prop-risk`
- `POST /api/v1/execution/prop-risk`

### Copying and command routing

- `GET /api/v1/execution/copy-groups`
- `POST /api/v1/execution/copy-groups`
- `POST /api/v1/execution/copy-groups/actions`
- `POST /api/v1/execution/pairing-tokens`
- `POST /api/v1/execution/orders`
- `POST /api/v1/execution/commands`

Order bodies use decimal strings for monetary/quantity values. Rust normalizes per target and
records independent target outcomes. Unknown delivery state is reconciled before any retry.

### Optional trade-password authorization

- `GET /api/v1/execution/trade-security`
- `PUT /api/v1/execution/trade-security`
- `POST /api/v1/execution/authorizations`
- `DELETE /api/v1/execution/trade-security/unlock`
- `POST /api/v1/execution/trade-security/recovery`
- `POST /api/v1/execution/trade-security/recovery/confirm`

Trade passwords are Argon2id hashes, are not the account password, and never leave the backend.
Authorization tokens are short-lived, single-use, user/session/operation/payload bound.

### Managed MT5 account lifecycle

- `POST /api/v1/execution/connectors/mt5/accounts`
- `GET /api/v1/execution/connectors/accounts/:accountId`
- `GET /api/v1/execution/connectors/accounts/:accountId/snapshot`
- `GET /api/v1/execution/connectors/accounts/:accountId/history`
- `POST /api/v1/execution/connectors/accounts/:accountId/reconnect`
- `POST /api/v1/execution/connectors/accounts/:accountId/disconnect`
- `DELETE /api/v1/execution/connectors/accounts/:accountId`

These are the current server-managed Windows-worker routes. Credentials go from Go to Vault, not
to the browser response, Rust database, command line, or environment.

## Service-authenticated Go routes

- `POST /api/v1/alerts/worker-snapshot` - alert evaluator snapshot.
- `POST /api/v1/alerts/worker-trigger` - evidence-verified worker trigger.
- `POST /api/v1/settings/integrations/worker-deliver` - closed-browser integration delivery.
- `POST /api/v1/push/worker-devices/ensure`
- `POST /api/v1/push/worker-devices/get`
- `GET /api/v1/push/worker-devices`
- `POST /api/v1/push/worker-devices/put`
- `POST /api/v1/push/worker-devices/delete`
- `POST /api/v1/execution-workers/mt5/credential-grants/consume` - private managed-worker grant
  consumption with worker bearer/session/lease/command binding.

Push/alert worker routes require `PUSH_WORKER_SECRET` and their signed user/device contracts. The
credential-grant route is a private worker boundary and never accepts a browser session as worker
authorization.

## Rust listener boundary

Rust has two loopback listeners. Go is the browser-facing client for admin routes.

### EA listener (`127.0.0.1:8790`)

- `GET /health`
- `POST /v1/ea/sessions`
- `POST /v1/ea/poll`
- `POST /v1/ea/events`

Only the corresponding Go `/execution-ea` allow-list is public.

### Admin and managed-worker listener (`127.0.0.1:8791`)

Core admin routes:

- `GET /v1/admin/accounts`
- `GET|POST /v1/admin/account-layout`
- `GET /v1/admin/account-state`
- `GET|POST /v1/admin/prop-risk`
- `GET /v1/admin/instruments`
- `POST /v1/admin/symbol-mappings`
- `GET|POST /v1/admin/copy-groups`
- `POST /v1/admin/copy-groups/actions`
- `POST /v1/admin/pairing-tokens`
- `POST /v1/admin/accounts/disconnect`
- `POST /v1/admin/accounts/remove`
- `POST /v1/admin/orders`
- `POST /v1/admin/commands`

Managed control and synchronization routes:

- `POST /v1/mt5-vm/workers/hello`
- `POST /v1/mt5-vm/workers/heartbeat`
- `POST /v1/mt5-vm/workers/poll`
- `POST /v1/mt5-vm/workers/ack`
- `POST /v1/mt5-vm/workers/ea-bootstrap/bind`
- `POST /v1/mt5-vm/workers/snapshots`
- `POST /v1/mt5-vm/workers/history`
- `GET /v1/admin/mt5-vm/workers`
- `POST /v1/admin/mt5-vm/commands`
- `GET /v1/admin/mt5-vm/accounts`
- `GET /v1/admin/mt5-vm/accounts/status`
- `POST /v1/admin/mt5-vm/accounts/reserve`
- `POST /v1/admin/mt5-vm/accounts/activate`
- `POST /v1/admin/mt5-vm/accounts/abort`
- `POST /v1/admin/mt5-vm/accounts/reconnect`
- `POST /v1/admin/mt5-vm/accounts/disconnect`
- `POST /v1/admin/mt5-vm/accounts/prepare-delete`
- `POST /v1/admin/mt5-vm/accounts/finalize-delete`
- `POST /v1/admin/mt5-vm/credential-grants/consume`
- `GET /v1/admin/mt5-vm/accounts/read-state`
- `GET /v1/admin/mt5-vm/accounts/history`

Admin routes require the independent `EXECUTION_ADMIN_TOKEN`. Worker routes use the configured
bootstrap token only for enrollment, then hashed generation-fenced worker sessions. Do not expose
this listener through a public proxy.
