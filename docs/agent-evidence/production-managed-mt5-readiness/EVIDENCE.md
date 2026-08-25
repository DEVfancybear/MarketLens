# EVIDENCE — production-managed-mt5-readiness v1

## Outcome

- Status: **PASS_WITH_DECLARED_UNVERIFIED**.
- Tier: old-coder Tier 3.
- Spec approval: obtained exactly from the user as
  `APPROVE SPEC: production-managed-mt5-readiness v1` on 2026-08-25.
- Approved SPEC pre-approval-record SHA-256:
  `5F6138B0F8BC6E005C1EC8340A27112DDC5F65F59DB5B8B484713B5A98E5185F`.
- Delivery authorization: after the passing gauntlet, the user separately requested
  `commit and push code để tôi build production server rồi tôi xem`. This authorizes committing
  and pushing only the task-owned paths; it does not authorize deployment or production execution.
- Final fresh entry point: `.\tools\verify-production-managed-mt5-readiness.ps1`.
- Final fresh run: 2026-08-25T05:34:24.2226490Z through
  2026-08-25T05:40:13.2893891Z.
- Result: 0 failed layers; 18 readiness tests; 576 property cases; 9/9 execution-proven
  mutants killed.
- Git HEAD and task base: `fa1b9135dad780b3d4dce7a5c5e5084d3df865af`.
- Executable task source state before this post-run report was created: 15 files,
  SHA-256 `7c0d5d2bd84d400ab7f7b9032c6977eef54979e8796428e69e1c9db25ebacd6f`.
  The hash intentionally identifies the implementation, tests, SPEC, and verifier that ran; this
  EVIDENCE file was created after the run and is not included in that hash.
- Machine-readable summary:
  `.artifacts/production-managed-mt5-readiness/summary.json`.
- Independent verification: **not performed** against the final source state.

This is portable local evidence for the approved source change. It is not evidence that a real
production Scheduled Task, managed worker, terminal, credential, broker account, or order was
activated.

## Codebase discovery gate

The Codex session did not expose `codebase-memory-mcp` tools. The documented CLI fallback also
failed before source inspection because `codebase-memory-mcp` was not found in `PATH`. The task
therefore followed the repository's explicit fallback: it read `docs/CODEBASE_MEMORY.md`, the
approved SPEC, `docs/TRADE_EXECUTION_ARCHITECTURE.md`, the managed-EA runbook, current source, and
the exact diffs. No graph-readiness or task-relevant graph query is claimed.

## Toolchain

| Tool | Version |
| --- | --- |
| Windows PowerShell | 5.1.26100.9168 |
| Node | v24.18.0 |
| npm | 11.16.0 |
| Go | go1.26.5 windows/amd64 |
| rustc | 1.97.1 (8bab26f4f 2026-07-14) |
| Cargo | 1.97.1 (c980f4866 2026-06-30) |
| Python | 3.13.15 |
| Git | 2.55.0.windows.2 |

No dependency manifest changed and no new runtime or test dependency was installed.

## SPEC to test mapping

| Contract | Executable evidence | Status |
| --- | --- | --- |
| P1 managed login remains discoverable | `managed MT5 entry stays visible while backend capability gates credential submission`; desktop/mobile exact-one markers, disabled unavailable state, localized explanation; `npm run test:trade` | PASS |
| P2 healthy worker is not restarted | `healthy task is never restarted`; portable fixture requires `ready=true` and `task_started=false` | PASS |
| P3 stopped attested task starts once and converges | `stopped attested task starts exactly once and converges`; bounded core loop | PASS |
| P4 invalid installation fails before execution | receipt malformed/missing/relative/linked/out-of-range tests; missing/linked/SHA-mismatched artifact tests; action, arguments, principal identity, interactive logon, limited run level, enabled matching logon trigger matrix; exact worker/slot attestation mismatch test | PASS |
| P5 stale or unsuitable registry never passes | explicit unsuitable-state test plus exhaustive 576-case status/drain/capacity/lease/heartbeat property matrix | PASS |
| P6 gateway, worker gate, API, and ready banner are ordered | `canonical runner gates API and final banner on managed worker readiness`; runner negative control; direct-agent-launch mutant | PASS |
| P7 production credential-store failure is fail closed | `TestProductionManagedMT5StartupFailurePanicsWithoutPriorEnablement`, `TestProductionManagedMT5InvalidIdentityPanicsWithSanitizedError`, `TestProductionManagedMT5ProbeFailurePanicsWithSanitizedError`; fail-open mutant; 5/5 changed Go lines covered | PASS |
| P8 secure existing submission path is retained | `managed MT5 dialog reuses an explicit request key and clears browser credential state`; full Go suite including `internal/mt5credentials`; Rust worker-agent library tests | PASS for portable contracts; real Windows identity/store and broker flow UNVERIFIED |
| P9 verifier fails closed and is fresh | artifact-root cleanup; four checker negative controls; coverage negative control exits 1 as expected; mutation match-count/restore checks; summary/source-state generation | PASS |

### Negative constraints

| Constraint | Evidence | Status |
| --- | --- | --- |
| Canonical runner remains `run-backend-production.ps1`; deploy/build scripts do not gain supervision logic | task-path/diff audit; neither `build-production.ps1` nor `tools/deploy-backend.ps1` changed | PASS |
| Normal run does not install a worker, invent slots/credentials, or log into a broker | runner source contract and capability audit; helper capability limited to attested Scheduled Task plus loopback admin registry | PASS |
| Healthy worker is not force-stopped or restarted | healthy-idempotency test and blind-restart mutant | PASS |
| Runner/helper do not directly start agent or terminal | source contract, capability scan, and direct-agent-launch mutant | PASS |
| Path/hash/task/identity/heartbeat/capacity/lease checks remain fail closed | P4 and P5 tests; linked-receipt, artifact-hash, logon, heartbeat, worker-ID, drain mutants | PASS |
| Secrets are absent from additions and sanitized failures | high-confidence secret scan negative control and clean task diff; Go sanitized panic assertions | PASS |
| Infrastructure readiness is not presented as account readiness | runbook/operator contract and readiness result fields contain worker/capacity only | PASS |
| Existing unrelated dirty work is preserved | SHA-256/status snapshot matched before and after for 15 non-task dirty paths | PASS |
| No unauthorized commit, push, deploy, real worker start, broker action, or order | no Git delivery or host action occurred during the gauntlet; task-only commit/push was separately authorized afterward; deploy and real-host layers remain unverified | PASS |

## Final fresh gauntlet

| Layer | Command | Final result |
| --- | --- | --- |
| Readiness/property tests | `.\tools\verify-production-managed-mt5-readiness.ps1 -ReadinessTestsOnly` inside the entry point | 18 passed; 576 property cases |
| PowerShell parser | PowerShell 5.1 `Parser.ParseFile` over five touched scripts | 5 parsed, 0 errors |
| Checker negative controls | known-bad parser, runner gate, missing mutant target, and forbidden ready output | 4/4 rejected |
| Portable real execution | verifier `-FixtureExecution` in a fresh PowerShell process | `ready=true`, `task_started=false`, exit 0 |
| Mutation | nine scripted byte-restored mutants | 9/9 killed; every target matched once and every source hash restored |
| Frontend trade tests | `cd frontend; npm run test:trade` | 84 passed, 0 failed, 0 skipped |
| Frontend types | `cd frontend; npm run typecheck` | exit 0 |
| Frontend lint | `cd frontend; npm run lint` | exit 0 |
| Frontend build | `cd frontend; npm run build` | exit 0 |
| Go suite health | `cd backend; go test -count=1 -shuffle=on ./...` | all packages passed, 0 failed |
| Go static analysis | `cd backend; go vet ./...` | exit 0 |
| Go changed-line coverage | atomic profile plus fail-closed changed-line checker | 5/5 coverable changed lines, no uncovered lines |
| Coverage negative control | known-uncovered Go fixture | rejected with exit 1 as required |
| Rust registry contract | `cargo test --locked -p execution-gateway mt5_vm_control` | 13 passed, 0 failed, 1 disposable-PostgreSQL test ignored by its explicit harness gate |
| Rust worker agent | `cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1` | 49 passed, 0 failed, 1 explicitly ignored |
| Whitespace | `git -c core.safecrlf=false diff --check fa1b913 -- <task paths>` | exit 0 |
| Dependency/capability/secret audit | task-diff audit and negative-controlled scanner | dependencies none; approved capabilities only; secret scan clean |
| Source state | task-owned source hash | 15 files; `7c0d5d2bd84d400ab7f7b9032c6977eef54979e8796428e69e1c9db25ebacd6f` |
| Unrelated worktree preservation | before/after status, byte count, SHA-256 comparison | 15/15 paths unchanged |

The mutation kills were: heartbeat expiry boundary, worker-ID case fold, linked-receipt acceptance,
artifact-hash skip, non-interactive task acceptance, drain acceptance, blind task restart, direct
agent launch, and production credential-store fail-open.

## RED, GREEN, and corrections

The resumed worktree already contained the main implementation and 15 passing readiness tests, so
the session did not invent a historical RED for those changes. During audit, P4's mapping was found
too broad for the direct tests. Three additional failure-matrix tests were added and passed against
the existing implementation; three corresponding one-off mutants were then observed failing and
were retained in the rerunnable mutation layer. Assertions were not weakened.

The first full gauntlet attempt honestly failed three layers:

1. Mutation stopped after 2 kills with `MUTANT_MATCH_COUNT_INVALID:0` because the drain mutant
   targeted the wrong condition. The target was corrected to the actual healthy/drain predicate.
2. The shuffled Go suite had several one-second HTTP timeouts under an unusually slow cold/full
   run and a downstream nil dereference in a failed test. `internal/execution` immediately passed
   alone in 2.644 seconds without changing code or timeouts. Two subsequent fresh full gauntlets,
   including the final 118.85-second shuffled run, passed.
3. The Rust registry command incorrectly supplied `--lib` to the binary-only
   `execution-gateway` package. Removing that invalid target selector produced 13 passes and the
   one expected disposable-database ignore.

After the second passing run, the SPEC-to-test audit found the P4 gap described above. The verifier
was strengthened and one final fresh run supplied every number in this report.

## Declared unverified and production boundary

- Real production Scheduled Task inspection/start, worker registry heartbeat, worker lease, and
  terminal execution were not run.
- Real Windows Credential Manager execution under the dedicated production Go identity was not
  run.
- Demo broker onboarding and the R15-9 three-account lifecycle gate were not run; no Live/funded
  account or order was touched.
- Browser screenshot/interaction automation was not run; P1 has source-contract and TypeScript
  test evidence only.
- `go test -race` was not run on Windows; the change adds no concurrent Go path and the normal Go
  suite was shuffled.
- Independent verification was not separately authorized or performed against this final source
  state.
- `codebase-memory-mcp` graph readiness/query evidence is unavailable as recorded above.
- Task-only commit/push was separately authorized after the final gauntlet. CI, deployment, and
  production activation remain outside the verified/authorized execution performed here.

The next production step, if separately authorized, is an operator-run worker installation and
canonical `.\run-backend-production.ps1` execution on the Windows production host, followed by
the Demo-only R15-9 gate. Until those pass, the correct claim remains local
`PASS_WITH_DECLARED_UNVERIFIED`, not production-active.
