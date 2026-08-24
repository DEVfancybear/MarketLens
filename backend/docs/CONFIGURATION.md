# Backend configuration

Copy `backend/.env.example` to the ignored `backend/.env` for local/host configuration. The Go
loader reads process environment first, then local dotenv files without overwriting already-set
values. Rust and Python processes inherit the runner's validated environment.

Never commit real secrets. Production secret files must be absolute, non-link, ACL-restricted
files. Public URLs and browser variables do not replace backend service authentication.

## Core Go API

| Variable | Default | Contract |
| --- | --- | --- |
| `PORT` | `8080` | Go API listen port |
| `APP_ENV` | `development` | `production` activates required-secret and secure-cookie checks |
| `AUTH_COOKIE_SECURE` | true outside development | Must be true in production |
| `DATABASE_URL` | empty | PostgreSQL DSN; required in production and for protected persistent routes |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated exact HTTP/HTTPS origins; no wildcard/path/query/credentials |
| `CHART_TIME_ZONE` | `Asia/Ho_Chi_Minh` | Valid IANA timezone for exchange-mode chart navigation |

`GET /health` remains available without a database. `GET /health/ready` reports unconfigured or
unreachable PostgreSQL and must pass before production traffic is considered ready.

## Authentication and alert services

| Variable | Default | Contract |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | empty | Independent 32+ character HMAC secret whenever auth is configured |
| `AUTH_ACCESS_TTL` | `15m` | Allowed 1 minute through 1 hour |
| `AUTH_REFRESH_TTL` | `720h` | Longer than access TTL; at most 2160 hours |
| `FIREBASE_PROJECT_ID` | empty | Firebase service-account project |
| `FIREBASE_CLIENT_EMAIL` | empty | Firebase service-account email |
| `FIREBASE_PRIVATE_KEY` | empty | PEM with newlines escaped as `\n` in dotenv |
| `PUSH_WORKER_SECRET` | empty | Independent 32+ character worker secret; required in production |
| `ALERT_EVALUATOR_ENABLED` | `true` | Starts backend scheduler calls to the evaluator URL |
| `ALERT_EVALUATOR_URL` | environment-derived | Required when evaluator is enabled in production; HTTP(S), no userinfo/fragment |
| `ALERT_EVALUATOR_INTERVAL` | `60s` | Must be positive |
| `ALERT_EVALUATOR_TIMEOUT` | `30s` | Must be positive and shorter than interval |

Firebase values are all-or-nothing. Authentication is assembled when PostgreSQL and all three
Firebase values are present; `AUTH_JWT_SECRET` is then mandatory even in development.

## Execution gateway and trade security

| Variable | Default | Contract |
| --- | --- | --- |
| `EXECUTION_GATEWAY_BIND` | `127.0.0.1:8790` | Rust common-EA listener; loopback only |
| `EXECUTION_ADMIN_BIND` | `127.0.0.1:8791` | Rust admin/managed-worker listener; loopback only |
| `EXECUTION_EA_URL` | `http://127.0.0.1:8790` | Go-to-Rust EA URL; validated loopback when execution is enabled |
| `EXECUTION_ADMIN_URL` | `http://127.0.0.1:8791` | Go-to-Rust admin URL; validated loopback |
| `EXECUTION_ADMIN_TOKEN` | empty | Independent unpredictable 32+ character admin secret; required in production |
| `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN` | empty | Independent private-worker enrollment secret; absence disables new enrollment |
| `EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE` | empty | Absolute file containing tenant-bound MT5 identity key material |
| `EXECUTION_DATABASE_MAX_CONNECTIONS` | `10` | Rust PostgreSQL pool bound |
| `RUST_LOG` | `execution_gateway=info` | Rust tracing filter |
| `TRADE_AUTHORIZATION_TTL` | `45s` | Operation-bound capability lifetime; allowed 10 seconds to 2 minutes |

Go sends `EXECUTION_ADMIN_TOKEN` only to the admin listener. The EA, browser, and managed worker
must not receive it. Do not reuse it as the worker bootstrap token or identity HMAC key.

## Managed MT5 Windows credential storage

Managed broker credentials have no service URL, API token, namespace, password environment
variable, or application plaintext file. Go stores bounded generic records in Windows Credential
Manager under the stable Windows identity running the API. Targets contain only
`MarketLens:MT5:<opaque-reference>`; PostgreSQL stores the opaque reference and grant hashes.

`EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE` remains independently required for stable tenant-bound
identity derivation. Startup advertises the connector only after the API identity completes an
exact synthetic write/read/delete/absence probe. A host or service-identity change requires users
to reconnect because database restore does not restore identity-bound credential records.

## Trade-password recovery email

| Variable | Default | Contract |
| --- | --- | --- |
| `TRADE_RECOVERY_SMTP_HOST` | empty | SMTP host; required in production |
| `TRADE_RECOVERY_SMTP_PORT` | `587` | 1-65535 |
| `TRADE_RECOVERY_SMTP_USERNAME` | empty | Optional only as a pair with password; required in production |
| `TRADE_RECOVERY_SMTP_PASSWORD` | empty | Optional only as a pair with username; required in production |
| `TRADE_RECOVERY_SMTP_MODE` | `starttls` | `starttls`, `tls`, or `plain`; production rejects `plain` |
| `TRADE_RECOVERY_EMAIL_FROM` | empty | Valid sender address; required when SMTP is configured and in production |

The recovery service is unavailable when this group is absent. Do not substitute a broker password
or Firebase credential for the trade password.

## Screenshot object storage

| Variable | Default | Contract |
| --- | --- | --- |
| `OBJECT_STORAGE_ENDPOINT` | empty | Optional S3-compatible endpoint; empty uses AWS-style endpoint construction |
| `OBJECT_STORAGE_BUCKET` | empty | Required with access/secret keys |
| `OBJECT_STORAGE_REGION` | `us-east-1` | Signing region |
| `OBJECT_STORAGE_ACCESS_KEY` | empty | Required with bucket/secret key |
| `OBJECT_STORAGE_SECRET_KEY` | empty | Required with bucket/access key |
| `OBJECT_STORAGE_SESSION_TOKEN` | empty | Optional temporary-session token |
| `OBJECT_STORAGE_PATH_STYLE` | `false` | Enable for providers requiring path-style URLs |

Bucket, access key, and secret key are all-or-nothing. When storage is absent, screenshot uploads
remain unavailable/local-buffered while journal metadata APIs continue according to their source
contract.

## Private MT5 market-data path

### Go consumer

| Variable | Default | Contract |
| --- | --- | --- |
| `MT5_STREAM_API_ENABLED` | `true` | Mount/connect the browser-facing market-data API |
| `MT5_BRIDGE_WS_URL` | `ws://localhost:8765` | Private Python sidecar URL |
| `MT5_BRIDGE_DIAL_TIMEOUT_SECONDS` | `10` | Dial timeout; duration or legacy seconds value |
| `MT5_BRIDGE_READ_LIMIT_BYTES` | `8388608` | Maximum inbound WebSocket message size |
| `MT5_BRIDGE_RECONNECT_MIN` | `1s` | Minimum reconnect delay |
| `MT5_BRIDGE_RECONNECT_MAX` | `30s` | Maximum reconnect delay; not below minimum |
| `MT5_TERMINAL_PATH` | empty | Optional terminal path used by the runner/sidecar |

### Python sidecar

| Variable | Default | Contract |
| --- | --- | --- |
| `MT5_STREAM_HOST` | `localhost` | Private listen host |
| `MT5_STREAM_PORT` | `8765` | Private listen port |
| `MT5_SYMBOLS` | empty | Comma-separated always-streamed base symbols |
| `MT5_STREAM_ALL_VISIBLE` | `false` | Poll every visible Market Watch symbol; normally false |
| `MT5_POLL_INTERVAL_MS` | `100` | Tick polling interval |
| `MT5_HISTORY_BARS` | `1500` | Default history window |
| `MT5_HISTORY_TIMEFRAMES` | configured list | Eligible preload timeframes |
| `MT5_PRELOAD_HISTORY` | `false` | Prefer on-demand history in normal operation |
| `MT5_HISTORY_SYNC_RETRIES` | `2` | Cold-history retry budget |
| `MT5_HISTORY_SYNC_DELAY_MS` | `300` | Delay between history refresh attempts |
| `MT5_LOGIN` | empty | Optional local sidecar login; all credential fields must be set together |
| `MT5_PASSWORD` | empty | Optional local sidecar password; never log or commit |
| `MT5_SERVER` | empty | Optional local sidecar broker server |
| `MT5_MARKET_STATUS_FILE` | auto-discovered | Native session-helper JSON override |
| `MT5_MARKET_STATUS_POLL_MS` | `1000` | Session-helper poll interval |
| `MT5_MARKET_STATUS_MAX_AGE_SECONDS` | `20` | Stale helper observations become `unknown` |
| `MT5_STREAM_LOG_LEVEL` | `INFO` | Python log level |

The `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` group is only for the private read-only market-data
terminal. Managed execution credentials use Windows Credential Manager and never these variables.

## Replay engine

| Variable | Default | Contract |
| --- | --- | --- |
| `REPLAY_ENGINE_ENABLED` | `false` | Enables the backend actor; schema/routes can exist while disabled |
| `REPLAY_MAX_BARS_PER_TRACK` | `5000` | Positive per-track cap |
| `REPLAY_MAX_TRACKS_PER_SESSION` | `4` | Positive session track cap |
| `REPLAY_CLEANUP_INTERVAL` | `1h` | Positive cleanup cadence |
| `REPLAY_SESSION_RETENTION` | `720h` | Closed-session retention |
| `REPLAY_DATASET_RETENTION` | `168h` | Unreferenced dataset retention |
| `REPLAY_DISCONNECT_GRACE` | `5s` | Actor disconnect grace |
| `REPLAY_ACTOR_LEASE_TTL` | `5s` | Actor lease duration; keep compatible with failover assumptions |

## Production minimum

For `APP_ENV=production`, Go fails fast unless the required base configuration is present:

- `DATABASE_URL`, `AUTH_JWT_SECRET`, all Firebase values, and non-empty
  `CORS_ALLOWED_ORIGINS`;
- `PUSH_WORKER_SECRET`, `EXECUTION_ADMIN_TOKEN`, and secure cookies;
- all trade-recovery SMTP values;
- `ALERT_EVALUATOR_URL` when the evaluator is enabled.

The canonical runner/deploy scripts add further host checks, including the identity-key file and
managed Python environment. Use [PRODUCTION_BUILD.md](PRODUCTION_BUILD.md); do not infer production
readiness from a process merely starting in development mode.

## Local examples

PowerShell process scope:

```powershell
$env:DATABASE_URL = 'postgres://user:pass@localhost:5432/marketlens?sslmode=disable'
$env:APP_ENV = 'development'
go run ./cmd/api
```

Do not paste production secret values into shell history. Prefer ignored dotenv files for local
development and ACL-protected secret files/service configuration on the production host.
