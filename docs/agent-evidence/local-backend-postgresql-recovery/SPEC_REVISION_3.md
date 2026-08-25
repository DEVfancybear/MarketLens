# SPEC revision v3 — Blocked server-handoff commit and push

## Status and relationship to earlier approvals

- Parent specifications:
  - `local-backend-postgresql-recovery v1`, SHA-256
    `468A2B09F3D611CBFDE5BE98DEB34BD0C7827C786BDD54D80F7BE85E1D031776`;
  - `local-backend-postgresql-recovery v2`, SHA-256
    `65FBBB365810CC661F96793FF30FC2E0A26DF7E390614E6D23176F8D86C2F584`.
- Old-coder tier remains **Tier 3**.
- Approval status: **not yet approved**. The user's request to update documentation, commit, and
  push establishes the requested delivery outcome, but does not approve this exact revision.
- Required approval token: `APPROVE SPEC: local-backend-postgresql-recovery v3`.
- This revision supersedes only the v1/v2 prohibition on task-owned documentation/Git delivery and
  explicitly permits delivery with the already reported Application Control blocker. It does not
  weaken any database, credential, secret, production, or verification assertion.

## Accepted blocked state

Approval explicitly accepts a **blocked handoff**, not task completion:

- PostgreSQL recovery/configuration checks are green: database inventory is exactly `postgres`,
  `smc`, `template1`; `smc` is owned by `postgres`; migration state is `42,false`; nine required
  tables are present; `.env` has the approved endpoint-only hash; ACL has exactly three approved
  identities; password/HBA gauntlet is `21/21`; targeted Go test and vet pass; retained-secret and
  dirty-worktree checks pass.
- The latest recovery entry point is `19/22`. Source-runner contract/static mutants pass `4/4`, but
  real API execution is blocked before the 12 probes because Windows Application Control policy
  `{0283ac0f-fff1-49ae-ada1-8a933130cad6}` rejects unsigned Cargo build-script executables with
  Code Integrity events `3033`/`3077` and OS error `4551`.
- `EVIDENCE.md` remains intentionally absent because v2 permits final EVIDENCE only after real API
  execution is green. The two other failed checks are consequences of that absence.
- No API/gateway/build process or listener remains on ports 8080, 8790, or 8791.

The commit message, handoff document, CI report, and final response must use `BLOCKED`, not `PASS`,
`complete`, `production-ready`, or equivalent language for the recovery task.

## Scenario 1 — Write a server handoff without leaking local state

Given the local database/password/ACL work is host state and not Git content,
when delivery documentation is added,
then `docs/agent-evidence/local-backend-postgresql-recovery/SERVER_HANDOFF.md` must record:

- the exact verified local outcomes and the exact WDAC blocker;
- that the local `.env`, password, ACL, PostgreSQL database, build cache, and runtime logs are not
  shipped;
- that `tools/verify-local-backend-postgresql-recovery.ps1` is host-specific and is not a portable
  production-server gauntlet;
- the portable verifier added by v2 and its offline source mode;
- the canonical production boundaries from `AGENTS.md`: `run-backend-production.ps1` for an
  explicit source build/run request and `tools/deploy-backend.ps1` for an explicit CI-artifact
  deployment request;
- that this agent will not invoke either production command in this delivery task;
- how the server operator can verify the fetched commit, inspect CI, and report a sanitized result
  without sending credentials.

The document must not contain a password, URL userinfo, SCRAM verifier, token, private key, local
`.env` content, or a claim that the 12 probes passed.

## Scenario 2 — Make source-state validation commit-aware without weakening scope

Given the recovery verifier currently binds the pre-delivery HEAD
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`,
when task files are committed,
then its source-state check must:

- require that exact approved base commit to be an ancestor of current `HEAD`;
- permit committed changes after the base only in the explicit task-owned allowlist below;
- reject any unexpected committed path after the approved base;
- continue requiring the same Go/PowerShell toolchains and all host-state invariants;
- bind this revision by exact hash and approval token and include it plus `SERVER_HANDOFF.md` in
  whitespace, secret, and status checks.

This avoids a self-referential final-commit hash while preventing unrelated committed work from
being silently covered by the recovery report.

## Scenario 3 — Stage and commit only task-owned paths

Given the worktree contains unrelated modified and untracked MT5 work,
when the delivery commit is created,
then the index must contain only:

1. `tools/verify-backend-local.ps1`;
2. `tools/verify-local-backend-postgresql-recovery.ps1`;
3. `tools/verify-local-postgresql-password-rotation.ps1`;
4. `docs/agent-evidence/local-backend-postgresql-recovery/SPEC.md`;
5. `docs/agent-evidence/local-backend-postgresql-recovery/SPEC_REVISION_2.md`;
6. `docs/agent-evidence/local-backend-postgresql-recovery/SPEC_REVISION_3.md`;
7. `docs/agent-evidence/local-backend-postgresql-recovery/SERVER_HANDOFF.md`;
8. `docs/agent-evidence/local-postgresql-password-rotation/SPEC.md`;
9. `docs/agent-evidence/local-postgresql-password-rotation/EVIDENCE.md`.

Before commit, `git diff --cached --name-only` must equal that allowlist, staged content must pass
`git diff --cached --check`, PowerShell parsing, task-secret scan, and the applicable component
checks. All 15 unrelated dirty-file hashes frozen by the verifier must remain exact.

The commit message will be:

```text
chore: hand off blocked local PostgreSQL recovery
```

## Scenario 4 — Push without rewriting shared history

Given local `master`, upstream `origin/master`, and remote `refs/heads/master` all start at
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`,
when delivery is pushed,
then the agent must:

- use a normal non-force push of the one narrow commit to `origin/master`;
- abort instead of pulling, rebasing, merging, force-pushing, or overwriting if the remote moved;
- verify `git ls-remote origin refs/heads/master` equals the new local commit;
- verify unrelated working-tree changes remain present after commit/push.

No tag, release, PR, production runner, deployer, migration, service restart, or public endpoint is
authorized.

## Scenario 5 — Observe actual CI conclusion

Given `.github/workflows/ci.yml` runs on every push,
when the commit reaches `origin/master`,
then the agent must locate the exact GitHub Actions run for the pushed SHA and wait for its terminal
conclusion. It must report the individual conclusions for:

- `replay-client-boundary`;
- `backend`;
- `execution-rust`;
- `backend-artifact`.

A failed/cancelled/timed-out CI run remains a delivery blocker and must be reported verbatim. The
agent may fix only a failure caused by the nine task-owned paths, with the same narrow staging and
verification rules; unrelated CI failures are reported without scope expansion.

## RED → GREEN → blocked delivery loop

1. Retain the observed v3 RED: `SERVER_HANDOFF.md` and revision binding are absent, while the main
   recovery entry point remains blocked at `19/22` by enforced WDAC.
2. Add handoff assertions/source-state allowlisting to the recovery verifier and observe their RED
   before writing `SERVER_HANDOFF.md` or commit-aware implementation.
3. Add the minimal implementation/documentation, run parser/static/component checks, and rerun the
   recovery entry point. It must still fail rather than conceal the exact WDAC/EVIDENCE blocker.
4. Approval of this revision is explicit acceptance of that exact reported failure for the sole
   purpose of creating a server-handoff commit and push, satisfying the repository exception that
   a failing gauntlet blocks commit/push unless the user accepts the blocker.
5. Review/stage the exact allowlist, commit once, push without force, verify remote SHA, and wait for
   terminal CI.

## Negative constraints

The delivery must **not**:

- create a final recovery `EVIDENCE.md`, claim 12/12 API probes, or relabel BLOCKED as passing;
- commit `backend/.env`, any password/token/key, PostgreSQL data, runtime log, Cargo/Go cache,
  executable, migration output, or generated credential file;
- change application Go/Rust source, migrations, auth, trading behavior, dependency manifests,
  lockfiles, production scripts, or CI configuration;
- stage, commit, overwrite, restore, clean, or otherwise touch unrelated dirty work;
- disable/bypass WDAC, sign/unblock/copy executables, or invoke a production build/deploy/run;
- pull, merge, rebase, force-push, amend, tag, release, or push more than the one task commit;
- print or persist GitHub credentials; GitHub CLI may use its existing keyring authentication only.

## Commands, dependencies, and completion boundary

- Existing tools only: PowerShell 5.1 parser, Git, GitHub CLI, Go targeted test/vet, current
  PostgreSQL/password verifiers, task-owned diff/secret checks, and GitHub Actions observation.
- New dependencies, services, credentials, artifacts, and production mutations: **none**.
- Git operations after approval: explicit `git add -- <nine paths>`, one `git commit`, one normal
  `git push origin master`, read-only remote/CI verification.
- Delivery completion means the blocked handoff commit is on `origin/master`, remote SHA matches,
  CI terminal conclusions are reported, and unrelated work remains untouched.
- Recovery completion remains blocked until a later approved run executes all 12 API probes and
  produces final EVIDENCE.
