# EVIDENCE — MarketLens README and open-source refresh

SPEC: `docs/agent-evidence/readme-open-source-refresh/SPEC.md`

SPEC approval: obtained from the user (`Duyệt SPEC`)

Old Coder tier: Tier 1

Source baseline: `f4e48a0a188474163bfa3a4dada0cfa7ebbd17fd` (`origin/master` after the requested clean pull)

Execution date: 2026-08-23 (Asia/Saigon)

## Outcome

| Behavior | Evidence | Result |
| --- | --- | --- |
| B1 Vietnamese product README | Verifier checks the opening value proposition, product journey and capabilities, links, financial-claim guardrails, and absence of architecture/code/setup content. | Pass |
| B2 English parity | Verifier checks the matching English promise, capabilities, links, guardrails, and product-only scope. | Pass |
| B3 MIT license | Root `LICENSE` matches the canonical MIT grant/disclaimer and names `Copyright (c) 2026 DEVfancybear`; both READMEs link to it. | Pass |
| B4 Playwright policy stays removed | `AGENTS.md` contains neither `playwright-automation` nor a mandatory Playwright section, while codebase-memory and old-coder gates remain. The file was not modified. | Pass |
| B5 codebase-memory recovery | v0.10.8 binary and doctor succeeded; the exact project is `ready`; a full persistent rebuild produced 18,190 nodes and 80,226 edges and honored `.cbmignore`. | Pass |
| B6 reproducible verification | The repository verifier passes normally and fails under its deliberate architecture-content negative control. | Pass |

## RED → GREEN → REFACTOR

The first syntactically valid verifier run occurred before the README, license, runbook, and
ignore-rule implementation. It exited 1 with:

```text
README/open-source verification: 32 passed, 17 failed
```

Failures covered the missing `LICENSE` and `.cbmignore`, missing README license links,
architecture/code/setup content in both legacy READMEs, incomplete MIT checks, and missing v0.10.8,
CLI fallback, transport recovery, and exclusion guidance. Earlier PowerShell parser errors were
fixed before this RED run and were not counted as behavioral evidence.

After the implementation and verifier refactor, the normal run exited 0:

```text
README/open-source verification: 47 passed, 0 failed
PASS: README, MIT license, agent policy, and codebase-memory documentation satisfy the approved SPEC.
```

The negative control injects a forbidden `Runtime architecture` heading and code fence into the
in-memory README input without changing the repository. It exited 1 as required:

```text
README/open-source verification: 46 passed, 1 failed
FAIL: B1 README contains no architecture/code/setup content
NEGATIVE_CONTROL_EXIT=1
```

Rerunnable entry point:

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-readme-open-source.ps1
```

## codebase-memory upgrade and recovery evidence

- Verified upstream stable release: v0.10.8, published 2026-08-19.
- Official tagged Windows installer was downloaded and its installer SHA-256 was
  `4FA23417504DB92845F33086569F8906259A07F0168D0D07B4C29555593A7607`; the downloaded Windows
  archive passed the installer's upstream checksum verification.
- Installed binary:
  `C:\Users\duong\AppData\Local\Programs\codebase-memory-mcp\codebase-memory-mcp.exe`.
- Binary reported `codebase-memory-mcp 0.10.8`; `doctor` exited 0.
- The installer exposed duplicate inline SessionStart hook representations and later stopped on
  its regular-file policy after publishing the binary. The pre-change Codex configuration backup
  is recoverable at
  `C:\Users\duong\AppData\Local\Temp\codex-config-before-cbm-v0108-20260823-234209.toml`
  (SHA-256 `C89384B52857B86A684BC648A706851C1455A4E96F7409F4456EA04FE7F180BF`). Only duplicate
  CBM-owned inline hook blocks were removed; the host hook router was preserved. The MCP command now
  points directly to the v0.10.8 executable.
- The PATH-preferred v0.9.0 executable was moved, not deleted, to
  `C:\Users\duong\.local\bin\codebase-memory-mcp-v0.9.0-20260823-235214.exe.bak`. A stable command
  shim at the former PATH location delegates to the canonical v0.10.8 executable. A new shell
  resolved `codebase-memory-mcp` through that shim and reported v0.10.8.
- Both full and fast indexing against the legacy primary project database returned a pipeline
  error. A full persistent index in an isolated user-profile cache succeeded, identifying the
  legacy project database as the failing state rather than the repository.
- The exact legacy project database and artifact-export sidecars were moved, not deleted, to
  `C:\Users\duong\.cache\codebase-memory-mcp-backups\Tradingview-pre-v0108-20260823-234853`.
- Re-indexing the normal cache with `mode=full` and `persistence=true` then exited 0. The matching
  project root is `C:/Users/duong/Downloads/Tradingview`; `index_status` reports `ready`, 18,190
  nodes, 80,226 edges, 14 excluded directories, 87 by-design unindexed files, zero skipped files,
  and 50 partially parsed files. A subsequent `get_architecture(aspects=overview)` query returned
  the project overview.
- Generated artifact metadata: schema 2, source commit
  `f4e48a0a188474163bfa3a4dada0cfa7ebbd17fd`, indexed at `2026-08-23T16:49:27Z`, 18,190 nodes,
  80,226 edges, 46,006,272 original bytes, and 8,246,117 compressed bytes.
- The 50 partial parses are explicitly recorded as best-effort SQL/source ranges, not represented
  as full coverage. Current source remains authoritative.

## Final gauntlet

The final fresh run after the last repository edit records:

| Layer | Command/evidence | Result |
| --- | --- | --- |
| SPEC verifier | `powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-readme-open-source.ps1` | Pass, 47/47 |
| Checker negative control | Same command with `-NegativeControl` | Expected failure, 46/47 |
| Graph health | `codebase-memory-mcp --version`, `doctor`, `cli index_status`, and `cli get_architecture` | Pass |
| Patch hygiene | `git diff --check` | Pass |
| Scope review | Explicit path list and staged diff inspection | Pass; application runtime code and `AGENTS.md` unchanged |
| Secret scan | Changed textual files scanned for common private-key/token/password assignments | Pass |

Runtime unit/integration suites, type checks, coverage, mutation tests, property tests, and browser
automation were not run because this Tier 1 change does not modify executable application behavior.
Playwright is also explicitly excluded by the approved SPEC and the repository's current policy.
The PowerShell verifier is the executable contract for the documentation, licensing, policy, and
graph-metadata behaviors changed here.

## Limitations and handoff

- The already-running Codex process cannot replace its MCP transport in place. CLI verification is
  complete; restart all Codex/Orca windows once after this delivery so the next MCP handshake reads
  the new direct executable path.
- The shared graph describes the pulled source commit immediately before this documentation commit;
  the verifier requires that source commit to exist and remain an ancestor of the delivered HEAD.
- Backup files listed above are intentionally outside the repository and are not part of the Git
  commit. Keep them until v0.10.8 has remained healthy across a fresh agent restart.
