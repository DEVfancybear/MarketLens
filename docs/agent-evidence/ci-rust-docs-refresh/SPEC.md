# SPEC — Rust CI disconnect race and documentation refresh

Status: autonomous execution requested; explicit SPEC approval not obtained (`không cần spec`)

Old Coder tier: Tier 2 — a flaky CI bug plus maintained documentation refresh; no production
runtime behavior or public API is intended to change.

Source state: `3dcf45d57bfababd213317993b6958237e023115`

## Observed failure

GitHub Actions run `32653200179` failed only in job `execution-rust`, step
`cargo test --locked --workspace --all-targets`. Test
`parallel_command_validation_and_received_ack_fail_closed_before_runtime` panicked because the
scripted test HTTP server unwrapped a `BrokenPipe` while writing a response after the client had
already rejected an oversized/malformed payload and closed its socket. The same Rust source and CI
workflow passed at commit `f4e48a0`, establishing a nondeterministic test-harness race rather than a
documentation-commit compiler regression.

## Executable behaviors

### B1 — expected early disconnects do not panic the scripted server

Given the scripted test server has captured a complete request, when writing or flushing its
response returns `BrokenPipe`, `ConnectionReset`, or `ConnectionAborted`, then the helper treats the
peer disconnect as an expected completed interaction and the server thread joins successfully.

### B2 — unrelated I/O failures remain visible

Given response writing or flushing returns any other I/O error, then the helper returns that error
and the scripted server continues to fail closed instead of hiding a broken test harness.

### B3 — response contract remains unchanged

Given a healthy writer, then the helper writes the same HTTP status line, JSON content type, exact
content length, `Connection: close`, body bytes, and flush operation used by the existing tests.

### B4 — original CI regression stays stable

The original failing test must pass repeatedly in a persisted stress command, and the exact CI
command `cargo test --locked --workspace --all-targets` must pass from `backend/execution`.

### B5 — root documentation identifies current guidance

`docs/README.md` must classify maintained operational/current documents separately from design
references, phase records, fixtures, and immutable `agent-evidence`. `CURRENT_STATE.md`,
`CURRENT_PROGRESS.md`, `HANDOFF.md`, `NEXT_TASKS.md`, `KNOWN_ISSUES.md`, and
`PROJECT_STRUCTURE.md` must describe the current MarketLens monorepo, production entrypoints,
Go/Rust managed execution boundary, canonical GitHub repository, and remaining work without
presenting deleted FTMO/browser-connector paths as current.

### B6 — frontend documentation index matches the repository

`frontend/docs/README.md` must link to files that exist, separate maintained architecture/contracts
from historical plans/audits, remove deleted MT5 bridge document names, and direct execution
operations to the maintained root architecture/runbooks. Historical files and completed evidence
must not be rewritten to make old results look current.

### B7 — reproducible fail-closed verification

One PowerShell entry point must run the Rust regression/stress/full-workspace checks, formatting,
lint/static checks, documentation invariants, diff/secret hygiene, and exit nonzero on any failed or
unreadable layer. Its documentation checker must be observed failing against a deliberate stale
fixture before its passing result is trusted.

## Negative invariants

- Do not change production Rust, Go, TypeScript, database, API, authentication, deployment, or
  trading behavior.
- Do not retry the CI job as the fix and do not weaken/remove the failing test.
- Do not broadly ignore I/O errors; only the three peer-disconnect kinds in B1 are acceptable.
- Do not edit archived frontend reports or prior `agent-evidence` results.
- Do not restore Playwright automation policy or run Playwright for this non-UI change.
- Do not add package dependencies, Actions, services, credentials, or secrets.
- Do not commit `.tmp-tencentdb-agent-memory/` or unrelated generated output.

## Planned files

Create:

- `docs/agent-evidence/ci-rust-docs-refresh/SPEC.md`
- `docs/agent-evidence/ci-rust-docs-refresh/EVIDENCE.md`
- `tools/verify-ci-rust-docs-refresh.ps1`
- `tools/verify-ci-rust-scripted-server-mutations.ps1`

Modify:

- `backend/execution/crates/mt5-vm-agent/tests/managed_commands.rs`
- `docs/README.md`
- `docs/CURRENT_STATE.md`
- `docs/CURRENT_PROGRESS.md`
- `docs/HANDOFF.md`
- `docs/NEXT_TASKS.md`
- `docs/KNOWN_ISSUES.md`
- `docs/PROJECT_STRUCTURE.md`
- `docs/CODEBASE_MEMORY.md`
- `frontend/docs/README.md`
- `.codebase-memory/artifact.json` and `.codebase-memory/graph.db.zst` only as a generated final
  graph refresh

## Tools, dependencies, and git operations

- Existing PowerShell, Git, Rust/Cargo, codebase-memory-mcp v0.10.8, and GitHub REST access through
  the already configured Git credential.
- No new dependency or tool installation.
- RED: retain the GitHub failure above, then add deterministic helper tests against an intentionally
  unimplemented helper and observe failure before implementation.
- GREEN/REFACTOR: implement the smallest error classifier/writer helper, integrate it into
  `serve_scripted`, freeze assertions, then format.
- Gauntlet commands are persisted under `tools/`; applicable layers are targeted tests, repeated
  regression, full workspace tests, `cargo fmt`, `cargo check`, `cargo clippy`, manual mutation,
  documentation checker negative control, source diff/secret review, and codebase coverage/status.
  Changed-line coverage and property testing will be recorded as skipped if the existing toolchain
  has no applicable runner for private integration-test harness code.
- Stage only the planned paths, create one commit `fix(ci): tolerate scripted client disconnects`,
  push `master`, monitor the resulting GitHub Actions run to completion, and treat any failed job as
  blocking completion.

## Amendment 1 — audit discoveries (2026-08-24)

The audit found a stale dependency statement in `frontend/README.md` (Lightweight Charts 4.2.3
instead of the locked 5.2.0, plus imprecise framework versions), so that file is added to the
planned modifications. The local `origin` still uses the repository's redirected former URL;
updating it to `https://github.com/DEVfancybear/MarketLens.git` is added as a reversible local Git
configuration operation before the final push. This amendment also proceeds autonomously without
explicit SPEC approval, consistent with the user's instruction not to pause for SPEC review.

## Amendment 2 — historical link repair (2026-08-24)

The repository-wide relative-link audit found one broken link in `docs/CHANGELOG.md` to the retired
`frontend/docs/MT5_POSITION_SIZING.md`. `docs/CHANGELOG.md` is added to the planned files only to
convert that dead hyperlink into an explicit historical filename and current-architecture pointer;
the dated changelog claim itself remains unchanged.

## Amendment 3 — execution-gateway environment race (2026-08-24)

The first full-workspace gauntlet exposed another pre-existing CI/suite race in
`backend/execution/crates/execution-gateway/src/main.rs`. Two tests mutate the same process-wide
`EXECUTION_*` variables concurrently. Running only those two with two test threads failed on the
first RED iteration because one test removed/replaced configuration during the other's collision
assertions. Add this test module file to planned modifications and add behavior B8: both environment
mutating tests must hold one test-only mutex, retain all existing assertions, and pass 50 consecutive
two-thread pair runs. No production code path may acquire the test lock.

## Amendment 4 — platform-calibrated full suite (2026-08-24)

The original B4 wording assumed the Linux CI command could run unchanged on a Windows worktree.
That is false for the existing platform-native MT5 library tests: the workflow deliberately runs
Linux `--workspace --all-targets` in `execution-rust` and Windows
`-p mt5-vm-agent --lib -- --test-threads=1` in `backend-artifact`. A parallel Windows all-targets
run reproduced four fixture/artifact collisions that disappear under the repository's documented
single-thread Windows gate. The local gauntlet will therefore run all targets single-threaded plus
the exact Windows managed-agent command; the post-push GitHub run remains the required evidence for
the exact parallel Linux command. This is a platform correction, not a test skip or assertion
change.

## Amendment 5 — final graph snapshot and commit description (2026-08-24)

The final graph refresh changed the verified node, edge, partial-parse, and artifact-size values, so
`docs/CODEBASE_MEMORY.md` is added to the maintained documentation scope. Its recovery ladder is
also validated by a real post-compaction MCP `Transport closed` result followed by a successful CLI
`list_projects` and `index_status`. The single commit message is updated to
`fix(ci): stabilize Rust tests and refresh docs` so the public history describes both requested
outcomes. This amendment remains autonomous under the user's instruction not to pause for SPEC
review.
