# Production build, deploy, and runtime runbook

There are two supported production entrypoints. Choose by whether the Windows host should compile
the checked-out source.

## Build from source and run

When asked to build/run the backend on the production host, execute from the repository root:

```powershell
.\run-backend-production.ps1
```

Use no switches in the normal case. The runner owns this sequence:

1. require a clean production checkout and pull the configured branch;
2. validate `backend/.env`, database/admin secrets, distinct worker bootstrap token, and the
   absolute non-link MT5 identity HMAC key file;
3. build staged Go API and Rust execution-gateway/worker artifacts through
   `build-production.ps1 -BackendOnly -StageApi`;
4. verify the managed Windows Python environment needed by the private MT5 sidecar;
5. apply forward migrations and refuse a dirty migration state;
6. stop only listeners owned by this repository;
7. start the configured market-data terminal, Python sidecar, Rust gateway, then Go API;
8. require local Go liveness/readiness, Rust health, public EA relay health, MT5 catalog/account
   evidence, and public health unless explicitly in documented recovery.

The runner stages new binaries before stopping the old services, starts Rust before Go, and keeps
runtime logs under the ignored runtime-log directory.

## Deploy a CI-built artifact

When asked to deploy without compiling on the production host, execute:

```powershell
.\tools\deploy-backend.ps1
```

The deployer:

1. downloads the selected successful CI artifact (or accepts an explicit local artifact);
2. verifies every file listed in `SHA256SUMS` and requires `MANIFEST.json`;
3. requires artifact commit to match checked-out `HEAD` unless the operator deliberately supplies
   `-AllowCommitMismatch`;
4. requires `api.exe`, `migrate.exe`, `mt5-stream.exe`, `execution-gateway.exe`, and
   `mt5-vm-agent.exe`;
5. preserves the previous binaries, places the verified artifact, and runs the packaged migrator;
6. delegates restart/health ownership to the canonical runner with
   `-SkipPull -SkipBuild -SkipMigrations`;
7. restores previous binaries and attempts one restart if the new restart/health gate fails.

Migrations are forward-only and are never rolled back by the deployer. A binary rollback after a
new migration is safe only when the older binaries remain schema-compatible; otherwise fix
forward.

`-AllowCommitMismatch`, `-SkipPublicHealthCheck`, local artifact selection, and staging retention
are deliberate operator/recovery tools. They are not normal deployment defaults.

## Artifact build command

`build-production.ps1` builds artifacts but does not start services or apply migrations:

```powershell
.\build-production.ps1
```

By default it provisions the Windows-only MT5 Python environment, builds the Go API, builds the
locked Rust workspace (gateway and worker), verifies the downloadable common EA, and builds the
frontend. `-BackendOnly` omits the frontend/EA publication verification path; `-StageApi` writes
staged `.next` backend binaries for safe replacement.

CI owns the reproducible server artifact recipe. The artifact contains compiled Go commands,
embedded migrations, Rust gateway/worker, manifest, and checksums. The Python `MetaTrader5`
package is Windows-only and remains a separately provisioned host prerequisite.

## Runtime topology

| Component | Default bind | Exposure |
| --- | --- | --- |
| Go API/BFF | `:8080` | Public only through the approved HTTPS tunnel/proxy |
| Python MT5 market-data sidecar | `localhost:8765` | Private loopback only |
| Rust common-EA listener | `127.0.0.1:8790` | Private; Go exposes an exact `/execution-ea` allow-list |
| Rust admin/managed-worker listener | `127.0.0.1:8791` | Private loopback only |

Do not open Rust/Python ports on a router, public firewall, tunnel, or reverse proxy. The managed
worker is installed and started separately through the explicit bare-metal operator tooling; the
backend runner deliberately does not create worker identities, slots, scheduled tasks, or runtime
roots.

## Required production configuration

Start from `backend/.env.example` and [CONFIGURATION.md](CONFIGURATION.md). At minimum, production
requires PostgreSQL, Firebase/session secrets, exact CORS origins, alert-worker configuration,
execution admin token, trade recovery email, and secure cookies.

Execution and managed-account configuration includes:

```dotenv
DATABASE_URL=postgres://...
EXECUTION_GATEWAY_BIND=127.0.0.1:8790
EXECUTION_ADMIN_BIND=127.0.0.1:8791
EXECUTION_EA_URL=http://127.0.0.1:8790
EXECUTION_ADMIN_URL=http://127.0.0.1:8791
EXECUTION_ADMIN_TOKEN=<independent random secret, 32+ characters>
EXECUTION_MT5_VM_BOOTSTRAP_TOKEN=<independent worker enrollment secret>
EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE=C:\ProgramData\MarketLens\secrets\mt5-identity.key
EXECUTION_DATABASE_MAX_CONNECTIONS=10
```

The identity-key file must be absolute, regular, non-link, and ACL-restricted. Managed broker
credentials are local generic records in Windows Credential Manager under the dedicated Go API
identity. Never place either value in the browser, EA, worker command line, repository, or log.

## Preflight

Before a source run or artifact deploy:

- production branch and expected commit are checked out;
- worktree is clean for source-run pull/build;
- `backend/.env` exists and contains production values;
- PostgreSQL is reachable and the API service identity passes the local Windows credential-store
  write/read/delete/absence probe;
- Go, Rust, Python, MetaTrader, and MetaEditor prerequisites are installed for a source build;
- `backend/.venv-mt5/Scripts/python.exe` can import `MetaTrader5` and `websockets`;
- the configured read-only market-data terminal path exists;
- ports 8080, 8765, 8790, and 8791 are free or held only by this repository's processes;
- public DNS/TLS/tunnel routes expose only Go.

For managed MT5, separately complete
[MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md](../../docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md). Backend
deployment alone does not install or activate a worker.

## Health gates

The canonical runner requires:

```powershell
Invoke-RestMethod http://localhost:8080/health
Invoke-RestMethod http://localhost:8080/health/ready
Invoke-RestMethod http://localhost:8080/execution-ea/health
Invoke-RestMethod http://localhost:8080/api/v1/mt5/symbols
```

Readiness must report the database up. EA relay health must prove the Rust EA listener is reachable.
MT5 symbols must prove the private sidecar and Go consumer are connected. The configured public
readiness and EA-relay URLs must also pass unless an explicitly documented recovery bypass is in
effect.

Managed account `READY` is stricter than process health: the current worker/session/lease,
terminal identity, four synchronization families, EA session/version, and successful recent EA poll
must all agree.

## Recovery rules

The runner exposes `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, and
`-SkipPublicHealthCheck`, but they are recovery/delegation switches:

- artifact deploy is the documented normal caller of the first three switches;
- use any switch directly only when the user explicitly requests recovery or the production
  runbook records the reason;
- never skip migrations merely to make incompatible binaries start;
- never skip public health and claim the public service is healthy;
- never stop a foreign listener automatically.

If migration fails, keep the old services/binaries and fix the schema forward. If restart fails
after artifact placement, the deployer restores previous binaries; inspect both the original and
rollback restart result. Do not delete runtime data, Windows credential records, terminal slots, or
worker roots as a generic recovery action.

## Safe rollback and cleanup

- Binary rollback: deploy a previously verified artifact whose binaries are compatible with the
  current forward schema.
- Schema rollback: not automated in production; use a separately reviewed fix-forward plan.
- Worker rollback: drain/fence the worker and follow the bare-metal runbook. The backend runner does
  not uninstall it.
- EA rollback: generally blocked by the minimum-version gate; deploy backend compatibility first
  and never downgrade around a lifecycle/safety requirement.
- Cleanup only exact repository-owned staging/runtime paths after resolving their absolute target.

## Verification commands

Deployment tooling self-tests:

```powershell
.\tools\deploy-backend.ps1 -SelfTest
.\tools\verify-backend-deploy.ps1
```

Backend documentation/source contracts:

```powershell
.\tools\verify-backend-docs.ps1
```

Managed MT5 Tier 3 gauntlet:

```powershell
.\tools\verify-mt5-baremetal-managed-ea.ps1
```
