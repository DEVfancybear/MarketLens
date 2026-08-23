# EVIDENCE - Rust CI cross-platform test fix

## Verdict

PASS for the approved Tier 2 SPEC and Revision 1. Commit
`2ad324a881bd6ca5a35baa81b2984e52bf04dfcf` fixes the Ubuntu Rust failure,
retains the affected Windows coverage on a Windows runner, and completed the full GitHub Actions
workflow successfully:

- Fix run: <https://github.com/DEVfancybear/MarketLens/actions/runs/32649314550>
- Status: `completed / success`
- Source SHA: `2ad324a881bd6ca5a35baa81b2984e52bf04dfcf`
- Required jobs: `backend`, `execution-rust`, `replay-client-boundary`, and `backend-artifact` all
  completed successfully.

The `Attach to release` step was skipped by its existing event condition because this was a normal
branch push, not a release. Artifact packaging and `actions/upload-artifact` both passed.

## Approved scope and source state

- SPEC: `docs/agent-evidence/ci-rust-cross-platform-fix/SPEC.md`.
- Tier: 2.
- Approval: base SPEC and Revision 1 were explicitly approved by the user on 2026-08-23.
- Fix commit parent: `311ab342a1bfbfbfde916116a166f272dc9aeb3c`.
- Fix commit: `2ad324a881bd6ca5a35baa81b2984e52bf04dfcf`.
- Fix commit files: `.github/workflows/ci.yml`,
  `backend/bridge/mt5_vm/test_ci_rust_platform_contract.py`,
  `backend/execution/crates/mt5-vm-agent/src/process.rs`, and the SPEC.
- No dependency manifest, lockfile, migration, production configuration, or public API changed.
- `codebase-memory-mcp` was unavailable in this session. The repository-mandated fallback used
  `docs/CODEBASE_MEMORY.md`, the current source/workflow, and exact GitHub logs as discovery
  evidence and source of truth.

Toolchain used for the final local run:

```text
rustc 1.97.1 (8bab26f4f 2026-07-14)
cargo 1.97.1 (c980f4866 2026-06-30)
Python 3.13.15
git 2.55.0.windows.2
gh 2.98.0 (2026-08-20)
```

## RED evidence

### External Ubuntu reproduction

GitHub Actions run `32648504557` at
`ffd5626fdd53c247eb0f81377ff882b1e7885f6f` failed only `execution-rust`; the
backend and replay/frontend jobs passed and the dependent artifact job was skipped. Command:

```text
cargo test --locked --workspace --all-targets
```

The `mt5-vm-agent` library result was `41 passed; 3 failed; 1 ignored`; the command exited 101.
The exact failures were:

- `local_process_driver_runs_signed_start_heartbeat_sync_and_stop_lifecycle`: its Windows fixture
  attempted `where.exe` on Ubuntu and failed with OS error 2.
- `process_start_failure_cleans_the_reserved_runtime_assignment`: the same Windows-only fixture
  boundary failed.
- `process_config_accepts_pinned_fixture_defaults_and_splits_slots`: a Windows-only disk/process
  assertion called `unwrap_err()` on the documented non-Windows `Ok(())` disk stub.

Source: <https://github.com/DEVfancybear/MarketLens/actions/runs/32648504557>.

### Focused regression contract RED

Before implementation:

```text
python -m unittest -v backend.bridge.mt5_vm.test_ci_rust_platform_contract
```

Result: 3 tests ran with 6 assertion failures. The missing protections were four platform gates,
the non-Windows conditional contract, and the Windows CI test step. After Revision 1 extended the
contract to require serialization, it was run against the still-parallel workflow and produced one
failure for the absent `--test-threads=1` argument.

### Windows concurrency discovery

The first parallel local workspace run exposed a separate deterministic-test constraint: fixtures
temporarily mutate process-global `APPDATA`. The agent library result was `46 passed; 3 failed; 1
ignored`. On the same source state, the approved serial command produced `49 passed; 0 failed; 1
ignored`. Revision 1 therefore required serialization in the Windows job and final local gauntlet;
it did not skip or weaken any test.

## Implementation evidence

- Added `#[cfg(windows)]` only to the two process-lifecycle tests and their fixture helpers that
  require `where.exe`, `cmd.exe`, PowerShell, and Windows process semantics.
- Kept `process_config_accepts_pinned_fixture_defaults_and_splits_slots` cross-platform. Its
  portable validation, topology/default, and slot assertions remain unconditional; only Windows
  disk-query/running-process assertions are Windows-gated.
- Added an explicit non-Windows assertion that the documented disk guard stub accepts nonzero
  input.
- Added a Windows `backend-artifact` step before all production binary builds:

```text
cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1
```

- Added a focused source/workflow contract that fails closed if gates, portability, absence of
  `#[ignore]`, serialization, or build ordering regress.

## Fresh final local gauntlet

Run against the complete fix state before commit:

| Layer | Command | Exact result |
| --- | --- | --- |
| Focused contract | `python -m unittest -v backend.bridge.mt5_vm.test_ci_rust_platform_contract` | PASS, 3/3 |
| Formatting | `cargo fmt --all -- --check` | PASS |
| Rust workspace | `cargo test --locked --workspace --all-targets -- --test-threads=1` | PASS, 244 passed, 0 failed, 5 ignored |
| Windows agent focus | `cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1` | PASS, 49 passed, 0 failed, 1 ignored |
| Static analysis | `cargo clippy --locked --workspace --all-targets -- -D warnings` | PASS, 0 warnings |
| Patch hygiene | `git diff --check` for the task diff | PASS |

The ignored tests were pre-existing credentialed/live validations; this change added no ignore.

## GitHub final gauntlet

Run `32649314550` supplied the real cross-platform proof:

| Job / step | Result |
| --- | --- |
| `backend` | PASS in 1m20s; Go tests and vet passed |
| `execution-rust` on Ubuntu | PASS in 1m05s; formatting and the original workspace command passed |
| `replay-client-boundary` | PASS in 1m20s |
| `backend-artifact` on Windows | PASS in 13m36s |
| `Run Windows managed-agent tests` | PASS; 49 passed, 0 failed, 1 ignored |
| `Build Go binaries` | PASS |
| `Build Rust production binaries` | PASS |
| `Package artifact` | PASS |
| `actions/upload-artifact` | PASS |

GitHub emitted non-blocking deprecation annotations because several third-party/action references
still target the Node 20 action runtime and GitHub forced Node 24. They did not fail a job and were
outside this approved Rust platform-fix scope.

## Acceptance mapping

1. **Ubuntu never executes Windows process fixtures - PASS.** The two lifecycle tests and both
   fixture helpers are compiled only on Windows; the contract verifies the exact gates and verifies
   no `#[ignore]` was introduced. Ubuntu `execution-rust` passed.
2. **Portable config coverage remains on Ubuntu - PASS.** The test itself is unconditional, only
   Windows-specific sub-assertions are gated, and the non-Windows disk stub is explicitly exercised.
3. **Windows CI retains skipped coverage - PASS.** The serialized agent suite ran before binary
   builds and passed all 49 active tests; build/package/upload happened only afterward.
4. **Regression contract fails closed - PASS.** Demonstrated RED before implementation and after
   the serialization requirement, then 3/3 GREEN on the final state.
5. **GitHub result is green - PASS.** Run `32649314550` completed successfully with every required
   job present and successful.

## Negative constraints and capability audit

- Production logic/runtime behavior changed: no; edits in `process.rs` are test-only platform
  selection/assertion changes.
- Public APIs, migrations, dependencies, lockfiles, security boundaries, runtime config: unchanged.
- Entire Rust suite/module/portable test skipped: no.
- Existing assertion weakened: no; Windows assertions still run on Windows and portable assertions
  still run everywhere.
- Secrets or credentials added/read: no.
- Production run, deploy, restart, worker install, or broker access: not performed.
- Push: normal fast-forward to `origin/master`; no amend, rebase, reset, stash, or force-push.

## Skipped layers and limitations

- Changed-line coverage and mutation testing: not applicable per the approved SPEC because the
  change is test platform selection plus CI orchestration; the focused contract has demonstrated
  RED evidence and both OS runners supplied behavioral evidence.
- Supply-chain audit: not applicable; dependency and lock files did not change.
- Independent second-agent verification: not performed for Tier 2 and not required by the approved
  SPEC.
- Parallelizing the Windows process fixtures remains outside scope. They mutate process-global
  `APPDATA`; the approved rerunnable entry points intentionally use `--test-threads=1` until those
  fixtures are isolated or synchronized.

## Rerunnable entry points

From repository root:

```powershell
python -m unittest -v backend.bridge.mt5_vm.test_ci_rust_platform_contract
Push-Location backend/execution
cargo fmt --all -- --check
cargo test --locked --workspace --all-targets -- --test-threads=1
cargo clippy --locked --workspace --all-targets -- -D warnings
Pop-Location
git diff --check
gh run view 32649314550
```
