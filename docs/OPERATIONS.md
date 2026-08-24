# Operations

> Trade execution update (2026-07-26): do not use the legacy Save & Verify MT5,
> FTMO terminal provisioning, or Connector operations retained later in this
> historical document. Use `TRADE_PRODUCTION_SECURITY_RUNBOOK.md`.

Day-to-day commands for developing, testing, and deploying the monorepo.

Security hardening and the production release checklist are documented in
 [`SECURITY.md`](SECURITY.md). Read it before exposing either service publicly.

## Production backend and managed MT5 worker

- Build/start the production backend from source with `.\run-backend-production.ps1`.
- Deploy the CI-built backend artifact with `.\tools\deploy-backend.ps1`.
- Both paths now provide `execution-gateway.exe` and `mt5-vm-agent.exe`; the
  artifact path verifies both through `SHA256SUMS`.
- The worker is installed and started separately. Use
  [`MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`](MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md)
  for the dry run, exact hash/ACL install, Scheduled Task start, and health check.
- Never add worker lifecycle to the canonical backend runner. Never use recovery
  switches for a normal source build, and never perform a production migration,
  worker install/start, or broker connection without the corresponding operator
  authorization.

## Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Production build
npm run build
npm run start
```

Frontend dev server: `http://localhost:3000`

## Frontend Tests

```bash
cd frontend

npm run test:position
npm run test:trade
npm run test:drawing
npm run test:indicator-catalog
npm run test:chart
npm run test:ui
```

## Backend

There are two production entrypoints on the Windows host. Both are one command and both end in the
same safe restart plus health gates.

### Deploy a CI-built artifact (normal path, no Go/Rust needed)

```powershell
.\tools\deploy-backend.ps1
```

Downloads the backend artifact GitHub Actions already built, verifies every file against
`SHA256SUMS`, refuses an artifact whose `MANIFEST.json` commit does not match the checked-out
`HEAD`, applies forward-only migrations with the packaged `migrate.exe`, and then delegates the
restart to `run-backend-production.ps1 -SkipPull -SkipBuild -SkipMigrations`. The host needs
**no Go and no Rust toolchain** - only PowerShell, the managed MT5 Python environment, and either
the `gh` CLI or `-ArtifactPath` pointing at a downloaded zip.

If the restart fails it restores the previous binaries automatically. Migrations are forward-only
and are never rolled back; fix forward.

Useful switches: `-ArtifactPath <zip>` (offline), `-Tag v1.2.3` (deploy a release),
`-Commit <sha>`, `-AllowCommitMismatch`, `-SkipPublicHealthCheck`.

### Build from source (recovery path)

On the Windows production host, **build backend production** and **run backend** both mean:

```powershell
.\run-backend-production.ps1
```

It pulls, provisions the MT5 runtime, builds a staged backend binary, migrates, safely restarts
ports `8765`/`8080`, and requires local plus public health checks. Use it when CI is unavailable,
for a local hotfix, or to provision the MT5 Python environment the artifact cannot ship. It needs
Go and Rust on the host. Commands below are development or manual-recovery commands.

### Verify a running backend locally

```powershell
.\tools\verify-backend-local.ps1
```

Starts the compiled API and Rust execution gateway against `backend\.env`, probes health,
readiness, the execution relay and the protected surface, then stops what it started. It reports
whether the protected routes are mounted, which depends on Firebase being configured.

```bash
cd backend

# Install Go dependencies
go mod tidy

# Verify the patched Go toolchain is selected
go version

# Run API server
go run ./cmd/api

# Run tests
go test ./...

# Build binary
go build -o bin/api ./cmd/api
```

Production backend builds must use Go 1.26.5 or newer; the `go 1.26.5` directive in
`backend/go.mod` makes that minimum explicit because Go 1.26.4 has a `crypto/tls` vulnerability.

Backend dev server: `http://localhost:8080`

Backend framework decision: **Go Fiber**. Phase 0 migrated the backend to Fiber, and Phase 4 added
the `/api/v1/auth/*` routes. Current backend work should continue with Phase 5 settings +
`sync/bootstrap` and follow Fiber handler/route-group conventions.

## MT5 runtime boundaries

The only Python long-running sidecar is the private read-only market-data bridge on
`localhost:8765`. It supplies symbol catalogs, ticks, history, and broker-session observations to
Go; it cannot authorize or submit orders.

Live execution uses the Go BFF, loopback Rust gateway (`8790` EA, `8791` admin), and common MT5 EA.
The managed path adds an explicitly installed bare-metal worker with bounded pre-provisioned slots,
Windows Credential Manager-backed grants, redirected-stdin login, and exact-PID named-pipe EA bootstrap. Account
connect never downloads or installs MT5/EA and never puts credentials in arguments or environment.

Run normal production through `run-backend-production.ps1`. Install/start the managed worker only
through `MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`; the backend runner deliberately does not own worker
installation or startup.

## Environment Variables

### Frontend

Copy `.env.example` to `frontend/.env.local` when the variable is frontend-only. Keep shared
examples in the root `.env.example`. The frontend also loads missing values from the repository root
`.env.local` / `.env` as a monorepo convenience, but `frontend/.env.local` and hosted project env
vars should be treated as the primary source for deployment.

For local auth, the frontend needs the `NEXT_PUBLIC_FIREBASE_*` values. The backend API base defaults
to `http://localhost:8080` in development; set `NEXT_PUBLIC_API_BASE_URL` explicitly in production.

### Backend

Use `backend/.env.example` and `backend/docs/CONFIGURATION.md` as the complete source-derived
reference. Production must keep Rust and Python listeners on loopback, use independent admin and
worker bootstrap secrets, provide the MT5 identity HMAC key through an absolute ACL-protected file,
and run Go under a stable dedicated Windows identity.

## Deployment

### Frontend on Vercel

Use these Vercel settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Production Branch | `master` |
| Install Command | default or `npm install` |
| Build Command | default or `npm run build` |

Current production domain and API env:

```text
Frontend: https://tradingterminal.io.vn
API:      https://api.tradingterminal.io.vn
```

Set these Vercel Production variables and redeploy after any change:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.tradingterminal.io.vn
NEXT_PUBLIC_APP_URL=https://tradingterminal.io.vn
```

Push registration and closed-browser evaluation additionally require both the
Firebase Web app values and the matching server-only service-account values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_VAPID_KEY=...

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=... # preserve escaped \n newlines
PUSH_WORKER_SECRET=...   # same value as the Go backend
```

`NEXT_PUBLIC_FIREBASE_PROJECT_ID` and `FIREBASE_PROJECT_ID` must identify the
same Firebase project. Firestore is not used by Push Alert storage.
`PUSH_WORKER_SECRET` must match the Go backend because Next uses its protected
worker API to persist device and evaluator state in PostgreSQL.

After changing any Vercel variable, redeploy Production. An unauthenticated
`POST /api/push/register` returning `401` proves only that the route exists. A
real signed-in Push toggle must receive `200`. A `503` mentioning push
registration storage means the Next route could not reach the protected Go
worker API or PostgreSQL; verify migration `0025`, `NEXT_PUBLIC_API_BASE_URL`,
and the shared `PUSH_WORKER_SECRET`. The route never logs the Firebase bearer
token, FCM token, or user id.

`POST /api/push/alerts/sync` has an eight-second server deadline. Treat `503`
as retryable worker/database unavailability and `409` as a non-retryable
device-ownership conflict. The Next log entry is sanitized and must not be
expanded to include the request body, Firebase UID, bearer token, or FCM token.

Cloudflare DNS keeps the Vercel apex CNAME in DNS-only mode. The `api` hostname is a proxied
Cloudflare Tunnel record targeting the Go API on this Windows host. Do not expose the private MT5
market-data sidecar on port 8765 or either Rust listener on ports 8790/8791.

If Vercel reports `The specified Root Directory "frontend" does not exist`, the deployment is using
an old commit from before the monorepo split. Redeploy the latest `master` commit where the
`frontend/` folder exists.

#### Managed MT5 frontend/API smoke test after push

Deploy the backend commit before rebuilding the frontend. The managed connector is not a
frontend-only feature: the Go registry returns `connectors.mt5Managed=true` only when its Windows
credential-store probe, identity-key, admin gateway, and worker-enrollment prerequisites are
configured.

The production frontend build must contain:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.tradingterminal.io.vn
NEXT_PUBLIC_APP_URL=https://tradingterminal.io.vn
```

After both deployments use the same commit:

1. Sign in normally and confirm `GET /api/v1/execution/accounts` returns `200` with
   `connectors.mt5Managed=true`. Do not copy response cookies or credentials into a ticket.
2. Open Trade, select **Add account**, and confirm the managed browser-connect option is visible on
   desktop and mobile.
3. With a disposable Demo account only, submit the managed form. The browser must send
   `POST /api/v1/execution/connectors/mt5/accounts`; `202` means the backend accepted provisioning,
   not that MT5 is ready yet.
4. Confirm the password field clears immediately and the account appears after the registry refresh.
   Follow status until `ready`; any `queued`, `provisioning`, `synchronizing`, `degraded`, or
   `credentials_required` state is a backend/worker prerequisite to diagnose, not a reason to resend
   the request blindly.
5. Test reconnect/disconnect only against that disposable Demo account. These lifecycle actions do
   not close broker positions. Do not use Live/funded credentials for this smoke test.

If the browser calls its own origin instead of `https://api.tradingterminal.io.vn`, redeploy Vercel
after correcting `NEXT_PUBLIC_API_BASE_URL`; Next.js embeds public environment variables at build
time. If the request reaches the API but returns `401`, repair the normal backend session/cookie and
CORS origin configuration. If the managed option is absent, verify backend configuration and
readiness before changing frontend code.

### Backend

Deploy the Go backend as a separate service from `backend/`. Do not include it in the Vercel
frontend build.

For the Firestore-to-PostgreSQL Push Alert rollout, deploy the backend first so
migration `0025` and `/api/v1/push/worker-devices/*` are live, verify the shared
`PUSH_WORKER_SECRET`, then import existing Firestore documents before deploying
the frontend:

```powershell
cd frontend

# Reads and validates only; PostgreSQL is not changed.
npm run migrate:push-firestore

# Imports pushAlertDevices through the protected Go worker API.
npm run migrate:push-firestore -- --apply
```

The command needs `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`, `NEXT_PUBLIC_API_BASE_URL`, and `PUSH_WORKER_SECRET` in
its process environment. Do not delete the Firestore collection until the
apply run reports zero failures and the new evaluator has been verified.
Existing `push_tokens` rows are also backfilled with empty snapshots and
version `1`; any device not present in Firestore fills its PostgreSQL snapshot
on the next signed-in push registration/sync.

Backend-first remains the preferred auth hardening rollout. If backend deployment is explicitly
deferred, the new frontend treats only `/auth/session` `404`/`405` as an older-backend signal and
falls back once to `/auth/google`. This keeps login available, but the one-call session matching,
revocation check, atomic rotation, Strict-cookie, Origin, and rate-limit changes are not active in
production until the backend is deployed. Never fall back on `400`, `401`, `403`, `429`, or `5xx`.

After the backend is eventually deployed, verify one `/auth/session` `200` precedes protected
bootstrap calls and the legacy fallback disappears. Frontend rollback remains safe because the new
backend retains `/auth/google`, `/auth/refresh`, and `/auth/me`.

For the runner contract, exceptional switches, manual recovery, Cloudflare Tunnel configuration,
and troubleshooting, follow `backend/docs/PRODUCTION_BUILD.md`.

### MT5 EA 1.26 compatibility release

Roll out the portfolio synchronization path backend-first:

1. From the repository root, run `.\run-backend-production.ps1`.
2. Deploy the frontend.
3. Upgrade each MT5 terminal to the published EA 1.26 artifact, one account at a
   time, and verify its downloaded SHA-256 checksum.

EA 1.26 is required before the account becomes `READY`; it retains in-place
pending-order mutation and adds the current copier telemetry and broker-margin
safety contract. Older releases are blocked from command routing.
Existing broker positions and pending orders do not need to be closed during
the upgrade. Avoid sending commands to the terminal while replacing the EA,
keep `GatewayUrl` unchanged, and wait about ten seconds after `READY` for the
portfolio snapshot to reach the web.

### User setup: FTMO to Exness copy

One MT5 process can be logged into only one broker account at a time. To keep
both sides executable:

1. Keep the FTMO terminal logged into the source account.
2. Install the Exness MT5 terminal into a different Windows installation
   directory and log it into the target account. A second PC or VPS is also
   supported.
3. In each terminal, copy the published `MarketLensExecutionEA.ex5` to that terminal's
   own `MQL5\Experts` data directory and attach it to exactly one chart.
4. Enable Algo Trading and allow the WebRequest origin shown by the in-app EA
   setup guide.
5. Generate and consume a separate one-time pairing token for each terminal.
   Do not reuse the FTMO pairing token for Exness.
6. Select FTMO as the source and Exness as a copy target. `READY` means
   immediate delivery. `Offline · waits 5 min` means the server has accepted a
   bounded deferred target.
7. For a deferred target, start Exness MT5 and its EA before the displayed
   deadline. The gateway waits for a fresh account/instrument snapshot and
   revalidates the route before queueing it.

If the deadline passes, the target becomes `DEFERRED_DELIVERY_EXPIRED`. Do not
expect the order to appear after opening MT5 later; submit a new copy only
after reconciling the source and target accounts.

For lane-specific log interpretation, safe database reconciliation, and the
rule against resubmitting an order that is absent only from the browser, follow
`TRADE_PRODUCTION_SECURITY_RUNBOOK.md` under **Portfolio synchronization rollout
and triage**.

## Validation Before Push

For frontend changes:

```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

For backend changes:

```bash
cd backend
go test ./...
go build -o bin/api ./cmd/api
```
