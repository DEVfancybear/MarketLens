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

## Production backend command

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

Use `-SkipPull`, `-SkipBuild`, `-SkipMigrations`, or `-SkipPublicHealthCheck` only when the user
explicitly requests recovery behavior or the production runbook documents the reason.
