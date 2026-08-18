# Repository agent instructions

## Mandatory codebase-memory startup

This repository uses `codebase-memory-mcp`. Before inspecting or changing code, every coding agent
must complete the startup gate below. Do not begin implementation from grep, glob, or ad-hoc file
reads alone.

1. Call codebase-memory-mcp's `list_projects` (not Codex's task/project listing), select the graph
   whose `root_path` matches this repository/worktree, and call `index_status` to confirm that it
   is ready.
2. If the matching project is missing or stale, call `index_repository` with the absolute
   repository root and wait for indexing to finish.
3. Run at least one task-relevant graph query before editing:
   - use `get_architecture` for unfamiliar or cross-cutting work;
   - use `search_graph` to locate symbols, routes, types, and modules;
   - use `trace_path` for caller/callee and dependency impact;
   - use `get_code_snippet` for the exact definitions that will be changed.
4. Read the exact source files returned by the graph before editing them. The graph is discovery
   evidence; current source remains authoritative.
5. For non-code text, configuration, generated files, missing graph results, or exact string
   searches, fall back to `rg` and direct file reads.

At session start, after compaction, and before delegating code work, repeat the project/status
check. Pass the selected project, relevant qualified symbols, paths, and call-chain findings to
subagents. If MCP is unavailable, say so explicitly, read `docs/CODEBASE_MEMORY.md` plus the
relevant architecture/package documentation, and inspect the required source before editing.

See `docs/CODEBASE_MEMORY.md` for installation, maintenance, verification, and recovery commands.

## Mandatory old-coder evidence-first workflow

Every coding agent and subagent working in this repository must invoke the globally installed
`old-coder` skill for every task that changes code or code-adjacent configuration, regardless of
the skill's normal trigger description, the apparent size of the change, or the agent's chosen
workflow. Read the skill's complete `SKILL.md` and every task-relevant referenced file before
acting. If the installed skill cannot be found or read, stop before implementation and report the
blocker; do not silently substitute a lighter workflow.

After completing the codebase-memory startup gate above, follow the skill's evidence-first loop:

1. Classify the task as old-coder Tier 1, 2, or 3 and write an executable SPEC to a file. Name its
   absolute path, include concrete positive and negative acceptance criteria, and disclose all
   planned dependencies, tools, generated files, git operations, and verification commands.
2. Obtain explicit approval of that exact SPEC before implementation. If the execution context is
   explicitly autonomous and cannot pause, proceed only as the skill permits and record
   `spec approval: not obtained (autonomous run)` in EVIDENCE; never imply approval.
3. Use RED -> GREEN -> REFACTOR for behavioral changes. Bug fixes require a reproducing test that
   is observed failing before the fix. Do not edit assertions and implementation in the same step,
   weaken tests, invent results, or skip an applicable layer without recording the reason.
4. Run the complete risk-calibrated gauntlet, including the repository's mandatory Playwright route
   below whenever applicable. Persist a single rerunnable entry-point command and retain relevant
   traces, screenshots, reports, and failure output.
5. Write EVIDENCE to a file at the end. Map every SPEC behavior and invariant to a test or an
   explicitly unverified/skipped layer, report exact results from one fresh final run, identify the
   source state and toolchain, and list every limitation honestly.

A failing gauntlet blocks completion, commit, and push unless the user explicitly accepts the
reported blocker. The codebase-memory, old-coder, and Playwright requirements are cumulative:
codebase-memory governs discovery, old-coder governs specification/TDD/evidence, and Playwright
governs executable UI/API/debugging verification. Before delegating code work, the parent agent
must pass the approved SPEC path, selected old-coder tier, required gauntlet layers, graph project
and relevant symbols/paths, and instruct the subagent to read and apply `old-coder` itself.

## Mandatory Playwright automation for debugging and delivery

Use the globally installed `playwright-automation` skill by default for every debugging, bug-fix,
reproduction, retest, and fix-verification task in this repository. Read the skill's `SKILL.md`
before acting and follow the relevant route/reference for the task. Do not guess selectors or
declare a fix from code inspection alone when the behavior can be exercised through UI, API, or
CI automation.

Before committing or pushing a code change:

1. Invoke `playwright-automation` and select the verification route that matches the change
   (UI E2E, API, visual/responsive, accessibility, network mocking, flaky/CI diagnosis, or another
   route defined by the skill).
2. Run the smallest meaningful regression that proves the changed behavior, preserving traces,
   screenshots, reports, or command output for failures. Deterministic Playwright regression tests
   must pass twice consecutively when the skill requires it.
3. If Playwright is not applicable (for example, a compile-only or platform-native backend change),
   run the closest code-native tests and state explicitly why browser/API automation does not cover
   the change. Do not skip verification silently.
4. Commit only files intended for the requested change, then push only after the selected
   verification passes or the user explicitly accepts a clearly reported blocker.

## Production backend commands

Two commands are production entrypoints. Neither replaces the other; pick by whether the host should
build from source.

### Build from source (unchanged meaning)

When the user says **build backend production** or **run backend**, execute this command from the
repository root on the Windows production host:

```powershell
.\run-backend-production.ps1
```

Use no switches in the normal case. Do not substitute `build-production.ps1`, a direct `go build`,
`api.exe`, or individual Python bridge commands; those are artifact-build or manual-recovery paths.
The canonical runner owns pull, MT5 runtime provisioning, staged API build, forward migration,
safe restart, and local/public health gates. Port `8787` is browser/account-local and is not part of
the multi-user backend runner.

### Deploy a CI-built artifact

When the user says **deploy backend**, or asks to ship a build without compiling on the host, run:

```powershell
.\tools\deploy-backend.ps1
```

It downloads the artifact GitHub Actions already built, verifies it against `SHA256SUMS`, refuses a
commit that does not match the checked-out `HEAD` unless `-AllowCommitMismatch` is given, migrates
forward with the packaged `migrate.exe`, and then delegates the restart to the canonical runner with
`-SkipPull -SkipBuild -SkipMigrations`. This is the documented reason those three switches exist, so
using them through this script is not recovery behaviour. The deploy script rolls binaries back on a
failed restart; it never rolls migrations back.

Do not modify `run-backend-production.ps1` to accommodate the deploy path: keeping the runner as the
single implementation of restart, MT5 startup and health gating is the point of the delegation.

Outside that delegation, use `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, or
`-SkipPublicHealthCheck` only when the user explicitly requests recovery behavior or the production
runbook documents the reason.
