## Evidence Report — GitHub CI/CD repair (Tier 2)

- Spec approval: obtained from user for `github-cicd-repair v1`.
- Source state: repair commit `2e0edb624e12867eed2f72e3a9cf01c496b970e0`; implementation fingerprint `frontend/package.json` SHA-256 `373E3D315CFE00DFD771567F58640A6F7E310A2D9544FBEE81B3F8F37E448A52`; gauntlet fingerprint `tools/verify-github-cicd-repair.ps1` SHA-256 `7003213B009B4ABEBF5336BD5046770EABAE90DA33021E0C61EE8EB91154A4AE`.
- Toolchain: Windows PowerShell 5.1; Node `v20.12.2`; npm `9.2.0`; package-lock-controlled frontend dependencies. GitHub acceptance target is Ubuntu with Node 22 as pinned in `.github/workflows/ci.yml`.
- Entry point: `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-github-cicd-repair.ps1`.
- Independent verification: passed in fresh GitHub Actions run `33157573604` for the exact repair commit; all four jobs concluded `success`.

### Spec → Test mapping

| Scenario | Test | Status |
|---|---|---|
| Trade tests run as individual test files on Ubuntu Node 22 | local gauntlet `npm run test:trade`; GitHub run `33157573604`, `replay-client-boundary` job | pass |
| Trade tests retain the Ky CommonJS preload bridge | `npm run test:trade` plus no-preload negative control | pass |
| Complete CI pipeline is green | GitHub run `33157573604` for `2e0edb624e12867eed2f72e3a9cf01c496b970e0` | pass |
| Must NOT: skip or reduce trade tests | gauntlet compares 21 source and 21 compiled test files; both runs execute 84 subtests | pass |
| Must NOT: alter dependencies or lockfile | `git diff --exit-code -- package-lock.json` | pass |
| Must NOT: alter application/deployment behavior | capability and diff review: only test command, SPEC, verifier, and evidence | pass |

### Gauntlet (final fresh local run)

| Layer | Command | Result |
|---|---|---|
| Trade tests | `npm run test:trade` twice | each run: 84 passed, 0 failed; 21/21 compiled files discovered |
| Replay boundary | `npm run check:replay-client-boundary` | 3 passed, 0 failed |
| Replay tests | `npm run test:replay` via Git Bash to reproduce Ubuntu glob expansion | 46 passed, 0 failed |
| Types | `npm run typecheck` | exit 0, 0 errors |
| Lint | `npm run lint` | exit 0, 0 warnings/errors |
| Production build | `npm run build` | Next.js 16.3.1 compiled and generated 12/12 static pages; exit 0 |
| Changed-line coverage | scenario-to-command mapping | package-script orchestration only; no application executable lines added |
| Mutation / negative controls | recorded Ubuntu directory-form failure; local no-preload run | 2/2 killed: `MODULE_NOT_FOUND` and `ERR_REQUIRE_ESM` respectively |
| Supply chain | package lock diff gate | no dependency or lockfile change |
| Suite health | repeated trade suite | two consecutive 84/84 passes |
| Full local entry point | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-github-cicd-repair.ps1` | `GITHUB_CICD_REPAIR_GAUNTLET_OK`, exit 0 |

### Independent verification

- Verifier: GitHub-hosted runners from Actions run `33157573604`; frontend used Ubuntu with Node 22, backend used Ubuntu, and the artifact job used Windows.
- Rounds: 1 completed against exact repair commit `2e0edb624e12867eed2f72e3a9cf01c496b970e0`; verdict `success`.
- Grading: mechanical GitHub job conclusions for `replay-client-boundary`, `backend`, `execution-rust`, and `backend-artifact`.
- Attacked: shell-independent test-file discovery, preservation of the Ky preload, complete test-file discovery, and full CI regression surface.
- Findings: the first GREEN attempt using a wildcard failed on Windows because Node 20 did not expand it; replaced with deterministic Node filesystem enumeration and child-process argument passing. No application code changed.
- Fixed after the last verified state, therefore unverified: none; this update changes evidence text only.

### Layers not run as specified

- **N-A (this project has no such surface):** property-based testing for a package-script orchestration change; public API compatibility; concurrency; UI visual checks.
- **UNAVAILABLE (tool missing):** local Linux container execution because Docker is not installed; the fresh GitHub-hosted Ubuntu run is the required real-platform acceptance gate.
- **SUBSTITUTED:** changed-line coverage uses scenario-to-command mapping because only package orchestration changed; this cannot provide statement coverage for JSON. Randomized suite ordering is substituted by two repeat runs and cannot detect every whole-suite order dependency.

### Dismissed review findings

- None — every observed behavioral finding was fixed or retained as a disclosed pending GitHub acceptance gate.

### Structural blind spot

- The local host uses Node 20/Windows, so local evidence alone cannot prove Ubuntu/Node 22 behavior. Completion requires the fresh GitHub-hosted run.

### Honest notes

- RED was observed in GitHub run `33138134525`: only `replay-client-boundary` failed, at `npm run test:trade`, because Node tried to load `.test-build/tests/trade` as a module.
- The unchanged directory-form command passed 84 tests on Windows, confirming the platform-specific blind spot.
- The first attempted wildcard-only repair passed shell expansion on Ubuntu in principle but failed locally on Windows; it was not retained.
- The existing `test:replay` glob also depends on shell expansion. The local gauntlet invokes that unchanged package script through installed Git Bash, matching the GitHub runner's shell behavior.
- Repair commit `2e0edb624e12867eed2f72e3a9cf01c496b970e0` was pushed to `origin/master`; GitHub run `33157573604` concluded `success` with `backend`, `replay-client-boundary`, `execution-rust`, and `backend-artifact` all green. No deployment or production-host mutation occurred.
