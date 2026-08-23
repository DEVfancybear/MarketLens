# SPEC - Backend documentation refresh (Tier 2)

Status: approved, including Revision 1.

## Objective

Audit the active backend documentation against the current repository source, replace obsolete
runtime guidance, add a rerunnable documentation gate, then commit and push only the files owned by
this task.

## Source of truth and discovery

- Repository root: `C:\Users\duong\Downloads\tradingview`.
- `codebase-memory-mcp` is unavailable in this agent session. The documented fallback is in use:
  `docs/CODEBASE_MEMORY.md`, current source files, route registrars, migrations, environment
  examples, build/deploy scripts, and package READMEs are authoritative.
- The worktree already contains many unrelated modified and untracked files. They must remain
  untouched and unstaged unless a file is explicitly listed as task-owned below.

## Documentation scope

Audit every Markdown file below, updating only where source comparison finds stale or incomplete
guidance:

- `backend/docs/*.md` (all eight canonical backend documents).
- `backend/README.md`.
- `backend/execution/README.md`.
- `backend/bridge/mt5_ea/README.md`.
- `backend/bridge/mt5_session/README.md`.
- `backend/bridge/mt5_stream/README.md`.
- `backend/bridge/mt5_vm/README.md`.
- Active cross-package backend runbooks linked by those documents under `docs/` (architecture,
  operations, production security, and current MT5 execution/worker runbooks). Historical plans,
  fixtures, release notes, and prior `docs/agent-evidence/**` records are review inputs but will not
  be rewritten merely to erase historical facts.

Expected task-created files:

- `tools/verify-backend-docs.ps1` - one fail-closed, rerunnable documentation gauntlet entry point.
- `docs/agent-evidence/backend-docs-refresh/EVIDENCE.md` - final fresh-run evidence.
- This SPEC.

## Acceptance criteria

1. **Runtime architecture is current**
   - Active docs describe Go API/BFF, Rust execution gateway/admin listeners, common MT5 EA,
     managed MT5 worker/agent, Vault boundary, PostgreSQL, and the private read-only MT5 stream.
   - Removed FTMO Connector, `mt5verify`, `bridge/ftmo_mt5`, browser-local port `8787`, and stored
     broker-password flows are never presented as current runtime guidance.

2. **Production commands are exact**
   - Normal source build/run is documented as `./run-backend-production.ps1` from the repository
     root with no normal-case switches.
   - CI-artifact deployment is documented as `./tools/deploy-backend.ps1`, including checksum,
     commit-match, forward migration, delegated restart, and binary-only rollback semantics.
   - Recovery switches are not promoted as ordinary operation.

3. **API reference matches registered routes**
   - The active route catalog is rebuilt from current Go route registration and the Rust EA/admin
     boundary.
   - Removed endpoints are absent from the active catalog; planned/disabled surfaces are explicitly
     marked and cannot be mistaken for implemented routes.
   - Authentication, ownership, listener exposure, and error conventions are stated at the route
     group level.

4. **Configuration reference matches source**
   - Required/default/optional variables are reconciled with `backend/internal/config/config.go`,
     `backend/.env.example`, the Rust gateway configuration, and canonical runner/deploy scripts.
   - Secrets are represented only by placeholders or file-based contracts; no credential value is
     copied into documentation.

5. **Database reference matches migrations**
   - The migration head is the highest checked-in migration (currently `0042` in the audited
     worktree), and the migration ledger covers the active schema domains through that head.
   - PostgreSQL/Vault ownership, forward-only production migration behavior, tenant scoping,
     idempotency, lifecycle state, and credential-removal invariants are accurate.

6. **Auth and security guidance matches implementation**
   - Firebase/Google session establishment, access/refresh cookies, rotation/replay behavior,
     Origin/CSRF policy, trusted-proxy behavior, and service/admin boundaries match current source
     and tests.

7. **Navigation and historical status are unambiguous**
   - `backend/docs/README.md` is a useful canonical index.
   - Superseded plans are either rewritten as current status/remaining work or clearly labeled
     historical with a link to current guidance.
   - All relative Markdown links in the audited active set resolve.

8. **Rerunnable gate fails closed**
   - `tools/verify-backend-docs.ps1` validates the active-document set, required current facts,
     forbidden legacy-current guidance, migration head, production entrypoints, and relative links.
   - A self-test/negative control proves the custom checker exits nonzero for a known-bad fixture.
   - The final clean input exits zero and prints counted results.

## Negative constraints

- Do not change application code, migrations, runtime configuration, dependencies, generated
  binaries, release artifacts, or secrets.
- Do not stage or commit pre-existing unrelated worktree changes.
- Do not rewrite historical evidence as if old events never occurred; distinguish history from
  active guidance.
- Do not run production, deploy, migrate a real database, install packages, or alter external
  services.
- Do not weaken checker assertions after observing failures. If a source/doc inconsistency requires
  a different contract, append a visible SPEC revision and obtain approval again.

## RED -> GREEN -> REFACTOR

1. RED: add the documentation gate first and run its negative control; then run it against the
   current stale docs and retain the failure output for every exercised stale contract.
2. GREEN: update documentation only until the frozen gate passes.
3. REFACTOR: remove duplication, tighten navigation, and rerun the gate without changing its
   assertions.

No application behavior is changed, so unit-test mutation and changed-line code coverage are not
applicable. The documentation checker itself receives a negative control.

## Verification gauntlet

The single final entry point will be:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-backend-docs.ps1
```

It will run or orchestrate:

- checker self-test/negative control;
- active Markdown link and legacy-guidance checks;
- migration-head and production-command consistency checks;
- route/config documentation consistency checks that can be derived reliably from source;
- targeted existing Go tests for route/config/auth contracts;
- formatting/whitespace and secret-pattern review of the task diff.

If a full backend suite is practical in the current dirty worktree, it will also be run and
reported. Any pre-existing failure will be recorded verbatim as baseline; zero new failures is the
required invariant. Rust/Python tests are skipped unless the edited documentation asserts a
contract not already exercised by the targeted source tests, because this task changes no runtime
code.

## Dependencies, tools, generated files, and environment changes

- New dependencies: none.
- Existing tools only: PowerShell, Git, ripgrep, Go test tooling already declared by the repository.
- Generated files: none. The checker and evidence report are maintained source files.
- Environment changes: test/build caches may be refreshed by existing tools; no package install.

## Git and push plan

1. Record the starting branch/HEAD and fetch remote state without modifying the worktree.
2. Stage only task-owned documentation, the checker, SPEC, and EVIDENCE; inspect the staged diff and
   staged path list before committing.
3. Create one documentation commit on `master` after the final gauntlet passes.
4. Push that commit to `origin/master` only if it is a fast-forward. Do not stash, reset, rebase,
   force-push, or include unrelated existing changes. If remote divergence prevents a safe push,
   stop and report the blocker.

## Evidence deliverable

`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\backend-docs-refresh\EVIDENCE.md`
will map every acceptance criterion and negative constraint to the final fresh run, list exact
commands/counts, identify the committed source state, and disclose every skipped or blocked layer.

## Revision 1 - source/commit consistency (approved)

Discovery after the initial approval: migration `0042_mt5_managed_ea_bootstrap` is untracked and the
EA `1.26` plus its managed-worker/Go/Rust/frontend integration are part of a large pre-existing
uncommitted change set. `HEAD` and `origin/master` are both
`5a61554c2255d18e0162c6dd9b71e8244ec6eb4a`, which does not contain that implementation.

The approved docs-only commit rule would therefore push documentation that claims migration head
`0042`, EA minimum `1.26`, and managed-EA behavior while the remote source remains older. That
violates the source-of-truth and commit-consistency acceptance criteria.

Proposed change to the SPEC:

- Expand the commit scope to the coherent managed-MT5 implementation already present in the
  worktree (migration `0042`, Go/Rust/Python/EA/frontend integration, production tooling, tests,
  active runbooks, release artifact, and their existing evidence).
- Preserve unrelated changes after classifying every dirty path; do not blindly stage the entire
  worktree.
- Treat the expanded source change as Tier 3 because it touches credentials, trade execution,
  process lifecycle, migrations, and deployment. Reuse only existing evidence that can be rerun;
  execute one fresh complete gauntlet and block commit/push on failure.
- Update the final EVIDENCE mapping and staged-path audit to cover both implementation and docs.

Approval: obtained from the user in chat on 2026-08-23 (`phê duyệt`). No source changes had been
staged or committed before approval.
