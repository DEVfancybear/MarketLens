# SPEC — Provision one managed MT5 worker slot and run backend production

- Status: **proposed; implementation is forbidden until the user approves this exact revision**.
- Approval token: `APPROVE SPEC: production-worker-host-provision v1`
- Tier: **old-coder Tier 3** — this mutates a Windows production host, protected secrets/ACLs,
  an interactive Scheduled Task, MT5/EA topology, database migrations, and trading infrastructure.
- Repository: `C:\Users\Duong\Downloads\tradingview`
- Source baseline: branch `master`, commit `097bcf7f523b1327b2c970036d24d1542740fd8b`.
- User-selected worker identity: `DESKTOP-MDC339G\Duong`.
- User-selected terminal: `C:\Program Files\MetaTrader 5\terminal64.exe`.
- Exact terminal state root:
  `C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075`.
- Other detected MT5 terminals are explicitly out of scope:
  `C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe` and
  `C:\Program Files\MetaTrader 5 IC Markets Global\terminal64.exe`.

## Startup and setup plan

- `codebase-memory-mcp` MCP and CLI are unavailable. The repository-authorized fallback was used:
  `docs/CODEBASE_MEMORY.md`, `docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`, `docs/OPERATIONS.md`, and
  the exact current runner/installer/worker source were read directly.
- The user explicitly requested installation of `AmazingAng/old-coder`; it was installed before this
  SPEC at `C:\Users\Duong\.codex\skills\old-coder`, its complete `SKILL.md`,
  `references/gauntlet.md`, and `references/templates.md` were read, and
  `tools\verify-old-coder-policy.ps1` passed.
- Tools to install after approval: **none**.
- New application/runtime dependencies: **none**.
- Git isolation: no application implementation will be changed. Git worktrees cannot isolate
  Scheduled Task, ACL, terminal-profile, or ProgramData mutations, so host mutation is isolated by
  exact absolute paths, protected staging files, preflight hashes, and fail-before-mutation gates.
  Git operations are read-only (`status`, `diff`, `rev-parse`, `diff --check`); no checkout, branch,
  stage, commit, reset, pull outside the canonical production runner, or push is authorized.
- The canonical runner's own normal `git pull` is authorized because the user's requested command
  is `run-backend-production.ps1`; no runner switches are authorized.
- The production runner may build its normal ignored binaries/logs and apply forward migrations.
  Migrations will not be rolled back.

## Planned files and host mutations

Task-owned repository evidence/tooling:

- `docs/agent-evidence/production-worker-host-provision/SPEC.md` — this approved contract.
- `tools/verify-production-worker-host-provision.ps1` — one fail-closed rerunnable gauntlet entry
  point; it must print no secret values and must support a known-bad negative control.
- `docs/agent-evidence/production-worker-host-provision/EVIDENCE.md` — final results only.

Protected host inputs/outputs, created only after all non-mutating preconditions pass:

- `C:\ProgramData\MarketLens\secrets\worker-bootstrap.token` — 48 random bytes encoded without
  command-line or log exposure; it must exactly match `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN` in
  `backend\.env`.
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\chart01.chr` — exact one-chart EA profile input.
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\experts.ini` — exact WebRequest settings snapshot.
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\webrequest-attestation.json` — accepted only when
  a real MT5 WebRequest probe to `http://127.0.0.1:8790` has succeeded; it must never be synthesized
  merely to satisfy schema validation.
- `C:\ProgramData\MarketLens\managed-worker-install-input.json` — schema v1, one slot, exact hashes.
- `C:\MarketLens\worker\**` and `C:\MarketLens\runtime\**` — installer-owned protected roots,
  launcher/config/receipt/runtime data.
- Windows Scheduled Task `MarketLens MT5 Worker` under identity `DESKTOP-MDC339G\Duong`.
- Selected terminal state-root outputs only: published EA, `MarketLens-slot-01\chart01.chr`, pinned
  `Config\experts.ini`, and `Config\marketlens-webrequest-attestation.json`.
- `backend\.env`: update only `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN` and the runner-owned
  `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE`; preserve encoding, ACL, every other line/value, and
  never print the file.
- Normal ignored production outputs under `backend\bin`, `backend\execution\target`,
  `backend\.venv-mt5`, and `.runtime-logs`.

If an already-existing target conflicts by content, identity, ACL, hash, task action, or ownership,
execution must stop; this SPEC does not authorize overwriting an unknown installation.

## Failure model and required defenses

| Failure mode | Required defense |
|---|---|
| Wrong broker terminal/profile is modified | Pin exact terminal/state-root pair; negative gate forbids the FTMO and IC Markets paths |
| Selected terminal is running during topology installation | Stop only the exact selected executable after recording its PID; fail on ambiguous ownership |
| Current `Duong` identity is not suitable for an interactive worker | Verify SID, enabled account, interactive session, paths, and task principal before mutation |
| Bootstrap/admin/HMAC/broker secret leaks | Never print `.env` or token content; no secret in argv/new logs/input/receipt; bounded secret scan |
| Bootstrap token file and `.env` diverge | In-process constant-time equality check without emitting values; fail before runner |
| Broad/inherited ACL exposes protected files | Disable inheritance; allow only current provisioning SID, SYSTEM, and Administrators; re-read ACL |
| Terminal/EA/catalog/license/settings changes after attestation | SHA-256 pin every required artifact and reject reparse components |
| WebRequest attestation is fabricated | Require real probe evidence; missing/unverifiable probe blocks all host mutation and production cutover |
| Partial installer or Scheduled Task mutation | Use existing dry-run-first installer; preserve exact failure code and receipt/logs; do not claim success |
| Worker task exists but wrong action/identity/hash | Existing receipt/task/status validators must pass before runtime startup |
| Worker starts without fresh registry heartbeat/capacity | Canonical runner readiness gate must observe matching fresh heartbeat and slot capacity |
| Migration/restart/public health fails | Canonical runner exits nonzero; no completion claim and no migration rollback claim |
| A verifier silently skips a layer | Expected-layer manifest plus known-bad negative control; unexpected exit is failure |

## Executable acceptance scenarios

### S1 — Exact selected slot preflight

Given the selected terminal and state root above,
when preflight resolves the terminal signer, `origin.txt`, `Config\terminal.lic`, state-root
`Config\servers.dat`, current SID, active processes, reparse ancestry, and SHA-256 values,
then every item is uniquely matched and safe, and neither out-of-scope terminal is selected or
modified. Any mismatch exits nonzero before creating ProgramData/worker/task/profile artifacts.

### S2 — Honest WebRequest topology evidence

Given the selected MT5 profile,
when the WebRequest settings source and topology attestation are prepared,
then `http://127.0.0.1:8790` is the only allowed origin, the settings hash matches, and
`probeSucceeded=true` is written only after an actual terminal WebRequest probe succeeds.
If no trustworthy probe can be executed or observed, the result is **blocked**, no positive
attestation is written, and production is not started.

### S3 — Protected bootstrap material

Given all non-secret slot preconditions and S2 pass,
when bootstrap material is created,
then the token has at least 32 unpredictable bytes, the protected token file equals the in-memory
value written atomically to `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN`, the file has protected ACLs, and no
command output, argv, input JSON, receipt, config, or task action contains the value.

### S4 — Strict one-slot install input

Given the pinned slot artifacts,
when `managed-worker-install-input.json` is written,
then it contains schema version 1, worker root `C:\MarketLens\worker`, data root
`C:\MarketLens\runtime`, worker identity `DESKTOP-MDC339G\Duong`, task name
`MarketLens MT5 Worker`, worker ID `marketlens-baremetal-01`, one `slot-01`, exact absolute paths and
fresh SHA-256 hashes, no duplicate/unknown fields/placeholders/secrets, and protected non-inherited
ACLs allowing only the provisioning SID, SYSTEM, and Administrators.

### S5 — Dry run rejects hostile or stale input

Given the staged input and production artifacts,
when the existing auto-install helper runs without `-Execute`,
then it returns only the expected dry-run result. Negative controls for relative path, broad ACL,
wrong terminal hash, wrong EA hash, false WebRequest attestation, and an out-of-scope terminal must
all fail with the expected fail-closed code and cause no host mutation.

### S6 — Exact selected terminal interruption

Given the selected terminal process is running,
when installation is ready to execute,
then only processes whose canonical executable path equals
`C:\Program Files\MetaTrader 5\terminal64.exe` are stopped. FTMO/IC Markets terminals and unrelated
processes are untouched. If ownership/path resolution is ambiguous, installation stops.

### S7 — Canonical production run succeeds end to end

Given S1–S6 pass and the selected terminal is stopped,
when `\.\run-backend-production.ps1` runs with no switches from the repository root,
then it pulls `master`, builds verified Go/Rust/worker artifacts, dry-runs and executes/adopts the
worker installation, persists the exact receipt path, applies forward migrations, safely restarts
the services/task, and passes local gateway/API, worker heartbeat/capacity, local readiness, and
public health gates with exit code 0.

### S8 — Failure remains a failure

Given any build, installer, ACL, receipt, task, migration, process, heartbeat, capacity, local health,
or public health gate fails,
when the entry point exits,
then EVIDENCE records the exact non-secret failure code/output, completion is blocked, no commit or
push occurs, and no claim is made that production is running.

## Must NOT

- Must not invent, weaken, or hand-author a positive WebRequest probe result.
- Must not modify, stop, hash-pin, or enroll the FTMO or IC Markets terminals.
- Must not create a new Windows account, change a password, or grant `Duong` additional global
  privileges under this revision.
- Must not expose secrets in output, command arguments, SPEC/EVIDENCE, input JSON, receipt, task,
  git diff, or logs.
- Must not place broker credentials in `.env`, files, command arguments, or environment variables.
- Must not use `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, or `-SkipPublicHealthCheck`.
- Must not directly launch the worker, gateway, API, or account terminal as a substitute for the
  canonical production runner.
- Must not weaken tests, assertions, hashes, ACLs, signer checks, task attestation, heartbeat, or
  health gates.
- Must not commit, push, reset, checkout, rebase, merge, delete unknown data, or roll back migrations.

## RED → GREEN → REFACTOR and gauntlet

This is an environment provisioning task, not an application behavior change. Before any production
mutation, the new verification entry point will be run against a known-bad fixture/flag and must
fail for the pinned reason (RED). Its read-only real-host preflight must then pass only the exact
selected paths (GREEN). Refactoring, if any, occurs with checks frozen and is followed by both runs.

The single final fresh entry point will be:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1
```

It will fail closed and run, in order:

1. source state/worktree and exact-path preflight;
2. verifier known-bad negative control;
3. existing managed-worker auto-install contract suite;
4. existing bare-metal managed-EA contract suite;
5. selected-host path/signer/hash/reparse/ACL/input/secret-capability audit;
6. installer dry run;
7. the normal canonical production runner once;
8. receipt/task/worker-heartbeat/capacity/local/public health postconditions;
9. exact expected-layer manifest audit and `git diff --check` for task-owned repo files.

Application changed-line coverage, property tests, and mutation of Go/Rust runtime code are N-A
because no application implementation is changed. The persisted verifier's negative controls and
the existing focused contract/mutation suites are the relevant substitute; EVIDENCE must label
them precisely and must not claim new application coverage. Independent verification is not
planned; it will be recorded as `not performed` against the final state.

## Revisions

- v1 — Created after the user selected `DESKTOP-MDC339G\Duong` and the generic MetaTrader 5
  installation as the single production slot. No production implementation or host mutation has
  begun.
- v1 approval — obtained exactly as `APPROVE SPEC: production-worker-host-provision v1` before the
  verifier was implemented or run. The run then failed closed and generated the blocked report in
  `EVIDENCE.md`.

## Revision v2 — Restore gauntlet-generated EA release drift

- Status: **proposed; cleanup is forbidden until the user approves this exact revision**.
- Approval token: `APPROVE SPEC REVISION: production-worker-host-provision v2`.
- User input incorporated: `restore 3 EA artifacts`.
- Reason: the approved v1 bare-metal gauntlet compiled the EA with a different local MetaEditor and
  left three tracked release artifacts modified even though they were absent from `dirty_before`.

### Exact cleanup scope

Restore these three paths byte-for-byte from the approved source baseline
`097bcf7f523b1327b2c970036d24d1542740fd8b`:

1. `frontend/public/downloads/MarketLensExecutionEA.ex5`
2. `frontend/public/downloads/MarketLensExecutionEA.release.json`
3. `frontend/public/downloads/MarketLensExecutionEA.sha256.txt`

The authorized command is restricted to:

```powershell
git restore --source=097bcf7f523b1327b2c970036d24d1542740fd8b --worktree -- `
  frontend/public/downloads/MarketLensExecutionEA.ex5 `
  frontend/public/downloads/MarketLensExecutionEA.release.json `
  frontend/public/downloads/MarketLensExecutionEA.sha256.txt
```

This revision authorizes no other `git restore`, checkout, reset, clean, delete, stage, commit, or
push. It authorizes no production runner, installer, migration, process stop/start, `.env` change,
ProgramData change, Scheduled Task change, or WebRequest attestation.

### Revision v2 acceptance criteria

Given the v1 summary proves the three paths were clean in `dirty_before` and modified in
`dirty_after`, when the exact restore command runs, then:

- `git diff --quiet 097bcf7f523b1327b2c970036d24d1542740fd8b -- <each exact path>` exits 0;
- each restored working-tree SHA-256 equals bytes extracted from that exact baseline commit;
- no other tracked or untracked path is removed, overwritten, staged, committed, or pushed;
- `SPEC.md`, `EVIDENCE.md`, the task verifier, and `.artifacts/**` remain present;
- the selected terminal and all production host state remain untouched; and
- `EVIDENCE.md` receives an append-only v2 cleanup record with the exact command/result and final
  `git status --short`.

### Revision v2 must NOT

- Must not accept the locally recompiled EA or rewrite its release manifest/checksum as production.
- Must not restore from `HEAD` implicitly; use the exact approved baseline above.
- Must not restore any fourth path or remove any untracked evidence/report.
- Must not resume provisioning or claim production readiness.

## Revision v3 — Make backend production run end to end

- Status: **proposed; implementation and production-host mutation are forbidden until the user
  approves this exact revision**.
- Approval token: `APPROVE SPEC REVISION: production-worker-host-provision v3`.
- User goal incorporated: backend production must actually run and pass its local/public health and
  managed-worker readiness gates; a report that merely remains BLOCKED is not the requested outcome.
- Tier remains **old-coder Tier 3**.
- Current source state remains branch `master` at
  `097bcf7f523b1327b2c970036d24d1542740fd8b` before v3 implementation.

### v3 diagnosis and gauntlet correction

The v1 run invoked `tools\verify-mt5-baremetal-managed-ea.ps1`, a historical feature gauntlet
frozen to task base `b0cabaf67b247412dbd5e02a01c61e75ce54349e`. Its 16 failures are retained in
`EVIDENCE.md`; no result is relabeled as pass. Several layers are not valid current-task gates:

- its capability audit compares the current committed production runner to an older frozen runner;
- its PostgreSQL sandbox requires a removed PostgreSQL 17 service, while the real configured
  production database is PostgreSQL 16.15 at `127.0.0.1:5432/marketlens`, migration `42`, clean;
- its persistent GCC snapshot is a missing artifact from a different Revision 2 task; and
- its Rust changed-line coverage targets historical Rust changes although v3 changes no Rust source.

Revision v3 replaces that historical entry point for this task with a current-source, production-
specific gauntlet. This is not permission to weaken a failing current test: the real failures found
by v1 — Python managed-worker fixtures, TypeScript test configuration, Go coverage, documentation,
formatting, and task verifier incompleteness — must be repaired and rerun. Historical PostgreSQL 17,
GCC snapshot, and Rust changed-line layers are recorded as N-A to v3 with the explicit production
substitutes below. PostgreSQL 16 data/service replacement or major-version migration is forbidden.

### v3 setup, dependencies, isolation, and Git authorization

- `codebase-memory-mcp` remains unavailable; the documented direct-source fallback is recorded.
- Tools/dependencies to install: **none**. Use the existing Go, Rust, Node/npm, Python, MetaEditor,
  PostgreSQL 16, PowerShell, and Git toolchains. Do not install PostgreSQL 17 or Rust LLVM tools.
- Network: only the canonical runner's `git pull --ff-only`, its public health probes, and the
  selected terminal's live probe of the already-running exact production gateway at
  `http://127.0.0.1:8790/health` are authorized. No temporary HTTP server is introduced.
- Isolation: after approval, create local branch
  `codex/production-worker-host-provision-v3` from the stated baseline. Commit the approved SPEC,
  implementation, tests, and EVIDENCE checkpoints locally; do not push. After GREEN, fast-forward
  local `master` to that branch so the no-switch canonical runner sees a clean production worktree.
  If `master` or its remote has diverged, stop; no rebase, force, reset, or non-fast-forward merge is
  authorized. Leaving the local task branch after the fast-forward is allowed; deleting it is not
  required.
- `.artifacts/migration-0042/`, `.artifacts/mt5-baremetal-managed-ea/`, and
  `.artifacts/production-worker-host-provision/` may be added to `.gitignore` so retained reports do
  not make the canonical runner's clean-worktree gate fail. The reports themselves must not be
  deleted or committed.
- `gofmt -w` may normalize only the Go files reported by `gofmt -l`; because Git uses
  `core.autocrlf=true`, the postcondition is no unintended tracked Go delta.

Planned tracked files are limited to:

- `.gitignore`;
- `backend/cmd/mt5-migration-gate/main_test.go`;
- `backend/bridge/mt5_vm/test_baremetal_worker_install.py` — fixture/setup repair only; assertions
  remain unchanged;
- `backend/bridge/mt5_vm/test_production_webrequest_probe.py`;
- `backend/docs/CONFIGURATION.md`;
- `frontend/tsconfig.test.json`;
- `tools/mt5-baremetal/MarketLensWebRequestProbe.mq5`;
- `tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1`;
- `tools/verify-production-worker-host-provision.ps1`;
- `docs/agent-evidence/production-worker-host-provision/SPEC.md`; and
- `docs/agent-evidence/production-worker-host-provision/EVIDENCE.md`.

Any newly discovered need to change application/runtime source, another tracked path, dependency,
service, database major version, security policy, firewall, or terminal selection requires another
append-only SPEC revision and approval.

### v3 failure model and defenses

| Failure mode | Required defense |
|---|---|
| A historical gauntlet is made green by changing its frozen baseline | Preserve v1 failure report; use a new v3 manifest tied to current source and map every former failure to a repair or explicit N-A/substitute |
| WebRequest evidence is fabricated | Attest the existing `execution-gateway.exe` listener/path and its exact HTTP 200 health body, then run a live nonce-bound MT5 EA/script outside Strategy Tester against that same endpoint; require a fresh matching terminal receipt before creating the five-field topology attestation |
| Probe EA can trade or leak account data | Probe source contains no trade API, token, account, or broker access; request/receipt contain only nonce, loopback URL, status, terminal build, and timestamps |
| URL is not actually allowed in MT5 | HTTP status must be returned by `WebRequest`; `-1`/error 4014 blocks. If manual MT5 UI configuration is required, pause for the user; do not automate the protected allow-list or claim success |
| Wrong terminal is stopped or launched | Resolve and pin only `C:\Program Files\MetaTrader 5\terminal64.exe`; reject FTMO/IC Markets and ambiguous processes |
| Production worktree is dirty | Commit only approved paths locally, ignore only the three report roots, require clean `git status`, then let the no-switch runner perform its own clean gate and pull |
| Secret is exposed or diverges | Generate 48 random bytes in process, protect the file ACL, atomically update only the named `.env` keys, compare without output, and scan task diffs/logs |
| Existing production database is damaged | Keep PostgreSQL 16 service/data in place; verify migration 42 clean before and after; runner may only apply forward migrations and may not roll back |
| Worker topology is partial or stale | Dry-run exact hashes/ACL/identity first; execute only through the existing auto-install helper; validate receipt/task/action/heartbeat/capacity |
| Production restart partially fails | Canonical runner remains fail-closed; retain logs and do not claim ready unless every local and public gate passes |

### v3 RED → GREEN behaviors

#### V3-S1 — Current managed-worker tests are genuinely green

Given the two v1 Python failures and TypeScript compiler failure were observed RED,
when fixture-only setup is corrected without changing assertions and
`frontend/tsconfig.test.json` uses a CommonJS-compatible module resolver,
then the exact Python managed suite and `npm run test:trade` pass. The Python fixture must model the
worker root and required `worker_id`; production assertions stay byte-for-byte unchanged.

#### V3-S2 — Empty Go command is covered and formatting is clean

Given `backend/cmd/mt5-migration-gate/main.go:6` was reported uncovered and `gofmt -l` reported
CRLF-normalized files,
when a regression test calls the intentionally inert `main()` and the approved normalization runs,
then changed-line coverage includes that line, `gofmt -l` is empty, and Git shows no unintended Go
source delta. A throwaway mutant that makes `main()` non-inert must make the new test fail before
GREEN is trusted.

#### V3-S3 — Production configuration documentation is complete

Given the docs checker reported the two managed-worker variables absent,
when their source-derived semantics are documented,
then `tools/verify-backend-docs.ps1` passes its positive run and still rejects its known-bad control.

#### V3-S4 — Live nonce-bound MT5 WebRequest proof

Given the existing listener on port `8790` resolves to this repository's
`backend\bin\execution-gateway.exe` and `GET /health` returns HTTP `200` with
`ok=true`, `service=execution-gateway`, and the expected protocol version,
when the selected terminal is stopped only after exact-path attribution and the persisted
PowerShell driver launches the no-trade probe via an MT5 startup config,
then the terminal's own WebRequest returns that same HTTP status/body, nonce/URL/timestamps match,
the terminal executable/hash match the selected slot, the probe source contains no trade API, and
a sanitized proof report is retained.
Only then may the driver write exact `chart01.chr`, `experts.ini`, and
`webrequest-attestation.json` inputs. Wrong nonce, remote bind, wrong terminal, status `-1`, MT5
error 4014, stale receipt, a wrong listener owner, or a gateway health mismatch must fail before
positive attestation.

#### V3-S5 — Protected one-slot host input

Given V3-S4 passes,
when the provisioning verifier generates bootstrap material and install input,
then the v1 S3/S4 ACL, entropy, equality, strict-schema, exact-path, exact-hash, one-slot, and
no-secret conditions pass. Existing conflicting worker/task/input state still blocks overwrite.

#### V3-S6 — Canonical production run and readiness

Given the current-task gauntlet is green, the selected terminal has been stopped exactly, Git is
clean on local `master`, and V3-S5 passes,
when `.\run-backend-production.ps1` runs once with no switches,
then it exits `0`, builds and verifies the API/gateway/worker, auto-installs or adopts the worker,
persists the receipt, leaves migration `42` clean or advances it cleanly, and passes gateway,
worker heartbeat/capacity, API health/readiness, MT5 stream/symbol, and both public health gates.

#### V3-S7 — Failure never becomes a readiness claim

Given any probe, test, pull, build, install, migration, task, heartbeat, local health, or public
health step fails,
when the v3 entry point exits,
then it is nonzero, the exact sanitized blocker is appended to EVIDENCE, no push occurs, and the goal
remains active rather than claiming production success.

### v3 final gauntlet and persisted entry point

The one final fresh entry point remains:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1
```

It must delete only its own stale `.artifacts/production-worker-host-provision` report root, bind
results to an expected-layer manifest, and run:

1. parser plus known-bad controls for the provisioning and WebRequest probe tools;
2. `gofmt -l`, `go vet ./...`, shuffled Go tests, normal Go tests, and `go test -race ./...`;
3. the focused Go test/coverage for `cmd/mt5-migration-gate`;
4. the full managed Python suites, including the new probe contracts;
5. Rust `fmt --check`, `check --locked`, `clippy --locked -- -D warnings`, tests, and agent tests;
6. frontend typecheck, lint, trade tests, and production build;
7. backend docs positive and negative-control checks;
8. existing managed-worker auto-install/readiness contract suites;
9. actual PostgreSQL 16 identity plus clean migration state before/after the canonical runner;
10. live nonce-bound MT5 WebRequest proof against the attested existing gateway and protected
    host-input verification;
11. exact-source/diff/secret/capability audits with no unapproved dependency or tracked path;
12. the no-switch canonical runner exactly once; and
13. receipt, Scheduled Task, worker heartbeat/capacity, local health, public health, expected-layer,
    clean-worktree, and retained-report postconditions.

Rust changed-line coverage, historical PostgreSQL 17 service-sandbox mutation, the historical GCC
snapshot, and the historical SQL mutant are **N-A to v3**, because v3 changes no Rust/SQL/GCC
surface and must not replace the live PostgreSQL 16 database. Their production substitutes are the
full Rust/Go/Python suites, actual migration-42 state, focused probe mutation/negative controls, and
real end-to-end execution. This limitation must remain explicit in final EVIDENCE.

### v3 must NOT

- Must not run production before this revision is approved and the v3 gauntlet reaches its runner
  stage green.
- Must not edit, stop, launch, or enroll FTMO or IC Markets terminals.
- Must not use Strategy Tester as WebRequest proof, hand-author `probeSucceeded=true`, or automate a
  failed MT5 allow-list UI with SendKeys/clipboard/UI scripting.
- Must not place any broker credential, database password, bootstrap/admin token, account ID, or
  session value in Git, argv, logs, reports, probe requests, or receipts.
- Must not install/replace PostgreSQL, migrate its major version, stop its service, drop/restore a
  production database, or change its authentication/configuration.
- Must not use runner recovery switches, directly substitute manual API/gateway/worker startup,
  skip public health, weaken tests, or edit existing behavioral assertions.
- Must not push, force, reset, rebase, non-fast-forward merge, delete retained evidence, or change
  any tracked file outside the exact list above.

### v3 pre-approval clarification — use the existing production gateway for WebRequest proof

Before v3 approval, a new read-only host preflight found that this repository's current
`backend\bin\api.exe`, Python stream, and `backend\bin\execution-gateway.exe` already own ports
`8080`, `8765`, `8790`, and `8791`. Local API health/readiness/EA-relay and both gateway health
endpoints returned HTTP `200`; the gateway reported zero connected execution accounts. The
managed-worker receipt, install input, protected bootstrap file, and Scheduled Task remain absent.

The proposed temporary Python probe server and its planned tracked file were therefore removed
before approval. V3-S4 now proves MT5 WebRequest against the real, exact-path production gateway
already listening on `8790`, while still requiring a fresh nonce-bound terminal receipt. Public
health could not be reached from the restricted diagnostic sandbox and remains a mandatory
canonical-runner gate; it was not claimed as pass. The v3 approval token is unchanged.

### v3 approval record

The user approved this revision exactly with:

```text
APPROVE SPEC REVISION: production-worker-host-provision v3
```

No v3 implementation, Git mutation, terminal interruption, protected-file creation, worker
installation, migration, or production run occurred before that approval.

## Revision v4 — Windows trade-test runner and test-only Ky ESM bridge (approval required)

### Discovery after v3 approval

V3 removed the TypeScript `TS5095` configuration error, but the required exact command
`npm run test:trade` exposed two further current-source failures on this Windows host:

1. `node --test .test-build/tests/trade/*.test.js` passes the wildcard literally, so Node reports
   that no matching path exists. Running the compiled test directory directly discovers the tests.
2. The CommonJS test output then fails in five tests because Ky v2 is ESM-only and cannot be loaded
   with `require()`. Compiling the entire suite as native ESM is not a safe local fix: the repository
   uses extensionless relative imports, which Node ESM rejects without rewriting application/test
   imports.

Both failures were observed before any v4 implementation. The production Next.js build and runtime
module graph are not implicated.

### v4 scope and behavior

Revision v4 keeps Tier 3 and every v3 invariant. It adds exactly these tracked paths to the v3
allow-list:

- `frontend/package.json`; and
- `frontend/tests/shims/ky.ts`.

The already-approved `frontend/tsconfig.test.json` may additionally map only the test compiler's
`ky` import to that shim. The shim must present the subset of Ky's callable/create/HTTP verb/body
shortcut and `HTTPError` contract used by `frontend/src/services/api/client.ts`, backed by native
`fetch`; it must not be imported by the production Next.js compiler or alter application source.
No dependency install, lockfile change, application/runtime source edit, test assertion edit, or
network service is authorized.

`frontend/package.json` may replace only the Windows-incompatible trade-test wildcard with Node's
directory test discovery. All other scripts and dependencies stay byte-for-byte unchanged.

### v4 RED → GREEN and negative controls

Given the exact wildcard and Ky ESM failures above, when the test-only bridge and directory runner
are applied, then `npm run test:trade` passes all compiled trade tests on Windows, `npm run
typecheck`, `npm run lint`, and `npm run build` remain green, and the production build never resolves
`ky` to the shim. A throwaway negative control that removes the test-only Ky path mapping must
reproduce the ESM failure before the bridge is trusted. The final v3 gauntlet manifest and canonical
runner remain unchanged except that the source allow-list includes these two v4 paths.

### v4 must NOT

- Must not change `frontend/src/**`, existing test assertions, dependencies, or lockfiles.
- Must not use an ESM-wide import rewriter, experimental Node resolver, or production alias.
- Must not proceed to the live host-mutation layer until this revision is approved and the frontend
  layer is GREEN.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v4
```

### v4 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v4`. No v4 implementation occurred before
that approval.

## Revision v5 — restore the lockfile-pinned frontend dependency tree (approval required)

### Discovery after v4 implementation

The v4 implementation made `npm run test:trade` pass 84/84 tests; `npm run typecheck` also passed
and `npm run lint` emitted no findings. The required production build then failed before compiling
application code because `frontend/node_modules/@tailwindcss/postcss` is absent. The dependency is
already declared as exact version `4.3.3` in `frontend/package.json` and resolved in the existing
`frontend/package-lock.json`; this is an incomplete ignored dependency tree, not a requested source
or dependency-set change.

### v5 setup authorization and acceptance criteria

From `frontend/`, run exactly:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
```

This revision authorizes npm to remove and recreate only the ignored `frontend/node_modules/`
directory from the existing lockfile and to download the packages/checksums named by that lockfile.
Lifecycle scripts remain disabled. It authorizes no global install, dependency/version addition,
package or lockfile edit, cache deletion, or other filesystem mutation.

Afterward, `npm ls @tailwindcss/postcss --depth=0`, `npm run test:trade`, `npm run typecheck`, `npm
run lint`, and `npm run build` must pass. `git status` must show no package-lock or unexpected
tracked delta. If `npm ci` changes a tracked file, fails integrity validation, requires a lifecycle
script, or reveals a different missing dependency not present in the lockfile, stop and revise the
SPEC rather than weakening the gauntlet.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v5
```

### v5 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v5`. No v5 dependency restoration occurred
before that approval.

## Revision v6 — select the lockfile-pinned TypeScript 6 compiler for the CommonJS test build

### Discovery after v5 dependency restoration

The approved clean install completed without changing `frontend/package-lock.json` and restored
`@tailwindcss/postcss@4.3.3`. It also exposed the package binaries exactly as pinned by the existing
manifest: `tsc` is provided by `@typescript/native` 7.0.2, while the aliased
`typescript: npm:@typescript/typescript6@6.0.2` package provides `tsc6`.

The current `test:build` script invokes `tsc`, so the required `npm run test:trade` now fails RED
with `TS5108` because native TypeScript 7 has removed the CommonJS-compatible `node10` resolver.
Changing to Node16 resolution was observed RED with ESM/CJS boundary and extension errors, and
passing `--ignoreDeprecations 7.0` to native TypeScript 7 was also observed RED with the same
removed-option error. In contrast, the lockfile-pinned `tsc6` compiler completed the exact test
project with `--ignoreDeprecations 6.0`, and its emitted CommonJS output passed all 84 trade tests.

### v6 scope and behavior

Revision v6 keeps Tier 3 and every v3-v5 invariant. It authorizes exactly two additional edits in
already-approved files:

- in `frontend/package.json`, change only the `test:build` compiler executable from `tsc` to
  `tsc6`; its cleanup command and project path remain byte-for-byte unchanged; and
- in `frontend/tsconfig.test.json`, add only `"ignoreDeprecations": "6.0"` so the pinned TS6
  compiler may continue using the required CommonJS-compatible resolver.

No dependency/version, lockfile, application source, test assertion, production compiler, base
TypeScript config, or other package script may change. `npm run typecheck` deliberately remains on
native `tsc`/TypeScript 7, and the production Next.js build must remain independent of the test-only
compiler and Ky shim.

### v6 RED → GREEN and negative controls

After the two edits, `npm run test:build` and `npm run test:trade` must pass from the clean v5
dependency tree, with the trade suite reporting 84 passed and zero failed. `npm run typecheck`,
`npm run lint`, and `npm run build` must also pass. `npm ls typescript @typescript/native --depth=0`
must report only the versions already pinned by the manifest/lockfile, and Git must show no
`package-lock.json` delta.

The retained RED evidence consists of native TypeScript 7 rejecting `moduleResolution=node10`,
native TypeScript 7 rejecting the deprecation override, and Node16 resolution producing ESM/CJS
boundary failures. The GREEN compiler-selection control is a direct `tsc6` compile followed by the
84-test Node run. No live production host mutation may continue until this revision is approved and
the complete frontend acceptance set is GREEN.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v6
```

### v6 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v6`. No v6 implementation occurred before
that approval.
