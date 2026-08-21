# Evidence Report — Remove the playwright-automation agent requirement (Tier 1)

- Spec approval: obtained from the user on 2026-08-21 with the exact response `Duyệt SPEC`.
- Source state: base commit `9ec4ba518f184e01c93ea8147289a3207a8d3415` plus the four intended
  working-tree paths listed below; policy verifier source-state SHA-256
  `043d782e1ce795acb44bab1915088471c5118470f395bf5cb3a72c017d8a5d17`.
- Toolchain: Windows PowerShell 5.1, built-in PowerShell cmdlets, ripgrep, and Git; no dependency
  was installed or changed.
- Entry point: `powershell -NoProfile -ExecutionPolicy Bypass -File
  .\tools\verify-old-coder-policy.ps1`.
- Independent verification: not performed; Tier 1 policy documentation does not warrant the
  experimental Tier 3 verifier protocol.

## Spec → test mapping

| Scenario or invariant | Verification | Status |
|---|---|---|
| Active repository policy no longer requires `playwright-automation` | Normal verifier checks four forbidden markers; exact `rg` check returns no matches | pass |
| Codebase-memory and old-coder remain mandatory | Normal verifier reports all 7 required policy markers present | pass |
| Reintroduced Playwright policy is rejected | Built-in known-bad forbidden-marker negative control | pass |
| Missing old-coder policy remains rejected | Built-in known-bad missing-marker negative control | pass |
| Application, CI, Playwright runtime, dependencies, and historical records remain unchanged | `git status --short --untracked-files=all` four-path allowlist and diff review | pass |
| Initial implementation must not commit or push without separate approval | No staging, commit, or push command was run before Revision 1 approval | pass |

## Gauntlet — final fresh run

| Layer | Command | Result |
|---|---|---|
| Policy controls and real policy verification | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-old-coder-policy.ps1` | exit 0; known-good accepted; missing-marker and forbidden-marker negative controls rejected as expected; 7/7 required markers present; 4/4 forbidden markers absent; installed old-coder files present |
| Exact active-policy scan | `rg -n "playwright-automation\|Mandatory Playwright automation\|mandatory Playwright route\|Playwright requirements are cumulative" AGENTS.md` | exit 1 with no output, the expected no-match result |
| Whitespace/error check | `git diff --check -- AGENTS.md tools/verify-old-coder-policy.ps1 docs/agent-evidence/remove-playwright-automation` | exit 0; no errors |
| Scope allowlist | `git status --short --untracked-files=all` | exactly 4 intended paths: `AGENTS.md`, `tools/verify-old-coder-policy.ps1`, task `SPEC.md`, task `EVIDENCE.md` |
| Dependencies and capabilities | Diff review | no dependency, lockfile, application, CI workflow, network, subprocess, filesystem, environment, or production capability change |

## Skipped layers

- Application/browser/API tests: not applicable; application and Playwright runtime behavior are
  unchanged.
- Static types, application lint, coverage, mutation, property-based tests, and real application
  execution: not applicable to the Markdown agent policy and its small PowerShell exact-marker
  verifier. The verifier's positive and negative controls directly exercise the changed behavior.
- Playwright automation: intentionally removed from the active agent policy by this task; no UI,
  API, or CI runtime behavior changed.
- Supply-chain audit: no dependency or lockfile changed.
- Suite randomization: the deterministic marker checks have no order-dependent shared state.

## Honest notes

- `codebase-memory-mcp` was unavailable both as an MCP tool and as a local CLI command. The mandated
  fallback was used: `docs/CODEBASE_MEMORY.md` was read, followed by exact-string discovery and
  direct reads of every changed source file.
- RED was observed before the policy edit: the new verifier exited 1 and reported all four active
  forbidden Playwright markers in the unchanged `AGENTS.md`.
- The first two GREEN attempts exposed required-marker strings split across Markdown line breaks.
  Wording was reflowed without changing the approved behavior; the verifier then passed.
- Prior `docs/agent-evidence/**` files still contain truthful historical mentions of Playwright.
  They are audit records, not active repository instructions, and were deliberately preserved.
- Git emitted only line-ending advisory warnings during diff inspection; `git diff --check` passed.
- No files were staged, committed, or pushed during the initial implementation run. Revision 1 was
  subsequently approved with the exact response `Duyệt SPEC Revision 1`, authorizing one four-file
  commit and a normal push to `origin/master`.
- Revision 2 was approved with the exact response `Duyệt SPEC Revision 2`. Local `master` was
  advanced from `bfadc28d62a6e5a0e2d64860d875ca791bf96f96` to the fetched remote base
  `9ec4ba518f184e01c93ea8147289a3207a8d3415` using `git merge --ff-only origin/master`; the command
  created no merge commit, and the four-path task allowlist remained intact.
- The delivery commit SHA and remote verification are recorded by Git history and the final user
  response rather than embedded here, avoiding a self-referential commit-hash cycle.
- No files were deleted, restored, or overwritten outside the four-file approved scope.
