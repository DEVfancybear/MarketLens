# Production build and runtime runbook

This is the repeatable checklist for the production SMC Trading Terminal. The frontend is hosted
by Vercel; the Go API, Python MT5 helpers/sidecars, and logged-in MetaTrader 5 terminal run on a
Windows host.

```text
Browser -> https://tradingterminal.io.vn (Vercel)
       -> ws://localhost:8787 (optional private FTMO execution bridge)
       -> https://api.tradingterminal.io.vn (Cloudflare Tunnel)
          -> Go/Fiber API localhost:8080
             -> Python MT5 market-data sidecar localhost:8765
             -> short-lived MT5 verifier process (stdin/stdout, no port)
                -> logged-in MetaTrader 5 terminal
             -> PostgreSQL (DATABASE_URL)
```

Both Python bridges must remain private on localhost. Cloudflare Tunnel exposes only the Go API.
Do not open router ports 8080, 8765, or 8787 and do not put MT5 credentials in Vercel or browser
env.

## Current production endpoints

| Component | Address | Hosting |
| --- | --- | --- |
| Frontend | `https://tradingterminal.io.vn` | Vercel, DNS-only CNAME in Cloudflare |
| Public API | `https://api.tradingterminal.io.vn` | Cloudflare Tunnel |
| Go API origin | `http://localhost:8080` | This Windows host |
| MT5 market-data sidecar | `ws://localhost:8765` | This Windows host, private only |
| FTMO execution bridge | `ws://localhost:8787` | Browser/operator host, private only |
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
5. Starts MT5 when needed, but never closes or changes the signed-in terminal account.
6. Stops only repository-owned listeners on `8080`/`8765`, atomically promotes the staged API,
   then starts the MT5 market-data sidecar and Go API from `backend\`.
7. Requires local liveness, database readiness, MT5 `connected:true`, verifier-runtime startup
   confirmation, and public Cloudflare readiness before reporting success.
8. Writes timestamped stdout/stderr and PID files under ignored `.runtime-logs\`.

Useful recovery switches are `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, and
`-SkipPublicHealthCheck`. They are exceptional/manual recovery options; an ordinary request to
build or run production uses no switches.

The script intentionally does not start the FTMO execution bridge on port `8787`. That bridge is
browser/account-local (`ws://localhost:8787`) and is not part of the multi-user backend server.

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
`MT5_VERIFY_TERMINAL_PATH` when it is set; the production API additionally requires explicit,
distinct market-data and verifier terminal paths before it enables account verification.

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

The optional FTMO execution bridge stays separate: start it only after its user account has been
verified, as described in [Per-user Verify and optional execution bridge](#4-per-user-verify-and-optional-execution-bridge).

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
NEXT_PUBLIC_MT5_BRIDGE_URL=ws://localhost:8787

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
MT5_VERIFY_TERMINAL_PATH=C:\Program Files\FTMO MetaTrader 5\terminal64.exe
MT5_VERIFY_TIMEOUT=30s
MT5_VERIFY_NATIVE_TIMEOUT_MS=8000
```

Leaving `MT5_VERIFY_PYTHON` blank is preferred. The API treats old bare aliases such as `python` as
automatic selection and probes each candidate with `import MetaTrader5`; a broken explicit runtime
falls back to `backend\.venv-mt5\Scripts\python.exe`. Restart the Go API after changing any
`MT5_VERIFY_*` value or rebuilding the venv.

`MT5_TERMINAL_PATH` and `MT5_VERIFY_TERMINAL_PATH` must point to different terminal installations.
Install the broker/FTMO terminal first and use its real `terminal64.exe` path for verification. The
API disables verification in production when these paths are missing, identical, or the verifier
path does not exist; this prevents a verification login from disconnecting the live market-data
account.

Additional local/LAN origins may be appended to `CORS_ALLOWED_ORIGINS` for diagnostics. Never use
`*` because authenticated requests send cookies.

For a local HTTP-only production-mode run, use `AUTH_COOKIE_SECURE=false`. For any HTTPS public
deployment, omit it or set `AUTH_COOKIE_SECURE=true`. A `Secure` cookie cannot be sent over plain
HTTP.

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
before starting/restarting the optional browser-local execution bridge. Cloudflare Tunnel may
remain running while the API is restarted.

### 1. MetaTrader 5 terminal

Start the installed `terminal64.exe`, sign in to the intended account, and wait until MT5 shows a
live broker connection. The Python package may select a logged-in terminal automatically, but set
`MT5_TERMINAL_PATH` explicitly whenever production account verification is enabled so the API can
prove that the market-data and verifier terminals are isolated.

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

### 4. Per-user Verify and optional execution bridge

Sign in, open **Connections & notifications**, and select **Save & Verify MT5**. The Go API launches
the short-lived verifier configured by `MT5_VERIFY_*`; credentials travel to it only over stdin.
On success, the current user's integration receives `verifiedAt` and MT5 becomes selectable.
Changing login/server/password invalidates that verification.

`MT5_VERIFIER_TERMINAL_REQUIRED`, `MT5_VERIFIER_TERMINAL_NOT_ISOLATED`, and
`MT5_VERIFIER_TERMINAL_UNAVAILABLE` are configuration errors: install/configure a distinct broker
terminal and restart the backend. `MT5_VERIFICATION_TIMEOUT` means the isolated terminal did not
complete its native login within the bounded verification window.

If the response code is `dependency_unavailable`, the helper started but its selected Python could
not import `MetaTrader5`; it is not an FTMO password or terminal-login failure. Rerun the full
production build and restart the actual API service/process so it loads the new binary and venv.

For execution, start or restart the private FTMO bridge after verification:

```powershell
cd backend
.\.venv-mt5\Scripts\python.exe -m bridge.ftmo_mt5.service
```

The execution bridge listens on `ws://localhost:8787` by default and must report the same login and
server verified by the current user. One bridge represents one active terminal account; other
verified users remain isolated and their live commands are blocked on account mismatch.

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
After Google sign-in, **Save & Verify MT5** should return a sanitized account summary; the execution
WebSocket on 8787 is required only for live MT5 commands. `auth/refresh` returning 401 before the
first sign-in is expected; after sign-in, `/auth/google` should return 200 and workspace/bootstrap
requests should stop returning 401.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Watchlist rows show `--` | Check bridge log for `IPC send failed`; restart bridge and confirm MT5 login. |
| MT5 is Configured but cannot be selected | Run **Save & Verify MT5** for the signed-in user and inspect the sanitized failure message. |
| MT5 is Verified but orders are blocked | Reconnect the execution bridge with the same login/server shown in the verified integration. |
| `Workspace sync failed` / 401 | Use the same API hostname as the UI, clear site data, sign in again, and verify CORS/cookie settings. |
| Google says domain not allowed | Add the exact hostname (without scheme/port) under Firebase Authentication → Authorized domains. |
| `/api/push/alerts/sync` returns 500 | Check Next logs for Firebase Admin errors, verify service-account values, and ensure Windows time is synchronized (`w32tm /query /status`). |
| Firebase `ACCESS_TOKEN_EXPIRED` | Synchronize Windows Time with an NTP peer, then restart Next. |
| `/health/ready` says database down | Verify `DATABASE_URL`, network access, and migration version before restarting the API. |

## Safe cleanup

Do not commit `backend\.venv*`, `node_modules`, `.next`, `backend\bin`, `.runtime-logs`, `.data`,
or any `.env*` file. Run `git status --short` before committing and inspect the staged diff for
credentials.
