# Configuration

The backend reads configuration from environment variables.

## Go API

| Variable  | Type    | Default         | Description                                    |
| --------- | ------- | --------------- | ---------------------------------------------- |
| `PORT`    | integer | `8080`          | TCP port the HTTP server listens on            |
| `APP_ENV` | string  | `"development"` | Runtime environment (`development`, `production`) |

## MT5 Tick Stream

These variables are used by `bridge/mt5_stream/mt5_server.py` and `cmd/mt5-stream`.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `MT5_STREAM_API_ENABLED` | boolean | `true` | Start the Go API background client for `/api/v1/mt5/symbols` |
| `MT5_SYMBOLS` | string | empty | Comma-separated symbols to stream, for example `EURUSD,GBPUSD,XAUUSD` |
| `MT5_STREAM_ALL_VISIBLE` | boolean | `false` | Stream every MT5 symbol currently marked visible when `MT5_SYMBOLS` is empty |
| `MT5_STREAM_HOST` | string | `localhost` | Python WebSocket listen host |
| `MT5_STREAM_PORT` | integer | `8765` | Python WebSocket listen port |
| `MT5_POLL_INTERVAL_MS` | integer | `100` | Tick polling interval |
| `MT5_TERMINAL_PATH` | string | empty | Optional MT5 terminal executable path |
| `MT5_LOGIN` | integer | empty | Optional MT5 login; set with password/server |
| `MT5_PASSWORD` | string | empty | Optional MT5 password; keep out of browser env |
| `MT5_SERVER` | string | empty | Optional MT5 broker server name |
| `MT5_STREAM_LOG_LEVEL` | string | `INFO` | Python bridge log level |
| `MT5_BRIDGE_WS_URL` | string | `ws://localhost:8765` | Go consumer bridge URL |
| `MT5_BRIDGE_DIAL_TIMEOUT_SECONDS` | integer | `10` | Go consumer WebSocket dial timeout |
| `MT5_BRIDGE_READ_LIMIT_BYTES` | integer | `8388608` | Go consumer max WebSocket message size; large enough for MT5 symbol catalogs |
| `MT5_BRIDGE_RECONNECT_MIN` | duration | `1s` | Go API/client minimum reconnect backoff |
| `MT5_BRIDGE_RECONNECT_MAX` | duration | `30s` | Go API/client maximum reconnect backoff |

## Setting variables

### Linux / macOS

```bash
export PORT=3001
export APP_ENV=production
go run ./cmd/api
```

### Windows (PowerShell)

```powershell
$env:PORT = "3001"
$env:APP_ENV = "production"
go run ./cmd/api
```

### Docker

```bash
docker run -e PORT=3001 -e APP_ENV=production my-image
```
