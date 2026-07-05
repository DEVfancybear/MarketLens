# SMC Trading Terminal Backend

The backend consists of two parts:

1. **Go Fiber API** — the primary HTTP API server
2. **Python MT5 Bridge** — a sidecar WebSocket service for FTMO broker integration

The Python bridge runs as a separate process alongside the Go API. It is not part of the Go Fiber
request path.

Backend framework decision: **Fiber**.

## Quick Start

### Go API

```bash
# Install dependencies
go mod tidy

# Run the server
go run ./cmd/api
```

Default server: `http://localhost:8080`

### Python MT5 Bridge

```bash
# Install dependencies
python -m pip install -r bridge/ftmo_mt5/requirements.txt

# Dry-run (no MT5 required)
python -m bridge.ftmo_mt5.service
```

## Configuration

### Go API

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `development` | Runtime environment |

### Python MT5 Bridge

See `bridge/ftmo_mt5/README.md` for full configuration reference.

## Project Structure

```text
backend/
  cmd/api/main.go              # Go API entry point
  internal/
    config/config.go           # Environment config
    httpserver/server.go       # Fiber app and server setup
    health/handler.go          # Health-check endpoint
    middleware/                # Shared Fiber-compatible middleware
  bridge/                      # Python MT5 WebSocket bridge (sidecar)
    ftmo_mt5/                  # FTMO broker integration
  docs/                        # Backend architecture and API docs
```

New backend code should use Fiber handlers, route groups, and middleware.
