# Bare-metal managed MT5 + EA runbook

Status: implementation and local synthetic/disposable gates are complete. Production migration,
worker installation/start, backend cutover, and broker connection remain explicit operator actions.
The R15-9 three-demo-account gate must pass before any Live/funded activation.

## Topology

- Public TLS terminates at the reverse proxy and exposes only Go on port `8080`.
- Rust EA/admin listeners remain on `127.0.0.1:8790` and `127.0.0.1:8791`.
- The managed worker uses the private admin URL `http://127.0.0.1:8791` and the credential API URL
  `http://127.0.0.1:8080`; remote plain HTTP is rejected.
- One dedicated interactive Windows identity runs one bounded Scheduled Task. Each active account
  owns a distinct preinstalled, attested terminal slot and writable runtime root.
- A separate stable, dedicated Windows identity runs the Go API. Its user profile and credential
  set must load on every restart because managed broker credentials are bound to that identity.
- `run-backend-production.ps1` never installs a worker or launches `mt5-vm-agent.exe` or an account
  terminal directly. After the Rust gateway is healthy, it validates the previously installed
  worker receipt and Scheduled Task. It leaves a healthy task untouched and starts the attested
  Scheduled Task once when it is stopped, then requires a fresh matching registry heartbeat.

## Required protected files

Create these outside the repository with inheritance disabled and access limited to the service
identities that consume them. Do not print their contents or put them in command arguments.

1. A 32-byte-or-longer identity HMAC key file, distinct from every other token.
2. A 32-byte-or-longer worker bootstrap-token file, matching
   `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN` in `backend/.env`.
3. The non-secret `managed-worker-installation.json` receipt produced by the one-time worker
   installer. Keep it under the protected worker root; do not hand-author or relocate it.

Set the absolute paths in `backend/.env`:

```dotenv
EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE=C:\ProgramData\MarketLens\secrets\mt5-identity-hmac.key
EXECUTION_MT5_VM_BOOTSTRAP_TOKEN=<independent random value matching the protected bootstrap file>
EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=C:\MarketLens\worker\managed-worker-installation.json
```

The canonical runner and deploy preflight reject a missing, relative, linked, too-small, or
oversized identity-key file. Go and Rust also reject a key equal to an auth/admin/bootstrap secret.
No broker password or third-party credential-store token belongs in `.env`. Go uses Windows
Credential Manager generic records with machine persistence and opaque `MarketLens:MT5:` targets.

## Pin and verify the Go API identity

Run the backend under the same dedicated local/domain identity on every start. Do not switch from
an interactive logon to a network-only logon or another Scheduled Task/service account after users
connect. Before broker onboarding, run the disposable probe twice under that exact identity:

```powershell
Push-Location .\backend
go test -count=2 -v ./internal/mt5credentials `
  -run '^TestWindowsCredentialStoreDisposable(RealLifecycle|ProbeLeavesNoSyntheticTargets)$'
Pop-Location
```

The API repeats a synthetic write/read/delete/absence probe at startup and advertises
`connectors.mt5Managed=true` only after it succeeds. Losing the Windows profile, host, or identity
does not expose an empty password: existing opaque references fail closed and users reconnect.

## Build or deploy the binaries

Build from source and start the backend only through:

```powershell
.\run-backend-production.ps1
```

Deploy a CI-built artifact only through:

```powershell
.\tools\deploy-backend.ps1
```

Both production build paths supply `execution-gateway.exe` and `mt5-vm-agent.exe`. The deploy path
verifies `SHA256SUMS`; it does not install the worker. A source build leaves the worker at
`backend\execution\target\release\mt5-vm-agent.exe`; an artifact deploy stages it at
`backend\bin\mt5-vm-agent.exe`.

For the first source installation, use this two-pass bootstrap sequence:

1. Configure the other required protected settings, leave the absent receipt unset, and run
   `.\run-backend-production.ps1`. It pulls and builds the API, gateway, and managed worker, verifies
   the staged artifacts, then exits nonzero with
   `MANAGED_MT5_WORKER_INSTALL_REQUIRED_AFTER_BUILD`. It does not migrate, stop services, or start
   the Python bridge, terminal, gateway, worker, or API on that path.
2. Complete the explicit worker installation below using the newly built
   `backend\execution\target\release\mt5-vm-agent.exe`. The runner never invokes this installer.
3. Put the installer's returned `receipt_path` in the configured environment variable, then rerun
   `.\run-backend-production.ps1` with
   `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE` set to that absolute path.
4. The second run validates the receipt before migrations or runtime replacement and continues
   through the existing worker and public readiness gates.

An artifact deploy also remains fail-closed: if its delegated `-SkipBuild` runner has no valid
receipt, it exits with `MANAGED_MT5_WORKER_RECEIPT_REQUIRED` before migrations or runtime startup
and does not claim that it built artifacts.

## Prepare the slot descriptor

For every slot, independently attest the terminal, state root, server catalog, license, published
EA, chart template, WebRequest settings, and topology attestation. Build one to four descriptors:

```powershell
$slots = @(
  [pscustomobject]@{
    slot_id = 'slot-01'
    terminal_path = 'C:\Program Files\MetaTrader 5 Slot 01\terminal64.exe'
    terminal_state_root = 'C:\ProgramData\MetaQuotes\Terminal\<exact-instance-id>'
    terminal_sha256 = '<terminal SHA-256>'
    servers_sha256 = '<servers.dat SHA-256>'
    terminal_license_sha256 = '<terminal license SHA-256>'
    ea_path = 'C:\ProgramData\MetaQuotes\Terminal\<exact-instance-id>\MQL5\Experts\MarketLensExecutionEA.ex5'
    ea_sha256 = '<published EA SHA-256>'
    ea_bootstrap_pipe = 'marketlens-slot-01'
    ea_profile = 'MarketLens-slot-01'
    ea_gateway_origin = 'http://127.0.0.1:8790'
    ea_chart_template_path = 'C:\MarketLens\slot-inputs\slot-01\chart01.chr'
    ea_chart_template_sha256 = '<chart template SHA-256>'
    ea_webrequest_settings_source_path = 'C:\MarketLens\slot-inputs\slot-01\experts.ini'
    ea_webrequest_settings_sha256 = '<WebRequest settings SHA-256>'
    ea_topology_attestation_source_path = 'C:\MarketLens\slot-inputs\slot-01\webrequest-attestation.json'
    ea_topology_attestation_sha256 = '<topology attestation SHA-256>'
  }
)
```

Do not reuse a terminal path, state root, runtime root, profile, pipe name, or slot ID.

## Dry-run, install, start, and check health

Populate the non-secret paths and hashes locally. The same argument map is used for dry-run and
execution; only the explicit `-Execute` switch mutates the host.

```powershell
$installArgs = @{
  WorkerRoot = 'C:\MarketLens\worker'
  DataRoot = 'D:\MarketLens\runtime'
  WorkerIdentity = 'HOST\MarketLensWorker'
  TaskName = 'MarketLens MT5 Worker'
  WorkerId = 'marketlens-baremetal-01'
  AgentPath = (Resolve-Path '.\backend\bin\mt5-vm-agent.exe').Path
  AgentSha256 = (Get-FileHash '.\backend\bin\mt5-vm-agent.exe' -Algorithm SHA256).Hash
  PythonPath = (Resolve-Path '.\backend\.venv-mt5\Scripts\python.exe').Path
  PythonSha256 = (Get-FileHash '.\backend\.venv-mt5\Scripts\python.exe' -Algorithm SHA256).Hash
  AdapterPath = (Resolve-Path '.\backend\bridge\mt5_vm\phase1_adapter.py').Path
  AdapterSha256 = (Get-FileHash '.\backend\bridge\mt5_vm\phase1_adapter.py' -Algorithm SHA256).Hash
  AclHelperPath = (Resolve-Path '.\backend\bridge\mt5_vm\Set-MT5VmPhase1RuntimeAcl.ps1').Path
  PowerShellPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  BootstrapTokenFile = 'C:\ProgramData\MarketLens\secrets\worker-bootstrap.token'
  EaReleaseManifestPath = (Resolve-Path '.\frontend\public\downloads\MarketLensExecutionEA.release.json').Path
  EaReleaseChecksumPath = (Resolve-Path '.\frontend\public\downloads\MarketLensExecutionEA.sha256.txt').Path
  MinimumEaVersion = '1.26'
  GatewayUrl = 'http://127.0.0.1:8791'
  CredentialApiUrl = 'http://127.0.0.1:8080'
  TerminalSlots = $slots
}

.\tools\mt5-baremetal\Install-MT5BareMetalWorker.ps1 @installArgs

$install = .\tools\mt5-baremetal\Install-MT5BareMetalWorker.ps1 `
  @installArgs -Execute | ConvertFrom-Json

$install.receipt_path

.\tools\mt5-baremetal\Get-MT5BareMetalWorkerStatus.ps1 `
  -TaskName $install.task_name `
  -WorkerIdentity $install.worker_identity `
  -PowerShellPath $install.powershell_path `
  -LauncherPath $install.launcher_path `
  -AgentPath $install.agent_path `
  -AgentSha256 $install.agent_sha256 `
  -ConfigPath $install.config_path `
  -ConfigSha256 $install.config_sha256
```

The installer copies the pinned agent into `WorkerRoot`, writes a non-secret config, replaces and
verifies root ACLs, registers the exact action/identity/logon trigger, and writes the protected
non-secret receipt. Put the returned `receipt_path` in
`EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE`. A normal `run-backend-production.ps1` execution then
validates the receipt, paths, hashes, identity, task action, slot count, registry capacity, leases,
and heartbeat. It starts the attested Scheduled Task once only when stopped; it never restarts a
healthy worker. `HEALTHY` accepts both Task Scheduler result `0` and `0x41301` while the long-running
action is still executing. Any other result is `DEGRADED`.

## Activation gates

Before broker onboarding, verify the backend, gateway, worker heartbeat/lease, slot capacity,
terminal/EA hashes, stable API identity, credential-store probe, and reverse-proxy route allow-list.
Then run R15-9 with two test
owners and three disposable Demo accounts. Keep Live/funded credentials and orders out of this
gate. Stop on any identity mismatch, secret exposure, duplicate controller, stale generation,
unknown cleanup state, failed reconciliation, or gauntlet failure.
