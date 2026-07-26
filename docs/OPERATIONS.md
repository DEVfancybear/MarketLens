# Operations

> Trade execution update (2026-07-26): do not use the legacy Save & Verify MT5,
> FTMO terminal provisioning, or Connector operations retained later in this
> historical document. Use `TRADE_PRODUCTION_SECURITY_RUNBOOK.md`.

Day-to-day commands for developing, testing, and deploying the monorepo.

Security hardening and the production release checklist are documented in
 [`SECURITY.md`](SECURITY.md). Read it before exposing either service publicly.

## Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Production build
npm run build
npm run start
```

Frontend dev server: `http://localhost:3000`

## Frontend Tests

```bash
cd frontend

npm run test:position
npm run test:trade
npm run test:drawing
npm run test:indicator-catalog
npm run test:chart
npm run test:ui
```

## Backend

On the Windows production host, **build backend production** and **run backend** both mean:

```powershell
.\run-backend-production.ps1
```

This is the only normal production entrypoint. It pulls, provisions the MT5 runtime, builds a
staged backend binary, migrates, safely restarts ports `8765`/`8080`, and requires local plus public
health checks. Commands below are development or manual-recovery commands.

```bash
cd backend

# Install Go dependencies
go mod tidy

# Verify the patched Go toolchain is selected
go version

# Run API server
go run ./cmd/api

# Run tests
go test ./...

# Build binary
go build -o bin/api ./cmd/api
```

Production backend builds must use Go 1.26.5 or newer; the `go 1.26.5` directive in
`backend/go.mod` makes that minimum explicit because Go 1.26.4 has a `crypto/tls` vulnerability.

Backend dev server: `http://localhost:8080`

Backend framework decision: **Go Fiber**. Phase 0 migrated the backend to Fiber, and Phase 4 added
the `/api/v1/auth/*` routes. Current backend work should continue with Phase 5 settings +
`sync/bootstrap` and follow Fiber handler/route-group conventions.

## Python MT5 Execution Bridge (Backend Sidecar, port 8787)

The full Windows production build provisions the shared MT5 virtual environment and installs these
dependencies automatically:

```powershell
.\build-production.ps1
```

For backend development without a full build, create `backend\.venv-mt5` and install
`bridge/ftmo_mt5/requirements.txt` into it manually.

Dry-run (no MT5 required):

```bash
cd backend
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="true"
.\.venv-mt5\Scripts\python.exe -m bridge.ftmo_mt5.service
```

MT5 availability in the web app is not controlled by a frontend feature flag. Leave
`MT5_VERIFY_PYTHON` unset so the Go API auto-detects the production venv, sign in, and use
**Connections & notifications -> Save & Verify MT5**. Verification belongs to that user. Live
commands additionally require this execution bridge to report the same login/server.

Live mode:

```bash
cd backend
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="false"
$env:FTMO_BRIDGE_ALLOW_LIVE="true"
$env:FTMO_MT5_LOGIN="12345678"
$env:FTMO_MT5_PASSWORD="master-password"
$env:FTMO_MT5_SERVER="FTMO-Server"
$env:FTMO_MT5_TERMINAL_PATH="C:\Program Files\MetaTrader 5\terminal64.exe"
.\.venv-mt5\Scripts\python.exe -m bridge.ftmo_mt5.service
```

## Environment Variables

### Frontend

Copy `.env.example` to `frontend/.env.local` when the variable is frontend-only. Keep shared
examples in the root `.env.example`. The frontend also loads missing values from the repository root
`.env.local` / `.env` as a monorepo convenience, but `frontend/.env.local` and hosted project env
vars should be treated as the primary source for deployment.

For local auth, the frontend needs the `NEXT_PUBLIC_FIREBASE_*` values. The backend API base defaults
to `http://localhost:8080` in development; set `NEXT_PUBLIC_API_BASE_URL` explicitly in production.

### Backend (Go)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `development` | Runtime environment |

### Backend (Python MT5 Bridge)

| Variable | Default | Description |
| --- | --- | --- |
| `FTMO_MT5_ENABLED` | `false` | Enable the bridge |
| `FTMO_BRIDGE_DRY_RUN` | `true` | Simulate without MT5 |
| `FTMO_BRIDGE_ALLOW_LIVE` | `false` | Allow live MT5 connection |
| `FTMO_BRIDGE_BIND_HOST` | `127.0.0.1` | WebSocket listen host |
| `FTMO_BRIDGE_BIND_PORT` | `8787` | WebSocket listen port |
| `FTMO_BRIDGE_TOKEN` | (empty) | 32+ random bytes required for live mode or any non-loopback bind |
| `FTMO_MT5_LOGIN` | (empty) | MT5 account login |
| `FTMO_MT5_PASSWORD` | (empty) | MT5 account password |
| `FTMO_MT5_SERVER` | (empty) | MT5 broker server |
| `FTMO_MT5_TERMINAL_PATH` | (empty) | Path to terminal64.exe |

## Deployment

### Frontend on Vercel

Use these Vercel settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Production Branch | `master` |
| Install Command | default or `npm install` |
| Build Command | default or `npm run build` |

Current production domain and API env:

```text
Frontend: https://tradingterminal.io.vn
API:      https://api.tradingterminal.io.vn
```

Set these Vercel Production variables and redeploy after any change:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.tradingterminal.io.vn
NEXT_PUBLIC_APP_URL=https://tradingterminal.io.vn
```

Push registration and closed-browser evaluation additionally require both the
Firebase Web app values and the matching server-only service-account values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_VAPID_KEY=...

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=... # preserve escaped \n newlines
PUSH_WORKER_SECRET=...   # same value as the Go backend
```

`NEXT_PUBLIC_FIREBASE_PROJECT_ID` and `FIREBASE_PROJECT_ID` must identify the
same Firebase project. Firestore is not used by Push Alert storage.
`PUSH_WORKER_SECRET` must match the Go backend because Next uses its protected
worker API to persist device and evaluator state in PostgreSQL.

After changing any Vercel variable, redeploy Production. An unauthenticated
`POST /api/push/register` returning `401` proves only that the route exists. A
real signed-in Push toggle must receive `200`. A `503` mentioning push
registration storage means the Next route could not reach the protected Go
worker API or PostgreSQL; verify migration `0025`, `NEXT_PUBLIC_API_BASE_URL`,
and the shared `PUSH_WORKER_SECRET`. The route never logs the Firebase bearer
token, FCM token, or user id.

`POST /api/push/alerts/sync` has an eight-second server deadline. Treat `503`
as retryable worker/database unavailability and `409` as a non-retryable
device-ownership conflict. The Next log entry is sanitized and must not be
expanded to include the request body, Firebase UID, bearer token, or FCM token.

Cloudflare DNS keeps the Vercel apex CNAME in DNS-only mode. The `api` hostname is a proxied
Cloudflare Tunnel record targeting the Go API on this Windows host. Do not expose the private MT5
market-data sidecar on port 8765 or the execution bridge on port 8787.

If Vercel reports `The specified Root Directory "frontend" does not exist`, the deployment is using
an old commit from before the monorepo split. Redeploy the latest `master` commit where the
`frontend/` folder exists.

### Backend

Deploy the Go backend as a separate service from `backend/`. Do not include it in the Vercel
frontend build.

For the Firestore-to-PostgreSQL Push Alert rollout, deploy the backend first so
migration `0025` and `/api/v1/push/worker-devices/*` are live, verify the shared
`PUSH_WORKER_SECRET`, then import existing Firestore documents before deploying
the frontend:

```powershell
cd frontend

# Reads and validates only; PostgreSQL is not changed.
npm run migrate:push-firestore

# Imports pushAlertDevices through the protected Go worker API.
npm run migrate:push-firestore -- --apply
```

The command needs `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_API_BASE_URL`, and `PUSH_WORKER_SECRET` in
its process environment. Do not delete the Firestore collection until the
apply run reports zero failures and the new evaluator has been verified.
Existing `push_tokens` rows are also backfilled with empty snapshots and
version `1`; any device not present in Firestore fills its PostgreSQL snapshot
on the next signed-in push registration/sync.

Backend-first remains the preferred auth hardening rollout. If backend deployment is explicitly
deferred, the new frontend treats only `/auth/session` `404`/`405` as an older-backend signal and
falls back once to `/auth/google`. This keeps login available, but the one-call session matching,
revocation check, atomic rotation, Strict-cookie, Origin, and rate-limit changes are not active in
production until the backend is deployed. Never fall back on `400`, `401`, `403`, `429`, or `5xx`.

After the backend is eventually deployed, verify one `/auth/session` `200` precedes protected
bootstrap calls and the legacy fallback disappears. Frontend rollback remains safe because the new
backend retains `/auth/google`, `/auth/refresh`, and `/auth/me`.

For the runner contract, exceptional switches, manual recovery, Cloudflare Tunnel configuration,
and troubleshooting, follow `backend/docs/PRODUCTION_BUILD.md`.

## Validation Before Push

For frontend changes:

```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

For backend changes:

```bash
cd backend
go test ./...
go build -o bin/api ./cmd/api
```
