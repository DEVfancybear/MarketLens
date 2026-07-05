# SMC Trading Terminal — Backend

Go API server for the SMC Trading Terminal.

## Quick start

```bash
# Install dependencies
go mod tidy

# Run the server
go run ./cmd/api

# The health endpoint is available at
# http://localhost:8080/health
```

## Configuration

| Variable   | Default       | Description          |
| ---------- | ------------- | -------------------- |
| `PORT`     | `8080`        | HTTP listen port     |
| `APP_ENV`  | `development` | Runtime environment  |

## Project structure

```
backend/
  cmd/api/main.go              # Entry point
  internal/
    config/config.go           # Environment config
    httpserver/server.go       # HTTP server setup
    health/handler.go          # Health-check endpoint
    middleware/logging.go      # Request logging middleware
```
