# Evidence — Universal MT5 Windows VM connector Phase 1–4 exit verification

- SPEC: `SPEC.md`, Revision 3, explicitly approved by the user on 2026-08-21.
- Source at evidence capture: `master` was at the same commit as
  `origin/master` (`git rev-list --left-right --count HEAD...origin/master`
  returned `0 0`). The verification edits and this evidence record are part of
  the requested commit; no deploy or production migration was performed.
- Safety boundary: all live/operational checks below are demo/read-only; no
  order mutation or live-trading activation was invoked.
- Evidence is sanitized. It contains no password, token, raw login, account
  identifier, broker ticket, terminal path, Vault response, or unsanitized log.

## Verification matrix

| Scenario | Verdict | Fresh evidence / reason |
| --- | --- | --- |
| V1 repository gauntlet | **PASS** | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run-mt5-phase4-disposable.ps1`; final `.artifacts/mt5-phase4/summary.json` reports Rust check/clippy/tests, Python Phase 0/1/4, Go execution, static migration, mutation controls, and PostgreSQL `0040/0041` round-trip all PASS. Disposable EDB PostgreSQL 17.11 was loopback-only and removed. |
| V2 durable restart and migration boundary | **PASS** | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run-mt5-phase2-operational.ps1`; two deterministic attempts passed. Each recorded schema 41, two gateway processes, worker session generation 2, lease generation 2, one active lease, one fenced old command, one current provision command, and five stale HTTP surfaces rejected. Runtime/token files were removed. |
| V3 Phase 1 normal signed-agent lifecycle | **BLOCKED** | Repository/fake-driver and installed-slot test-host lifecycle pass, but the normal authenticated stdio path still needs an Authenticode-valid/reputable `mt5-vm-agent.exe` accepted by Smart App Control/Application Control, a local DPAPI demo credential, and an installed signed terminal slot. Test-host evidence is not promoted. |
| V4 independent match and two-account isolation | **BLOCKED** | Requires two distinct disposable MT5 demo accounts, two separately installed signed terminal slots, and independent FTMO/retail terminal or web observations. The current operator host does not expose those prerequisites. |
| V5 worker session rotation and reassignment | **PASS** | Covered by the fresh V2 operational run: old session/lease fencing and exactly-one current provision command were asserted on two attempts. |
| V6 Vault/API/browser lifecycle | **BLOCKED** | Disposable Vault KV v2 client lifecycle (`put/get/rotate/delete`) passed in `.artifacts/mt5-vault-disposable/summary.json`; `go test ./cmd/mt5-phase3-harness ./internal/mt5vault -count=1` also passes. The full authenticated public API connect → ready → reconnect → rotate → disconnect → remove exercise, cross-owner checks, and browser password-clear regression still need a disposable Go/API+Vault deployment run. No production Vault was used. |
| V7 Phase 4 FTMO and retail-demo read synchronization | **BLOCKED** | Code-native and migration layers pass, including partial/failed/empty/cursor mutation controls. Exit evidence still requires independent FTMO and one retail demo observations across disconnect, reconnect, and cold-cache history. No broker account was read in this run. |
| V8 Phase 5 remains disabled | **PASS** | `manual-mutation-controls` passed; the worker/adapter boundary exposes only provision/reconcile/stop and read synchronization. No `order_check`, `order_send`, modify, cancel, partial-close, full-close, or live activation was called. |

## Final gauntlet layers

- Rust: `cargo check --locked`, `cargo clippy --locked --all-targets`, and
  `cargo test --locked -p execution-gateway -p mt5-vm-agent --all-targets` all
  passed. The final log contains 93 gateway tests, 23 library tests plus one
  credentialed live test ignored, 3 managed-command tests, 5 managed-control
  tests, and 4 CLI tests: 128 passed, 0 failed, 1 intentionally ignored.
- Python: the final Phase 0/1/4 unittest command ran 43 tests and returned
  `OK`.
- Go: `go test ./internal/execution -count=1` returned
  `ok github.com/marketlens/backend/internal/execution 1.013s`; the focused
  `go test ./cmd/mt5-phase3-harness ./internal/mt5vault -count=1` also returned
  `ok` for both packages.
- Migration/static/mutation: `0041` static checks PASS; the manual mutation
  layer killed all five named mutants; the disposable PostgreSQL migration
  round-trip PASS is in V1.
- Format/diff: `cargo fmt --all -- --check` and `git diff --check -- backend
  docs tools` PASS.
- Real execution: the Phase 2 runner started two actual gateway processes per
  attempt; the Vault runner started a real loopback Vault 2.0.3 process; the
  Phase 4 runner started a real disposable PostgreSQL 17.11 process. No MT5
  broker mutation was executed.
- Property/adversarial coverage: protocol replay/tamper/expiry, stale lease,
  owner scope, partial/failed/empty reconciliation, cursor tamper, decimal
  transport, path/reparse, queue/capacity and secret-redaction cases are in the
  Rust/Python/Go suites and mutation layer. A randomized-order test runner and
  changed-line coverage threshold are not configured in this repository; these
  are recorded as skipped rather than inferred from unit-test counts.

The only intentional ignored test is the credentialed Windows live lifecycle;
it cannot be promoted without the operator's signed agent and demo credentials.

## Changes made while closing local gates

- The Phase 4 verifier now uses a disposable workspace-local Go build cache so
  Windows cache ACLs cannot turn a passing Go test into a host permission error.
- The Vault and Phase 2 disposable runners use the same cache isolation.
- The Phase 2 runner supports Windows PowerShell 5.1, whose
  `ProcessStartInfo` lacks `.ArgumentList`; fixed/generated `psql` arguments are
  passed through `.Arguments`.
- The managed-agent scripted TCP test resets accepted sockets to blocking mode;
  this removes a Windows `WSAEWOULDBLOCK` race without weakening the transport.

## Operator prerequisites to close the remaining gates

Provide these locally, without pasting secret values into chat or Git:

1. A signed/reputable `mt5-vm-agent.exe` path accepted by Application Control.
2. Two disposable MT5 demo accounts (FTMO plus one independent retail demo),
   stored through the existing DPAPI credential flow, with two installed signed
   terminal slots and their broker server catalogs.
3. Independent terminal or broker-web views for the identity, demo mode,
   positions, pending orders, seven-day history counts, instruments, orders and
   deals used for comparison.
4. For V6 only, a disposable Vault/API private-ingress environment (the local
   Vault binary and loopback PostgreSQL are already available as test tooling).

Until V3, V4, V6, and V7 are PASS, the Phase 1–4 exit gate is not closed and
Phase 5 order execution must not start.
