# Production build and runtime runbook

This is the repeatable checklist for a production-mode SMC Trading Terminal on a Windows host
with MetaTrader 5. It covers the three processes that make the local production stack work:

```text
Next.js UI :3000  ->  Go/Fiber API :8080  ->  Python MT5 bridge :8765  ->  MetaTrader 5 terminal
                         |
                         +-> PostgreSQL (DATABASE_URL)
```

The Python bridge must remain private (`localhost:8765`). Only the Go API and, when needed, the
Next UI should be exposed to the LAN or Internet through a firewall/reverse proxy.

## One-command build

From the repository root in PowerShell:

```powershell
.\build-production.ps1
```

The script performs a stripped Go build and a Next.js production build. It does not start services,
modify secrets, run migrations, or expose a port. The generated Go binary is
`backend\bin\api.exe`; `.next` is the Next.js production artifact. Both are ignored by git.

If the script reports a missing SDK, install Go and Node.js/npm first. The frontend dependencies
must already be installed with `npm ci` in `frontend\`.

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

When the UI is opened by LAN IP, add that host without scheme or port to Firebase Authentication's
Authorized domains, for example `192.168.2.128`. Also include `localhost` for local browser access.

## Start order on Windows

Open three PowerShell processes from the repository root/backend as appropriate.

### 1. MT5 bridge

Use the native Windows Python environment that has `MetaTrader5` and `websockets` installed. Keep
MetaTrader 5 open, logged in, and connected to the intended account.

```powershell
cd backend
.\.venv-mt5\Scripts\python.exe -m bridge.mt5_stream.mt5_server
```

The bridge listens on `ws://localhost:8765`. If the log contains `IPC send failed (-10001)`,
restart this Python process after confirming the MT5 terminal is still logged in. A successful
startup logs `MT5 initialized account=...` and `tick WebSocket listening`.

### 2. Go API

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

### 3. Next.js UI

```powershell
cd frontend
npm run start
```

The UI is available at `http://localhost:3000`. The API client automatically uses `localhost:8080`
when the UI is opened on localhost and uses the current hostname when the same build is opened via
the machine's LAN address. A hard reload (`Ctrl+Shift+R`) is required after rebuilding because
`NEXT_PUBLIC_*` values are embedded in the browser bundle.

## LAN and Internet exposure

The Go API already binds all interfaces. For LAN access, allow TCP 3000 and 8080 in Windows
Firewall on the Private profile and use `http://<machine-lan-ip>:3000`.

For Internet access, a private `192.168.x.x` address is not enough. Configure router port forwarding
to the machine or, preferably, put an HTTPS reverse proxy/domain in front of the UI/API. Never
expose port 8765 or MT5 credentials. Public HTTPS deployments must use `AUTH_COOKIE_SECURE=true`
and update `CORS_ALLOWED_ORIGINS` plus `NEXT_PUBLIC_API_BASE_URL` to the HTTPS origins before
rebuilding.

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
```

In the browser Network panel, `symbols`, `history`, and the MT5 WebSocket should succeed. `auth/refresh`
returning 401 before the first sign-in is expected; after Google sign-in, `/auth/google` should
return 200 and workspace/bootstrap requests should stop returning 401.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Watchlist rows show `--` | Check bridge log for `IPC send failed`; restart bridge and confirm MT5 login. |
| `Workspace sync failed` / 401 | Use the same API hostname as the UI, clear site data, sign in again, and verify CORS/cookie settings. |
| Google says domain not allowed | Add the exact hostname (without scheme/port) under Firebase Authentication → Authorized domains. |
| `/api/push/alerts/sync` returns 500 | Check Next logs for Firebase Admin errors, verify service-account values, and ensure Windows time is synchronized (`w32tm /query /status`). |
| Firebase `ACCESS_TOKEN_EXPIRED` | Synchronize Windows Time with an NTP peer, then restart Next. |
| `/health/ready` says database down | Verify `DATABASE_URL`, network access, and migration version before restarting the API. |

## Safe cleanup

Do not commit `backend\.venv*`, `node_modules`, `.next`, `backend\bin`, `.runtime-logs`, `.data`,
or any `.env*` file. Run `git status --short` before committing and inspect the staged diff for
credentials.
