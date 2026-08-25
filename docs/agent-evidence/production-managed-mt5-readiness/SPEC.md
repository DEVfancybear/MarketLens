# SPEC — production-managed-mt5-readiness v1

- Status: proposed; implementation is forbidden until the user approves the exact token
  `APPROVE SPEC: production-managed-mt5-readiness v1`.
- Tier: old-coder Tier 3 (production process lifecycle, broker credentials, trading availability).
- Repository: `C:\Users\duong\Downloads\tradingview`
- Source baseline: `fa1b9135dad780b3d4dce7a5c5e5084d3df865af`
- Requested outcome: a normal production backend run must not report ready until the managed MT5
  worker infrastructure is ready to accept account provisioning, while the managed-login entry
  remains discoverable in the UI.

## User-visible contract

1. The desktop and mobile Trade surfaces always show the managed MT5 login entry.
2. When `connectors.mt5Managed=true`, the entry opens the existing credential form and preserves
   the current secure submission contract.
3. When the capability is false or has not loaded, the entry remains visible but reports that the
   managed backend is unavailable; it must not submit or retain a broker password.
4. A normal `\.\run-backend-production.ps1` run ensures both the existing market-data MT5 path and
   one previously installed, attested bare-metal managed worker are healthy before printing
   `Backend production is ready.`
5. The worker runs through its existing Scheduled Task under its dedicated interactive Windows
   identity. The backend runner never launches `mt5-vm-agent.exe` or a per-account terminal
   directly.

## Definition of ready

“Managed MT5 infrastructure ready” means all of the following are true during one fresh runner
execution:

- the existing worker installation receipt is an absolute, non-link, readable regular JSON file;
- the receipt identifies exactly one expected task and worker and contains the installer-produced
  task identity, launcher/config/agent paths, and SHA-256 pins;
- the existing `Get-MT5BareMetalWorkerStatus.ps1` contract validates those files, hashes, task
  action, dedicated identity, interactive logon type, limited run level, and 1–4 terminal slots;
- the Scheduled Task is `Running` with last result `0` or `0x00041301`;
- the private Rust admin registry contains the receipt’s exact `workerId` with `status=healthy`,
  `drain=false`, positive capacity equal to the attested slot count, active leases not exceeding
  capacity, and an unexpired heartbeat;
- the Go API starts with a valid identity HMAC key and a successful Windows Credential Manager
  write/read/delete/absence probe, so a successful authenticated execution registry response can
  advertise `connectors.mt5Managed=true`;
- the existing local database, EA relay, market-data symbol, and public health checks also pass.

This definition does **not** claim that a broker account which has never supplied credentials is
ready. Once a user submits valid Demo credentials, the existing Go → Windows Credential Manager →
Rust reservation/activation → worker lease flow owns launching the account’s terminal and EA.

## Failure model and catching layers

| Failure mode | Harm | Required detector |
| --- | --- | --- |
| Runner reports ready with no worker heartbeat | credentials can be accepted into a permanently queued account | worker-registry contract test, timeout test, real fixture execution |
| Runner starts an arbitrary or tampered Scheduled Task | code execution or credential exposure under the wrong identity | receipt/path/hash/task-contract validation and negative controls |
| Runner launches the agent directly | bypasses interactive identity, ACL, pin, and task action boundaries | source contract plus direct-launch mutant |
| Healthy worker is blindly restarted | active leases and terminals can be fenced or interrupted | idempotency test proving zero start calls for a healthy worker |
| Stale/offline/draining/wrong worker row is accepted | false readiness and unavailable slot capacity | exhaustive registry-state property matrix and mutants |
| Worker capacity does not match attested slots | overbooking or silently unavailable accounts | exact capacity/slot-count assertion |
| HMAC key or Windows Credential Manager probe fails but API stays production-ready | UI can expose an unusable or unsafe credential path | Go startup RED test and fail-closed implementation |
| Capability is false and UI hides the feature | users cannot discover or diagnose managed MT5 | desktop/mobile render-contract tests |
| Capability is false and UI still submits a password | unnecessary credential exposure | unavailable-state interaction/source contract and existing password-clear test |
| Admin or broker secrets reach argv/logs/evidence | credential disclosure | no-command-argument invariant, sanitized-output assertions, diff secret scan |
| Worker is missing during a source/deploy restart | partial deployment presented as success | runner nonzero exit and forbidden-ready-output negative control |
| Account has no credentials yet | build invents or reuses broker identity | explicit no-account-launch invariant |

## Executable acceptance scenarios

### P1 — managed login is always discoverable

Given either `mt5Managed=true`, `false`, or unresolved capability state, when desktop and mobile
Trade actions render, then each surface contains exactly one managed MT5 entry. True opens the
existing connection dialog. False/unresolved shows an unavailable explanation and cannot invoke
the connect mutation.

### P2 — production startup keeps a healthy worker running

Given a valid receipt, valid task contract, a running healthy task, and a fresh matching Rust
registry heartbeat, when the readiness helper runs, then it performs zero `Start-ScheduledTask`
calls and returns a sanitized ready result for the exact worker ID and capacity.

### P3 — production startup starts a stopped attested worker

Given the same valid installation but a stopped task, when the readiness helper runs, then it calls
`Start-ScheduledTask` exactly once for the receipt’s exact task name, waits for the task contract to
become healthy, waits for a new matching Rust heartbeat, and returns ready within the configured
bounded timeout.

### P4 — invalid installation fails before execution

For each missing/malformed/relative/linked receipt, missing or linked artifact, SHA mismatch,
unexpected task action, non-interactive principal, elevated run level, wrong identity, and zero or
more than four slots: the helper exits nonzero before starting any task or calling the admin
registry, and emits only a stable sanitized error code.

### P5 — stale or unsuitable registry state never passes

For each empty registry, wrong worker ID, `offline`, `draining`, `drain=true`, expired heartbeat,
zero capacity, capacity/slot mismatch, or active-leases-over-capacity response: the helper keeps
polling only until the bound expires, exits nonzero, and never emits ready.

### P6 — gateway restart is ordered before worker readiness and API readiness

Given a normal canonical production run, the new Rust gateway is healthy before worker readiness is
evaluated; managed worker readiness passes before the new Go API is declared ready; and the final
ready banner occurs only after all existing local/public checks. A failed worker gate prevents the
ready banner and the Go API must not be presented as production-ready.

### P7 — production credential-store failure is fail-closed

Given `APP_ENV=production` with a configured managed identity-key path, when the key is invalid or
the Windows Credential Manager probe fails, then Go API startup fails with a sanitized error before
managed routes/capability are enabled. Development/test behavior remains explicitly controllable
without weakening the production path.

### P8 — user submission retains the existing secure flow

Given capability true and a valid authenticated Demo-account request, when the existing form
submits, then it uses the existing POST route, clears the browser password on success/failure, stores
the credential only in Windows Credential Manager, activates the Rust account, and leaves terminal
launching to the worker lease. No broker credential is added to env, argv, PostgreSQL, files, logs,
or responses.

### P9 — portable verifier is fail-closed

Given the final source tree, the single gauntlet command removes stale task-owned reports, runs all
declared layers, and exits nonzero on any failed command, missing input, parser error, skipped
mutant, surviving mutant, unmet scenario, or failed negative control.

## Negative constraints

- MUST NOT change `build-production.ps1` into a process supervisor; the canonical source-build and
  run entrypoint remains `run-backend-production.ps1`.
- MUST NOT make `tools\deploy-backend.ps1` independently implement restart logic; it continues to
  delegate to the canonical runner.
- MUST NOT install a worker, invent terminal slots, create broker credentials, or log into a broker
  during a normal backend run. Installation/attestation remains an explicit one-time operator step.
- MUST NOT force-stop or restart an already healthy worker.
- MUST NOT start `mt5-vm-agent.exe` or `terminal64.exe` for managed accounts directly from the
  backend runner. Only the attested Scheduled Task and worker own managed terminals.
- MUST NOT weaken task principal, ACL, reparse-point, artifact-pin, heartbeat, capacity, lease,
  loopback, authentication, or credential-store checks.
- MUST NOT print the admin token, bootstrap token, identity HMAC material, broker login/password,
  worker session token, or complete sensitive request/response bodies.
- MUST NOT claim an account is `ready` merely because the worker infrastructure is ready.
- MUST NOT edit, stage, reset, delete, or overwrite unrelated existing dirty-worktree paths.
- MUST NOT commit, push, deploy, install/start a real worker, or mutate a production host under this
  SPEC without a separate explicit user request after the gauntlet passes.

## Planned implementation surface

Exact paths may be reduced, but adding implementation paths requires an append-only SPEC revision
and new approval.

- `run-backend-production.ps1`
- `backend/.env.example`
- `backend/internal/execution/handler.go`
- `backend/internal/execution/managed_mt5_startup_test.go`
- `tools/mt5-baremetal/Install-MT5BareMetalWorker.ps1`
- `tools/mt5-baremetal/Get-MT5BareMetalWorkerStatus.ps1` only if a test proves an existing public
  contract is insufficient; otherwise it remains unchanged
- `tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1` (new)
- `tools/verify-production-managed-mt5-readiness.ps1` (new single gauntlet entry point)
- `frontend/src/components/trade/TradeWorkspace.tsx`
- `frontend/src/components/mobile/MobileTradeScreen.tsx`
- `frontend/src/i18n/localization.ts`
- `frontend/tests/trade/managedMt5DialogContract.test.ts`
- `docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`
- `docs/OPERATIONS.md`
- `docs/agent-evidence/production-managed-mt5-readiness/SPEC.md`
- `docs/agent-evidence/production-managed-mt5-readiness/EVIDENCE.md` (created only after a fresh
  passing final gauntlet)

## Receipt and configuration plan

- The existing worker installer will persist a non-secret, ACL-protected installation receipt
  below the protected worker root. It records only the existing installer result fields: worker ID,
  task name, worker identity, slot count, launcher/config/agent/PowerShell paths, and SHA-256 pins.
- `backend/.env.example` and the runbook will add one non-secret absolute-path setting pointing to
  that receipt. The receipt contains no broker/admin/bootstrap/HMAC secret.
- The canonical runner will read the path without echoing receipt contents, validate it, reuse the
  existing status contract, and authenticate the loopback Rust registry request with the existing
  in-memory admin token header. The token never enters a command argument.
- Timeout and polling are bounded. The concrete default will be stated in tests and documentation;
  the implementation may expose only a tightly validated bounded override if tests demonstrate an
  operational need.

## RED → GREEN → REFACTOR order

1. Add frontend RED contracts showing the managed entry is missing for false/unresolved state.
2. Make the smallest frontend render/state change; run targeted and full Trade tests.
3. Add PowerShell RED scenarios for healthy idempotency, stopped-task start, invalid receipt/task,
   stale registry, bounded timeout, secret hygiene, and final-banner ordering.
4. Add the smallest receipt/readiness helper and runner integration; freeze assertions before
   refactoring.
5. Add Go RED tests proving a production credential-store startup failure does not continue; then
   implement the explicit production requirement without changing test/development defaults
   implicitly.
6. Refactor only while assertions stay frozen and rerun the affected full suites after each step.

## Gauntlet and evidence plan

The persisted `tools\verify-production-managed-mt5-readiness.ps1` will be the single rerunnable
entry point. Its final fresh run must include:

- PowerShell 5.1 parser checks for every touched `.ps1` file;
- all new readiness scenarios with deterministic fake scheduler/clock/registry boundaries;
- an exhaustive property matrix proving only the exact healthy worker state is accepted;
- at least five scripted, execution-proven mutants covering skipped heartbeat, wrong worker,
  drain acceptance, blind restart, and direct agent launch; every mutant must be killed and the
  original bytes restored;
- negative controls proving the verifier fails on a known-bad runner, malformed receipt, a silently
  skipped mutant, and forbidden ready output;
- `cd frontend; npm run test:trade`, `npm run typecheck`, `npm run lint`, and `npm run build`;
- `cd backend; go test -shuffle=on ./...` and `go vet ./...`;
- the relevant locked Rust workspace tests because the helper consumes the private worker-registry
  contract, even if Rust source does not change;
- changed-line behavior mapping/coverage for new Go and testable helper logic; PowerShell host
  orchestration lines that cannot be instrumented must be mapped to deterministic scenario tests
  and disclosed rather than assigned an invented percentage;
- a realistic portable execution of the readiness CLI against fake host boundaries; real Scheduled
  Task/worker/terminal execution remains **unverified** until the operator runs the canonical runner
  on the Windows production host;
- diff capability review, dependency diff, and secret scan; new runtime/package dependencies must
  remain zero;
- source-state and unrelated-dirty-path preservation checks.

EVIDENCE will map every scenario and negative constraint to an exact test/layer, include raw counts
from one final fresh run, disclose all skipped/blocked layers, and state independent verification as
`not performed` unless separately authorized and actually completed.

## Dependencies, tools, generated files, and git operations

- New dependencies: none.
- Existing tools only: PowerShell 5.1, Task Scheduler cmdlets, Git, Node/npm, Go, Cargo/Rust, and
  repository scripts.
- Network: no new external service. The production helper accesses only the configured loopback
  Rust admin endpoint; local tests use fakes and make no network request.
- Generated/task-owned artifacts: verifier logs/reports only under the task evidence directory;
  the final EVIDENCE file only after a passing gauntlet.
- Host mutation during implementation/verification: none. No real task start, worker install,
  terminal launch, broker login, order, database migration, or deployment.
- Git: read-only status/diff/source-state checks only. No stage, commit, pull, rebase, push, tag, or
  force operation is authorized by this SPEC.
- Existing unrelated dirty paths observed at proposal time are outside scope and must retain their
  byte hashes. In particular, the current MT5 credential-store revisions, migration-gate work, and
  modified broad managed-EA verifier files are not task inputs and must not be staged or rewritten.

## Approval

Implementation may begin only after the user sends exactly:

`APPROVE SPEC: production-managed-mt5-readiness v1`

## Approval record

- Approved exactly by the user on 2026-08-25 with
  `APPROVE SPEC: production-managed-mt5-readiness v1`.
- Approved SPEC SHA-256 before this append-only approval record:
  `5F6138B0F8BC6E005C1EC8340A27112DDC5F65F59DB5B8B484713B5A98E5185F`.
