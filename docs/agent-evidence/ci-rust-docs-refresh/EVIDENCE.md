# EVIDENCE — Rust CI stabilization and documentation refresh

Date: 2026-08-24

Old Coder tier: Tier 2

SPEC: `docs/agent-evidence/ci-rust-docs-refresh/SPEC.md`

Spec approval: not obtained (autonomous run). The user explicitly said `không cần spec`; the
repository policy still required the SPEC and this evidence record, so work continued without a
review pause.

Source baseline: `3dcf45d57bfababd213317993b6958237e023115`

## Failure and root cause

GitHub Actions run [32653200179](https://github.com/DEVfancybear/MarketLens/actions/runs/32653200179)
failed only in `execution-rust`, job `97227861711`, at
`cargo test --locked --workspace --all-targets`. The test
`parallel_command_validation_and_received_ack_fail_closed_before_runtime` closed its connection
after correctly rejecting an invalid response; the scripted mock server then unwrapped the
resulting `BrokenPipe` and panicked. Commit `f4e48a0` had passed with the same Rust test source and
workflow, confirming a test-harness race rather than a documentation-build regression.

The first full local workspace run also revealed an independent test-only race: two
`execution-gateway` tests concurrently mutate the same process-wide `EXECUTION_*` variables.
Their collision assertions failed on the first deterministic two-thread RED iteration.

## RED evidence

- The GitHub log showed `BrokenPipe` at `managed_commands.rs:500` and a failed server-thread join.
- Three new scripted-writer tests were run while the extracted helper was deliberately
  `unimplemented!`: 0 passed, 3 failed.
- The two filtered gateway state-building tests failed on iteration 1 with two test threads before
  the shared test-only environment mutex was added.
- The documentation checker negative control injected the retired
  `MT5_BRIDGE_PROTOCOL.md` name in memory: 235 checks passed and 1 failed at the intended stale-index
  assertion.

Assertions were not weakened or edited during GREEN. The temporary unimplemented helper and
in-memory documentation mutation were removed before the final run.

## Behavior-to-evidence map

| SPEC behavior | Executable evidence | Final result |
| --- | --- | --- |
| B1 expected disconnects are accepted | `scripted_response_accepts_peer_disconnect_during_write_or_flush` | Passed |
| B2 unrelated I/O remains fail-closed | `scripted_response_rejects_non_disconnect_io_failures`; reject-all/swallow-all mutants | Passed; mutants killed |
| B3 HTTP response wire contract is unchanged | `scripted_response_preserves_http_wire_contract`; skip-flush mutant | Passed; mutant killed |
| B4 original regression is stable | original named test repeated 50 times; complete Windows suite; post-push Linux CI required | 50/50 local passes |
| B5 root current docs are accurate | maintained-date, path, repository, runner, and link checks | Passed |
| B6 frontend index matches repository | link audit, retired-name checks, package-version checks | Passed |
| B7 one fail-closed verification entry point | `tools/verify-ci-rust-docs-refresh.ps1` | Passed |
| B8 gateway environment tests are serialized | filtered pair with two test threads, repeated 50 times | 50/50 passes |

## Final fresh gauntlet

Rerunnable entry point:

```powershell
pwsh -NoProfile -File .\tools\verify-ci-rust-docs-refresh.ps1
```

The final run completed after the last code edit and reported:

- documentation invariants: 236 passed, 0 failed;
- relative-link audit: 134 Markdown files under `docs/` and `frontend/docs/` excluding immutable
  `docs/agent-evidence`, 0 broken relative links;
- `cargo fmt --all -- --check`: passed;
- three scripted response regression tests: passed;
- original `BrokenPipe` regression stress: 50/50 passed;
- gateway environment-race stress: 50/50 passed;
- Windows workspace all-target suite with `--test-threads=1`: 247 passed, 5 ignored, 0 failed;
- exact workflow Windows managed-agent library gate: 49 passed, 1 ignored, 0 failed;
- `cargo check --locked --workspace --all-targets`: passed;
- `cargo clippy --locked --workspace --all-targets -- -D warnings`: passed, 0 warnings and 0
  errors;
- manual mutation runner: 3/3 mutants killed and the exact original source hash restored;
- `git diff --check`: passed;
- changed-diff credential/secret scan: passed;
- final result: `PASS: complete CI/docs gauntlet with 50 consecutive regression iterations.`

The three mutation operators rejected `BrokenPipe`, swallowed every I/O error, and skipped flush.
Each caused the frozen regression tests to fail.

## Documentation audit

The inventory contained 172 documentation files when fixtures, archived reports, and historical
evidence were included. Maintained root and frontend entry points were rewritten as concise current
guidance, while historical plans, audits, and completed evidence were left historically intact.
The audit removed current references to deleted FTMO/browser-connector paths and port 8787, repaired
one historical changelog link, aligned frontend versions with `package.json` (Next.js 16.3.1, React
19.0.0, TypeScript 6.0.2, Lightweight Charts 5.2.0), and documented the canonical repository and
production runner/deployer split.

## Codebase-memory evidence

The final persisted v0.10.8 graph for project `C-Users-duong-Downloads-Tradingview` reported
`ready`, 18,225 nodes, 80,308 edges, 14 intentionally excluded directories, 87 intentionally
ignored files, 0 skipped files, and 52 partially parsed files. The schema-2 artifact is 8,249,231
compressed bytes. Task-relevant searches found the changed Rust tests after indexing.

`check_index_coverage` continued to classify the two Rust files and workflow as
`metadata_changed` immediately after refresh; direct source was therefore treated as authoritative.
After compaction, the Codex MCP transport returned `Transport closed`. The documented CLI fallback
then selected the exact matching root and returned `status: ready` with the same counts. The bridge
session needs a Codex restart, but the executable and graph are healthy.

## Platform correction and skipped layers

A parallel Windows all-target run exposed four pre-existing platform-native MT5 fixture collisions.
The repository workflow intentionally uses parallel workspace tests on Linux and a single-threaded
`mt5-vm-agent` library gate on Windows. The final local run therefore used all targets with one test
thread plus the exact Windows workflow gate. The post-push GitHub run is the required proof of the
exact parallel Linux command.

- Changed-line coverage: not collected; the installed toolchain has no configured coverage runner
  for the private integration-test helper. Behavioral and mutation evidence cover each branch.
- Property testing: not added; table-driven tests enumerate the three allowed disconnect kinds and
  representative forbidden write/flush errors.
- Playwright/UI/API automation: not applicable. No UI, API, selector, browser, or production
  behavior changed, and the repository's Playwright policy was removed.
- Five credentialed/disposable/database integration tests remained ignored by their existing test
  annotations; no external credentials or production services were introduced for this CI harness
  task.
- Independent verifier: not required for Tier 2 and not performed.

## Supply chain, scope, and delivery

No dependency, lockfile, Action, service, credential, database, or production code path changed.
Only expected peer-disconnect errors are accepted by the test helper; other errors still panic the
scripted server through the existing fail-closed join path. The gateway mutex is compiled only for
tests. `.tmp-tencentdb-agent-memory/` is generated background state and is explicitly excluded from
the commit.

The intended delivery is one commit, `fix(ci): stabilize Rust tests and refresh docs`, pushed to
`origin/master`. The resulting GitHub Actions run must pass before delivery is declared complete.
