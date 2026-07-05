# Operations

Day-to-day commands for developing, testing, and deploying the monorepo.

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

```bash
cd backend

# Install Go dependencies
go mod tidy

# Run API server
go run ./cmd/api

# Run tests
go test ./...

# Build binary
go build -o bin/api ./cmd/api
```

Backend dev server: `http://localhost:8080`

Backend framework decision: **Go Fiber**. The current scaffold still uses stdlib `net/http`; Phase 0
of the backend implementation plan migrates it to Fiber. Backend docs and future backend routes
should follow Fiber conventions.

## Python MT5 Bridge (Backend Sidecar)

Install dependencies:

```bash
cd backend
python -m pip install -r bridge/ftmo_mt5/requirements.txt
```

Dry-run (no MT5 required):

```bash
cd backend
$env:FTMO_MT5_ENABLED="true"
$env:FTMO_BRIDGE_DRY_RUN="true"
python -m bridge.ftmo_mt5.service
```

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
python -m bridge.ftmo_mt5.service
```

## Environment Variables

### Frontend

Copy `.env.example` to `frontend/.env.local` when the variable is frontend-only. Keep shared
examples in the root `.env.example`.

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
| `FTMO_BRIDGE_TOKEN` | (empty) | Optional auth token |
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

If Vercel reports `The specified Root Directory "frontend" does not exist`, the deployment is using
an old commit from before the monorepo split. Redeploy the latest `master` commit where the
`frontend/` folder exists.

### Backend

Deploy the Go backend as a separate service from `backend/`. Do not include it in the Vercel
frontend build.

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
