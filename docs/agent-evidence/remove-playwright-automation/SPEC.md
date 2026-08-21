# SPEC — Remove the playwright-automation agent requirement

- Tier: old-coder Tier 1 (repository agent-policy documentation and its fail-closed verifier)
- Requested outcome: remove the globally installed `playwright-automation` skill requirement from
  this project while preserving the mandatory codebase-memory and old-coder workflows.
- Starting source state: `bfadc28d62a6e5a0e2d64860d875ca791bf96f96` on local branch `master`.
- Spec approval: obtained from the user on 2026-08-21 with the exact response `Duyệt SPEC`.

## Acceptance scenarios

### Scenario 1 — The active repository policy no longer requires playwright-automation

Given a coding agent reads the root `AGENTS.md`,
when it determines which global skills and verification routes are mandatory,
then `AGENTS.md` contains no `playwright-automation` skill invocation, no mandatory Playwright
section, and no statement that Playwright is cumulative with codebase-memory and old-coder.

### Scenario 2 — Codebase-memory and old-coder remain mandatory

Given the Playwright-specific agent policy is removed,
when `AGENTS.md` is read after the change,
then the codebase-memory startup gate and the complete mandatory old-coder evidence-first workflow
remain active, including SPEC approval, RED -> GREEN -> REFACTOR where applicable, the calibrated
gauntlet, EVIDENCE, and delegation requirements.

### Scenario 3 — The policy verifier rejects a reintroduced Playwright requirement

Given `tools/verify-old-coder-policy.ps1` runs against the changed `AGENTS.md`,
when all required old-coder markers are present and all forbidden Playwright-policy markers are
absent,
then the verifier exits zero.

Given a known-bad policy fixture containing a forbidden `playwright-automation` marker,
when the verifier's self-test runs,
then it exits through the expected rejection path, proving the forbidden-marker checker can fail.

### Scenario 4 — Application and historical evidence are not rewritten

Given this request concerns the repository-level agent skill requirement,
when the change is complete,
then application code, CI workflows, Playwright packages/tests/configuration, dependencies,
lockfiles, production scripts, and prior `docs/agent-evidence/**` audit records remain unchanged,
apart from this new task's SPEC and EVIDENCE files.

## Negative constraints

- Do not remove or weaken the mandatory codebase-memory or old-coder policies.
- Do not remove Playwright runtime dependencies, application E2E tests, or CI jobs; those are not
  the named `playwright-automation` agent skill requirement.
- Do not rewrite historical SPEC/EVIDENCE files merely because they truthfully mention the policy
  that existed when those records were produced.
- Do not add dependencies, install tools, change lockfiles, or change production behavior.
- Do not commit or push; the user has not authorized either operation in this task.
- Do not claim completion if the policy verifier, its negative controls, or `git diff --check`
  fails.

## Planned files and tools

- Modify `AGENTS.md` to remove the Playwright-specific clauses and section.
- Modify `tools/verify-old-coder-policy.ps1` so it preserves required old-coder checks and rejects
  active Playwright skill-policy markers. Its normal mode will run the built-in positive and
  negative controls before validating the real `AGENTS.md`, making it the single rerunnable
  gauntlet entry point.
- Add `docs/agent-evidence/remove-playwright-automation/EVIDENCE.md` only after the final fresh run.
- Use only existing PowerShell, `rg`, and Git read-only/diff commands. New dependencies: none.
- Generated files: the SPEC and EVIDENCE Markdown files only. Git operations: inspection and diff
  only; no staging, commit, push, reset, checkout, or restore.

## RED -> GREEN plan

1. RED: update only the policy verifier with the forbidden-marker rule and run it against the
   unchanged `AGENTS.md`; record the expected failure caused by the existing active Playwright
   requirement.
2. GREEN: edit only `AGENTS.md` to remove the Playwright skill policy, then rerun the verifier and
   observe success.
3. REFACTOR: review wording and diff without changing the accepted behaviors; rerun the verifier
   after any cleanup.

## Final verification plan

Run after the last implementation edit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-old-coder-policy.ps1
rg -n "playwright-automation|Mandatory Playwright automation|mandatory Playwright route|Playwright requirements are cumulative" AGENTS.md
git diff --check -- AGENTS.md tools/verify-old-coder-policy.ps1 docs/agent-evidence/remove-playwright-automation
git status --short
```

The verifier must pass. The `rg` command must return exit code 1 with no matches (the only accepted
no-match result); exit code 0 means a forbidden active marker remains and exit code 2 or greater
means the check failed. `git diff --check` must pass, and `git status --short` must list only the
four intended paths: `AGENTS.md`, `tools/verify-old-coder-policy.ps1`, this SPEC, and its EVIDENCE.

Application tests, browser/API automation, coverage, mutation testing, property tests, and real
application execution are not applicable because no application, dependency, workflow, or runtime
behavior changes. The fail-closed PowerShell policy verifier and exact-string check directly cover
the changed policy surface.

## Approval requested

Please approve this exact SPEC before implementation. Approval authorizes only the four-file local
change and verification plan above; it does not authorize a commit or push.

## Approval record

- Approved by the user on 2026-08-21 with the exact response: `Duyệt SPEC`.
- No acceptance scenario, constraint, planned file, verification command, or authorization scope
  changed after approval.

## Revision 1 — Commit and push the verified change

- User request: `commit and push` on 2026-08-21.
- Authorization status: approved by the user on 2026-08-21 with the exact response
  `Duyệt SPEC Revision 1`.
- Scope change: authorize staging, committing, and pushing the same four approved paths; no
  application or dependency scope is added.

### Delivery plan

1. Update this SPEC and the task EVIDENCE so the audit record distinguishes the completed local
   implementation run from the subsequently authorized delivery operation.
2. Run `git fetch origin master` and require the fetched `origin/master` to equal the starting base
   commit `bfadc28d62a6e5a0e2d64860d875ca791bf96f96`. If it has advanced or diverged, stop and report
   the blocker instead of rebasing, merging, force-pushing, or changing the approved source scope.
3. Run the policy verifier and exact active-policy scan again, then stage only:

   - `AGENTS.md`
   - `tools/verify-old-coder-policy.ps1`
   - `docs/agent-evidence/remove-playwright-automation/SPEC.md`
   - `docs/agent-evidence/remove-playwright-automation/EVIDENCE.md`

4. Require `git diff --cached --check` to pass and `git diff --cached --name-only` to match the
   four-file allowlist exactly.
5. Commit once with message `docs: remove playwright automation agent policy`.
6. Push normally with `git push origin HEAD:master`; do not use force, force-with-lease, amend,
   reset, checkout, restore, or any destructive git command.
7. Verify that local `HEAD` and `refs/heads/master` reported by `git ls-remote origin` are identical
   and that the working tree is clean. The final response will report the exact commit SHA and push
   verification result.

### Revision 1 negative constraints

- Do not include any file outside the four-file allowlist in the commit.
- Do not proceed if the remote base changed, any verification fails, the staged allowlist differs,
  the push is rejected, or the post-push remote SHA does not equal local `HEAD`.
- Do not create a second commit merely to embed the first commit's SHA in EVIDENCE; Git history and
  the final response provide the delivery receipt without creating a self-referential hash cycle.

### Revision 1 approval requested

Approval of Revision 1 authorizes exactly the fetch, four-file stage, one commit, normal push to
`origin/master`, and post-push read-only verification described above.

### Revision 1 approval record

- Approved by the user on 2026-08-21 with the exact response: `Duyệt SPEC Revision 1`.
- No delivery command, file allowlist, commit message, branch, remote, or safety constraint changed
  after approval.

## Revision 2 — Fast-forward to the current remote base

- Discovery after Revision 1 approval: `git fetch origin master` resolved `origin/master` to
  `9ec4ba518f184e01c93ea8147289a3207a8d3415`, while local `HEAD` remained
  `bfadc28d62a6e5a0e2d64860d875ca791bf96f96`.
- Relationship: `git rev-list --left-right --count HEAD...origin/master` returned `0 2`; local
  `master` has no unique commit and is exactly two commits behind, not diverged.
- Remote commits: `75af72c perf(charts): coalesce lightweight charts viewport resizes` and
  `9ec4ba5 feat(mt5): add managed worker and phase gate evidence`.
- Conflict review: the remote two-commit file diff does not touch any of the four approved task
  paths.
- Authorization status: approved by the user on 2026-08-21 with the exact response
  `Duyệt SPEC Revision 2`.

### Revised delivery plan

1. Run `git merge --ff-only origin/master` before staging. This may advance tracked repository
   files to the already-fetched remote state, but must create no merge commit and must preserve the
   four local task changes.
2. Require local `HEAD` to equal `9ec4ba518f184e01c93ea8147289a3207a8d3415`, rerun the policy
   verifier and exact active-policy scan, and confirm the working tree still contains only the four
   approved task paths.
3. Continue Revision 1 steps 3–7 unchanged: stage only the four-file allowlist, check the staged
   diff and allowlist, create one commit with the approved message, push normally to
   `origin/master`, and verify remote/local SHA equality and a clean working tree.

### Revision 2 safety constraints

- Do not use rebase, autostash, merge commits, force, force-with-lease, reset, checkout, or restore.
- If `--ff-only` fails, the remote changes again, any local task path is lost or altered, or any
  verification fails, stop without staging, committing, or pushing.

### Revision 2 approval requested

Approval authorizes the single fast-forward base update and then the already approved four-file
commit/push workflow. All other Revision 1 scope and safety constraints remain unchanged.

### Revision 2 approval record

- Approved by the user on 2026-08-21 with the exact response: `Duyệt SPEC Revision 2`.
- No fast-forward command, target commit, file allowlist, commit message, branch, remote, or safety
  constraint changed after approval.
