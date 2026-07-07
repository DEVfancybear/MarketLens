# SMC Trading Terminal Backend

The backend consists of three runtime surfaces:

1. **Go API** - the primary HTTP API server. Fiber is the selected framework target.
2. **Python FTMO/MT5 Bridge** - a sidecar WebSocket service for broker/order integration.
3. **MT5 Tick Stream** - a local Python WebSocket bridge plus Go consumer for realtime MT5 market
   ticks.

Python bridges run as separate processes alongside the Go API. They are not part of the Go Fiber
request path.

Backend framework decision: **Fiber**. The active Go API uses Fiber handlers and route groups.

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

Run these commands from `backend/`:

```bash
# Install dependencies
python -m pip install -r bridge/ftmo_mt5/requirements.txt

# Dry-run (no MT5 required)
python -m bridge.ftmo_mt5.service
```

### MT5 Tick Stream

Run these commands from `backend/` on a Windows host with MT5 installed:

```bash
# Install stream bridge dependencies
python -m pip install -r bridge/mt5_stream/requirements.txt

# Start local MT5 tick WebSocket bridge on ws://localhost:8765
python -m bridge.mt5_stream.mt5_server

# In a second terminal, consume the stream from Go
go run ./cmd/mt5-stream

# Or run the API and let FE call /api/v1/mt5/symbols, /ticks, and /history
go run ./cmd/api
```

The frontend reads the full MT5 catalog from `GET /api/v1/mt5/symbols`, live watchlist prices from
`GET /api/v1/mt5/ticks`, and chart candles from on-demand `GET /api/v1/mt5/history` responses.
It never connects to the Python bridge directly.

## Configuration

### Go API

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `development` | Runtime environment |

### Python MT5 Bridge

See `bridge/ftmo_mt5/README.md` for full configuration reference.

### MT5 Tick Stream

See `bridge/mt5_stream/README.md` for full configuration reference.

## Project Structure

```text
backend/
  cmd/api/main.go              # Go API entry point
  internal/
    config/config.go           # Environment config
    httpserver/server.go       # HTTP app and server setup
    health/handler.go          # Health-check endpoint
    middleware/                # Shared HTTP middleware
  bridge/                      # Python MT5 WebSocket bridge (sidecar)
    ftmo_mt5/                  # FTMO broker integration
    mt5_stream/                # Local MT5 tick streaming bridge
  cmd/mt5-stream/main.go       # Go MT5 tick stream consumer
  docs/                        # Backend architecture and API docs
```

New backend code should use Fiber handlers, route groups, and middleware after Phase 0 migration.
