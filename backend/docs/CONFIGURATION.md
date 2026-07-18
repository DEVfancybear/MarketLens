# Configuration

The backend reads configuration from environment variables.

## Go API

Copy `backend/.env.example` to `backend/.env` for local development.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `PORT` | integer | `8080` | TCP port the HTTP server listens on |
| `APP_ENV` | string | `development` | Runtime environment; production enables required-secret checks and secure cookies |
| `AUTH_COOKIE_SECURE` | boolean | `false` in development, `true` otherwise | Override the session-cookie `Secure` flag; set `false` only for local HTTP, keep `true` behind HTTPS |
| `DATABASE_URL` | string | empty | PostgreSQL used by migrations, workspace sync, alerts, history, and push-token ownership |
| `AUTH_JWT_SECRET` | string | empty | Backend access/refresh token secret; use at least 32 random bytes in production |
| `AUTH_ACCESS_TTL` | duration | `15m` | Access-token lifetime |
| `AUTH_REFRESH_TTL` | duration | `720h` | Refresh-token lifetime |
| `FIREBASE_PROJECT_ID` | string | empty | Firebase Admin project used to verify ID tokens |
| `FIREBASE_CLIENT_EMAIL` | string | empty | Firebase Admin service-account email |
| `FIREBASE_PRIVATE_KEY` | string | empty | Firebase Admin PEM; escaped `\n` newlines are supported |
| `CORS_ALLOWED_ORIGINS` | CSV | `http://localhost:3000` | Credentialed browser origins; wildcard is unsupported |
| `CHART_TIME_ZONE` | IANA timezone | `Asia/Ho_Chi_Minh` | Backend-owned display/input timezone for the chart's `Exchange` option; MT5 candle timestamps remain UTC |
| `OBJECT_STORAGE_ENDPOINT` | URL | AWS regional S3 endpoint | Optional S3-compatible endpoint for R2/MinIO |
| `OBJECT_STORAGE_BUCKET` | string | empty | Screenshot bucket; required with access/secret keys |
| `OBJECT_STORAGE_REGION` | string | `us-east-1` | SigV4 signing region (`auto` for Cloudflare R2) |
| `OBJECT_STORAGE_ACCESS_KEY` | string | empty | S3-compatible access key (server only) |
| `OBJECT_STORAGE_SECRET_KEY` | string | empty | S3-compatible secret key (server only) |
| `OBJECT_STORAGE_SESSION_TOKEN` | string | empty | Optional temporary credential session token |
| `OBJECT_STORAGE_PATH_STYLE` | boolean | `false` | Use `/bucket/key` URLs; normally true for local MinIO |

### Phase 11 screenshot storage

Journal CRUD only needs the database and normal authenticated API configuration. Screenshot bytes
use a two-step direct-browser upload and require all three of `OBJECT_STORAGE_BUCKET`,
`OBJECT_STORAGE_ACCESS_KEY`, and `OBJECT_STORAGE_SECRET_KEY`; partial credential configuration is
rejected at startup. With all three empty, journal CRUD remains available and screenshot upload
returns HTTP 503 so the frontend can retain its IndexedDB fallback.

The bucket CORS policy must allow `PUT` and `GET` from the frontend origin and allow the
`Content-Type` request header. Credentials never belong in frontend environment variables.

### Phase 10 push responsibility

The Go API does not send FCM notifications. It stores authenticated device-token ownership in
PostgreSQL through `/api/v1/push/tokens`; Phase 10 therefore needs `DATABASE_URL` and the normal
Firebase Admin authentication configuration, but no additional Go push secret.

The Next server evaluates closed-browser alerts and sends FCM. Configure it from
`frontend/.env.example`. The same Firebase project/service account can be used in both env files,
but server credentials must never use a `NEXT_PUBLIC_` prefix.

## Closed-browser alert scheduler

| Variable | Default | Purpose |
|---|---|---|
| `ALERT_EVALUATOR_ENABLED` | `true` | Run the scheduler inside the persistent Go API process |
| `ALERT_EVALUATOR_URL` | `http://localhost:3000/api/push/evaluate` | Next evaluator endpoint; set to the production frontend URL when deployed |
| `ALERT_EVALUATOR_INTERVAL` | `15s` | Delay between sequential evaluation calls |
| `ALERT_EVALUATOR_TIMEOUT` | `30s` | HTTP timeout for one evaluation |
| `PUSH_WORKER_SECRET` | empty in dev | Shared evaluator/service authentication; required in production |

The scheduler runs one immediate tick, never overlaps its own calls, and stops
with the API context. External cron providers are fallback-only.

## MT5 Tick Stream

These variables are used by `bridge/mt5_stream/mt5_server.py` and `cmd/mt5-stream`.

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `MT5_STREAM_API_ENABLED` | boolean | `true` | Start the Go API background client for `/api/v1/mt5/symbols`, `/api/v1/mt5/stream`, `/api/v1/mt5/ticks`, `/api/v1/mt5/market-status`, and `/api/v1/mt5/history` |
| `MT5_SYMBOLS` | string | empty | Comma-separated extra symbols to stream, for example `EURUSD,GBPUSD,XAUUSD` |
| `MT5_STREAM_ALL_VISIBLE` | boolean | `true` | Stream every MT5 symbol currently marked visible; when true, `MT5_SYMBOLS` is added on top of visible symbols |
| `MT5_STREAM_HOST` | string | `localhost` | Python WebSocket listen host |
| `MT5_STREAM_PORT` | integer | `8765` | Python WebSocket listen port |
| `MT5_POLL_INTERVAL_MS` | integer | `100` | Tick polling interval |
| `MT5_HISTORY_BARS` | integer | `1500` | Default candle count for Python history responses |
| `MT5_HISTORY_TIMEFRAMES` | string | `1m,3m,5m,15m,30m,1H,2H,4H,1D,1W,1M` | Supported preload timeframes when `MT5_PRELOAD_HISTORY=true` |
| `MT5_PRELOAD_HISTORY` | boolean | `false` | Preload history messages on every bridge connection; normally leave false because the Go API requests history on demand |
| `MT5_HISTORY_SYNC_RETRIES` | integer | `2` | Python bridge retry budget when MT5 initially returns empty history |
| `MT5_HISTORY_SYNC_DELAY_MS` | integer | `300` | Non-blocking async delay between MT5 history refresh attempts |
| `MT5_TERMINAL_PATH` | string | empty | Optional MT5 terminal executable path |
| `MT5_LOGIN` | integer | empty | Optional MT5 login; set with password/server |
| `MT5_PASSWORD` | string | empty | Optional MT5 password; keep out of browser env |
| `MT5_SERVER` | string | empty | Optional MT5 broker server name |
| `MT5_MARKET_STATUS_FILE` | string | auto-discovered | Optional override for the MQL5 helper's `market_sessions.json` path |
| `MT5_MARKET_STATUS_POLL_MS` | integer | `1000` | Local helper-file polling interval, clamped to at least `250`; no broker/network polling is performed |
| `MT5_MARKET_STATUS_MAX_AGE_SECONDS` | integer | `20` | Maximum helper heartbeat age, clamped to at least `5`, before every cached session state becomes `unknown` |
| `MT5_STREAM_LOG_LEVEL` | string | `INFO` | Python bridge log level |
| `MT5_BRIDGE_WS_URL` | string | `ws://localhost:8765` | Go consumer bridge URL |
| `MT5_BRIDGE_DIAL_TIMEOUT_SECONDS` | integer | `10` | Go consumer WebSocket dial timeout |
| `MT5_BRIDGE_READ_LIMIT_BYTES` | integer | `8388608` | Go consumer max WebSocket message size; large enough for MT5 symbol catalogs |
| `MT5_BRIDGE_RECONNECT_MIN` | duration | `1s` | Go API/client minimum reconnect backoff |
| `MT5_BRIDGE_RECONNECT_MAX` | duration | `30s` | Go API/client maximum reconnect backoff |

Exact scheduled open/closed status requires the read-only native MQL5 helper in
[`bridge/mt5_session`](../bridge/mt5_session/README.md). The Python package does
not expose `SymbolInfoSessionTrade`; when the helper is missing or stale, the
API deliberately returns `unknown` instead of inferring a session from tick age.

Bridge regression tests can run without an installed MT5 terminal because they
stub the `MetaTrader5` module:

```powershell
cd backend
python -m unittest bridge.mt5_stream.test_mt5_server -v
```

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
