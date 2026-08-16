# Evidence Report — Mandatory old-coder agent policy (Tier 1)

- Final SPEC approval: obtained from the user on 2026-08-16 with the exact response
  `Duyệt SPEC Revision 1`.
- Policy source state: SHA-256
  `07c3503bba15df93cfde7807b69300065878dc1401c7b6f209c1eb279fb9f341`.
  This is the deterministic manifest hash emitted by `tools/verify-old-coder-policy.ps1` over
  `AGENTS.md`, `docs/agent-evidence/old-coder-policy/SPEC.md`, and
  `tools/verify-old-coder-policy.ps1`. EVIDENCE is excluded to avoid a self-referential hash.
- Starting Git commit: `ca3ccb117a473cdf1344b479a0572b764b21d531`.
- Toolchain: repository PowerShell verifier using built-in PowerShell/.NET APIs; no dependency or
  lockfile change.
- Rerunnable entry point:
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-old-coder-policy.ps1`.
- Independent verification: not performed; this is a Tier 1 documentation/agent-policy change.

## SPEC to verification mapping

| Scenario or invariant | Verification | Status |
|---|---|---|
| Every coding agent and subagent must invoke old-coder | Verifier checks mandatory heading and universal-agent marker in `AGENTS.md` | pass |
| SPEC approval, RED/GREEN/REFACTOR, gauntlet, and EVIDENCE gates are explicit | Verifier checks the approval and RED/GREEN/REFACTOR markers; direct diff review covers the surrounding gauntlet/EVIDENCE text | pass |
| codebase-memory, old-coder, and Playwright are cumulative | Verifier checks the cumulative-requirements marker | pass |
| Policy verifier fails closed | `-SelfTest` accepts a known-good fixture and rejects a known-bad fixture missing the required heading | pass |
| Installed skill is complete | Default verifier requires both global `SKILL.md` and `references/gauntlet.md` | pass |
| Only the four approved files enter the commit | Pre-commit staged-file allowlist check described below | pass; exactly 4/4 approved paths staged |
| Unrelated `.codebase-memory/*` and `.tmp-tencentdb-agent-memory/` changes remain untouched | Stage explicit paths only, then compare the staged name list to the approved allowlist | pass; neither unrelated path appears in the staged list |

## Gauntlet — final pre-commit run

| Layer | Command | Actual result |
|---|---|---|
| Checker negative control | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-old-coder-policy.ps1 -SelfTest` | known-good accepted; known-bad rejected for the expected missing marker |
| Policy real execution | `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-old-coder-policy.ps1` | 7/7 mandatory markers present; 2/2 installed skill files present; source-state hash emitted |
| Suite health | run the default verifier twice consecutively | 2/2 passed with identical source-state hash |
| Documentation/diff check | `git diff --check -- AGENTS.md docs/agent-evidence/old-coder-policy tools/verify-old-coder-policy.ps1` | exit 0; no whitespace errors |
| Dependency/capability review | inspect approved file list and diff | no dependency, lockfile, runtime capability, network, subprocess, filesystem, or environment-reading change outside the verifier's documented file checks |

## Skipped or not-applicable layers

- Playwright UI/API automation: not applicable. The change affects repository agent instructions
  and their verifier only; it does not change a UI, endpoint, browser flow, selector, or API
  behavior that Playwright can exercise.
- Application full suite, static types, application lint, changed-line coverage, mutation testing,
  property testing, and production execution: not applicable under the approved Tier 1 SPEC
  because no application source, test, dependency, runtime configuration, or production behavior
  changes. Direct policy execution, negative control, repeated verifier runs, and Git diff gates
  cover the changed artifacts.
- Independent verification: not performed because this is Tier 1, not a high-stakes Tier 3 change.

## Honest notes

- The first verifier attempt used the originally approved command and was blocked before execution
  by Windows with `PSSecurityException: running scripts is disabled on this system`. SPEC Revision 1
  disclosed a process-local `-ExecutionPolicy Bypass`; the user explicitly approved that revision.
- The next real-policy check failed because `.NET GetFolderPath(UserProfile)` resolved the sandbox
  profile `C:\Users\CodexSandboxOffline` rather than the invoking user's profile. The resolver was
  corrected to prefer the existing `USERPROFILE` value and retain `.NET` only as a fallback. The
  checker then passed twice with the same source-state hash.
- The codebase-memory MCP did not expose `list_projects` or `index_status` in this session and its
  documented CLI was not on PATH. The available MCP `index_repository` indexed the exact repository
  root successfully as project `C-Users-duong-Downloads-Tradingview` with 27,261 nodes and 98,445
  edges; `get_architecture(aspects=[overview])` then completed successfully. Documentation and
  configuration contents were read directly under the repository's documented fallback rule.
- The staged allowlist matched all four approved paths exactly, and `git diff --cached --check`
  exited 0. Post-commit and push checks occur after this report is finalized; any mismatch blocks
  the push and will be reported rather than silently omitted.
