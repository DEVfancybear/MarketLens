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

Backend framework decision: **Go Fiber**. Backend docs and future backend routes should follow
Fiber conventions.

## Environment Variables

### Frontend

Copy `.env.example` to `frontend/.env.local` when the variable is frontend-only. Keep shared
examples in the root `.env.example`.

### Backend

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `development` | Runtime environment |

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
