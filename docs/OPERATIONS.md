# Operations

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

Cloudflare DNS keeps the Vercel apex CNAME in DNS-only mode. The `api` hostname is a proxied
Cloudflare Tunnel record targeting the Go API on this Windows host. Do not expose the private MT5
market-data sidecar on port 8765 or the execution bridge on port 8787.

If Vercel reports `The specified Root Directory "frontend" does not exist`, the deployment is using
an old commit from before the monorepo split. Redeploy the latest `master` commit where the
`frontend/` folder exists.

### Backend

Deploy the Go backend as a separate service from `backend/`. Do not include it in the Vercel
frontend build.

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
