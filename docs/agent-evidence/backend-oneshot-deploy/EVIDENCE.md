# EVIDENCE — One-command backend build/restart via CI artifacts (Windows)

- Task: `SPEC.md` Revision 1, old-coder Tier 3, approved by the user on 2026-08-18.
- Completed: 2026-08-19.
- Source state: branch `master`, on top of commit `31b39f9`.
- Toolchain used: Go 1.26.5 (windows/amd64), cargo 1.97.1, Windows PowerShell 5.1,
  PostgreSQL 17.6, Python 3.13.15.
- Gauntlet entry point:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-backend-deploy.ps1
```

## Mandatory-tooling disclosure

`AGENTS.md` requires a `codebase-memory-mcp` startup gate and the globally installed `old-coder`
skill, and instructs an agent to stop and report if the skill cannot be found. **Neither was
available in this session**: no codebase-memory MCP server was connected, and `old-coder` was absent
from `~/.claude/skills/` (only `playwright-automation` is installed) and from the account skill list.
This was reported to the user before implementation began, and the user approved proceeding.

Discovery therefore used the fallback `AGENTS.md` explicitly permits: `docs/CODEBASE_MEMORY.md`,
`docs/OPERATIONS.md`, `docs/HANDOFF.md`, and direct reads of `run-backend-production.ps1`,
`build-production.ps1`, `backend/cmd/**`, `backend/internal/config`, `backend/internal/auth`, and
`.github/workflows/ci.yml`. The SPEC/TDD/EVIDENCE structure below follows what `AGENTS.md`
describes, but it was **not** produced under the real `old-coder` skill.

Playwright was not used: this change adds no UI. `AGENTS.md` §Playwright point 3 covers this case,
and the substitute is stronger than a code-only claim — layer 6 starts the real compiled services and
probes twelve HTTP endpoints (see §4).

## 1. What now exists

| Artifact | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` job `backend-artifact` | Builds and publishes the deployable Windows backend after the existing test jobs pass |
| `tools/deploy-backend.ps1` | The one command: acquire, verify, migrate, restart, roll back |
| `tools/lib/MarketLensBackend.psm1` | Shared env/port/ownership/checksum helpers used by the deploy path |
| `tools/verify-backend-local.ps1` | Starts the compiled services and probes the API |
| `tools/verify-backend-deploy.ps1` | The seven-layer fail-closed gauntlet |

The production host now needs **no Go and no Rust**. It needs PowerShell, the managed MT5 Python
environment (which cannot ship in an artifact because `MetaTrader5` is a Windows-only pip package),
and either the `gh` CLI or a downloaded zip passed to `-ArtifactPath`.

## 2. Design decision that differs from the SPEC

The SPEC's step 6 described re-implementing the restart inside the deploy script, "reusing the
`Stop-OwnedListener` process-chain logic ... extracted to a shared module so there is one
implementation".

While reading `run-backend-production.ps1` it became clear the runner already accepts exactly the
switches this path needs: with `-SkipBuild` it requires `backend\bin\api.exe` and
`execution-gateway.exe` to already exist — which is precisely what the artifact provides — and
`-SkipMigrations` skips the `go run ./cmd/migrate` step that would otherwise require Go.

So the deploy script **delegates** the restart:

```
run-backend-production.ps1 -SkipPull -SkipBuild -SkipMigrations
```

This satisfies the SPEC's stated intent ("so there is one implementation") better than the SPEC's
own mechanism, and it is strictly lower risk:

- `run-backend-production.ps1` is **not modified at all** — stronger than SPEC Scenario 8, which
  allowed a module-import change. Enforced by a gauntlet assertion on `git diff`.
- No duplication of listener ownership, MT5 terminal startup, market-data sidecar startup, or the
  local/public health gates.

Consequently the shared module carries only what the deploy path genuinely needs
(`Get-BackendEnvValue`, `Get-BindPort`, `Get-ListenerOwnership`, `Test-ArtifactChecksums`) and was
named `MarketLensBackend.psm1` rather than the SPEC's `MarketLensListeners.psm1`, because it is no
longer a listener-only module. `Get-BackendEnvValue` is intentionally duplicated from the runner
rather than refactored into it, to keep the runner byte-identical.

## 3. Scenario results

### Scenario 1 — CI produces a verifiable Windows backend artifact — **PARTIALLY VERIFIED**

The job is implemented and its YAML is validated (layer 1 asserts the job exists, runs on
`windows-latest`, gates on `[backend, execution-rust]`, and that no pre-existing job was removed).

The **build recipe itself is verified by executing it locally** (layer 3): the same
`CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath` commands produce `api.exe`,
`migrate.exe` and `mt5-stream.exe`; the release `execution-gateway.exe` is packaged; a
`MANIFEST.json` and `SHA256SUMS` are generated the same way; and the result round-trips through the
same verifier the deploy script uses (5 files matched).

**Not verified:** the job has never run on GitHub Actions. `gh` is not installed on this machine and
no repository token was available, so the first genuine run happens after this is pushed. The
`actions/upload-artifact` step, the tag-triggered release upload, and Rust compilation on the
`windows-latest` runner are all unexercised.

### Scenario 2 — The deployed host needs no build toolchain — **VERIFIED**

Self-test asserts the deploy script contains no `go build`/`go run` and no `cargo` invocation, and
that it passes `-SkipBuild`, `-SkipMigrations`, `-SkipPull` to the runner. Independently, layer 3
proves the packaged `migrate.exe` runs standalone, confirming the SQL is embedded via
`iofs.New(migrations.FS, ".")` and no Go toolchain is needed to migrate.

### Scenario 3 — Tampered artifacts are refused — **VERIFIED**

Five self-test cases, each observed failing before the guard existed:
intact artifact verifies all files; a tampered binary is refused with the offending path; a deleted
binary is refused; an **empty** `SHA256SUMS` is refused (an empty manifest must never read as
"verified"); a missing `SHA256SUMS` is refused. All refusals happen before any service is stopped.

### Scenario 4 — Migrations gate the restart — **VERIFIED**

`Test-MigrationStateClean` is asserted against `dirty = true`, `dirty: true`, `dirty = false`, and
empty output. A dirty schema aborts before binaries are swapped. Additionally, the real
`migrate.exe up` was executed against a real PostgreSQL 17.6 and reported `version=39 dirty=false`.

### Scenario 5 — Failed health gates roll back — **PARTIALLY VERIFIED**

The rollback path is implemented: the previous binaries are copied to `backend\bin\.previous` before
the swap, restored on any failure from the migration step onward, the runner is re-invoked, and the
script exits non-zero while stating explicitly that migrations were **not** rolled back.

**Not verified:** no live rollback was executed. Triggering it requires a failing restart on a host
with the MT5 terminal and market-data sidecar, which this machine does not have. The logic is
covered only by reading, not by a test.

### Scenario 6 — Commit mismatch is refused by default — **VERIFIED**

`Test-ManifestCommit` asserted for: matching commit (case-insensitive) allowed; differing commit
refused; empty artifact commit refused; `-AllowCommitMismatch` permits the override.

### Scenario 7 — Only repo-owned listeners are stopped — **VERIFIED**

`Get-ForeignListener` is exercised against a free port (no finding) and against a real
`TcpListener` opened by the test on an ephemeral port, which is correctly reported as foreign
(`Owned = $false`). Preflight refuses before downloading or migrating. A gauntlet assertion proves
port `8787` is never a deploy target.

### Scenario 8 — The existing runner is unchanged — **VERIFIED, more strongly than specified**

`git diff HEAD -- run-backend-production.ps1` is empty. Asserted by layer 4.

## 4. Live local API verification (the user's headline requirement)

The user asked to "test local all api run thành công". This was done against the real compiled
binaries, not stubs.

Environment built for the purpose: PostgreSQL 17.6 installed locally, a dedicated cluster
initialised on port **55432** (port 5432 was already held by another PostgreSQL on this machine),
database `smc` created, and `backend\.env` generated from `backend\.env.example` with locally
generated development-only secrets. `migrate.exe up` then reported `version=39 dirty=false`.

`tools\verify-backend-local.ps1` starts `execution-gateway.exe` and `api.exe` and probes twelve
endpoints. Protected routes and the `/execution-ea` relay only mount when both a database and a
Firebase service account are configured, so the script detects the mode and asserts the contract that
applies. **Both modes were exercised and both passed 12/12:**

| Endpoint | Without Firebase | With Firebase |
| --- | --- | --- |
| `GET /health` | 200 | 200 |
| `GET /health/ready` (real Postgres) | 200 | 200 |
| `GET /health` on the Rust admin listener | 200 | 200 |
| `GET /execution-ea/health` (Go → Rust relay) | 404 (surface absent) | **200** |
| `GET /api/v1/alerts` | 404 | **401** |
| `GET /api/v1/drawings` | 404 | **401** |
| `GET /api/v1/watchlists` | 404 | **401** |
| `GET /api/v1/sync/bootstrap` | 404 | **401** |
| `GET /api/v1/execution/accounts` | 404 | **401** |
| `GET /api/v1/execution/instruments` | 404 | **401** |
| `POST /execution-ea/v1/ea/poll` | 404 | **401** |
| `GET /api/v1/definitely-not-a-route` | 404 | 404 |

The script also fails if any endpoint returns 5xx in either mode, since that would mean broken
wiring rather than an enforced boundary.

To exercise the mounted mode without a real credential, a throwaway 2048-bit RSA key was generated
locally and passed as `FIREBASE_PRIVATE_KEY` with a fake project id and client email, via process
environment. Firebase Admin only contacts Google when it verifies a token, so this proves the routes
mount and reject anonymous callers. **No real Firebase credential was used, and none was written to
a committed file.**

**Not covered by this check:** the MetaTrader 5 terminal and the Python market-data sidecar. Both
need a licensed Windows MT5 install and broker credentials.

## 5. Findings surfaced while verifying

### 5.1 `backend/.env.example` cannot be copied verbatim

A fresh `cp .env.example .env` produces a backend that refuses to start:

```
config error: TRADE_RECOVERY_SMTP_HOST, TRADE_RECOVERY_EMAIL_FROM and both SMTP credentials
must be configured together
```

The example ships `TRADE_RECOVERY_EMAIL_FROM="MarketLens Security <security@example.com>"` while
leaving the SMTP host and credentials empty, and the validator requires the whole group together.
Not fixed here: the SPEC forbids source changes, and `.env.example` is a documented default whose
correct value is the user's call. Recorded in `docs/KNOWN_ISSUES.md`.

### 5.2 A single malformed line silently disables the entire `.env`

`internal/config/config.go:132` calls `_ = godotenv.Load()`. When any line fails to parse, godotenv
returns an error **and no keys at all**, the error is discarded, and every value silently falls back
to its default — including `APP_ENV`, which then reads as `development` and skips the production
required-secret validation.

This was observed directly: a `.env` whose `FIREBASE_PRIVATE_KEY` had been written across multiple
physical lines produced `keys parsed: 0` while the file plainly contained `DATABASE_URL`.

Honest attribution: the malformed file was **created by this session's own tooling**, not shipped by
the repository. A correctly written single-line quoted PEM parses fine (verified with a minimal
reproduction, both LF and CRLF). The hazard is the silent-fallback mechanism, not a shipped defect.
Recorded in `docs/KNOWN_ISSUES.md` as a hardening candidate.

### 5.3 Pre-existing flaky backend tests

The first `go test ./...` run failed two tests in `internal/execution` with `i/o timeout`
(`TestPublicEARoutesRequireBearerAndNeverExposeAdmin`,
`TestTradingMutationRateLimitIsScopedAfterAuthentication`). Both pass in isolation and the full suite
passed on re-run, so this is loopback port contention under parallel package execution on this
machine. No Go source was modified by this task, so these failures are definitionally pre-existing.

## 6. Negative constraints

| Constraint | Result |
| --- | --- |
| No Go, Rust or Python source change | **Held.** Layer 7 rejects any change under `backend/` or `frontend/`. |
| No Linux, systemd or Docker artifact | **Held.** None added; the user descoped Linux mid-task. |
| No automatic deploy on push | **Held.** The job publishes an artifact and performs no deployment. |
| No secret printed, logged or committed | **Held.** `backend\.env` is read but never copied into an artifact, manifest or log; layer 4 scans the new tools for credential-shaped literals; `backend/.env` and `backend/bin/*.exe` are gitignored. |
| No automatic migration rollback, no `migrate down` | **Held.** Layer 4 scans every `tools/*.ps1` for a rollback invocation. |
| Never kill a foreign listener; never touch port 8787 | **Held.** Scenario 7 plus a layer-4 assertion. |
| No weakened health gates, no switch that skips verification | **Held.** Layer 4 rejects a `SkipChecksum`/`SkipVerify`/`NoVerify` switch and requires the empty-manifest refusal to exist. |
| `run-backend-production.ps1` behaviour unchanged | **Held.** Its diff is empty. |

## 7. Gauntlet layers

| Layer | Covers | Result |
| --- | --- | --- |
| 1 | PowerShell AST parse of six scripts; `ci.yml` job/schema assertions | PASS |
| 2 | `deploy-backend.ps1 -SelfTest`: 23 refusal-path assertions | PASS |
| 3 | Local reproduction of the CI build recipe, packaging, checksum round-trip, standalone `migrate.exe` | PASS |
| 4 | Architecture invariants (runner untouched, delegation, no rollback, no 8787, no optional verification, no secrets) | PASS |
| 5 | `go vet ./...` and `go test ./...` | PASS |
| 6 | Live local API run: real services, twelve probes | PASS |
| 7 | `git diff --check`, intended-file allowlist, no application source changed | PASS |

Mutation control: three deliberate regressions were introduced one at a time and each was observed
failing the gauntlet before being restored — the checksum verifier accepting an empty manifest, the
dirty-migration gate inverted, and the foreign-listener refusal removed. Two further self-inflicted
failures found during development are worth recording because they prove the layers bite: layer 4
initially failed on the gauntlet's own message text containing `migrate down`, and again on the
deploy script naming port `8787` inside the assertion that keeps it out. Both checks were tightened
to match an actual invocation or assignment rather than any mention.

## 8. Explicitly not verified

- **The GitHub Actions run.** No `gh` CLI and no repository token were available. `backend-artifact`
  has never executed; the artifact upload and the tag-triggered release upload are unproven. Please
  confirm the first run after this is pushed.
- **A real deploy on the production host.** No access. Artifact download via `gh`, the swap against
  live services, the MT5 terminal and sidecar startup, the production migration, and the public
  health gate at `https://api.tradingterminal.io.vn` were never executed.
- **The rollback path executing** (Scenario 5), for the same reason.
- **Rust compilation on `windows-latest`.** Only the local `cargo build --release` was run.
- **`gh run download` / `gh release download` behaviour** against the actual repository, whose
  visibility and token setup are unknown here.
