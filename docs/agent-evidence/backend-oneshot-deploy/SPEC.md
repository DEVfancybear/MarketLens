# SPEC — One-command backend build/restart via CI artifacts (Windows)

- Absolute path: `C:\Users\duong\Downloads\tradingview\docs\agent-evidence\backend-oneshot-deploy\SPEC.md`
- Tier: old-coder **Tier 3** — new cross-cutting delivery surface that touches production
  operations, release integrity, database migration, and service restart.
- Revision 1. **Spec approval: obtained.** The user replied `Duyet SPEC` on 2026-08-18, approving
  this exact Revision 1 before implementation began.

## Mandatory-tooling disclosure

`AGENTS.md` requires the `codebase-memory-mcp` startup gate and the globally installed `old-coder`
skill. **Neither is available in this session**: no codebase-memory MCP server is connected, and
`old-coder` is absent from `~/.claude/skills/` (only `playwright-automation` is installed) and from
the account's skill list. Discovery therefore used the fallback `AGENTS.md` explicitly permits
(`docs/CODEBASE_MEMORY.md`, architecture/operations docs, and direct source reads). This SPEC and the
final EVIDENCE follow the structure `AGENTS.md` describes, but they were **not** produced under the
real `old-coder` skill. EVIDENCE will repeat this disclosure.

## Requested outcome

The user builds and restarts the entire backend on the **Windows production host with one command**,
without an agent rebuilding anything, and without the host needing a Go or Rust toolchain.

## Confirmed decisions

| Decision | Choice |
| --- | --- |
| Target platform | **Windows only.** Linux is explicitly out of scope for now (user, this session). No systemd, no Linux script, no Docker. |
| Where builds happen | **GitHub Actions** produces the artifact. The server only downloads, verifies, and runs it. |
| CD trigger | CI builds automatically on push to `master`; **deployment stays a manual one-command action.** |
| Source changes | **None.** No Go, Rust, or Python source is modified. This task is delivery infrastructure only. |

## Established facts this design depends on

Verified by reading the source, not assumed:

1. **Go is CGO-free** (`pgx/v5`, no `import "C"`), so `CGO_ENABLED=0` produces self-contained
   `windows/amd64` binaries.
2. **SQL migrations are embedded in the binary.** `backend/cmd/migrate` uses
   `iofs.New(migrations.FS, ".")` from `github.com/marketlens/backend/migrations`. `migrate.exe` is
   self-contained; the artifact does **not** need to ship the 79-file `backend/migrations/` tree.
3. **The Rust gateway needs no runtime files.** Its `include_str!` references to migration SQL are
   compile-time and only in test assertions.
4. **`cmd/api` has no `-version` flag**, so build metadata will travel in a `MANIFEST.json` beside
   the binaries rather than requiring a source change.
5. **`backend/bin/*.exe` is gitignored** (`.gitignore:50`), so deployed artifacts cannot be
   accidentally committed.
6. **MT5 is Windows-bound**: `backend/bridge/mt5_stream/requirements.txt` requires
   `MetaTrader5>=5.0.45`. Python is a *runtime* prerequisite of the MT5 host, not a build toolchain,
   so requiring it on this Windows host does not violate the "no build toolchain" goal.

## Backend components the one command must own

| Component | Source | Artifact | Health gate |
| --- | --- | --- | --- |
| Go API | `backend/cmd/api` | `api.exe` | `http://localhost:8080/health`, `/health/ready`, `/execution-ea/health` |
| Migrator | `backend/cmd/migrate` | `migrate.exe` | `migrate version` must not report `dirty = true` |
| MT5 stream consumer | `backend/cmd/mt5-stream` | `mt5-stream.exe` | started only when `MT5_BRIDGE_WS_URL` resolves |
| Rust execution gateway | `backend/execution` (bin `execution-gateway`) | `execution-gateway.exe` | `<EXECUTION_ADMIN_URL>/health` |
| Python MT5 market-data bridge | `backend/bridge/mt5_stream` | not built by CI (Windows-only pip runtime) | `ws://localhost:8765`, symbols probe |

## Design

### 1. CI build job — `.github/workflows/ci.yml` (extended, existing jobs untouched)

New job `backend-artifact`, `runs-on: windows-latest`, gated on the existing `backend` and
`execution-rust` jobs passing:

- `go build` with `CGO_ENABLED=0`, `GOOS=windows`, `GOARCH=amd64`, `-trimpath` for `./cmd/api`,
  `./cmd/migrate`, `./cmd/mt5-stream`.
- `cargo build --release --locked -p execution-gateway`.
- Package `marketlens-backend-windows-amd64.zip` containing `bin/*.exe`, `MANIFEST.json`
  (commit SHA, workflow run id, UTC build time, Go/Rust/tool versions), and `SHA256SUMS`.
- Upload via `actions/upload-artifact@v4`, retention 30 days.
- On a `v*` tag, also attach the zip and `SHA256SUMS` to a GitHub Release.

The job publishes an artifact only; it performs no deployment.

### 2. The one command — `tools/deploy-backend.ps1` (new)

```powershell
.\tools\deploy-backend.ps1
```

Ordered, fail-closed, and idempotent:

1. **Preflight** — confirm repo root, `backend\.env` present, required env keys resolvable, and no
   unexpected process already owning the target ports outside this repo's own listeners.
2. **Resolve the artifact**, in this precedence order:
   1. `-ArtifactPath <file>` — an explicit local zip (offline/air-gapped path);
   2. `gh` CLI when present — `gh run download` for the newest successful `master` build, or
      `gh release download` with `-Tag`;
   3. `curl` + `$env:GITHUB_TOKEN` against the REST API.
   `-Commit <sha>` or `-Tag <tag>` pins a specific build; the default is the newest successful
   `master` run.
3. **Verify integrity** — recompute SHA-256 for every extracted file against `SHA256SUMS` and abort
   on any mismatch. `MANIFEST.json` commit is printed and, unless `-AllowCommitMismatch`, must match
   the checked-out `HEAD` so the operator cannot silently ship a different tree than they inspected.
4. **Stage** — extract to `backend\bin\.staging\<runId>`, then keep the previous release in
   `backend\bin\.previous` for rollback.
5. **Migrate forward** — run the staged `migrate.exe up`, then `migrate.exe version`; refuse to
   replace running services if the state is dirty.
6. **Restart safely** — stop only listeners this repository owns (reusing the proven
   `Stop-OwnedListener` process-chain logic from `run-backend-production.ps1`, extracted to a shared
   module so there is one implementation), swap binaries, and start execution gateway → Go API →
   MT5 stream consumer, with the Python MT5 bridge and terminal handled exactly as the existing
   runner does.
7. **Health gates** — local `/health`, `/health/ready`, `/execution-ea/health`, gateway admin
   `/health`, MT5 symbols probe; then the public gate unless `-SkipPublicHealthCheck`.
8. **Roll back automatically** — any failure from step 6 onward restores `backend\bin\.previous`,
   restarts the prior binaries, re-runs the health gates, and exits non-zero. Migrations are
   forward-only and are **not** rolled back; the script says so explicitly in its failure output.
9. **Report** — commit, run id, PIDs, ports, log paths, and the elapsed time.

### 3. Relationship to the existing runner

`run-backend-production.ps1` is **not modified in behavior** and remains the canonical
build-from-source path required by `AGENTS.md`. The two paths are documented as:

| Path | Command | Needs Go/Rust on host | Use |
| --- | --- | --- | --- |
| Artifact deploy (new) | `.\tools\deploy-backend.ps1` | No | Normal production deploy of a CI-built commit |
| Build from source | `.\run-backend-production.ps1` | Yes | Recovery, local hotfix, or when CI is unavailable |

`AGENTS.md` and `docs/OPERATIONS.md` are updated so **build backend production** / **run backend**
keep their current meaning while the new artifact path is described alongside them. This is a
documentation change only; no existing instruction is silently reinterpreted.

## Executable acceptance scenarios

### Scenario 1 — CI produces a verifiable Windows backend artifact
Given a push to `master`, when the workflow runs, then `backend-artifact` publishes
`marketlens-backend-windows-amd64.zip` containing `api.exe`, `migrate.exe`, `mt5-stream.exe`,
`execution-gateway.exe`, a `MANIFEST.json` whose commit equals the triggering SHA, and a
`SHA256SUMS` that matches every packaged file.

### Scenario 2 — The deployed host needs no build toolchain
Given a host with neither Go nor Rust on `PATH`, when `deploy-backend.ps1` runs against a local
artifact, then it completes without invoking `go` or `cargo`. Asserted by a test that runs the
script with a PATH that shadows both executables with failing stubs.

### Scenario 3 — Tampered artifacts are refused
Given an artifact whose zip contents no longer match `SHA256SUMS`, when the script runs, then it
aborts before stopping any service, exits non-zero, names the mismatched file, and leaves the
running deployment untouched.

### Scenario 4 — Migrations gate the restart
Given `migrate version` reports a dirty state, when the script runs, then it refuses to swap
binaries, leaves the previous release running, and exits non-zero.

### Scenario 5 — Failed health gates roll back
Given the staged `api.exe` never becomes healthy, when the script runs, then it restores
`backend\bin\.previous`, brings the previous binaries back to a passing health state, reports that
migrations were **not** rolled back, and exits non-zero.

### Scenario 6 — Commit mismatch is refused by default
Given an artifact whose `MANIFEST.json` commit differs from `HEAD`, when the script runs without
`-AllowCommitMismatch`, then it aborts before touching services and prints both commits.

### Scenario 7 — Only repo-owned listeners are stopped
Given a foreign process listening on a target port, when the script runs, then it refuses to kill it
and exits non-zero with the owning process chain. Port `8787` stays excluded, matching the existing
runner.

### Scenario 8 — The existing runner is unchanged
Given `run-backend-production.ps1`, when the change is complete, then its behavioral logic is
identical apart from importing the shared listener module, proven by an architecture test plus a
reviewed diff.

## Negative constraints

- Must **NOT** modify Go, Rust, or Python source, database schema, API behavior, auth, trading
  logic, or the frontend.
- Must **NOT** add Linux, systemd, or Docker artifacts in this task.
- Must **NOT** deploy automatically on push; CD stops at publishing an artifact.
- Must **NOT** print, log, or commit secrets. `backend\.env` is read but never copied into an
  artifact, log, or manifest.
- Must **NOT** roll migrations back automatically, or run `migrate down` anywhere.
- Must **NOT** kill a listener the repository does not own, and must **NOT** touch port `8787`.
- Must **NOT** weaken or bypass the existing health gates, or add a switch that skips integrity
  verification.
- Must **NOT** change `run-backend-production.ps1` behavior, or redefine what **build backend
  production** / **run backend** mean.
- Must **NOT** commit build outputs (`backend\bin\*.exe` stays ignored).

## Dependencies, tools, and generated files this SPEC authorizes

1. New file `tools/deploy-backend.ps1`.
2. New file `tools/lib/MarketLensListeners.psm1` — the shared owned-listener module, extracted
   verbatim from `run-backend-production.ps1`.
3. Edit `.github/workflows/ci.yml` — add the `backend-artifact` job only; existing jobs untouched.
4. New file `tools/verify-backend-deploy.ps1` — the rerunnable gauntlet entry point.
5. New test `backend/../tools/tests/deployBackend.Tests.ps1` **or**, if Pester is unavailable on this
   host, a plain-PowerShell test script at `tools/tests/deploy-backend-selftest.ps1`. The final
   choice and the reason will be recorded in EVIDENCE.
6. `-SelfTest` mode inside `deploy-backend.ps1` that exercises artifact resolution, checksum
   verification, staging/rollback selection, and commit-mismatch refusal against a temporary
   directory with stubbed `systemctl`-equivalent externals (`gh`, `curl`, the service binaries).
7. Doc edits: `AGENTS.md`, `docs/OPERATIONS.md`, `docs/CURRENT_PROGRESS.md`, `docs/NEXT_TASKS.md`,
   `docs/HANDOFF.md`, `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, and
   `docs/agent-evidence/backend-oneshot-deploy/EVIDENCE.md`.
8. Local one-off tool use: `go build` for `windows/amd64` to prove the CI build recipe, and creation
   of throwaway artifacts under the session scratchpad and `backend\bin\.staging`.

No new runtime dependency is introduced. Server prerequisites become: PowerShell, Python (already
required for MT5), and either `gh` or a `GITHUB_TOKEN` — **and no Go or Rust**.

## Verification gauntlet

Single entry point:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-backend-deploy.ps1
```

Fail-closed layers:

1. **Static syntax** — PowerShell AST parse of every new/changed `.ps1`/`.psm1`; YAML parse of
   `ci.yml`; `actionlint` if obtainable, otherwise a recorded schema check of the job keys.
2. **Deploy-script self-test** — Scenarios 2, 3, 4, 5, 6, 7 driven through `-SelfTest` with stubbed
   externals and a temp release tree. Each negative scenario must be observed **failing before the
   guard exists** (RED) and passing after (GREEN).
3. **Real local artifact build** — reproduce the CI recipe on this machine: `CGO_ENABLED=0 GOOS=windows
   GOARCH=amd64 go build -trimpath` for all three commands, package, and prove `SHA256SUMS`
   round-trips and `migrate.exe --help`/`version` runs from the packaged binary.
4. **Architecture assertions** — `run-backend-production.ps1` retains its documented steps; no
   `migrate down` anywhere in `tools/`; no secret-shaped string in the new files; port `8787` still
   excluded.
5. **Existing suites** — `cd backend && go test ./... && go vet ./...` to prove no source regression.
6. **Diff hygiene** — `git diff --check`, intended-file allowlist, secret scan.

### Explicitly NOT verifiable in this session

Stated here so approval is informed, and repeated in EVIDENCE:

- **The real GitHub Actions run.** `gh` is not installed locally and I hold no repository token. The
  `backend-artifact` job's first genuine execution happens after the change is pushed. I will report
  it as unverified and ask you to confirm the run, unless you want me to install `gh` or you supply
  a token.
- **Rust `cargo build --release` on `windows-latest`** — not reproduced locally; only the Go half of
  the recipe is built here.
- **A real deploy onto your production host** — I have no access to it. Service restart against live
  MT5, the production PostgreSQL migration, and the public health gate at
  `https://api.tradingterminal.io.vn` are covered by stubs and logic tests only, never by a live run.
- Whatever the artifact-download path does against the actual repository, since its visibility and
  token setup are unknown to me.

## RED → GREEN → REFACTOR plan

1. Record the baseline: current `ci.yml` jobs, `run-backend-production.ps1` behavior, `go test`/`go vet`.
2. RED: write the self-test asserting Scenarios 2-7 against a not-yet-written script and observe each
   failing for the right reason.
3. GREEN: implement the module, the deploy script, and the CI job until every layer passes.
4. REFACTOR: extract the shared listener logic and de-duplicate, without editing assertions in the
   same step.
5. Mutation control: temporarily disable checksum verification, the dirty-migration gate, and the
   foreign-listener guard one at a time; prove the gauntlet fails for each; restore exactly.

## Git operations

Commit and push to `master` only after the gauntlet passes, or after you explicitly accept a reported
blocker. `master` is this repository's working branch and `AGENTS.md` directs pushes to the current
branch. The remote has moved to `DEVfancybear/MarketLens.git`; I will not change the remote URL
unless you ask.

## Completion rule

After the final edit, run the single gauntlet entry point fresh and write
`docs/agent-evidence/backend-oneshot-deploy/EVIDENCE.md`, mapping every scenario and negative
constraint to a layer or to an explicit unverified/n-a entry with its reason. Any failing applicable
layer blocks completion.
