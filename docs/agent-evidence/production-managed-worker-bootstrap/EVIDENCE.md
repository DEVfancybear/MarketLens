# Evidence Report - production-managed-worker-bootstrap v2 LIGHTWEIGHT (Tier 3)

- Spec approval: obtained exactly from the user:
  `APPROVE SPEC: production-managed-worker-bootstrap v2 LIGHTWEIGHT`.
- Final fresh entry point: `.\tools\verify-production-managed-worker-bootstrap.ps1`.
- Final run: 2026-08-25T08:22:50.3257504Z through 2026-08-25T08:22:54.0581344Z.
- Source state used by the run: task tree SHA-256
  `0ecb9c19946107561d780d6486245c6220dfdc9289acbc9826d0d11be38a63e6`.
  The hash was generated before this EVIDENCE file was written.
- Machine-readable report: `.artifacts/production-managed-worker-bootstrap/summary.json`.
- Independent verification: not performed.
- Status: **PASS_WITH_DECLARED_UNVERIFIED**.

## SPEC to test mapping

| Behavior | Evidence | Status |
| --- | --- | --- |
| B1 build-before-install gate | Focused readiness suite: canonical runner ordering and build-mode-aware receipt resolver | PASS |
| B2 no runtime side effects at bootstrap stop | Canonical runner source ordering places receipt gate before Python, migrations, terminal, listeners, worker, API, and ready banner | PASS |
| B3 valid receipt preserves production path | Focused resolver test accepts and normalizes a valid regular receipt | PASS |
| B4 malformed receipt fails closed | Focused resolver tests reject relative, missing, directory, empty, oversized, and linked paths | PASS |
| B5 `-SkipBuild` remains fail-closed | Focused resolver test requires `MANAGED_MT5_WORKER_RECEIPT_REQUIRED` in artifact mode | PASS |
| B6 installer ownership remains explicit | Capability audit and runner contract reject installer invocation, receipt synthesis, and direct agent launch | PASS |
| B7 first-install runbook is unambiguous | Focused documentation/configuration contract test | PASS |
| B8 verifier catches ordering regression | Receipt-before-build mutant: 1/1 killed; original runner bytes restored by SHA-256 | PASS |

## Final lightweight gauntlet

| Layer | Result |
| --- | --- |
| PowerShell parser | 3 files parsed, 0 errors |
| Focused readiness tests | 19 passed, 0 failed |
| Ordering mutant | 1/1 killed; mutant run exited 1 through `READINESS_TESTS_FAILED=`, then restored exactly |
| Diff check | PASS for task paths |
| Dependency audit | No Go, Rust, or frontend manifest changes |
| Capability/secret audit | Installer/direct-agent forbidden checks passed; secret assignment scan clean |

## Resource boundary and unverified layers

The final run did not invoke the production runner, build-production, deploy-backend, npm build,
Go full suite/vet/coverage/race, Rust test/check/clippy/build, database migrations, Scheduled Task,
worker or terminal startup, broker login, deployment, commit, or push. Those layers remain
unverified by this lightweight completion and no production-active claim is made.

The earlier interrupted run's logs are historical diagnostics only and are not used as final fresh
gauntlet evidence. They showed the workstation reached frontend build before the restart; the
lightweight run intentionally stopped before the heavy Go/Rust layers.

## Honest notes

The first two wrapper attempts failed closed before the focused suite: strict parser-error formatting
accessed an empty error collection, and a PowerShell array-concatenation expression passed `+` as a
child-process argument. Both were corrected without changing product assertions. The final fresh
run above passed after those corrections. No unrelated dirty path was staged, changed, committed,
or pushed.
