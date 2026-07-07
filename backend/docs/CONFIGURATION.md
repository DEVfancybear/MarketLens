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
| `MT5_STREAM_API_ENABLED` | boolean | `true` | Start the Go API background client for `/api/v1/mt5/symbols`, `/api/v1/mt5/ticks`, and `/api/v1/mt5/history` |
| `MT5_SYMBOLS` | string | empty | Comma-separated extra symbols to stream, for example `EURUSD,GBPUSD,XAUUSD` |
| `MT5_STREAM_ALL_VISIBLE` | boolean | `true` | Stream every MT5 symbol currently marked visible; when true, `MT5_SYMBOLS` is added on top of visible symbols |
| `MT5_STREAM_HOST` | string | `localhost` | Python WebSocket listen host |
| `MT5_STREAM_PORT` | integer | `8765` | Python WebSocket listen port |
| `MT5_POLL_INTERVAL_MS` | integer | `100` | Tick polling interval |
| `MT5_HISTORY_BARS` | integer | `1500` | Default candle count for Python history responses |
| `MT5_HISTORY_TIMEFRAMES` | string | `1m,3m,5m,15m,30m,1H,2H,4H,1D,1W,1M` | Supported preload timeframes when `MT5_PRELOAD_HISTORY=true` |
| `MT5_PRELOAD_HISTORY` | boolean | `false` | Preload history messages on every bridge connection; normally leave false because the Go API requests history on demand |
| `MT5_HISTORY_SYNC_RETRIES` | integer | `12` | Python bridge retry budget when MT5 initially returns stale history bars |
| `MT5_HISTORY_SYNC_DELAY_MS` | integer | `300` | Non-blocking async delay between MT5 history refresh attempts |
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
