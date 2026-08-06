# Production build and runtime runbook

> Superseded for trade execution (2026-07-26): do not use the legacy verifier,
> downloadable Connector, or port 8787 instructions retained in this historical
> runbook. The canonical command remains `.\run-backend-production.ps1`; the
> current execution topology and gates are in
> `../../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md`.

This is the repeatable checklist for the production SMC Trading Terminal. The frontend is hosted
by Vercel; the Go API, Python MT5 helpers/sidecars, and logged-in MetaTrader 5 terminal run on a
Windows host.

```text
Browser -> https://tradingterminal.io.vn (Vercel)
       -> ws://127.0.0.1:8787 (packaged Connector on each user's Windows PC)
       -> https://api.tradingterminal.io.vn (Cloudflare Tunnel)
          -> Go/Fiber API localhost:8080
             -> Python MT5 market-data sidecar localhost:8765
             -> short-lived MT5 verifier process (stdin/stdout, no port)
                -> logged-in MetaTrader 5 terminal
             -> PostgreSQL (DATABASE_URL)
```

All MT5 sidecars and Connectors must remain private on localhost. Cloudflare Tunnel exposes only the Go API.
Do not open router ports 8080, 8765, or 8787 and do not put MT5 credentials in Vercel or browser
env.

## Current production endpoints

| Component | Address | Hosting |
| --- | --- | --- |
| Frontend | `https://tradingterminal.io.vn` | Vercel, DNS-only CNAME in Cloudflare |
| Public API | `https://api.tradingterminal.io.vn` | Cloudflare Tunnel |
| Go API origin | `http://localhost:8080` | This Windows host |
| MT5 market-data sidecar | `ws://localhost:8765` | This Windows host, private only |
| FTMO Connector | `ws://127.0.0.1:8787` | Each user's Windows PC, loopback only |
| MT5 verifier | no listening port | Short-lived child of the Go API |

The legacy Vercel URL may continue to resolve, but production configuration and user links should
use `tradingterminal.io.vn`.

## Canonical `build backend production` / `run backend` command

The phrases **build backend production** and **run backend** always mean this one command from the
repository root on the Windows production host:

```powershell
.\run-backend-production.ps1
```

This script is the single normal production entrypoint. Do not replace it with a manual
`go build`, `api.exe`, or `python -m ...` command. It performs the complete workflow:

1. Refuses a dirty production worktree, then runs `git pull --ff-only`.
2. Provisions and import-checks `backend\.venv-mt5`.
3. Builds `backend\bin\api.next.exe` without rebuilding the Vercel frontend.
4. Applies forward-only migrations and prints the migration version.
5. Starts MT5 when needed and provisions an isolated verifier from an existing FTMO installation
   or FTMO's MetaQuotes-signed public installer; it never changes the market-data account.
6. Stops only repository-owned listeners on `8080`/`8765`, atomically promotes the staged API,
   then starts the MT5 market-data sidecar and Go API from `backend\`.
7. Requires local liveness, database readiness, MT5 `connected:true`, verifier-runtime startup
   confirmation, and public Cloudflare readiness before reporting success.
8. Writes timestamped stdout/stderr and PID files under ignored `.runtime-logs\`.

Useful recovery switches are `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, and
`-SkipPublicHealthCheck`. They are exceptional/manual recovery options; an ordinary request to
build or run production uses no switches.

The script intentionally does not start port `8787`. The packaged Connector is browser/account
local (`ws://127.0.0.1:8787`) on each user's PC and is not part of the multi-user backend server.

## Artifact build options (manual or CI only)

### Full production build (Go API + frontend)

From the repository root in PowerShell:

```powershell
.\build-production.ps1
```

The script creates `backend\.venv-mt5` when needed, installs the declared MT5 helper requirements,
checks that `MetaTrader5` and `websockets` import successfully, then performs a stripped Go build
and a local Next.js production build. The Go API automatically discovers that virtual environment
when `MT5_VERIFY_PYTHON` is unset. It does not start services, modify secrets, run migrations,
deploy Vercel, or expose a port. The generated Go binary is `backend\bin\api.exe`; `.next` is the
local Next.js artifact. Both are ignored by git. Vercel builds the frontend again from the pushed
commit with its own Production environment variables.

Install 64-bit Python 3 for Windows, Go, and Node.js/npm before the first build. The script runs
`npm ci` automatically when `frontend\node_modules` is absent. The build validates
`MT5_VERIFY_TERMINAL_PATH` when it is set. At runtime, the canonical production runner exports the
resolved market-data path and either honors a distinct verifier override or provisions an isolated
portable clone automatically before it starts the API.

Only a host that intentionally does not support MT5 may skip Python provisioning:

```powershell
.\build-production.ps1 -SkipMT5PythonSetup
```

Do not use that switch on the trading server; account verification requires the provisioned
Python environment.

### Backend-only production build (optional)

Use this option when only the Go API, database migrations, MT5 bridge, or host configuration has
changed and the frontend does not need a new local production artifact. It intentionally does
**not** build or start the frontend. The full build above remains the required option after frontend
changes or whenever a local Next.js production-build check is wanted.

```powershell
.\build-production.ps1 -BackendOnly
```

The resulting artifact is the same `backend\bin\api.exe` produced by `build-production.ps1`.
Backend-only mode still creates/updates and import-checks `backend\.venv-mt5`; it skips only the
local Next.js build. The canonical runner additionally uses `-StageApi` so a new binary is complete
before the currently running API is replaced.

## Manual production recovery sequence

Use this section only when the canonical `run-backend-production.ps1` entrypoint fails and an
operator needs to isolate one step. It is not the normal interpretation of **build backend
production** or **run backend**.

### 1. Pull and migrate before starting the new API

Run from the repository root. `migrate up` applies only pending migrations; it never rolls back the
schema.

```powershell
git pull --ff-only

cd backend
go run ./cmd/migrate up
go run ./cmd/migrate version
cd ..
```

The version command must report `dirty=false` and the current highest migration version. Do not use
`migrate force` or `migrate down` as part of a normal production update.

### 2. Choose the recovery build scope

- Run `./build-production.ps1` for a manual full Go API + frontend artifact build.
- Run `./build-production.ps1 -BackendOnly` for a manual backend-only artifact build.

Both build commands only create local ignored artifacts. Neither starts a service, modifies secrets,
runs migrations, or deploys Vercel.

### 3. Start or restart runtime services in order

Use separate PowerShell sessions (or the equivalent Windows services). Before replacing a running
API or bridge, stop its existing process cleanly in the session or service manager that started it;
do not launch duplicate listeners on ports `8080` or `8765`.

1. Start MetaTrader 5, sign in to the intended account, and wait for a live broker connection:

   ```powershell
   Start-Process "C:\Program Files\MetaTrader 5\terminal64.exe"
   ```

2. Start the private market-data bridge from `backend/`:

   ```powershell
   cd backend
   .\.venv-mt5\Scripts\python.exe -m bridge.mt5_stream.mt5_server
   ```

   Wait for `MT5 initialized` and `tick WebSocket listening`. This bridge must remain private on
   `localhost:8765`.

3. Start the freshly built Go API from `backend/`:

   ```powershell
   cd backend
   $env:APP_ENV = "production"
   .\bin\api.exe
   ```

4. Start the named Cloudflare Tunnel from the repository root when it is not already installed as
   a Windows service:

   ```powershell
   C:\Cloudflared\bin\cloudflared.exe tunnel --config .runtime-logs\cloudflared-config.yml run
   ```

   The tunnel is required for `https://api.tradingterminal.io.vn` to reach the local API. It exposes
   only port `8080` through Cloudflare; never expose `8765` or `8787` publicly.

Each user's packaged Connector stays separate from the server, as described in
[Per-user verification and packaged Connector](#4-per-user-verification-and-packaged-connector).

### 4. Verify local and public traffic

Run these checks after the API and tunnel are listening. The MT5 symbols result must report
`connected:true`.

```powershell
# Local API, database, and MT5 bridge
Invoke-WebRequest http://localhost:8080/health
Invoke-WebRequest http://localhost:8080/health/ready
Invoke-WebRequest http://localhost:8080/api/v1/mt5/symbols

# Public API through Cloudflare Tunnel
Invoke-WebRequest https://api.tradingterminal.io.vn/health/ready
Invoke-WebRequest https://api.tradingterminal.io.vn/api/v1/mt5/symbols
```

If the local checks succeed but the browser reports a network error for
`https://api.tradingterminal.io.vn/api/v1/...`, check whether `cloudflared` is running and restart
the tunnel in step 3. A successful local API alone cannot serve the Vercel frontend.

## Required configuration

Never commit `backend\.env`, root `.env.local`, Firebase private keys, MT5 passwords, or generated
runtime logs. Start from `backend\.env.example` and root `.env.example`.

At minimum, production requires:

- `DATABASE_URL`
- `AUTH_JWT_SECRET` (at least 32 random bytes)
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`
- `PUSH_WORKER_SECRET`
- `CORS_ALLOWED_ORIGINS` containing the exact browser origin(s)
- `NEXT_PUBLIC_API_BASE_URL` for the frontend API origin

Current production values are:

```env
# Vercel Production environment
NEXT_PUBLIC_API_BASE_URL=https://api.tradingterminal.io.vn
NEXT_PUBLIC_APP_URL=https://tradingterminal.io.vn
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://127.0.0.1:8787

# backend/.env on the Windows host
APP_ENV=production
PORT=8080
AUTH_COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://tradingterminal.io.vn
ALERT_EVALUATOR_URL=https://tradingterminal.io.vn/api/push/evaluate
MT5_BRIDGE_WS_URL=ws://localhost:8765
MT5_TERMINAL_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
# Leave unset/blank to use backend\.venv-mt5 created by build-production.ps1.
MT5_VERIFY_PYTHON=
MT5_VERIFY_SCRIPT=bridge/ftmo_mt5/verify_account.py
# Optional override; leave blank for the runner-managed isolated clone.
MT5_VERIFY_TERMINAL_PATH=
MT5_VERIFY_TIMEOUT=30s
MT5_VERIFY_NATIVE_TIMEOUT_MS=8000
```

Leaving `MT5_VERIFY_PYTHON` blank is preferred. The API treats old bare aliases such as `python` as
automatic selection and probes each candidate with `import MetaTrader5`; a broken explicit runtime
falls back to `backend\.venv-mt5\Scripts\python.exe`. Restart the Go API after changing any
`MT5_VERIFY_*` value or rebuilding the venv.

When explicitly set, `MT5_VERIFY_TERMINAL_PATH` must point to an installation different from
`MT5_TERMINAL_PATH`. Normally it stays blank: the runner prefers an installed FTMO terminal, uses
the market-data installation only when that session is itself FTMO, and otherwise downloads an
official MetaQuotes-signed FTMO installer. It refreshes a separate clone at
`backend\.data\mt5-verifier-terminal` when the source executable changes. The resolved paths are
exported to child processes only and are never written into `.env`.

Additional local/LAN origins may be appended to `CORS_ALLOWED_ORIGINS` for diagnostics. Never use
`*` because authenticated requests send cookies.

Production refuses to start with `AUTH_COOKIE_SECURE=false`. For local HTTP diagnostics, run with
`APP_ENV=development`; for every production run, omit `AUTH_COOKIE_SECURE` (the default is true) or
set it explicitly to `true`. A Secure cookie cannot be sent over plain HTTP.

The current frontend and API hostnames are different origins but the same site, so
`SameSite=Strict` cookies remain valid. If the frontend moves away from the
`tradingterminal.io.vn` registrable domain, do not loosen the cookie flag as a quick fix: redesign
and retest the cross-site CSRF boundary first.

The frontend Google sign-in values are public Firebase web-app settings and must be present in the
env file used at build time:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
```

Add `tradingterminal.io.vn` to Firebase Authentication -> Settings -> Authorized domains. When the
UI is opened by LAN IP, also add that host without scheme or port, for example `192.168.2.128`.
Keep `localhost` for local browser access.

## Manual start order on the Windows production host

The canonical runner performs this order automatically. Use the commands below only for recovery:
start MT5 first, then the market-data sidecar, then the API. Verify the signed-in user's account
before testing the browser-local packaged Connector. Cloudflare Tunnel may
remain running while the API is restarted.

### 1. MetaTrader 5 terminal

Start the installed `terminal64.exe`, sign in to the intended account, and wait until MT5 shows a
live broker connection. The Python package may select a logged-in terminal automatically, but set
`MT5_TERMINAL_PATH` explicitly when the installation is not at the runner's standard path. The
runner exports the resolved value and provisions a physically separate verifier instance.

### 2. MT5 market-data sidecar

Use the native Windows Python environment that has `MetaTrader5` and `websockets` installed. Keep
MetaTrader 5 open, logged in, and connected to the intended account.

```powershell
cd backend
.\.venv-mt5\Scripts\python.exe -m bridge.mt5_stream.mt5_server
```

The market-data sidecar listens on `ws://localhost:8765`. If the log contains
`IPC send failed (-10001)`,
restart this Python process after confirming the MT5 terminal is still logged in. A successful
startup logs `MT5 initialized account=...` and `tick WebSocket listening`.

The Python bridge reads its process environment and does not parse `backend/.env`. Manual terminal
login is the preferred production path; inject MT5 variables into the bridge process only when
unattended login is intentionally configured.

### 3. Go API

```powershell
cd backend
$env:APP_ENV = "production"
.\bin\api.exe
```

On startup, confirm the API logs `MT5 verifier runtime ready` and that `selected_python` points to
`backend\.venv-mt5\Scripts\python.exe` (or another interpreter that passed the import probe). A
`MT5 verifier runtime unavailable` log means no candidate could import `MetaTrader5`.

The API binds to `:8080` (all interfaces). Verify it before opening the UI:

```powershell
Invoke-WebRequest http://localhost:8080/health
Invoke-WebRequest http://localhost:8080/health/ready
Invoke-WebRequest http://localhost:8080/api/v1/mt5/symbols
```

Readiness must report `"ready":true` and `"database":"up"`. The MT5 symbols response should
report `connected:true`; its `streamSymbols` list grows when the frontend subscribes to watchlist
symbols.

### 4. Per-user verification and packaged Connector

Sign in, open **Connections & notifications**, and select **Connect & Verify MT5**. The Go API launches
the short-lived verifier configured by `MT5_VERIFY_*`; credentials travel to it only over stdin.
On success, the current user's integration receives `verifiedAt` and MT5 becomes selectable.
Changing login/server/password invalidates that verification.

Verifier configuration failures return the generic `MT5_VERIFIER_UNAVAILABLE` response; exact
operator diagnostics stay in backend logs. `MT5_VERIFICATION_TIMEOUT` means the isolated terminal
did not complete its native login within the bounded verification window.

If the response code is `dependency_unavailable`, the helper started but its selected Python could
not import `MetaTrader5`; it is not an FTMO password or terminal-login failure. Rerun the full
production build and restart the actual API service/process so it loads the new binary and venv.

For execution, the user downloads the Windows Connector from the same dialog, opens FTMO MT5 with
the verified account, runs `TradingTerminalMT5Connector.exe`, and allows the browser's Local
Network Access prompt. No source checkout, Python install, environment variable, terminal path, or
local token is required. The Connector listens only on `127.0.0.1:8787`, pairs with a one-use
backend ticket, selects the matching open terminal, and blocks commands after an account mismatch.

### 5. Next.js UI (local diagnostic only)

```powershell
cd frontend
npm run start
```

The local UI is available at `http://localhost:3000`. Production users use Vercel at
`https://tradingterminal.io.vn`. A Vercel redeploy is required after changing `NEXT_PUBLIC_*`
because those values are embedded in the browser bundle.

### 6. Cloudflare Tunnel

The named tunnel is `tradingterminal-backend`. Its ignored runtime config follows this shape:

```yaml
tunnel: tradingterminal-backend
credentials-file: C:\Users\<windows-user>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: api.tradingterminal.io.vn
    service: http://localhost:8080
  - service: http_status:404
```

Run it from a normal PowerShell session when it is not installed as a Windows service:

```powershell
C:\Cloudflared\bin\cloudflared.exe tunnel --config .runtime-logs\cloudflared-config.yml run
```

Never commit the tunnel JSON credential. For boot persistence, run PowerShell as Administrator and
install the Cloudflare Tunnel Windows service using the Cloudflare-issued service command/token.

## DNS, TLS, Vercel, and Firebase

Cloudflare remains authoritative DNS. The current routing is:

| Name | Type/target | Proxy |
| --- | --- | --- |
| `@` | CNAME target shown by the Vercel project | DNS only (gray cloud) |
| `api` | Cloudflare Tunnel `tradingterminal-backend` | Proxied |

Do not proxy the Vercel CNAME through Cloudflare. Vercel issues the frontend certificate; the
Cloudflare Universal certificate covers the proxied API hostname. In Vercel, attach
`tradingterminal.io.vn` to the Production deployment and set the two `NEXT_PUBLIC_*` values shown
above before redeploying. In Firebase, authorize `tradingterminal.io.vn` for Google sign-in.

## LAN and Internet exposure

The Go API already binds all interfaces. For LAN access, allow TCP 3000 and 8080 in Windows
Firewall on the Private profile and use `http://<machine-lan-ip>:3000`.

For Internet access, use the Cloudflare Tunnel described above. Router port forwarding is not
required. Never expose ports 8765/8787 or MT5 credentials. Public HTTPS deployments must use
`AUTH_COOKIE_SECURE=true`; update `CORS_ALLOWED_ORIGINS`, `NEXT_PUBLIC_API_BASE_URL`, and Firebase
Authorized domains whenever the public frontend hostname changes.

## Verification checklist

```powershell
# API and database
Invoke-WebRequest http://localhost:8080/health
Invoke-WebRequest http://localhost:8080/health/ready

# MT5 catalog and live snapshots
Invoke-WebRequest http://localhost:8080/api/v1/mt5/symbols
Invoke-WebRequest "http://localhost:8080/api/v1/mt5/ticks?symbols=EURUSD,BTCUSD,XAUUSD"

# UI
Invoke-WebRequest http://localhost:3000

# Public production
Invoke-WebRequest https://tradingterminal.io.vn
Invoke-WebRequest https://api.tradingterminal.io.vn/health/ready
Invoke-WebRequest https://api.tradingterminal.io.vn/api/v1/mt5/symbols
```

In the browser Network panel, `symbols`, `history`, and the market-data WebSocket should succeed.
After Google sign-in, **Connect & Verify MT5** should return a sanitized account summary. The
packaged Connector on `127.0.0.1:8787` is required only for live MT5 commands.

Auth bootstrap should make one `POST /api/v1/auth/session` request:

- `200` with existing matching access cookie: session reused, no cookie rewrite required;
- `200` with expired access + valid matching refresh: refresh rotated and both cookies rewritten;
- `200` without usable backend cookies: a new session is created;
- `400`: malformed/oversized ID token body;
- `401`: invalid/revoked/disabled, non-Google, or unverified-email Firebase identity;
- `429`: auth rate limit reached.
- `503`: the bounded Firebase revocation check is temporarily unavailable; retry with backoff.

An initial `GET /auth/me` or `POST /auth/refresh` 401 probe is no longer expected. After
`/auth/session` returns 200, `/api/v1/sync/bootstrap` and other protected requests must stop
returning 401. If the frontend is intentionally released before this backend, the temporary
compatibility sequence is `/auth/session` `404`/`405` followed by one `/auth/google` `200`; other
statuses must never trigger fallback.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Watchlist rows show `--` | Check bridge log for `IPC send failed`; restart bridge and confirm MT5 login. |
| MT5 is Configured but cannot be selected | Run **Connect & Verify MT5** for the signed-in user and inspect the sanitized failure message. |
| MT5 is Verified but orders are blocked | Open the verified account in FTMO MT5, run the downloaded Connector, and allow Local Network Access for the site. |
| `Workspace sync failed` / 401 | Inspect `POST /api/v1/auth/session`. Verify the Firebase project matches on frontend/backend, CORS includes the exact frontend origin, cookies are Secure/Strict, and Windows time is correct. Clear site data and sign in again only after fixing configuration. |
| Google says domain not allowed | Add the exact hostname (without scheme/port) under Firebase Authentication → Authorized domains. |
| `/api/push/alerts/sync` returns 401 | Firebase bearer token is missing/invalid; verify the frontend and Next Firebase projects match. |
| `/api/push/alerts/sync` returns 409 | The FCM token is owned by another Firebase user; sign out, clear site notification data/service worker state, then register under the intended account. Do not blindly retry. |
| `/api/push/alerts/sync` returns 503 | The eight-second Next deadline expired or the Go worker/PostgreSQL path is unavailable. Verify migration `0025`, public API reachability, database readiness, and matching `PUSH_WORKER_SECRET`; retry is safe. |
| Firebase `ACCESS_TOKEN_EXPIRED` | Synchronize Windows Time with an NTP peer, then restart Next. |
| Migration reports `dirty=true` | Stop before replacing services. Inspect the failed migration and actual schema first. Use `migrate force` only when the schema version has been proven and the failed transaction's effects are understood; never use `force` or `down` as a blind retry. Commit any migration correction so the canonical runner retains its clean-worktree gate. |
| `/health/ready` says database down | Verify `DATABASE_URL`, network access, and migration version before restarting the API. |

## Safe cleanup

Do not commit `backend\.venv*`, `node_modules`, `.next`, `backend\bin`, `.runtime-logs`, `.data`,
or any `.env*` file. Run `git status --short` before committing and inspect the staged diff for
credentials.
