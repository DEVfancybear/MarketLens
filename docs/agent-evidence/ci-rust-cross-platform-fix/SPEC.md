# SPEC - Rust CI cross-platform test fix (Tier 2)

Status: approved, including Revision 1 (`Duyệt`, 2026-08-23).

## Incident and objective

GitHub Actions run `32648504557` for commit
`ffd5626fdd53c247eb0f81377ff882b1e7885f6f` failed only in job `execution-rust` on
`ubuntu-latest`. Go and frontend jobs passed. The failing command was:

```text
cargo test --locked --workspace --all-targets
```

Observed RED failures:

- `local_process_driver_runs_signed_start_heartbeat_sync_and_stop_lifecycle` tried to execute
  Windows-only `where.exe` and failed with OS error 2.
- `process_start_failure_cleans_the_reserved_runtime_assignment` failed through the same
  Windows-only fixture.
- `process_config_accepts_pinned_fixture_defaults_and_splits_slots` ran Windows disk/process
  postcondition assertions against the deliberate non-Windows disk stub and called `unwrap_err()`
  on `Ok(())`.

Objective: keep the portable Rust tests running on Ubuntu, run the genuinely Windows-only process
tests on a Windows GitHub runner before artifact creation, and restore the complete GitHub workflow
to green without changing production runtime behavior.

## Discovery and source of truth

- Repository: `C:\Users\duong\Downloads\tradingview`.
- `codebase-memory-mcp` is unavailable in this agent session. The mandated fallback was repeated:
  `docs/CODEBASE_MEMORY.md`, the current workflow, the exact GitHub failure log, and current
  `mt5-vm-agent/src/process.rs` are authoritative.
- GitHub failure: `https://github.com/DEVfancybear/MarketLens/actions/runs/32648504557`.
- Six pre-existing local modifications in docs/gauntlet files and generated `.artifacts/**` are
  outside this fix. They must remain unstaged and must not be overwritten.

## Executable acceptance criteria

1. **Ubuntu never executes Windows process fixtures**
   - The two tests that resolve `where.exe`, copy `cmd.exe`, launch PowerShell, and use Windows
     process semantics are compiled only on Windows.
   - Their Windows-only fixture helpers are compiled only on Windows as well.
   - No `#[ignore]` is used to conceal them.

2. **Portable config coverage remains on Ubuntu**
   - `process_config_accepts_pinned_fixture_defaults_and_splits_slots` remains a cross-platform
     test.
   - Only its Windows disk-query and running-process assertions are conditionally compiled for
     Windows; portable validation, managed-EA topology, defaults, and slot-splitting assertions
     remain active on Ubuntu.
   - The non-Windows disk stub is exercised with its documented nonzero-input success contract.

3. **Windows CI retains the skipped coverage**
   - The Windows `backend-artifact` job runs
     `cargo test --locked -p mt5-vm-agent --lib` before the release build/package steps.
   - A failing Windows agent test blocks artifact publication.

4. **Regression contract fails closed**
   - Add `backend/bridge/mt5_vm/test_ci_rust_platform_contract.py` to assert the exact platform
     gates, the continued portable test, the absence of `#[ignore]` on the affected tests, and the
     ordering of the Windows test step before the release build.
   - Observe this contract fail before implementation and pass after implementation.

5. **GitHub result is green**
   - Local Rust formatting/tests/clippy and the focused contract pass.
   - After a normal commit and fast-forward push, the new GitHub Actions run for that commit must
     complete successfully. A merely queued/in-progress run or skipped `execution-rust`/artifact
     job is not completion.

## Negative constraints

- Do not change production logic, public APIs, migrations, dependencies, lockfiles, security
  boundaries, or runtime configuration.
- Do not skip or ignore the entire Rust suite, the entire process test module, or the portable
  config test.
- Do not weaken existing behavioral assertions.
- Do not stage the six pre-existing local modifications or any `.artifacts/**` output.
- Do not rerun production, deploy an artifact, restart services, install the worker, or access
  broker credentials.

## RED -> GREEN -> REFACTOR

1. RED: create and run the focused platform/CI source contract against the current commit; retain
   its assertion failures. The GitHub run above is the real Ubuntu behavioral RED.
2. GREEN: add only the narrow `cfg(windows)` gates, explicit non-Windows stub assertion, and the
   Windows CI test step required by the criteria.
3. REFACTOR: run formatting and keep the platform-gating layout readable without changing test
   assertions.

## Verification gauntlet

Local commands:

```powershell
python -m unittest -v backend.bridge.mt5_vm.test_ci_rust_platform_contract
cargo fmt --all -- --check
cargo test --locked --workspace --all-targets
cargo clippy --locked --workspace --all-targets -- -D warnings
git diff --check
```

The Cargo commands run from `backend/execution`. The focused Python command runs from repository
root. The final external layer is the complete GitHub Actions workflow for the pushed commit,
inspected with `gh run view`; all required jobs must pass.

Changed-line coverage and mutation are not applicable to production behavior because this fix adds
only test platform selection and CI orchestration. The regression contract receives a demonstrated
RED. Supply-chain audit is not applicable because dependency files must not change. The final diff
receives a secret/capability review.

## Planned files, dependencies, generated output, and git operations

Task-owned files:

- `backend/execution/crates/mt5-vm-agent/src/process.rs`
- `.github/workflows/ci.yml`
- `backend/bridge/mt5_vm/test_ci_rust_platform_contract.py` (new)
- `docs/agent-evidence/ci-rust-cross-platform-fix/SPEC.md` (this file)
- `docs/agent-evidence/ci-rust-cross-platform-fix/EVIDENCE.md` (new after final run)

Dependencies/tools: no new dependency or installation; existing Rust, Python, Git, and authenticated
GitHub CLI only. Cargo/GitHub caches and ignored build outputs may be refreshed.

After all local gates pass, stage only the five paths above, audit the staged diff, fetch and require
fast-forward `origin/master`, create one normal fix commit, and push to `origin/master`. Watch the
new GitHub run to completion. Do not amend, rebase, reset, stash, force-push, deploy, or alter the
pre-existing local work.

## Evidence deliverable

`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\ci-rust-cross-platform-fix\EVIDENCE.md`
will map every criterion and negative constraint to exact results, identify the commit and GitHub
run, and disclose all skipped layers and limitations.

## Revision 1 - serialize Windows agent fixtures (approved)

Discovery during the first local Windows gauntlet: the newly planned Windows CI command without a
thread limit ran 50 agent tests in parallel and produced three failures. The affected fixtures
temporarily replace process-global `APPDATA`, so concurrent tests can redirect another fixture's
MetaTrader state root and make pinned files disappear. The existing Revision 15 gauntlet already
documents and uses `--test-threads=1` for this agent suite.

Observed comparison on the same source state:

- Parallel `cargo test --locked --workspace --all-targets`: agent lib result 46 passed, 3 failed,
  1 ignored. The failures were the same lifecycle/config tests involved in the CI incident, now due
  to missing fixture paths during concurrent `APPDATA` replacement.
- Serial `cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1`: 49 passed, 0 failed,
  1 ignored.

Revision to the approved commands only:

- The Windows artifact job will run
  `cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1` before release build.
- The local all-workspace final run will use
  `cargo test --locked --workspace --all-targets -- --test-threads=1`.
- The regression contract will require the exact serialized Windows command.

This does not skip a test, weaken an assertion, or change production logic. It makes the already
required Windows test layer deterministic under the known process-global fixture boundary. A future
parallelization refactor would require replacing process-global environment mutation with isolated
processes or a shared synchronization primitive; that larger test-infrastructure change is outside
this CI repair.
