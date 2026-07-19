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

## Build options

### Full production build (Go API + frontend)

From the repository root in PowerShell:

```powershell
.\build-production.ps1
```

The script performs a stripped Go build and a local Next.js production build. It does not start
services, modify secrets, run migrations, deploy Vercel, or expose a port. The generated Go binary
is `backend\bin\api.exe`; `.next` is the local Next.js artifact. Both are ignored by git. Vercel
builds the frontend again from the pushed commit with its own Production environment variables.

If the script reports a missing SDK, install Go and Node.js/npm first. The frontend dependencies
must already be installed with `npm ci` in `frontend\`.

### Backend-only production build (optional)

Use this option when only the Go API, database migrations, MT5 bridge, or host configuration has
changed and the frontend does not need a new local production artifact. It intentionally does
**not** build or start the frontend. The full build above remains the required option after frontend
changes or whenever a local Next.js production-build check is wanted.

```powershell
cd backend
$env:GOTOOLCHAIN = "local"
go build -trimpath -ldflags="-s -w" -o ".\bin\api.exe" ".\cmd\api"
```

The resulting artifact is the same `backend\bin\api.exe` produced by `build-production.ps1`.

## Canonical production host update and restart

Use this sequence after pulling a deployment on the Windows production host. It is deliberately
backend-first: the hosted Vercel frontend remains unchanged unless the full build or a Vercel
deployment is explicitly needed.

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

### 2. Choose the build scope

- Run `./build-production.ps1` for the full Go API + frontend production build.
- Run the **Backend-only production build** above when the frontend is intentionally unchanged.

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
MT5_VERIFY_PYTHON=C:\path\to\python.exe
MT5_VERIFY_SCRIPT=bridge/ftmo_mt5/verify_account.py
MT5_VERIFY_TERMINAL_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
MT5_VERIFY_TIMEOUT=30s
```

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

## Start order on the Windows production host

Start MT5 first, then the market-data sidecar, then the API. Verify the signed-in user's account
before starting/restarting the optional execution bridge. Cloudflare Tunnel may remain running
while the API is restarted; it will return an origin error briefly until port 8080 is listening
again.

### 1. MetaTrader 5 terminal

Start the installed `terminal64.exe`, sign in to the intended account, and wait until MT5 shows a
live broker connection. The Python package may select a logged-in terminal automatically. Set
`MT5_TERMINAL_PATH` explicitly only when several terminal installations exist and selection is
ambiguous.

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

For execution, start or restart the private FTMO bridge after verification:

```powershell
cd backend
python -m bridge.ftmo_mt5.service
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
