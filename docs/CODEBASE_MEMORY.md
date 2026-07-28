# Codebase Memory Runbook

This repository uses
[`DeusData/codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp)
as a local structural knowledge graph for coding agents. It indexes definitions, calls, imports,
routes, tests, and cross-module relationships. Source files remain authoritative.

## Required agent startup

Before inspecting or changing code:

1. Use codebase-memory-mcp's `list_projects` tool, not Codex's task/project listing.
2. Select the project whose `root_path` is the current repository or worktree. Project names are
   derived from absolute paths, so do not hardcode one in prompts or automation.
3. Call `index_status(project=...)` and require `status: "ready"`.
4. If the project is missing or stale, call
   `index_repository(repo_path="<absolute repository root>")`.
5. Query the task surface before editing:
   - `get_architecture` for unfamiliar or cross-cutting work;
   - `search_graph` for symbols, routes, types, or modules;
   - `trace_path` for inbound/outbound impact;
   - `get_code_snippet` for exact definitions.
6. Open the returned source files and verify the current implementation before making changes.

Use graph discovery first for code structure. Use `rg` or direct reads for literals, error
messages, configuration, documentation, generated files, or anything the graph did not index.

## Local installation

Install the signed Windows release using the upstream instructions, restart the coding agent, and
verify:

```powershell
codebase-memory-mcp --version
codebase-memory-mcp doctor
```

The upstream installer detects supported clients and adds managed MCP/instruction/hook blocks.
Review those blocks after installation. For Codex, the MCP entry is in
`$CODEX_HOME/config.toml`; the installer also provides durable global instructions and a session
startup reminder.

Enable automatic first-use indexing and git-based refresh:

```powershell
codebase-memory-mcp config set auto_index true
codebase-memory-mcp config set auto_watch true
```

## Manual indexing and verification

All MCP tools are also available as one-shot CLI commands:

```powershell
codebase-memory-mcp cli --progress index_repository --repo-path "$PWD"
codebase-memory-mcp cli list_projects
codebase-memory-mcp cli index_status --project <project-from-list_projects>
codebase-memory-mcp cli get_architecture --project <project-from-list_projects> --aspects overview
```

Run `list_projects` first and copy its exact project name. Worktrees can have distinct roots and
must be matched by `root_path`.

### First shared-artifact export on Windows 0.9.0

If the project already has a local database, 0.9.0 chooses incremental indexing and does not create
the first shared artifact. Force one full run without deleting the normal cache by using a fresh
temporary cache and the upstream in-process switch:

```powershell
$env:CBM_CACHE_DIR = Join-Path $env:TEMP ("cbm-export-" + [guid]::NewGuid())
$env:CBM_INDEX_SUPERVISOR = "0"
$indexArgs = @{
    repo_path   = (Resolve-Path .).Path
    mode        = "full"
    persistence = $true
} | ConvertTo-Json -Compress
$indexArgs | codebase-memory-mcp cli --progress index_repository
```

Success must report `artifact_present: true` and create:

- `.codebase-memory/graph.db.zst`
- `.codebase-memory/artifact.json`
- `.codebase-memory/.gitattributes`

Later incremental indexing refreshes an existing artifact automatically.

## Graph visualization

Install the upstream UI variant, then start the local graph viewer:

```powershell
codebase-memory-mcp --ui=true --port=9749
```

Open `http://localhost:9749`. The viewer is local-only and reads the same persistent graph used by
the MCP clients. Keep the process running while inspecting the graph; stopping it does not remove
the index or shared artifact.

## Maintenance workflow

- The background watcher keeps an indexed project synchronized with git/file changes.
- Re-run `index_repository` after large rebases, branch replacement, ignore-rule changes, or when
  `index_status` is not ready.
- Use `detect_changes` for graph-assisted impact analysis, then verify affected source and tests.
- Never treat an empty graph search as proof that code does not exist. Confirm with `rg` and
  direct source inspection.
- Do not index secrets or generated outputs. The indexer honors this repository's `.gitignore`;
  keep environment files, caches, dependencies, build output, and runtime logs excluded.

## Initial verified snapshot

The first full index was verified on 2026-07-29 with codebase-memory-mcp 0.9.0:

- status: `ready`
- nodes: 13,507
- edges: 50,571
- skipped files: 0
- shared artifact: schema 2 zstd graph, bootstrap-tested from an empty cache
- primary indexed languages: TypeScript, Go, SQL, Rust, Python, YAML, TOML, and CSS
- indexed structural data includes functions, methods, modules, interfaces, routes, tests,
  call/import edges, HTTP links, configuration links, and semantic relationships

These counts are only a health snapshot. They will change as the repository evolves.
