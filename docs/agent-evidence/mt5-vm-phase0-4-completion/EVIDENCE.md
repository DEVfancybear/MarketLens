# EVIDENCE — Universal MT5 Windows VM connector Phase 0–4 completion

- SPEC: `SPEC.md`, Revision 1, old-coder Tier 3.
- Approval: obtained before implementation with the exact user response
  `Duyệt SPEC Revision 1` on 2026-08-20.
- Source state at evidence capture: working tree changes on branch `master`; commit/push were not
  requested during implementation. A later follow-up explicitly authorized commit and push after
  this evidence was captured.
- Status: **repository implementation code-native PASS; delivery BLOCKED on disposable PostgreSQL
  round-trip and external Phase 1–4 gates**.

## Startup and toolchain

`codebase-memory-mcp` was unavailable in this session. The required fallback was used: direct read
of `docs/CODEBASE_MEMORY.md`, the connector plan, Phase 0–4 records and exact current source files.
The installed `old-coder` and `playwright-automation` skills were read. No browser UI changed, so
Playwright UI E2E is not applicable; Go Fiber `httptest`/native Rust routes are the closest route.

Toolchain observed: Rust/Cargo 1.97.1, Go 1.26.5, Python 3.14.6, PostgreSQL service 17 on local
port 5432. No package installation, credential creation, production deploy, commit or push occurred.

## RED → GREEN record

- Portfolio freshness RED: the new pure test panicked at the intentional `todo!`; GREEN after the
  conservative older-of-two implementation.
- Agent wire-kind RED: deserialization rejected the three new names; GREEN after adding stable
  `instrument_snapshot`, `orders_history_snapshot`, and `deals_snapshot` variants plus round-trip
  test.
- Python history RED: both new tests failed because history normalizers/collector were absent;
  GREEN after bounded normalizers and `None`/exception failure semantics.
- Go route RED: snapshot/history handlers returned 404; GREEN after owner-scoped client, admin
  route and public Fiber handler wiring.
- Later cursor/coverage tests were added before final refactor and pass. Assertions were not weakened.

## Fresh verification results

1. `cargo test --locked -p execution-gateway -p mt5-vm-agent --all-targets`: **93 gateway pass;
   22 agent pass; 1 credentialed live test ignored; 0 failures**.
2. `backend\\.venv-mt5\\Scripts\\python.exe -m unittest ...phase0_probe ...phase1_adapter
   ...phase1_control_harness ...phase4_snapshots -v`: **37 pass; 0 failures**.
3. `go test ./...` from `backend`: **all packages pass**.
4. `go vet ./internal/execution`: **pass**.
5. `cargo fmt --all` followed by `cargo check --locked -p execution-gateway -p mt5-vm-agent`:
   **pass**. Non-fatal legacy warnings were removed from the new sync module; clippy without
   `-D warnings` remains the repository invocation because legacy copier/risk warnings predate this
   task. `cargo clippy -D warnings` is **FAIL/BLOCKED** on existing `copier.rs`/`main.rs` lint debt;
   it is not treated as a product PASS.
6. `cargo clippy --locked -p execution-gateway -p mt5-vm-agent --all-targets` completes with 11
   pre-existing warnings in legacy copier/risk/main code and no warning in the new sync module.
   `-D warnings` therefore remains a repository debt failure, not a Phase 4 implementation pass.
7. `powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\verify-mt5-phase4.ps1 -SkipDatabase`:
   Rust check/clippy/tests, Python, Go, migration-static and manual mutation layers **PASS**;
   PostgreSQL layer explicitly **BLOCKED** by `-SkipDatabase` and exits non-zero.
8. `tools/verify-mt5-phase4-mutants.ps1`: **5/5 mutants killed** — partial delete, dropped lease
   fence, dropped identity check, one-sided portfolio freshness, and partial-history coverage.
   Logs are retained below `.artifacts/mt5-phase4-mutants`.

## Scenario map

| Scenario | Evidence |
| --- | --- |
| 1 complete replaces exact family | Rust reconciliation + transaction delete-on-complete tests PASS |
| 2 partial/failed preserve rows/freshness | Rust tests and Python collector PASS |
| 3 complete empty clears | Rust test PASS; Python empty-vs-failed test PASS |
| 4 paired portfolio freshness | Rust older-of-two test PASS |
| 5 atomic worker fences | Rust lease/session/sequence tests PASS; live DB transaction unverified |
| 6 identity mismatch | Rust identity tests PASS; live DB write/no-write unverified |
| 7 cross-owner isolation | Go handler owner injection tests PASS; live PostgreSQL route unverified |
| 8 redacted public response | Go route tests and DTO inspection PASS; live Vault/database unverified |
| 9 decimal/ticket transport | Python and Rust strict string/decimal tests PASS |
| 10 stable instrument protocol | Agent wire-name/HMAC/replay tests PASS |
| 11 history empty vs failed | Python and Rust validation tests PASS; live DB coverage unverified |
| 12 history idempotence | SQL primary keys/upsert path reviewed; disposable DB execution unverified |
| 13 bounded/tamper-evident cursor | Rust cursor account/tamper/length tests PASS; live page traversal unverified |
| 14 0040/0041 round-trip | **BLOCKED**: local configured URL unavailable/unauthenticated; no production fallback used |
| 15 Phase 0–3 regression | Rust/Python/Go code-native suites PASS; live Phase 1–3 gates remain open |

## Negative constraints

No broker mutation API, Phase 5 execution path, broker-name branch, plaintext credential, public
worker/adapter port, frontend change, production runner change, migration rewrite, commit or push
was added. Partial/failed snapshots/pages do not delete rows or advance authoritative freshness/
coverage. `ready` is not granted by the Phase 2 acknowledgement boolean; Phase 4 snapshot families
own readiness.

## Remaining blockers and user actions

1. Provide a disposable PostgreSQL URL through the process-local
   `MT5_PHASE4_DATABASE_URL` variable and rerun `tools/verify-mt5-phase4.ps1`; do not provide it in
   chat or commit it. The verifier must report migration 0040/0041 up → down → up PASS.
2. On the signed Windows VM, complete the Phase 1 normal-agent, independent FTMO web comparison
   and second-demo cross-fault test.
3. Complete the Phase 2 signed-worker rotation/reassignment and Phase 3 Vault lifecycle exercises.
4. Complete Phase 4 FTMO + retail independent terminal/web comparisons through reconnect and
   cold-cache history.

Until these return sanitized PASS evidence, Phase 5 order execution must remain disabled.
