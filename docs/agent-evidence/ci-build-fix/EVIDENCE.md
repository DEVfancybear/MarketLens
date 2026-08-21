# EVIDENCE — Repair the MT5 commit CI build failures

## Source and toolchain

- Approved base: `fd28f7d4780f3fa16cdc10b849967125e77266a6` on `master`.
- Original failing change: `9ec4ba518f184e01c93ea8147289a3207a8d3415`.
- GitHub RED runs: `32432519781` and `32441641679`.
- Local host: Windows amd64 with Node `v24.18.0`, npm `11.16.0`, Go `1.26.5`,
  rustc `1.97.1`, and Cargo `1.97.1`.
- Dependencies and lockfiles changed: none.
- Production code and workflow files changed: none.

## RED → GREEN evidence

| SPEC behavior | RED evidence | GREEN evidence |
| --- | --- | --- |
| Supported TypeScript test resolver | `npm run check:replay-client-boundary` failed locally and on GitHub with TS5108 because `node` maps to removed `node10` resolution. | `moduleResolution: "bundler"`; fresh final run compiled and passed all 3 boundary tests. |
| Runtime-validated command narrowing | Resolver probe and `npm run typecheck` exposed `commandId` and `leaseGeneration` as `unknown`. | Assertion-based validator checks kind and all required field types/values; fresh final typecheck exited 0 without a blind cast. |
| Platform-native missing-token fixture | GitHub Ubuntu returned `MANAGED_WORKER_TOKEN_PATH_INVALID` for the Windows-only fixture path instead of reaching the intended missing-file guard. | Fixture uses an absolute, confirmed-absent native temp path and retains the expected `MANAGED_WORKER_TOKEN_FILE_INVALID` assertion; exact Linux execution is mandatory post-push. |
| No production validation weakening | The failure occurred before the missing-file branch. | Production `validate_token_path` was not edited; existing agent library, managed command, and managed control tests all pass. |

## Fresh final local gauntlet

Entry point:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-ci-build-fix.ps1
```

Observed after the last code/configuration edit:

- Gauntlet self-test rejected native exit code 23 and rejected a known-bad allowlist path.
- `npm ci`: passed; installed 557 packages from the lockfile. npm reported 3 existing high-severity
  audit findings and three existing unapproved install scripts. No audit fix or dependency change
  was authorized.
- Replay boundary: 3 passed, 0 failed.
- Replay tests: 46 passed, 0 failed.
- Trade tests: 81 passed, 0 failed.
- Frontend typecheck, lint, and production build: passed.
- Go `test ./...` and `vet ./...`: passed.
- Rust format: passed.
- Rust workspace excluding the agent executable: passed (2 adapter, 27 domain, 12 engine, and 93
  gateway tests).
- Rust agent library: 23 passed, 0 failed, 1 credentialed Windows test ignored by its existing
  annotation.
- Rust managed commands: 3 passed; managed control: 5 passed.
- Rust managed CLI integration test compiled successfully with `--no-run`.
- `git diff --check`: passed with line-ending warnings only.

The entry point terminated at its final working-tree allowlist because the unrelated untracked
`docs/agent-evidence/mt5-vm-local-prerequisites/SPEC.md` appeared during the run. It is preserved and
excluded from staging. The user explicitly directed isolated commit/push after this and the Windows
Rust limitation were disclosed.

## Explicitly unverified locally

- Windows Application Control blocks Cargo's generated `aws-lc-sys` clippy build script and the
  newly built managed-worker CLI executable with OS error 4551. Local clippy and CLI execution are
  not claimed as passing.
- GitHub Ubuntu must pass exact `cargo clippy --locked --workspace --all-targets -- -D warnings` and
  `cargo test --locked --workspace --all-targets`, including the repaired CLI regression.
- The dependent Windows `backend-artifact` job must also succeed. These post-push results are not
  predeclared here; the exact run URL and terminal job results will be reported after monitoring.

## Delivery controls

- Stage only the six SPEC paths and verify the cached path allowlist plus `git diff --cached --check`.
- Fetch and require `origin/master` still equals the approved base before committing.
- Commit message: `fix(ci): restore cross-platform build gates`.
- Push normally to `origin/master`; no force, rebase, reset, dependency update, deployment, or secret
  operation is permitted.
