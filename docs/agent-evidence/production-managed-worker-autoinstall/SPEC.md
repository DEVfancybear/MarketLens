# SPEC - production-managed-worker-autoinstall v1

- Status: proposed; implementation is forbidden until the user approves the exact token
  `APPROVE SPEC: production-managed-worker-autoinstall v1`.
- Tier: old-coder Tier 3 (production host mutation, Windows Scheduled Task, protected configuration,
  and managed trading infrastructure).
- Repository: `C:\Users\duong\Downloads\tradingview`.
- Source baseline: `8dcc38f4d70161042853768abbbb6403ae979633`.
- Requested outcome: on an already prepared production host, one normal
  `.\run-backend-production.ps1` invocation builds the artifacts, installs or adopts the attested
  managed worker when its receipt is absent, validates and persists the returned `receipt_path`,
  and continues the same production run. The operator must not manually invoke the installer,
  copy the receipt path, edit `.env`, or rerun the canonical runner.

## Prepared-host boundary

Zero-touch begins only after the host has the security inputs that cannot be inferred safely:

- an existing dedicated Windows worker identity;
- an existing ACL-protected bootstrap-token file whose secret matches the configured backend
  bootstrap token;
- one to four fully attested terminal-slot descriptors with exact terminal, EA, chart, WebRequest,
  topology paths, hashes, profiles, and pipe names.

Those non-secret paths and hashes are supplied in one ACL-protected JSON install-input file at the
deterministic default
`C:\ProgramData\MarketLens\managed-worker-install-input.json`. An optional absolute
`EXECUTION_MT5_MANAGED_WORKER_INSTALL_INPUT_FILE` setting may select another protected file. The
runner may consume this file automatically; it must not invent an identity, terminal slot,
attestation, bootstrap secret, or broker credential.

## Executable acceptance scenarios

### A1 - one normal invocation completes first installation

Given the receipt setting is empty, the source-build path has produced and verified the API,
gateway, and `mt5-vm-agent.exe`, and the protected install-input file is valid, when the canonical
runner reaches the post-build receipt gate, then it:

1. derives executable artifact paths and SHA-256 values from the checked-out repository rather
   than trusting manifest-supplied artifact overrides;
2. runs the existing worker installer dry-run and requires valid sanitized JSON;
3. runs the same installer with `-Execute` exactly once;
4. parses the returned JSON and validates the absolute, regular, non-reparse, bounded receipt;
5. atomically persists exactly that `receipt_path` to
   `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE` in `backend\.env`;
6. exports the normalized receipt path to the current process and continues through the existing
   Python, migration, restart, worker-readiness, API, and health gates without asking for a rerun.

### A2 - valid existing receipt remains idempotent

Given `.env` already names a valid receipt, a normal runner invocation does not load the install
input, invoke the installer, rewrite `.env`, replace the Scheduled Task, or change worker files. It
continues through the existing receipt/readiness path.

### A3 - completed install can be adopted after persistence interruption

Given the installer previously completed and wrote the deterministic receipt under the configured
worker root but `.env` persistence did not complete, when the next normal source-build invocation
runs, then it validates and adopts that receipt only if it matches the protected install input and
current artifact/task contract. It persists the receipt without reinstalling the task. Ambiguous or
mismatched state fails closed.

### A4 - invalid or missing install input fails before runtime

Given the receipt is absent and the install-input file is missing, relative, linked, unreadable,
empty, oversized, malformed, has duplicate/unknown fields, names a missing identity or secret file,
contains zero or more than four slots, or fails installer dry-run, then the runner exits nonzero
with a stable sanitized code beginning `MANAGED_MT5_WORKER_AUTOINSTALL_`. It performs no migration,
terminal launch, listener stop, artifact replacement, gateway/API start, health check, or ready
banner and does not modify `.env`.

### A5 - installer execution failure is fail-closed and honest

Given dry-run succeeds but installer execution fails or emits invalid JSON, the runner exits
nonzero before runtime and does not claim production readiness. It does not persist a receipt path,
does not retry in a loop, and does not expose installer arguments, token contents, `.env` contents,
or sensitive paths beyond sanitized field names and stable error codes.

### A6 - `.env` persistence is exact and atomic

Given installer execution returns a validated receipt, the updater accepts exactly zero or one
active `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE` assignment, preserves every other byte and line,
refuses duplicate or malformed assignments, writes a same-directory temporary file, preserves the
original ACL, atomically replaces the original, verifies the resulting exact value, and removes the
temporary file on failure. It never logs or returns any other `.env` value.

### A7 - deploy/recovery mode remains unchanged

Given `-SkipBuild` is selected, the runner never auto-installs or adopts a worker and never rewrites
`.env`. A missing receipt remains a nonzero `MANAGED_MT5_WORKER_RECEIPT_REQUIRED` failure before
runtime. The documented `tools\deploy-backend.ps1` delegation contract is unchanged.

### A8 - no credential or attestation invention

The runner and auto-install helper never create a Windows identity, prompt for or accept a password,
generate a bootstrap token, derive terminal slots from broad filesystem scanning, log into a broker,
or put credentials/tokens in argv, environment additions, JSON output, logs, the receipt, or Git.
Only the path to an already protected bootstrap-token file crosses the installer boundary.

### A9 - verifier fails closed

The persisted lightweight gauntlet proves normal/adopt/invalid/installer-failure/SkipBuild branches,
atomic `.env` preservation, source ordering, stable error codes, no secret output, and exact
single-invocation continuation. It execution-proves and kills at least these mutants: installer
called before artifact verification, `-SkipBuild` auto-install enabled, invalid installer exit
accepted, receipt persisted before validation, and duplicate `.env` key accepted. Parser errors,
skipped fixtures, surviving mutants, restore mismatch, or missing assertions fail the gauntlet.

## Failure model

| Failure | Harm | Required detector |
| --- | --- | --- |
| Installer runs before verified build | stale or substituted worker installed | ordering test and mutant |
| Runner invents slot/identity input | wrong broker/terminal or privilege boundary | schema/capability tests |
| Installer output trusted blindly | malicious path persisted | invalid JSON/path fixtures and mutant |
| `.env` rewrite corrupts secrets | production outage or credential disclosure | byte-preservation fixtures and secret-output scan |
| Crash after task install before persistence | repeated mutation of installed task | adoption/idempotency scenario |
| `-SkipBuild` gains host mutation | deploy path violates artifact boundary | explicit branch test and mutant |
| Partial install continues runtime | unattested execution starts | forbidden-side-effect ordering matrix |
| Credentials appear in logs/argv | secret disclosure | sanitized-output negative controls |

## Negative constraints

- MUST NOT auto-create a Windows account, password, broker credential, bootstrap token, terminal
  installation, terminal slot, EA attestation, or topology attestation.
- MUST NOT pass secrets in command arguments, add them to new environment variables, print `.env`,
  print install-input contents, or include secrets in receipt/config/logs.
- MUST NOT auto-install in `-SkipBuild` mode.
- MUST NOT continue runtime after any install, validation, adoption, or persistence failure.
- MUST NOT weaken the existing receipt, task, artifact, identity, ACL, slot, heartbeat, capacity, or
  lease validation.
- MUST NOT alter `tools\deploy-backend.ps1` or its documented delegation switches.
- MUST NOT run a real installer, Scheduled Task, terminal, broker login, migration, production
  restart, deploy, commit, or push during local implementation verification.

## Planned implementation surface

- `run-backend-production.ps1`
- `backend/.env.example`
- `tools/Install-ProductionManagedWorker.ps1` (new fail-closed orchestrator/helper)
- `tools/verify-production-managed-mt5-readiness.ps1`
- `tools/verify-production-managed-worker-autoinstall.ps1` (new lightweight entry point)
- `docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`
- `docs/OPERATIONS.md`
- `docs/agent-evidence/production-managed-worker-autoinstall/SPEC.md`
- `docs/agent-evidence/production-managed-worker-autoinstall/EVIDENCE.md`

## RED -> GREEN -> REFACTOR

1. Add frozen fixture tests for A1-A9 using fake installer and temporary `.env` boundaries.
2. Run the focused verifier against baseline `8dcc38f` and observe RED for the missing auto-install
   behavior.
3. Implement the helper and minimal canonical-runner integration.
4. Run focused tests GREEN; refactor with assertions frozen.
5. Run the five scoped mutants one at a time and prove exact source-byte restoration.
6. Run one final fresh lightweight gauntlet and write EVIDENCE from that run.

## Lightweight gauntlet and resource ceiling

Single entry point:

```powershell
.\tools\verify-production-managed-worker-autoinstall.ps1
```

It runs sequentially and may use PowerShell parser checks, temporary fixture directories, fake
installer processes, focused contract tests, five scoped mutants, diff/secret/capability audits,
and source-state hashing. It MUST NOT invoke npm build, frontend full tests, `go test ./...`, Go
build/vet/coverage/race, Cargo test/check/clippy/build/coverage, the production runner against real
configuration, a real installer, database, Scheduled Task, terminal, broker, deploy, commit, or push.
Each child process has a finite timeout; failure stops without falling back to heavy tests.

Final status may be `PASS_WITH_DECLARED_UNVERIFIED` only when every lightweight layer passes. Real
host identity/ACL/task creation, worker heartbeat, terminal execution, broker onboarding, build,
deployment, and activation remain explicitly unverified.

## Dependencies, generated files, and git operations

- New dependencies: none; Windows PowerShell 5.1, Git, and repository scripts only.
- Generated ignored artifacts: `.artifacts/production-managed-worker-autoinstall/**`.
- Network: none during local verification.
- Git: read-only status/diff/hash checks only. No stage, commit, pull, rebase, push, tag, reset, or
  checkout is authorized by this SPEC.
- Working tree: preserve unrelated and previously committed work byte-for-byte.

## Approval

Implementation may begin only after the user sends exactly:

`APPROVE SPEC: production-managed-worker-autoinstall v1`
