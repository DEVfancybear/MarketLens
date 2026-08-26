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

## Revision v7 — normalize the final two Go formatting drifts (approval required)

### Discovery after v6 GREEN

The complete v6 frontend acceptance set is GREEN: compiler inventory matched the lockfile,
`test:build` passed, the trade suite passed 84/84, and typecheck, lint, and production build exited
zero. The v3 `gofmt -l backend/.` gate was then rerun after CRLF normalization and now reports
exactly two genuine formatting drifts that predate this task:

- `backend/internal/httpserver/server.go` — gofmt moves the third-party zerolog import after the
  local MarketLens import block; and
- `backend/internal/simtrading/model_test.go` — gofmt expands seven one-line `if`/test-failure
  statements to canonical multiline formatting.

Both changes were inspected and then reverted pending approval. The formatter again reports exactly
those two paths, so the v3 requirement that `gofmt -l` be empty cannot be met within the currently
approved tracked-path allow-list.

### v7 scope, controls, and acceptance

Revision v7 keeps Tier 3 and every v3-v6 invariant. It adds exactly the two paths above to the
tracked-source allow-list and authorizes `gofmt -w` on those files only. It also authorizes adding
those two literal paths to the existing `Assert-ApprovedSourceState` allow-list in
`tools/verify-production-worker-host-provision.ps1`; no other checker behavior may change.

No executable statement, assertion text, test input, dependency, API, runtime behavior, or other
tracked path may change. The accepted diff is limited to gofmt's import grouping and line wrapping
described above.

After formatting:

- `gofmt -l backend/.` emits no paths;
- `git diff --check` passes and the two newly authorized diffs contain no token/text changes beyond
  whitespace and import position;
- `go test ./internal/httpserver ./internal/simtrading -count=1` passes;
- the complete Go quality layer (`go vet`, shuffled tests, regular tests, and race tests) remains
  required by the final fresh gauntlet; and
- every source-diff, no-secret, production-runner, database, worker, and health invariant remains
  unchanged.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v7
```

### v7 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v7`. No v7 formatting or checker
allow-list implementation occurred before that approval.

## Revision v8 — replace impossible empty-function coverage with a reproducible mutant

### Discovery during the final fresh gauntlet

After v7, `tool-contracts` and the complete Go quality layer (vet, shuffled tests, regular tests,
and race tests) passed. The next layer ran the exact focused test successfully, but Go 1.26.5
reported `coverage: [no statements]` and created no coverage profile. Production source is exactly
`func main() {}`; Go statement coverage cannot instrument an empty function. The v3 expectation
that a profile contain a span for `main.go:6` is therefore impossible without adding a synthetic
no-op statement solely to increase coverage, which is forbidden coverage gaming.

The gauntlet stopped before Python, Rust, frontend, PostgreSQL, MT5, host-input, runner, or health
layers. No live production-host mutation occurred in this failed run.

### v8 scope and executable substitute

Revision v8 keeps Tier 3 and all v3-v7 runtime/security invariants. It revises only V3-S2's
coverage mechanism and authorizes edits only to the already-approved
`tools/verify-production-worker-host-provision.ps1`:

1. Require `backend/cmd/mt5-migration-gate/main.go` to contain one unique exact
   `func main() {}` definition and retain its original bytes plus SHA-256.
2. Run `TestProductionCommandMainIsInert` against the original source and require exit zero.
3. In a guarded `try/finally`, replace that exact definition with
   `func main() { panic("PROVISIONING_MAIN_MUTANT") }`, prove the bytes/hash changed, run the same
   focused test, and require a nonzero exit whose captured output contains
   `PROVISIONING_MAIN_MUTANT`.
4. Restore the original bytes in `finally`, require the restored SHA-256 to equal the original,
   rerun the focused test successfully, and require Git to report no worktree/index delta for
   `main.go`.

The final gauntlet must retain the layer name `go-migration-gate-coverage` for report compatibility,
but EVIDENCE must classify statement coverage for this zero-statement production file as **N-A**
and the persisted manual mutant as **SUBSTITUTED**, never as coverage pass. The substitution proves
the regression test executes `main()` and detects a non-inert panic; it cannot measure branch or
statement coverage where no instrumentable statement exists.

### v8 must NOT and acceptance

- Must not commit or leave any change to `main.go`, add a synthetic statement, edit the test,
  suppress a failing test, or claim a coverage percentage.
- Any source mismatch, mutant not applied, unexpected mutant success, wrong failure reason,
  restore error/hash mismatch, or post-restore Git delta fails closed with a pinned provisioning
  code.
- After approval, the verifier contract controls must pass, a forced mutant must be killed and
  restored, and a fresh complete entry-point run must restart from layer one.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v8
```

### v8 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v8`. No v8 mutation-substitute
implementation occurred before that approval.

## Revision v9 - serialize process-global APPDATA test fixtures (approval required)

### Discovery during the v8 fresh gauntlet

The v8 fresh run passed tool contracts, the complete Go quality layer, the persisted Go mutant,
and both Python suites (145 managed tests plus 5 EA tests). `cargo fmt`, `cargo check`, and
`cargo clippy` also passed. The workspace Rust test then failed in exactly three
`mt5-vm-agent` tests with `REQUIRED_ARTIFACT_MISSING`; 46 tests passed and 1 credentialed live test
remained intentionally ignored. The gauntlet stopped before frontend, documentation, PostgreSQL,
MT5 WebRequest, host provisioning, the production runner, or health checks.

All three failing tests pass when run individually. The complete `mt5-vm-agent` library suite
passes 49/49 active tests with `--test-threads=1`. Current source shows why: each affected fixture
changes the process-global `APPDATA` variable to a different temporary tree, while Rust's default
test runner executes those fixtures concurrently. A competing fixture can therefore make another
test validate its terminal state under the wrong APPDATA tree. This is test-fixture interference,
not a missing repository or production artifact.

### v9 scope and behavior

Revision v9 keeps Tier 3 and every v3-v8 production/security invariant. It authorizes changes only
to `backend/execution/crates/mt5-vm-agent/src/process.rs`, confined to its `#[cfg(test)]` module:

1. Add one test-only static mutex protecting every read/write/restore transaction involving the
   process-global `APPDATA` variable.
2. Make `AppDataGuard` own the corresponding mutex guard for its full lifetime, remember the prior
   value, and restore that exact prior value before releasing the mutex.
3. Make `valid_process_config_fixture` acquire the guard before changing `APPDATA` or deriving the
   terminal state path.
4. Update the existing guard test so it verifies both the temporary absent state and exact
   restoration through the same serialized guard API.

Poisoned-lock recovery must remain deterministic and test-only; it may recover the mutex guard but
must not skip restoration. No production item, API, runtime synchronization, dependency, Cargo
manifest/lockfile, assertion expectation, fixture artifact requirement, verifier command, or
ignored-test status may change. In particular, the gauntlet must retain Rust's normal parallel test
execution; adding `--test-threads=1`, retrying failures, or weakening `REQUIRED_ARTIFACT_MISSING`
checks is forbidden.

### v9 RED -> GREEN and acceptance

The retained RED evidence is the v8 fresh run described above, plus the three individual GREEN
controls and the serialized-suite GREEN diagnostic that isolate the race. After implementation:

- the three formerly failing focused tests pass;
- `cargo test -p mt5-vm-agent --lib` passes with the default parallel runner, and must be repeated
  at least three consecutive times to exercise the former interference window;
- `cargo fmt --all -- --check`, `cargo check --workspace --locked`, and
  `cargo clippy --workspace --all-targets --locked -- -D warnings` pass;
- Git reports no tracked change outside this revision's one Rust test-module path and the already
  approved SPEC/EVIDENCE/verifier allow-list; and
- after committing and fast-forwarding the task branch into local `master`, one new complete
  gauntlet run restarts from layer one. Only that run may supply final production evidence.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v9
```

### v9 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v9`. No v9 implementation occurred before
that approval.

## Revision v10 - admit the approved v9 Rust path to the source-state gate (approval required)

### Discovery after v9 GREEN

The v9 implementation is committed at `d38358e`. The three formerly failing tests pass, the
default-parallel `mt5-vm-agent` library suite passed three consecutive runs with 49 active tests
and zero failures per run, and Rust format, check, and clippy pass. The first implementation attempt
also supplied an additional RED: acquiring the mutex after fixture-file creation still allowed
same-millisecond temporary roots to interfere; acquiring it before the entire fixture transaction
made all three stress runs GREEN.

The production verifier's `Assert-ApprovedSourceState` allow-list does not yet contain
`backend/execution/crates/mt5-vm-agent/src/process.rs`. Because the approved v9 change is now in
`HEAD`, the unchanged gate would deterministically fail later with
`PROVISIONING_UNAPPROVED_TRACKED_PATH`, after the live host layers. No v9 verifier edit was
authorized, so none was made, and no new complete production gauntlet has started.

### v10 scope, controls, and acceptance

Revision v10 keeps Tier 3 and every v3-v9 behavior and security invariant. It authorizes exactly
one edit to `tools/verify-production-worker-host-provision.ps1`: add the literal normalized path
`backend/execution/crates/mt5-vm-agent/src/process.rs` to the existing `$allowed` array in
`Assert-ApprovedSourceState`.

No command, layer order, baseline commit, dirty-worktree check, secret scan, host input, WebRequest
probe, production runner, health assertion, error code, or other allow-list entry may change. The
RED control is the current committed task diff being rejected because this one literal is absent.
After the edit, PowerShell parsing and `-ContractTestsOnly` must pass, the allowed set must contain
the exact path once, an unrelated synthetic path must remain rejected by the same membership rule,
and `git diff --check` must pass. Then commit the checker checkpoint, fast-forward local `master`,
normalize checkout-only Go line endings without content drift, and restart one complete gauntlet
from layer one. Only that fresh run may mutate the live host or supply final evidence.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v10
```

### v10 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v10`. No v10 implementation occurred
before that approval.

## Revision v11 - resolve the installed PostgreSQL 16 client outside PATH (approval required)

### Discovery during the v10 fresh gauntlet

The v10 fresh run passed tool contracts, Go quality and its restored mutant, both Python suites,
Rust quality, frontend typecheck/lint/84 trade tests/production build, 2,563 backend-documentation
checks, and 18 managed-worker contract tests. It then stopped at `postgresql-preflight` with
`PROVISIONING_PSQL_MISSING`; WebRequest, host-input mutation, provisioning, the canonical runner,
and postconditions did not run.

The PostgreSQL 16 service check succeeded. `psql.exe` is not on this account's process PATH, but
the existing host installation contains the regular file
`C:\Program Files\PostgreSQL\16\bin\psql.exe`, product version 16.15. A read-only direct invocation
using the existing `.env` database URL returned server version `160015` and migration state
`42:false` with exit code zero. PostgreSQL is installed and healthy; only verifier discovery is
wrong. Persistently changing user/machine PATH would mutate ambient host configuration and would
make the documented entry point less reproducible, so it is not authorized.

### v11 scope, controls, and acceptance

Revision v11 keeps Tier 3 and every v3-v10 invariant. It authorizes edits only to
`Assert-PostgreSqlProductionState` in the already-approved
`tools/verify-production-worker-host-provision.ps1`:

1. Preserve `Get-Command psql.exe` / `Get-Command psql` as the first choice.
2. When neither command exists, select only the exact absolute fallback
   `C:\Program Files\PostgreSQL\16\bin\psql.exe`.
3. Require the selected path to be an existing leaf or fail with the unchanged
   `PROVISIONING_PSQL_MISSING` code, and invoke both existing read-only queries through that path.

No PATH value, PostgreSQL file/service/data/auth/configuration, database value, query, migration,
credential handling, error code, layer order, production command, or other tracked path may change.
No download or dependency is authorized.

The retained RED is the v10 fresh report. After implementation, PowerShell parsing and
`-ContractTestsOnly` must pass; the exact fallback must resolve while PATH discovery remains absent;
a synthetic missing fallback must still take the `PROVISIONING_PSQL_MISSING` branch; and the real
fallback must return server major 16 plus `42:false` without printing credentials. Commit the
checker checkpoint, fast-forward local `master`, require a clean worktree, and restart one complete
gauntlet from layer one. Only that later fresh run may provide final evidence.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v11
```

### v11 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v11`. No v11 implementation occurred
before that approval.

## Revision v12 - use the MetaEditor command-line compiler contract (approval required)

### Discovery during the v11 fresh gauntlet

The v11 fresh run passed tool contracts, Go quality and its restored mutant, both Python suites,
Rust quality, frontend typecheck/lint/84 trade tests/production build, 2,563 backend-documentation
checks, 18 managed-worker contract tests, and PostgreSQL preflight. It then stopped at
`live-webrequest-and-host-inputs` with `PROVISIONING_PROBE_COMPILE_FAILED`; no bootstrap material,
install input, worker provisioning, canonical production runner, or postcondition ran.

The retained MetaEditor log reports `Result: 0 errors, 0 warnings`, and the previously deleted
`MarketLensWebRequestProbe.ex5` was freshly created. Both of those predicates in the current gate
are therefore true. The remaining predicate incorrectly requires MetaEditor's process exit code
to equal zero. MetaEditor's command-line convention uses exit code `1` for a successful compile.
A bounded local diagnostic also observed the complementary failure case: an attempted overwrite
returned exit code `0`, left the prior binary unchanged, and logged `EX5 write error` plus
`Result: 1 errors, 0 warnings`. The compiler log and newly created artifact must remain mandatory;
the correction must not accept an exit code by itself.

### v12 scope, RED -> GREEN controls, and acceptance

Revision v12 remains Tier 3 and keeps every v3-v11 invariant. It authorizes edits only to:

- `backend/bridge/mt5_vm/test_production_webrequest_probe.py`;
- `tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1`;
- this SPEC and the final EVIDENCE record.

First add an executable contract expectation and observe it fail against the v11 driver because
the MetaEditor compile contract marker/helper is absent (RED). Then introduce one pure compile
result assertion used by both contract-only and live paths. A successful result must require all
of the following simultaneously:

1. MetaEditor exit code is exactly `1`;
2. the destination `.ex5` exists as a leaf after the driver deleted the old artifact before
   compilation;
3. the compiler log contains exactly one `Result:` summary; and
4. that summary reports exactly `0 errors, 0 warnings` (additional elapsed-time/CPU fields may
   follow).

Contract-only execution must accept that positive fixture and reject each bounded negative fixture
with `PROVISIONING_PROBE_COMPILE_FAILED`: exit code `0` with an otherwise clean log, exit code `1`
with no binary, exit code `1` with one compiler error, and duplicate `Result:` summaries. The
existing receipt positive/negative controls remain unchanged. The live path must replace only the
incorrect `ExitCode -eq 0` conjunction with the shared assertion; it must continue deleting the
old `.ex5`, invoking the exact signed MetaEditor path, and reading the exact compile log.

No MQL5 source, URL, signer, terminal/state-root boundary, terminal stop behavior, WebRequest
receipt, nonce, host input, secret, ACL, worker installer, database check, source-diff gate,
production command, layer order, or health/postcondition may change. No dependency, download,
ambient host configuration change, push, or out-of-scope terminal action is authorized.

After GREEN, run PowerShell parsing, the probe's `-ContractTestsOnly` and retained known-bad control,
the targeted Python probe suite, and `git diff --check`. Commit the checker checkpoint on the task
branch, fast-forward local `master`, require a clean worktree, and restart one complete 13-layer
gauntlet from layer one. Only that later fresh run may provision the host, invoke exactly
`.\run-backend-production.ps1` without switches, and provide final evidence. Any failed layer
remains blocking and must not be reported as production success.

Planned tools and generated files are unchanged from v3-v11: `apply_patch`, PowerShell 5.1,
Python unittest, Git checkpoint/fast-forward operations, and the existing gauntlet toolchains.
The gauntlet may recreate only its already disclosed `.artifacts` reports and the approved MT5,
ProgramData, worker-root, task, build, migration, and runtime outputs. The diagnostic-only
`webrequest-probe-exitcode-diagnostic.log` is not source evidence and must not be committed.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v12
```

### v12 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v12`. No v12 implementation occurred
before that approval.

## Revision v13 - generate the probe nonce on Windows PowerShell 5.1 (approval required)

### Discovery during the v12 fresh gauntlet

The v12 fresh run passed the first nine layers and the corrected live MetaEditor compile contract.
It then stopped inside `live-webrequest-and-host-inputs`, before writing a probe request, bootstrap
secret, install input, worker files/task, or invoking the canonical production runner, because
Windows PowerShell reported that `RandomNumberGenerator` has no static `Fill` method.

Read-only runtime inspection identifies Windows PowerShell `5.1.19041.6456` on CLR
`4.0.30319.42000`. That runtime has no static `RandomNumberGenerator.Fill` and no
`Convert.ToHexString`, so merely replacing the first failing call would expose a second failure.
It does provide `RandomNumberGenerator.Create()` and instance `GetBytes`, while `BitConverter` can
produce the required hexadecimal representation. The failure is a PowerShell 5.1 compatibility
defect in nonce generation, not a WebRequest, compiler, terminal, gateway, or database failure.

### v13 scope, RED -> GREEN controls, and acceptance

Revision v13 remains Tier 3 and keeps every v3-v12 invariant. It authorizes edits only to:

- `backend/bridge/mt5_vm/test_production_webrequest_probe.py`;
- `tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1`;
- this SPEC and the final EVIDENCE record.

First add an executable contract expectation and observe it fail against the v12 driver because
the PowerShell-5.1 nonce contract marker and compatible implementation are absent (RED). Then add a
single nonce generator and a shared nonce-shape assertion with these exact requirements:

1. allocate exactly 16 bytes;
2. create a `System.Security.Cryptography.RandomNumberGenerator` instance, fill the bytes through
   instance `GetBytes`, and dispose the instance in `finally`;
3. encode with `BitConverter.ToString`, remove only hyphens, and lowercase invariantly;
4. require the result to match the case-sensitive shape `^[0-9a-f]{32}$` before use; and
5. replace the live inline `Fill`/`Convert.ToHexString` block with that shared generator.

Contract-only execution must generate and accept a real nonce, emit
`PRODUCTION_PROBE_NONCE_CONTRACTS=PASS`, and reject short, uppercase, and non-hex fixtures with the
exact code `PROVISIONING_PROBE_NONCE_INVALID`. The Python source contract must require the
PowerShell-5.1-compatible `Create`/`GetBytes`/`BitConverter` path and reject reintroduction of
`RandomNumberGenerator.Fill` or `Convert.ToHexString`. The existing MetaEditor positive and four
negative compile fixtures, receipt controls, nonce-bound receipt, and no-trade source checks remain
unchanged.

No nonce length or entropy source, MQL5 source, URL, signer, terminal/state-root boundary, terminal
stop behavior, WebRequest receipt, host input, secret, ACL, worker installer, database check,
source-diff gate, production command, layer order, or health/postcondition may change. No
dependency, download, ambient host configuration change, push, or out-of-scope terminal action is
authorized.

After GREEN, run PowerShell parsing, the probe's `-ContractTestsOnly` and retained known-bad control,
the targeted Python probe suite, a nonce-defense mutant, and `git diff --check`. Commit the checker
checkpoint on the task branch, fast-forward local `master`, require a clean worktree, and restart
one complete 13-layer gauntlet from layer one. Only that later fresh run may write protected host
inputs, provision the worker, invoke exactly `.\run-backend-production.ps1` without switches, and
provide final evidence. Any failed layer remains blocking and must not be reported as production
success.

Planned tools and generated files are unchanged from v3-v12: `apply_patch`, PowerShell 5.1, Python
unittest, Git checkpoint/fast-forward operations, and the existing gauntlet toolchains. No new
dependency or tracked file is planned. The gauntlet may recreate only its already disclosed
`.artifacts` reports and approved MT5, ProgramData, worker-root, task, build, migration, and runtime
outputs.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v13
```

### v13 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v13`. No v13 implementation occurred
before that approval.

## Revision v14 - complete the PowerShell 5.1 crypto path before implementation (approval required)

### Additional discovery after v13 approval and before RED

The mandatory exact-source read performed after committing the approved v13 SPEC found one more
.NET-newer static API later in the same live probe path:
`System.Security.Cryptography.SHA256.HashData`. Read-only reflection on the production host confirms
that CLR `4.0.30319.42000` does not expose `SHA256.HashData`, but does expose `SHA256.Create`,
instance `ComputeHash`, and `BitConverter.ToString`.

No v13 test or implementation edit has occurred. Proceeding with v13 alone would knowingly move the
failure from nonce creation to proof construction after a successful terminal probe, so v14 extends
the compatibility correction before implementation rather than manufacturing another expected
failed production gauntlet.

### v14 scope, controls, and acceptance

Revision v14 remains Tier 3, retains every v3-v13 invariant and all v13 nonce requirements, and
keeps the same authorized paths:

- `backend/bridge/mt5_vm/test_production_webrequest_probe.py`;
- `tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1`;
- this SPEC and the final EVIDENCE record.

In addition to the approved v13 nonce generator, add one PowerShell-5.1-compatible SHA-256 helper
that accepts bytes, creates a `SHA256` instance, computes the digest through instance `ComputeHash`,
disposes the instance in `finally`, and returns `BitConverter.ToString` with only hyphens removed
and invariant lowercase. Replace only the proof's inline `SHA256.HashData` expression with that
helper. The nonce value itself must remain absent from output and persisted proof; only its SHA-256
digest is recorded.

RED must require the combined marker `PRODUCTION_POWERSHELL51_CRYPTO_CONTRACTS=PASS` and the
compatible source capabilities before either implementation exists. GREEN contract-only execution
must retain the v13 real 16-byte nonce generation and invalid-shape controls, and must verify the
SHA-256 helper against the exact standard `abc` digest
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`. The Python source contract
must require `RandomNumberGenerator.Create`/`GetBytes`, `SHA256.Create`/`ComputeHash`,
`BitConverter.ToString`, and disposal, while forbidding all three unavailable calls:
`RandomNumberGenerator.Fill`, `Convert.ToHexString`, and `SHA256.HashData`.

The v13 nonce-shape negatives remain: short, uppercase, and non-hex values must fail with
`PROVISIONING_PROBE_NONCE_INVALID`. A one-off mutant that changes the compatible hash result or
nonce-shape defense must be killed by the frozen contracts and restored byte-for-byte before the
GREEN checkpoint.

No cryptographic algorithm, nonce length/entropy, receipt/proof schema, MQL5 source, URL, signer,
terminal/state-root boundary, host input, secret, ACL, installer, database check, source-diff gate,
production command, layer order, or health/postcondition may change. No dependency, download,
ambient configuration mutation, push, or out-of-scope terminal action is authorized. Tools,
generated files, checkpoint/fast-forward cadence, and the required fresh 13-layer gauntlet remain
exactly as v13 states.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v14
```

### v14 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v14`. No v14 implementation occurred
before that approval.

## Revision v15 - agent-owned MT5 WebRequest allowlist transaction (approval required)

### User input and bounded discovery

The user rejected the v14 manual MT5 Options step and requires the production agent to complete
the whole cutover without asking the user to manipulate the terminal UI. This is new authorization
input, not approval of a changed implementation. Official MQL5 documentation states that the
WebRequest list is an end-user safety setting in the Expert Advisors tab and cannot be edited
programmatically through MQL; therefore this revision uses the terminal's real Options dialog as
the configuration boundary and retains the live nonce-bound WebRequest probe as the only positive
attestation.

Read-only discovery against only the signed selected terminal
`C:\Program Files\MetaTrader 5\terminal64.exe` used the existing exact-PID Win32 helper, selected
the Expert Advisors tab, inspected control metadata without printing list contents, clicked
Cancel, and gracefully closed the terminal it started. It found:

- WebRequest checkbox control ID `10322`, initially unchecked;
- one visible `SysListView32` control ID `10191`;
- exactly one list item, which is empty; and
- no pre-existing non-empty WebRequest URL to preserve on this host.

The discovery made no persisted terminal setting change. One attempted .NET UI Automation tree
read failed because Windows PowerShell 5.1 rejected the collection shape; its `finally` block still
cancelled the dialog and closed the owned terminal. The successful discovery used bounded Win32
control IDs because this MT5 dialog does not expose a useful UI Automation child tree.

### v15 scope, setup, and planned paths

Revision v15 remains old-coder **Tier 3** and retains every v3-v14 invariant except the explicit
manual-only allowlist clause. It authorizes an agent-owned UI transaction only for the exact
selected terminal and exact origin `http://127.0.0.1:8790`.

Tools/dependencies to install: **none**. Use only Windows PowerShell 5.1, the .NET/Win32 APIs already
available on the host, Python unittest, `apply_patch`, Git checkpoint/fast-forward operations, and
the existing gauntlet toolchains. No browser automation, UI Automation package, SendKeys helper,
or third-party desktop dependency is authorized.

Additional planned tracked paths are limited to:

- `backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1` - add bounded list-view read/replace primitives and
  a transactional exact-origin apply/verify/rollback operation;
- `backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py` - add RED/GREEN transaction,
  ambiguity, idempotency, rollback, and forbidden-capability contracts;
- `tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1` - new no-argument production entry point
  pinned internally to the selected terminal and origin, plus contract-only known-bad mode;
- `tools/verify-production-worker-host-provision.ps1` - parse/contract-test the new entry point,
  authorize these exact tracked paths, and invoke it immediately before the existing live probe;
- this SPEC and the final EVIDENCE record.

No other tracked path, dependency, download, service/database/security-policy change, global PATH
change, push, broker enrollment, credential access, or out-of-scope terminal action is authorized.
The existing task branch/checkpoint cadence, fast-forward-only local `master`, clean-worktree gate,
13-layer manifest, and no-switch canonical runner remain unchanged.

### v15 failure model and defenses

| Failure mode | Required executable defense |
|---|---|
| Wrong terminal or another broker terminal receives UI messages | Reuse exact canonical path, valid MetaQuotes signature/company, exact PID, and single-process boundary before opening Options |
| UI layout changes or a control ID is ambiguous | Require exactly one visible Options dialog, checkbox `10322`, and enabled `SysListView32` `10191` with exact classes; otherwise fail before OK |
| Existing URLs are silently lost | Snapshot checkbox plus every list item in memory before mutation; bound count/length; never print item values; restore the exact snapshot on a failed transaction |
| Partial/pending edits persist after an error | Cancel any open dialog in `finally`; after OK reopen and compare normalized persisted state; on mismatch perform and verify exact rollback |
| Rollback itself fails | Emit `PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED`, retain failure, and do not run the live probe or production runner |
| Arbitrary UI automation capability is introduced | No SendKeys, Clipboard, coordinate/mouse click, foreground-window stealing, window-title matching, arbitrary terminal path, or arbitrary URL argument |
| A blank MT5 placeholder is mistaken for an allowed URL | Normalize only non-empty list items; permit at most one UI-created blank placeholder; require exactly one non-empty item equal ordinally to the expected origin |
| Direct list write does not affect MT5's persisted setting | Reopen Options after OK and require checkbox `1` plus the exact normalized list; then require the existing real MT5 WebRequest receipt and HTTP response |
| A fake UI pass replaces network evidence | The allowlist transaction emits only a configuration result; positive topology attestation remains forbidden until the nonce-bound live probe succeeds |

### v15 RED -> GREEN acceptance scenarios

#### V15-S1 - exact boundary and source capability

Given the new production allowlist entry point,
when its contract-only positive and known-bad modes run,
then it accepts only the internally pinned selected terminal and
`http://127.0.0.1:8790`, rejects an out-of-scope terminal or non-loopback/different origin with a
pinned `PROVISIONING_WEBREQUEST_ALLOWLIST_BOUNDARY_INVALID` reason, and its source contains no
SendKeys, Clipboard, coordinate/mouse, title-match, credential, trade, or force-termination
capability. The test must be observed RED before the entry point exists.

#### V15-S2 - exact state transaction is idempotent

Given a mocked exact-PID Options boundary whose prior state is unchecked with one blank item,
when the high-level transaction applies the expected origin,
then it snapshots the prior state, writes checkbox `1` and exactly one non-empty expected origin,
confirms once, reopens, rereads the same normalized state, cancels the verification dialog, and
returns a sanitized result containing no URL-list contents. Given that exact state already exists,
the transaction performs no confirmed write and returns idempotent success.

#### V15-S3 - ambiguity and invalid list state fail closed

Given zero/duplicate/wrong-class/disabled list controls, more than 64 items, an item longer than
2048 UTF-16 characters, duplicate expected origins, or any unexpected non-empty origin after a
write,
when the transaction evaluates the dialog,
then it exits nonzero before positive attestation with a pinned allowlist error and never guesses a
control or accepts a subset/partial match.

#### V15-S4 - failed apply restores the exact snapshot

Given a write or persisted reread mismatch after the prior state was captured,
when the transaction handles the failure,
then it cancels any pending dialog, reapplies the exact prior checkbox/list snapshot through a new
exact-PID dialog, confirms, rereads, and verifies the rollback. The original apply error remains
authoritative if rollback succeeds; if rollback cannot be verified, the exact rollback-failed code
above is authoritative. Tests must cover both branches.

#### V15-S5 - live selected-host proof precedes production

Given V15-S1 through V15-S4 are GREEN and PostgreSQL preflight passes,
when the fresh gauntlet reaches `live-webrequest-and-host-inputs`,
then it runs the no-argument allowlist entry point, observes its persisted exact-state result, and
immediately runs the existing nonce-bound MT5 probe. Only an actual HTTP 200 receipt from
`http://127.0.0.1:8790/health` may unlock protected host inputs, worker provisioning, and the exact
no-switch `\.\run-backend-production.ps1`. Error 4014, timeout, mismatched receipt, allowlist
postcondition failure, or rollback failure blocks every later layer.

### v15 RED, mutation, and final gauntlet

First add the tests for V15-S1 through V15-S4 and observe them fail against v14 before adding the
entry point or implementation. Keep assertions frozen through GREEN. Run focused Python tests,
PowerShell parsing, both contract-only modes, and `git diff --check`. Kill and restore at least one
one-off mutant that changes the exact origin comparison or persisted-state equality; verify the
source hash is restored.

Commit the GREEN checkpoint on the existing task branch, fast-forward local `master`, require a
clean worktree, and rerun the single fresh entry point from layer one:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1
```

The final EVIDENCE may claim production success only if all 13 layers pass, including the real
allowlist transaction, live MT5 receipt, protected worker provisioning, the canonical runner, and
local/public/worker postconditions. Any failure remains blocking and must be reported exactly.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v15
```

### v15 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v15`. No v15 implementation occurred
before that approval.

## Revision v16 - activate MT5's private URL editor through a bounded list hit (approval required)

### Discovery during approved v15 implementation

V15 RED was observed as five new failures with all 25 retained tests passing. GREEN contracts then
passed 30/30 tests; the exact-origin comparator mutant was killed and restored to its prior SHA-256.
The first selected-host transaction opened the exact signed terminal and snapshotted the unchecked,
one-blank-row state. Direct `LVM_DELETEALLITEMS`/`LVM_INSERTITEMW` changed the Windows list view but
not MT5's private dialog model, so the mandatory pending reread failed with
`PROVISIONING_WEBREQUEST_ALLOWLIST_PENDING_FAILED`. The exact snapshot rollback succeeded; no
rollback-failed code, confirmation attestation, host input, worker mutation, or production runner
followed.

A second pending-only discovery tried standard `LVM_EDITLABELW`; the list does not expose the
`LVS_EDITLABELS` behavior and returned no Edit handle (`EDIT_LABEL_NOT_AVAILABLE`). Its `finally`
block cancelled the dialog and closed the owned terminal. Existing control discovery shows MT5
instead owns a hidden Edit control ID `10325`; MT5 reveals that private editor only when its blank
list row receives the dialog's normal double-click action.

This means v15's prohibition on every coordinate/mouse message also prohibits the remaining
agent-owned path. Revision v16 narrows one exception rather than silently weakening that boundary.

### v16 bounded exception and unchanged scope

Revision v16 remains Tier 3, retains all v15 paths, dependencies, failure codes, rollback rules,
tests, mutation requirement, gauntlet, and exact terminal/origin boundary. It authorizes only this
additional control-local activation sequence inside `Mt5VmTerminalUi.ps1`:

1. require the WebRequest checkbox and the unique visible `SysListView32` ID `10191` already bound
   to the exact selected terminal PID;
2. require the pre-mutation state to be either the exact desired state or unchecked with exactly
   one empty item; any unexpected non-empty item fails without mutation;
3. query item 0's client rectangle using bounded `LVM_GETITEMRECT` and compute its midpoint inside
   that list control only;
4. prove that point resolves back to item 0 with bounded `LVM_HITTEST` and item/label hit flags;
5. send one `WM_LBUTTONDBLCLK` message to that exact list handle using only the verified
   control-client point;
6. require exactly one visible, enabled `Edit` control ID `10325` under the same Options dialog;
7. set only `http://127.0.0.1:8790` with bounded `WM_SETTEXT`, then commit only to that edit handle
   with bounded `WM_KEYDOWN`/`WM_KEYUP` for `VK_RETURN`; and
8. reread the pending checkbox/list state before any OK, then retain v15's persisted reread, live
   WebRequest probe, and rollback requirements.

The exception does **not** authorize `SendInput`, `mouse_event`, `SetCursorPos`, global cursor
movement, absolute screen coordinates, coordinate literals, window-title lookup, focus stealing,
arbitrary list rows, right-click, drag, menu traversal, SendKeys, or Clipboard. The user's physical
cursor is not moved. If item-rectangle retrieval, hit testing, editor visibility/class/ID, text set,
Return commit, or pending reread is ambiguous or fails, the dialog is cancelled and no OK is sent.

No new tracked path or dependency is added. The v15 direct replace primitive may remain only for
exact snapshot rollback if its result is verified pending and persisted; it may not be treated as a
successful desired-state apply after the observed failure. If exact rollback cannot be verified,
`PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED` remains authoritative.

### v16 RED -> GREEN additions

Before adding the activation implementation, add and observe RED source/contract expectations for
the exact constants and defenses: `LVM_GETITEMRECT`, `LVM_HITTEST`, `WM_LBUTTONDBLCLK`, editor ID
`10325`, one verified row, one editor, and forbidden global input APIs. A pure hit-test contract
must accept a rectangle midpoint that maps to item 0 and reject wrong row, outside point, missing
label/item flags, empty/negative rectangles, and duplicate editor controls with pinned allowlist
errors. Keep assertions frozen through GREEN.

Run the pending-only selected-host transaction first. It may click OK only after the exact desired
state is reread from the live dialog. Reopen and verify persisted state, rerun the no-argument
entrypoint for idempotency, then run the existing nonce-bound MT5 WebRequest probe. Kill and restore
a mutant that bypasses the row/hit-test equality defense. After the GREEN checkpoint and local
master fast-forward, restart the complete 13-layer gauntlet from layer one; only all-layer success
permits the production claim.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v16
```

### v16 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v16`. No v16 implementation occurred
before that approval.

## Revision v17 - send the complete control-local double-click sequence (approval required)

### Discovery during approved v16 execution

V16 source/geometry contracts were observed RED, then passed 31/31 focused tests. A mutant that
accepted the wrong hit row was killed with `PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID`, and the
helper was restored to SHA-256
`6AF7C3F7F79A66CBDB27773EB4CCE9AA941E0849B5AB96695D54666372255DDF` before live execution.

On the exact signed terminal, `LVM_GETITEMRECT` and `LVM_HITTEST` succeeded for item 0, the checkbox
was enabled only in the pending dialog, and the single authorized `WM_LBUTTONDBLCLK` was delivered
to the exact list handle. MT5 did not reveal Edit control `10325`, so the transaction failed with
`PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID`. The dialog was cancelled, the exact unchecked
one-blank-row snapshot was restored and verified, and the owned terminal was closed. No OK with a
desired URL, live probe, attestation, protected host input, worker mutation, or production runner
followed.

The control-local double-click message alone lacks the preceding button state that Windows sends
during a real double click. MT5's private handler requires the first click to select/focus the blank
row before it treats the second click as activation.

### v17 bounded exception

Revision v17 remains Tier 3 and changes only the v16 activation delivery after the same exact
rectangle/hit-test defenses pass. Replace the single message with exactly this four-message
sequence to the same `SysListView32` handle and same computed control-client point:

1. `WM_LBUTTONDOWN` with `MK_LBUTTON`;
2. `WM_LBUTTONUP` with no button flags;
3. `WM_LBUTTONDBLCLK` with `MK_LBUTTON`;
4. `WM_LBUTTONUP` with no button flags.

Every message must use the existing bounded timeout wrapper. No delay-dependent coordinate
recalculation, second row, retry at another point, global input API, cursor movement, absolute
screen coordinate, `SetFocus`, `SetForegroundWindow`, `SendInput`, SendKeys, Clipboard, or window
title is authorized. After the sequence, exactly one same-dialog Edit ID `10325` must become visible
and enabled; otherwise cancel and retain the v16 failure behavior.

No path, dependency, URL, terminal, signer/PID boundary, state precondition, text/Return action,
snapshot/rollback rule, live probe, gauntlet layer, Git operation, or production command changes.

### v17 RED -> GREEN additions

Add and observe RED constants/source contracts for `WM_LBUTTONDOWN=0x0201` and
`WM_LBUTTONUP=0x0202`, and a pure sequence contract that requires exactly four ordered messages,
the verified packed point on all four, and only the two specified `MK_LBUTTON` flags. Reject a
missing/reordered/extra message, changed point, or wrong flag with
`PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID`. Keep assertions frozen through GREEN and kill
a mutant that swaps or drops one sequence element.

Then run the selected-host transaction. It may persist only after pending reread is exact; rerun it
for idempotency and immediately run the live nonce-bound WebRequest probe. Only after the GREEN
checkpoint, clean local-master fast-forward, and a fresh all-pass 13-layer gauntlet may EVIDENCE
claim production success.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v17
```

### v17 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v17`. No v17 implementation occurred
before that approval.

## Revision v18 - queue the exact control-local mouse sequence (approval required)

### Discovery during approved v17 execution

V17 source and pure sequence contracts passed 32/32 focused tests after the exact four-message
implementation. A mutant that swapped the first expected sequence element was killed with
`PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID` and the helper was restored before live
execution.

The exact signed-terminal transaction then failed closed with
`PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID` and restored the unchecked, one-blank-row
snapshot. A no-output diagnostic retained message results in memory until after cancellation and
rollback. It showed `WM_LBUTTONDOWN` itself returned Win32 `ERROR_TIMEOUT` (`1460`) after 2004 ms;
the following three messages therefore could not be delivered by the synchronous
`SendMessageTimeoutW` wrapper. No desired state was confirmed, no live receipt or protected host
input ran, and no production runner followed.

This is a synchronization deadlock at the interaction boundary: MT5's mouse-down handler waits for
the rest of the mouse gesture while the external synchronous sender waits for that handler to
return. Adding sleep before or after the synchronous call cannot make the corresponding mouse-up
enter the target thread.

### v18 bounded queue exception

Revision v18 remains Tier 3 and changes only delivery of v17's already-approved exact four-message
sequence after the same checkbox, PID, control ID, rectangle, and hit-test defenses pass. It
authorizes a `PostMessageW` boundary that queues, in order, to the same verified
`SysListView32` handle and same packed control-client point:

1. `WM_LBUTTONDOWN` with `MK_LBUTTON`;
2. `WM_LBUTTONUP` with no button flags;
3. `WM_LBUTTONDBLCLK` with `MK_LBUTTON`; and
4. `WM_LBUTTONUP` with no button flags.

Every queue call must return success. Any false return fails with the exact code
`PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_QUEUE_FAILED`; the dialog is cancelled and the exact
snapshot rollback remains mandatory. The queue is nonblocking but the operation remains bounded:
after all four calls succeed, exactly one visible and enabled same-dialog Edit ID `10325` must
appear within the existing bounded editor wait, and the existing pending reread, OK, reopened
persisted reread, idempotency run, and nonce-bound live receipt remain required.

The exception does not authorize another handle, another row or point, retries at alternate
coordinates, arbitrary messages, global input, cursor movement, focus/foreground APIs, SendInput,
SendKeys, Clipboard, window-title lookup, or removal of any state, rollback, signer, PID, terminal,
or origin check. `PostMessageW` may be used only by this private exact-sequence boundary; all other
control reads, text writes, Return commit, dialog confirmation, and dialog cancellation retain
their existing bounded synchronous wrappers. Timing sleeps are not evidence of success and must
not replace the exact editor and state rereads.

No tracked path, dependency, URL, terminal, public API, host input, worker mutation, gauntlet
layer, Git operation, or production command changes.

### v18 RED -> GREEN additions

Before adding the queue implementation, add and observe RED contracts requiring the private
`PostMessageW` boundary, exactly four successful queue calls, and the pinned queue-failure code.
Use a mocked native boundary only at the Win32 edge to prove a false result on any one of the four
positions aborts and never reports success; retain v17's frozen pure ordering/flag/point assertions.
Kill and restore a mutant that ignores one failed queue result.

Then rerun all focused tests, the exact selected-host transaction, a second idempotency transaction,
and the live nonce-bound WebRequest probe. Only after a GREEN checkpoint, clean local-master
fast-forward, and one fresh all-pass execution of the complete 13-layer verifier may EVIDENCE claim
production success.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v18
```

### v18 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v18`. No v18 implementation occurred
before that approval.

## Revision v19 - activate the verified Add URL icon rectangle (approval required)

### Discovery during approved v18 execution

V18 RED was observed as two failures: the `PostMessageW`/queue boundary did not exist and the
four-position abort test could not resolve it. GREEN then passed 34/34 focused tests. A mutant that
swallowed one queue failure was killed because the mocked sequence continued to all four calls
instead of stopping at the failed position; the helper was restored to SHA-256
`138F09473E0BDDAC1E2B96A893A1C02D02E56F96DD19BC02CA71B1A8CA3BC896` and the targeted test returned
GREEN.

The selected-host transaction no longer timed out but failed closed with
`PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID` and restored the exact unchecked,
one-placeholder-row state. A Cancel-only diagnostic showed that the queued gesture selected and
focused item 0 (`selected_count=1`, `selected_index=0`, `focused_index=0`) but created no editor.
No desired state was confirmed and no live receipt, protected host input, worker mutation, or
production runner followed.

Current MetaQuotes documentation renders the final list item as a green plus followed by
`add new URL like 'https://www.mql5.com'`; current MetaQuotes-hosted setup guidance instructs users
to double-click that green plus. A read-only, Cancel-only `LVM_GETITEMRECT`/`LVM_HITTEST` diagnostic
on the exact selected terminal proved that v16-v18 targeted the entire item bounds midpoint
`(268,10)`, while item 0's standard `LVIR_ICON` rectangle is `(left=4, top=0, right=22, bottom=20)`
with midpoint `(13,10)`, hit item 0, and flags `0xE`. The existing bounds midpoint therefore selects
the row but is not the documented Add URL activation target.

### v19 bounded icon-geometry correction

Revision v19 remains Tier 3 and changes only the rectangle kind used before the already-approved
v18 exact queued sequence. The native geometry boundary must:

1. request item 0's `LVIR_ICON=1` rectangle with bounded `LVM_GETITEMRECT`;
2. reject empty, negative, overflowing, or out-of-client icon rectangles;
3. compute only that icon rectangle's midpoint;
4. prove bounded `LVM_HITTEST` maps the midpoint back to item 0 and includes
   `LVHT_ONITEMICON=0x0002`; and
5. pass that one packed point unchanged to all four v18 `PostMessageW` queue calls.

No bounds/label/select-bounds fallback, alternate point, retry, coordinate literal, screen
coordinate, cursor movement, global input, focus/foreground API, arbitrary message, or other row is
authorized. If icon geometry, icon hit, any queue call, editor discovery, text/Return commit,
pending reread, persisted reread, or rollback fails, retain the existing pinned fail-closed path.

All v18 sequence ordering, flags, queue failure behavior, exact same list handle, exactly one visible
enabled Edit ID `10325`, exact origin/terminal/signer/PID boundary, snapshot/rollback rules,
idempotency run, live receipt, verifier layers, Git operations, and canonical production command
remain unchanged. No tracked path or dependency is added.

### v19 RED -> GREEN additions

Before changing geometry, add and observe RED source/pure contracts for `LVIR_ICON=1`, passing the
icon rectangle kind into the native `LVM_GETITEMRECT` request, and requiring
`LVHT_ONITEMICON=0x0002`. The pure geometry contract must reject a bounds-style rectangle request,
a hit lacking the icon bit, a wrong row, and an invalid icon rectangle while accepting the exact
general form of a valid item-0 icon rectangle. Keep assertions frozen through GREEN. Kill and
restore a mutant that changes `LVIR_ICON` to `LVIR_BOUNDS` or accepts a hit without the icon bit.

Then rerun all focused tests, the exact selected-host transaction, a second idempotency transaction,
and the live nonce-bound WebRequest probe. Only after a GREEN checkpoint, clean local-master
fast-forward, and one fresh all-pass execution of the complete 13-layer verifier may EVIDENCE claim
production success.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v19
```

### v19 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v19`. No v19 implementation occurred
before that approval.

## Revision v20 - bind the live Add URL editor control ID (approval required)

### Discovery during approved v19 execution

V19 RED was observed because the icon rectangle and hit contracts did not exist. GREEN passed
35/35 focused tests. A mutant changing `LVIR_ICON=1` to `LVIR_BOUNDS=0` was killed by the frozen
constant/geometry assertion; the helper was restored to SHA-256
`8954110FD7285CFEC658D3A2BA534C331F0CB2DD261891B89FAB7EA742CC4D36` and the targeted test returned
GREEN.

The selected-host transaction targeted the verified item-0 icon midpoint but still failed closed
with `PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID`; its exact snapshot rollback completed and
no desired state was confirmed. A Cancel-only GUI-thread diagnostic then proved the Options dialog
was active and foreground and that the double-click had moved keyboard focus to an `Edit` control
ID `32954`. A second Cancel-only descendant query repeated the observation: exactly one ID `32954`
control existed under the same Options dialog, class `Edit`, visible and enabled, while the
previously assumed ID `10325` had zero matches. The editor therefore opened successfully; the
postcondition rejected the correct live control because its pinned ID was wrong.

No text was written during either diagnostic. No OK, live receipt, protected host input, worker
mutation, or production runner followed.

### v20 exact editor identity correction

Revision v20 remains Tier 3 and changes only the editor control identity used after all approved
v19 icon geometry and v18 queue checks pass. Add a production Add URL editor constant with exact
value `32954`; `Get-MT5VmWebRequestEditorBoundary` must require exactly one same-dialog descendant
with that ID, exact class `Edit`, visible, and enabled. Zero, duplicate, wrong-ID (including legacy
`10325`), wrong-class, hidden, or disabled candidates fail with the existing exact code
`PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID` before any text write.

The older `WebRequestEditor=10325` constant may remain only as frozen regression history for the
v16 contract; production discovery and writing must not use it. No fallback IDs, focused-control
trust without descendant verification, title/text lookup, arbitrary Edit control, or retry against
another editor is authorized.

All icon rectangle/client/hit checks, exact four queued messages, same list handle and point,
`WM_SETTEXT` exact origin, Return commit, pending and reopened persisted rereads, exact rollback,
terminal/signer/PID boundary, idempotency run, live receipt, verifier layers, Git operations, and
canonical production command remain unchanged. No tracked path or dependency is added.

### v20 RED -> GREEN additions

Before changing the resolver, add and observe RED constants/source and pure-candidate contracts for
the exact Add URL editor ID `32954`. The pure contract must accept one ID `32954`, class `Edit`,
visible and enabled candidate and reject legacy ID `10325`, zero/duplicate counts, wrong class,
hidden, and disabled candidates with the pinned editor-invalid error. Keep all assertions frozen
through GREEN. Kill and restore a mutant changing the production ID back to `10325` or accepting
the legacy ID.

Then rerun all focused tests, the exact selected-host transaction, a second idempotency transaction,
and the live nonce-bound WebRequest probe. Only after a GREEN checkpoint, clean local-master
fast-forward, and one fresh all-pass execution of the complete 13-layer verifier may EVIDENCE claim
production success.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v20
```

### v20 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v20`. No v20 implementation occurred
before that approval.

## Revision v21 - deliver Return's exact character message (approval required)

### Discovery during approved v20 execution

V20 RED was observed because the production Add URL editor constant and exact-candidate contract did
not exist. GREEN passed 36/36 focused tests. A mutant changing production ID `32954` back to legacy
`10325` was killed with `PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID`; the helper was restored
to SHA-256 `6D47C625E085F40D7B7E8A6E4E4BF03A02D1113223BA02040BDAF14B2023C0A8` and the targeted test returned
GREEN.

The selected-host transaction still failed closed with
`PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID` and restored the exact prior state. A pending-only,
always-Cancel stage trace proved the icon activation found the exact ID `32954` editor,
`WM_SETTEXT` succeeded, and bounded `WM_KEYDOWN(VK_RETURN)` and `WM_KEYUP(VK_RETURN)` both returned
success. The editor nevertheless remained visible and the pending list state was not committed.
No OK or persisted mutation occurred.

Microsoft's Win32 documentation states that `TranslateMessage` translates key messages and posts
the corresponding `WM_CHAR`; its keyboard-input documentation explicitly lists Enter as generating
a carriage-return `WM_CHAR`. A directly delivered `WM_KEYDOWN` does not traverse the target
thread's retrieve/translate loop, so v16-v20 omitted the character message the edit control uses to
commit its value.

### v21 exact Return character sequence

Revision v21 remains Tier 3 and changes only the editor commit delivery after exact `WM_SETTEXT`
succeeds. Deliver exactly these three bounded synchronous messages, in order, to the same verified
ID `32954` editor handle:

1. `WM_KEYDOWN=0x0100` with `VK_RETURN=0x0D`;
2. `WM_CHAR=0x0102` with carriage return `0x0D`; and
3. `WM_KEYUP=0x0101` with `VK_RETURN=0x0D`.

All three calls must succeed through the existing timeout wrapper. Missing, reordered, extra,
wrong-handle, wrong-message, or wrong-`wParam` delivery fails closed with the existing
`PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID`; the dialog is cancelled and the exact snapshot
rollback remains mandatory. After the exact sequence, the editor must disappear within the existing
bounded wait and the exact desired pending state must be reread before OK.

No arbitrary character, text, key, retry, keyboard-layout inference, global input, SendKeys,
Clipboard, focus/foreground mutation, or additional handle is authorized. All v20 editor identity,
v19 icon geometry, v18 mouse queue, exact origin, persisted reread, idempotency run, live receipt,
terminal/signer/PID boundary, verifier layers, Git operations, and canonical production command
remain unchanged. No tracked path or dependency is added.

### v21 RED -> GREEN additions

Before changing commit delivery, add and observe RED constants and a pure sequence contract for
exact messages `[WM_KEYDOWN, WM_CHAR, WM_KEYUP]` and exact parameters `[0x0D, 0x0D, 0x0D]`. Reject a
missing, reordered, extra, wrong-message, or wrong-parameter sequence with the pinned editor-invalid
error. Keep assertions frozen through GREEN. Kill and restore a mutant that drops or changes the
`WM_CHAR` element.

Then rerun all focused tests, the exact selected-host transaction, a second idempotency transaction,
and the live nonce-bound WebRequest probe. Only after a GREEN checkpoint, clean local-master
fast-forward, and one fresh all-pass execution of the complete 13-layer verifier may EVIDENCE claim
production success.

Approval token:

```text
APPROVE SPEC REVISION: production-worker-host-provision v21
```

### v21 approval record

The user approved this exact revision verbatim as
`APPROVE SPEC REVISION: production-worker-host-provision v21`. No v21 implementation occurred
before that approval.
