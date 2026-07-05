# Operations

Day-to-day commands for developing and running the SMC Trading Terminal.

## Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development server (http://localhost:3000)
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Production build
npm run build
npm run start

# Run tests
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

# Run the API server (http://localhost:8080)
go run ./cmd/api

# Run tests
go test ./...

# Build binary
go build -o bin/api ./cmd/api
```

## Useful scripts (frontend)

| Command                  | Purpose                              |
| ------------------------ | ------------------------------------ |
| `npm run mock-mt5`       | Start mock MT5 bridge                |
| `npm run ftmo-mt5-bridge`| Start FTMO MT5 bridge (Node)         |
| `npm run push-worker`    | Start push alert worker              |
| `npm run check:...`      | Various parity/integrity check tools |

## Environment variables

### Frontend

Copy `.env.example` to `.env.local` and configure as needed.

### Backend

| Variable  | Default       | Description      |
| --------- | ------------- | ---------------- |
| `PORT`    | `8080`        | HTTP listen port |
| `APP_ENV`  | `development` | Runtime env      |
