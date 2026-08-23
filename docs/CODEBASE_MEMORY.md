# Codebase Memory Runbook

This repository uses
[`DeusData/codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp)
as a local structural knowledge graph for coding agents. It indexes definitions, calls, imports,
routes, tests, and cross-module relationships. Source files remain authoritative.

The verified Windows/Codex baseline for this repository is
[`codebase-memory-mcp v0.10.8`](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.10.8).

## Required agent startup

Before inspecting or changing code:

1. Use codebase-memory-mcp's `list_projects` tool, not Codex's task/project listing.
2. Select the project whose `root_path` is the current repository or worktree. Project names are
   derived from absolute paths, so do not hardcode one in prompts or automation.
3. Call `index_status(project=...)` and require `status: "ready"`.
4. If the project is missing or stale, call
   `index_repository(repo_path="<absolute repository root>")`.
5. Query the task surface before editing:
   - use `get_architecture` for unfamiliar or cross-cutting work;
   - use `search_graph` for symbols, routes, types, or modules;
   - use `trace_path` for inbound/outbound impact;
   - use `get_code_snippet` for exact definitions.
6. Open the returned source files and verify the current implementation before making changes.

Use graph discovery first for code structure. Use `rg` or direct reads for literals, error
messages, configuration, documentation, generated files, or anything the graph did not index.

## Install or update on Windows

The upstream Windows installer downloads the current release, verifies its checksum, activates the
binary, and updates the MCP configuration it owns. Download it to a temporary path so it can be
reviewed before execution:

```powershell
$cbmInstaller = Join-Path $env:TEMP "codebase-memory-mcp-install.ps1"
Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1" `
    -OutFile $cbmInstaller
notepad $cbmInstaller
Unblock-File -LiteralPath $cbmInstaller
powershell -NoProfile -ExecutionPolicy Bypass -File $cbmInstaller
```

Re-running the installer is also the supported update path. Close and restart every open Codex or
other coding-agent session after activation so each MCP client starts the same binary and performs
a fresh protocol handshake.

Verify the installation in a new PowerShell session:

```powershell
Get-Command codebase-memory-mcp | Format-List Source,Version
codebase-memory-mcp --version
codebase-memory-mcp doctor
codebase-memory-mcp config list
```

Enable automatic first-use indexing and git-based refresh:

```powershell
codebase-memory-mcp config set auto_index true
codebase-memory-mcp config set auto_watch true
```

## Manual indexing and CLI fallback

Every graph tool is available as a one-shot CLI command. This is also the primary CLI fallback
when the Codex MCP bridge or transport is unavailable:

```powershell
codebase-memory-mcp cli list_projects
codebase-memory-mcp cli index_status --project <project-from-list_projects>
codebase-memory-mcp cli --progress index_repository --repo-path "$PWD" --mode full --persistence true
codebase-memory-mcp cli get_architecture --project <project-from-list_projects> --aspects overview
```

Always run `list_projects` first and copy the exact project name whose `root_path` matches the
current worktree. Similar project names can refer to an old checkout or a separate cache entry.

## Shared graph artifact and exclusions

The repository commits a compressed graph snapshot so a new clone can bootstrap without a full
re-index:

- `.codebase-memory/graph.db.zst`
- `.codebase-memory/artifact.json`
- `.codebase-memory/.gitattributes`

`.cbmignore` uses gitignore-style syntax but affects only codebase-memory discovery, not Git. This
repository excludes generated evidence and runtime trees that would otherwise inflate the graph or
introduce non-authoritative copies of dependencies and tools. Changes take effect on the next
re-index.

Verify exclusions in the `index_repository` response. The `excluded.dirs` list may be truncated,
so use its `count` plus the reported examples rather than assuming the first page is exhaustive.

## Recovery when codebase-memory does not run

Follow this ladder in order. Preserve the first failing command and its full output; do not erase
the cache before identifying whether the failure is the executable, MCP transport, project
selection, or graph data.

### 1. Command is not found

```powershell
Get-Command codebase-memory-mcp -ErrorAction SilentlyContinue
$env:Path -split ';' | Where-Object { $_ }
```

If the executable is absent, rerun the official installer above. If it exists but is missing from
`PATH`, use the installer's reported path and reopen PowerShell and Codex. Do not copy an old binary
over the active executable.

### 2. The executable starts but health checks fail

```powershell
codebase-memory-mcp --version
codebase-memory-mcp doctor
codebase-memory-mcp config list
```

Keep the failing output. Confirm that every open agent session uses the same executable returned by
`Get-Command`. With v0.10.x, coordinated processes must use the same build and cache root. Close all
agent sessions, rerun the installer, then restart Codex before retrying.

### 3. MCP tools fail or report `Transport closed`, but CLI works

First isolate the bridge from the graph:

```powershell
codebase-memory-mcp cli list_projects
codebase-memory-mcp cli index_status --project <matching-project>
```

If those commands succeed, the executable and graph are usable; continue with the CLI fallback
instead of treating the graph as corrupt. Close all Codex windows, verify the MCP command path in
the Codex configuration points to the current executable, then restart Codex to force a new MCP
handshake. Rerun the installer only if the owned configuration is missing or points to an obsolete
binary.

### 4. The project is missing, stale, or not ready

```powershell
codebase-memory-mcp cli list_projects
codebase-memory-mcp cli --progress index_repository --repo-path "$PWD" --mode full --persistence true
codebase-memory-mcp cli list_projects
codebase-memory-mcp cli index_status --project <matching-project>
```

Require the exact `root_path` and `status: "ready"`. Re-index after large pulls, rebases, branch
replacement, ignore-rule changes, or a graph-format upgrade.

### 5. Indexing fails, hangs, or consumes unexpected resources

Check free disk space and memory, then confirm generated directories are covered by `.gitignore`
or `.cbmignore`. Run once with progress and debug logging:

```powershell
$env:CBM_LOG_LEVEL = "debug"
codebase-memory-mcp cli --progress index_repository --repo-path "$PWD" --mode fast --persistence false
Remove-Item Env:CBM_LOG_LEVEL
```

Daemon-backed sessions write lifecycle and error logs below `${CBM_CACHE_DIR}/logs`; when
`CBM_CACHE_DIR` is unset, the default cache root is `~/.cache/codebase-memory-mcp`. Record the log
path and relevant error lines before changing the installation.

### 6. Install or update fails

Confirm the target release and platform asset on the
[`v0.10.8` release page](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.10.8),
retain the installer transcript, and retry only after all coding-agent sessions are closed. The
release provides `checksums.txt` and the Windows archive; do not substitute an unverified binary.
If the current binary cannot update itself, rerun the standalone installer from a fresh temporary
path rather than repeatedly invoking the failing in-process command.

If the installer reports `conflicting_hook_representations`, back up the agent configuration first.
Preserve the host application's hook router and remove only duplicate, CBM-owned inline hook blocks;
then rerun the installer. Some Windows hosts also reject an otherwise valid existing configuration
as a regular-file policy conflict after publishing the binary. In that partial-install state, do
not assume rollback: verify the installed binary with `--version`, then confirm both `PATH` and the
MCP server command point to that same executable. Close stale processes from older executable paths
and restart Codex before testing the MCP transport.

### 7. Last resort: isolate the local cache without deleting it

Only after the executable, transport, configuration, and project path have been ruled out, close
all agent sessions and move the exact cache directory to a dated backup. Validate the resolved path
before moving it; never target a home directory or workspace root. Restart Codex and re-index from
the repository artifact. Keep the backup until the new graph reports `ready` and task-relevant
queries succeed.

## Graph visualization

The v0.10.8 Windows build includes the local graph UI:

```powershell
codebase-memory-mcp --ui=true --port=9749
```

Open `http://localhost:9749`. The viewer is local-only and reads the same persistent graph used by
MCP and CLI clients.

## Maintenance workflow

- Let the background watcher handle normal git/file changes.
- Re-run `index_repository` after large repository changes or when `index_status` is not ready.
- Use `detect_changes` for graph-assisted impact analysis, then verify affected source and tests.
- Never treat an empty graph search as proof that code does not exist. Confirm with `rg` and direct
  source inspection.
- Never index secrets or generated outputs. Keep exclusions current and review every shared
  artifact refresh before committing it.

## Current verified snapshot

The graph was rebuilt from commit `f4e48a0a188474163bfa3a4dada0cfa7ebbd17fd` on 2026-08-23 with
codebase-memory-mcp v0.10.8. The matching project reported `ready` with 18,190 nodes and 80,226
edges. Indexing excluded 14 generated/runtime directories and 87 files by design, skipped zero
files, and reported 50 partially parsed files. Those partial results are best-effort signals—read
the current source directly for any flagged range.

The persisted artifact uses schema version 2, contains the same node and edge counts, and is
compressed from 46,006,272 bytes to 8,246,117 bytes. A task-relevant `get_architecture` query
returned the project overview after the rebuild, confirming the recovered graph is queryable.
