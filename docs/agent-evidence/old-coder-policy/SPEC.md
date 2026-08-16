# SPEC — Enforce old-coder for all Tradingview coding agents

- Tier: old-coder Tier 1 (documentation and agent-policy configuration)
- Requested outcome: document the mandatory old-coder workflow, verify it, commit only the
  intended policy artifacts, and push the commit to `origin/master`.
- Starting source state: `ca3ccb117a473cdf1344b479a0572b764b21d531`
- Spec approval: pending

## Acceptance scenarios

### Scenario 1 — Every coding agent is required to use old-coder

Given a coding agent or subagent works in this repository,
when it reads the root `AGENTS.md`,
then it is explicitly required to invoke the globally installed `old-coder` skill for every code
or code-adjacent configuration change, regardless of the skill's default trigger description.

### Scenario 2 — The evidence-first gates are explicit

Given an agent is preparing a code-affecting change,
when it follows the mandatory old-coder section,
then it must read the skill and relevant references, classify the tier, write and obtain approval
for SPEC, use RED -> GREEN -> REFACTOR for behavioral work, run the calibrated gauntlet, and write
EVIDENCE from a final fresh run.

### Scenario 3 — Existing repository gates remain cumulative

Given codebase-memory and Playwright requirements already exist,
when old-coder is applied,
then `AGENTS.md` states that codebase-memory governs discovery, old-coder governs
specification/TDD/evidence, and Playwright governs executable UI/API/debug verification.

### Scenario 4 — The policy has a rerunnable fail-closed verifier

Given the committed repository state,
when `powershell -NoProfile -File .\tools\verify-old-coder-policy.ps1` runs,
then it exits zero only if the required policy markers and installed skill files are present.

Given a known-bad AGENTS fixture that omits a required marker,
when the verifier self-test runs,
then the fixture is rejected, proving the checker's failure path is reachable.

### Scenario 5 — Commit and push contain only intended files

Given unrelated working-tree changes exist,
when the policy is committed and pushed,
then the commit contains only:

- `AGENTS.md`
- `docs/agent-evidence/old-coder-policy/SPEC.md`
- `docs/agent-evidence/old-coder-policy/EVIDENCE.md`
- `tools/verify-old-coder-policy.ps1`

and the commit is pushed from local `master` to `origin/master`.

## Negative constraints

- Do not stage, modify intentionally, restore, delete, or commit `.codebase-memory/artifact.json`,
  `.codebase-memory/graph.db.zst`, `.tmp-tencentdb-agent-memory/`, or any other unrelated change.
- Do not change application behavior, production runtime, dependencies, lockfiles, APIs, tests, or
  Playwright configuration.
- Do not claim Playwright coverage for a Markdown/agent-policy-only change.
- Do not commit or push if the verifier, self-test, diff check, or staged-file allowlist fails.
- Do not force-push.

## Setup and implementation plan

1. Keep the already prepared `AGENTS.md` old-coder section, editing it only if verification reveals
   a mismatch with this SPEC.
2. Add `tools/verify-old-coder-policy.ps1` with a normal verification mode and a known-bad
   self-test mode. Use only built-in PowerShell; add no dependency.
3. Add `docs/agent-evidence/old-coder-policy/EVIDENCE.md` after all final checks pass.
4. Stage only the four allowlisted files above.
5. Commit with message `docs: require old-coder workflow for agents`.
6. Push normally to `origin/master`.

## Verification plan

The final fresh verification will run after the last pre-commit edit:

```powershell
powershell -NoProfile -File .\tools\verify-old-coder-policy.ps1 -SelfTest
powershell -NoProfile -File .\tools\verify-old-coder-policy.ps1
git diff --check -- AGENTS.md docs/agent-evidence/old-coder-policy tools/verify-old-coder-policy.ps1
git diff --cached --check
git diff --cached --name-only
```

The staged-name output must match the four-file allowlist exactly. After commit, inspect the commit
file list and push result. Playwright, application tests, coverage, mutation testing, property
tests, and real application execution are not applicable because no application or test behavior
changes; the PowerShell verifier and git checks cover the changed policy artifacts directly.

## Authorization requested

Approval of this exact SPEC authorizes creation of the verifier and EVIDENCE files, staging only
the allowlisted files, creating the stated commit on `master`, and pushing it normally to
`origin/master`.

## Approval record

- Approved by the user on 2026-08-16 with the exact response: `Duyệt spec`.
- No scenarios, constraints, setup steps, verification commands, commit scope, or push target were
  changed after approval.

## Revision 1 — Windows PowerShell execution policy

- Discovery: the first approved verifier command was blocked before script execution with
  `PSSecurityException: running scripts is disabled on this system`.
- Command change: replace each invocation of
  `powershell -NoProfile -File .\tools\verify-old-coder-policy.ps1` with
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-old-coder-policy.ps1`.
- Scope: `Bypass` applies only to the spawned verification process. No machine, user, registry, or
  persistent PowerShell execution-policy setting will be changed.
- Everything else in this SPEC, including the four-file commit allowlist, commit message, branch,
  remote, negative constraints, and push method, remains unchanged.
- Revised-spec approval: pending.

### Revision 1 approval record

- Approved by the user on 2026-08-16 with the exact response: `Duyệt SPEC Revision 1`.
- No further change to the approved scenarios, constraints, file allowlist, commit, or push plan.
