# Evidence Report — production-worker-host-provision v1 (Tier 3)

- Status: **BLOCKED — production was not started**.
- Spec approval: obtained exactly from the user as
  `APPROVE SPEC: production-worker-host-provision v1` before implementation.
- Approved SPEC:
  `C:\Users\Duong\Downloads\tradingview\docs\agent-evidence\production-worker-host-provision\SPEC.md`.
- Source baseline: `master` at `097bcf7f523b1327b2c970036d24d1542740fd8b`.
- Final verifier run: 2026-08-25T09:24:15.5791356Z through
  2026-08-25T09:55:50.8315400Z.
- Bare-metal report source-state hash before its generated tracked-output drift:
  `a557e5001a731a13fac5561e131823d03dfe9dcf6ed3d14e6ef656e235dcd115`.
- Toolchain observed: Windows PowerShell 5.1.19041.6456, Go 1.26.5 windows/amd64,
  rustc 1.97.1, cargo 1.97.1, Python 3.10.9, Node 20.12.2. `npm --version` could not be
  captured in the sandbox because Node failed to resolve `C:\Users\Duong` with `EPERM`.
- Entry point:
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1`.
- Independent verification: **not performed** against this failed state.

## Outcome

The verifier correctly selected only:

- identity `DESKTOP-MDC339G\Duong`;
- terminal `C:\Program Files\MetaTrader 5\terminal64.exe`;
- state root
  `C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075`.

Its known-bad control rejected the FTMO terminal with the exact code
`PROVISIONING_SELECTED_TERMINAL_FORBIDDEN`. The auto-install contract suite passed 8/8.

The complete existing bare-metal gauntlet then returned `FAIL`: 42 layers passed, 16 failed, and
one live three-demo-account layer was `UNVERIFIED_ALLOWED`. The task verifier stopped with
`PROVISIONING_CONTRACT_LAYER_FAILED_BAREMETAL`, before checking or creating WebRequest evidence,
bootstrap material, install input, worker roots, receipt, task, migrations, service restart, or
health gates. This is the required fail-closed outcome; a failing gauntlet blocks production.

An explicit post-run audit found all three approved WebRequest source artifacts absent:

- `C:\ProgramData\MarketLens\slot-inputs\slot-01\chart01.chr`;
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\experts.ini`;
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\webrequest-attestation.json`.

Therefore S2 also remains independently blocked. No `probeSucceeded=true` result was invented.

## SPEC → test mapping

| Scenario / invariant | Evidence | Status |
|---|---|---|
| S1 exact selected slot preflight | verifier real-host preflight plus FTMO known-bad control | **pass** |
| S2 honest WebRequest topology evidence | explicit existence audit: all three required source artifacts absent | **fail / blocked** |
| S3 protected bootstrap material | stopped before mutation; post-run audit found no token file or env token | **unverified** |
| S4 strict one-slot install input | stopped before mutation; post-run audit found no install input | **unverified** |
| S5 hostile/stale dry run | auto-install synthetic contracts 8/8 pass; real installer dry run not reached | **unverified** |
| S6 exact terminal interruption | process-stop stage not reached; selected terminal was not running at post-run audit, attribution unknown | **unverified** |
| S7 canonical production run | canonical runner not invoked | **unverified** |
| S8 failure remains failure | verifier exited nonzero, protected production config stayed absent, no success claimed | **pass** |
| Must not touch FTMO/IC Markets | negative control rejected FTMO; no production install stage reached | **pass within observed scope** |
| Must not expose secrets | secret-diff-scan passed; no new token was generated | **pass within observed scope** |
| Must not use runner recovery switches | canonical runner was not invoked | **pass** |
| Must not commit/push/reset/checkout | none performed | **pass** |

## Gauntlet — final fresh run

The machine-readable report is
`.artifacts\mt5-baremetal-managed-ea\summary.json`; per-layer output is retained under
`.artifacts\mt5-baremetal-managed-ea\logs`.

| Layer | Result |
|---|---|
| Verifier parser and RED/GREEN control | RED observed against the stub; implemented control then rejected FTMO with the pinned code |
| Selected real-host preflight | pass |
| Auto-install contracts | 8 passed, 0 failed |
| Complete bare-metal gauntlet | 42 pass, 16 fail, 1 allowed-unverified; overall FAIL |
| Go shuffled full tests | pass, 231.476 seconds |
| Go tests / vet / race | pass; race 300.814 seconds |
| Windows credential-store smoke | pass |
| Rust fmt / check / clippy / tests / agent tests | pass |
| Rust stress properties | pass |
| EA MetaEditor compile and release attestation | pass, but generated tracked release drift described below |
| Frontend typecheck / lint | pass |
| npm production audit / dependency delta / secret scan | pass |
| Real production execution | not run because the gauntlet failed |

### Failed layers

1. `go-format` — command emitted output when an empty result was required.
2. `persistent-go-race-environment` — missing Revision 2 preflight snapshot at
   `.artifacts\mt5-windows-credential-store\toolchain-revision-2\preflight.json`.
3. `go-changed-coverage-gate` — exit 1.
4. `rust-coverage-toolchain` — approved `llvm-tools-preview` component is absent.
5. `rust-database-integration` — exit 1.
6. `rust-coverage-merge` — `llvm-profdata` was not attested.
7. `rust-coverage-export` — `llvm-cov` was not attested.
8. `rust-changed-coverage-gate` — exit 1.
9. `python-managed` — exit 1.
10. `postgres-0042-positive` — exit 1.
11. `postgres-0042-negative-control` — failed for an unexpected reason; missing
    `KNOWN_BAD_0042_CHECKER_INPUT`.
12. `mutation-score` — exit 1.
13. `postgres-0042-service-sandbox-absence` — expected at least four fresh reports, got zero.
14. `frontend-trade-tests` — exit 2.
15. `backend-docs` — exit 1.
16. `capability-diff-audit` — reported an unapproved production-runner capability change.

The exact logs named by the summary, not this condensed list, are authoritative for diagnostics.
No failed layer was weakened, skipped, relabeled as pass, or repaired outside the approved scope.

## Layers not run as specified

- **UNAVAILABLE:** Rust changed-line coverage could not complete because the approved
  `llvm-tools-preview` component was missing.
- **UNAVAILABLE:** the PostgreSQL/service-sandbox evidence expected by the frozen prior-task
  gauntlet was absent or failed.
- **UNVERIFIED:** R15-9 live three-demo-account gate; the reused suite explicitly recorded
  `UNVERIFIED_ALLOWED`.
- **UNVERIFIED:** installer real dry run, Scheduled Task, worker heartbeat/capacity, migrations,
  local health, and public health; all were downstream of the blocking gates.
- **N-A:** new application changed-line coverage/property/mutation for this task; no Go/Rust/TS
  application implementation was edited by the task.

## Generated drift and host state

The reused bare-metal gauntlet did not restore three tracked EA release artifacts after its
MetaEditor compile layer:

- `frontend/public/downloads/MarketLensExecutionEA.ex5` changed from 93,366 to 93,522 bytes;
- `frontend/public/downloads/MarketLensExecutionEA.release.json` changed compiler/source/binary
  attestation values from compiler 5.0.0.6122 to 5.0.0.6090;
- `frontend/public/downloads/MarketLensExecutionEA.sha256.txt` changed with the generated binary.

Those changes were absent from `dirty_before`, present in `dirty_after`, and remain unstaged.
They were not adopted as task implementation and were not restored because the approved SPEC
forbids checkout/reset and no separate destructive cleanup approval was obtained.

The post-run host audit found:

- no bootstrap token file;
- no managed-worker install input;
- no worker receipt;
- no `MarketLens MT5 Worker` Scheduled Task;
- no bootstrap token or worker receipt configured in `backend\.env`;
- the selected terminal process was no longer running, although this task did not execute its
  approved exact-process stop stage, so attribution is unknown.

## Structural blind spot

The repository validates the schema/hash of a positive WebRequest attestation but cannot derive an
actual MT5 terminal `WebRequest` success from a missing operator probe. This task therefore cannot
honestly create `probeSucceeded=true` from the current host state. Treating a hand-authored boolean
as proof would violate the approved SPEC and old-coder anti-gaming rules.

## Honest notes

- `codebase-memory-mcp` was unavailable as MCP and CLI; the documented direct-source fallback was
  used and disclosed before approval.
- The user-installed `old-coder` skill and its gauntlet/templates were read before SPEC creation.
- No production completion, health, worker readiness, or successful deployment claim is made.
- A fresh rerun remains blocked until the failed gauntlet layers and real WebRequest evidence are
  resolved. The tracked EA release drift also needs an explicit keep-or-restore decision first.

## SPEC Revision v2 cleanup evidence

Approval was obtained verbatim as:

```text
APPROVE SPEC REVISION: production-worker-host-provision v2
```

The approved cleanup scope was limited to these three tracked EA release artifacts:

- `frontend/public/downloads/MarketLensExecutionEA.ex5`;
- `frontend/public/downloads/MarketLensExecutionEA.release.json`;
- `frontend/public/downloads/MarketLensExecutionEA.sha256.txt`.

The first restore attempt stopped at a PowerShell parser error caused by an empty pipeline before
Git was invoked. It made no filesystem or index change. The second attempt reached Git but failed
to create `.git/index.lock` under the sandbox permission boundary; it also made no restore change.

After explicit elevation approval, this exact approved command completed successfully:

```powershell
git restore --source=097bcf7f523b1327b2c970036d24d1542740fd8b --worktree -- frontend/public/downloads/MarketLensExecutionEA.ex5 frontend/public/downloads/MarketLensExecutionEA.release.json frontend/public/downloads/MarketLensExecutionEA.sha256.txt
```

Post-restore verification matched each working file to the baseline commit:

| Path | Baseline Git blob | Working-file SHA-256 |
|---|---|---|
| `frontend/public/downloads/MarketLensExecutionEA.ex5` | `2116a666369309b12b8dbaf2ef75c856cf508dac` | `fcf60c64764055a6545bfba1287c33e3f34f63fac006f8c04474fd4ad74262e0` |
| `frontend/public/downloads/MarketLensExecutionEA.release.json` | `d9eeaa2630ab68db06ca5156d02506512b8e795b` | `08a7f9257efb9bfdd31a7878aa2580f4546f5180a5ace5a7d740d8a9b6f29c6c` |
| `frontend/public/downloads/MarketLensExecutionEA.sha256.txt` | `7e18c026c73fcca67fc75aea36a82a293f3d27c3` | `e80ac68ca15a2ff53c0e04e315f281943c14fd4813879822537b8693f00dacf1` |

A path-scoped `git status --short -- <three approved paths>` returned no output. The full final
status retained only the task evidence and gauntlet outputs:

```text
?? .artifacts/migration-0042/
?? .artifacts/mt5-baremetal-managed-ea/
?? docs/agent-evidence/production-worker-host-provision/
?? tools/verify-production-worker-host-provision.ps1
```

`SPEC.md`, this `EVIDENCE.md`, the provisioning verifier, and the machine-readable gauntlet summary
remain present. No fourth path was restored, removed, or otherwise cleaned. Revision v2 did not
resume production, run the canonical production runner, or intentionally change production-host
runtime state. The Revision v1 BLOCKED result remains authoritative.
