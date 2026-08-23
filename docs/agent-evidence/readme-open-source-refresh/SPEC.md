# SPEC — MarketLens README and open-source refresh

Status: approved by user (`Duyệt SPEC`)
Old Coder tier: Tier 1 (documentation, repository policy, license, and generated graph metadata; no runtime behavior)

## Objective

Present MarketLens as an attractive open-source product in Vietnamese and English, license the
repository under MIT, update the local codebase-memory installation and shared graph data, and
document a practical Windows/Codex recovery path when codebase-memory cannot run.

Research basis:

- GitHub recommends that a README quickly explain what the project does, why it is useful, how
  people can use it, and where they can get help. This project-specific request narrows that to a
  product-only story, so architecture, source layout, setup, commands, and implementation details
  will remain outside the README.
- The MIT license will use the canonical text and the repository owner's GitHub identity,
  `DEVfancybear`, as the copyright holder.
- The latest stable upstream codebase-memory-mcp release verified on 2026-08-23 is v0.10.8.

## Acceptance criteria

### B1 — Vietnamese product README

Given a visitor opens `README.md`, then the page:

- identifies MarketLens and its value within the first screen;
- describes the complete user journey from market observation through replay, risk-aware MT5
  execution, alerts, journal, and analytics;
- highlights desktop/mobile and Vietnamese/English experiences;
- links to the live product, English README, and MIT license;
- uses a confident, clear, disciplined voice suitable for a trading product;
- does not contain architecture diagrams, source-tree descriptions, technology-stack badges,
  developer setup, code snippets, production commands, API details, or internal runbooks.

### B2 — English parity

Given a visitor opens `README.en.md`, then it communicates the same product promise, capabilities,
open-source status, live-product link, and MIT license as `README.md`, without technical or
architectural content.

### B3 — MIT license

Given GitHub or a license scanner inspects the repository root, then `LICENSE` contains the
canonical MIT text with `Copyright (c) 2026 DEVfancybear`, and both READMEs link to it.

### B4 — Playwright policy stays removed

Given an agent reads `AGENTS.md`, then no mandatory `playwright-automation` requirement exists.
The codebase-memory startup gate and mandatory old-coder workflow remain intact. Upstream commit
`f4e48a0` already satisfies this behavior, so no edit to `AGENTS.md` is planned unless verification
finds a regression.

### B5 — codebase-memory version, clean data, and recovery

Given a maintainer follows `docs/CODEBASE_MEMORY.md`, then the runbook:

- names v0.10.8 as the verified Windows/Codex baseline and records a fresh graph snapshot;
- documents the current official Windows install/update flow and required agent restart;
- provides a fail-closed recovery ladder for command-not-found, failed doctor, MCP transport/tool
  failure, stale/missing project, stale graph, and installer/update failure;
- documents CLI fallback when the MCP bridge is unavailable;
- does not instruct users to delete graph caches as an early recovery step;
- explains `.cbmignore` and how to verify exclusions.

Given indexing runs, then `.cbmignore` excludes generated evidence/runtime trees (`/.artifacts/`,
`/.tmp-tencentdb-agent-memory/`, and `/backend/.artifacts/`) without changing Git's own ignore
rules, and a fresh shared `.codebase-memory` artifact is generated from the pulled source.

### B6 — reproducible verification

Running:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-readme-open-source.ps1
```

must exit zero only when B1–B5 hold. Before implementation, the verifier will be run once and
observed failing against the current README/license/runbook (RED). After implementation it must
pass (GREEN), and `git diff --check` must also pass.

## Negative invariants

- Do not modify application runtime code, APIs, database schema, deployment scripts, or package
  manifests.
- Do not add libraries, package dependencies, images, generated marketing artwork, or remote
  tracking assets.
- Do not claim guaranteed profitability, investment advice, broker endorsement, or risk-free
  trading.
- Do not commit `.tmp-tencentdb-agent-memory/` or unrelated generated/runtime output.
- Do not weaken or remove the codebase-memory or old-coder requirements in `AGENTS.md`.
- Do not use Playwright; no browser/UI behavior changes and the repository policy requiring that
  global skill has already been removed upstream.

## Planned files

Create:

- `LICENSE`
- `.cbmignore`
- `tools/verify-readme-open-source.ps1`
- `docs/agent-evidence/readme-open-source-refresh/SPEC.md`
- `docs/agent-evidence/readme-open-source-refresh/EVIDENCE.md`

Modify:

- `README.md`
- `README.en.md`
- `docs/CODEBASE_MEMORY.md`
- `.codebase-memory/artifact.json` (generated)
- `.codebase-memory/graph.db.zst` (generated)

Verify without planned modification:

- `AGENTS.md`

## Tools, dependencies, and external changes

- Existing tools only: PowerShell, Git, codebase-memory-mcp, and the repository's current tooling.
- No new package dependency.
- Upgrade the account-level Windows `codebase-memory-mcp` executable from 0.9.0 to the official
  stable v0.10.8 using the upstream signed/checksummed installer. This changes the global tool and
  may update its owned Codex MCP configuration; all Codex sessions must be restarted afterward.
- Rebuild/export the repository graph after `.cbmignore` is present. Generated graph files are
  intentionally committed because this repository already shares them with the team.

## Implementation and verification sequence

1. Confirm source remains at pulled `origin/master` commit `f4e48a0` and inspect only the approved
   paths.
2. Add the verifier and run it unchanged against the current state; retain its expected failing
   output as RED evidence.
3. Rewrite both READMEs, add MIT `LICENSE`, add `.cbmignore`, and update the runbook.
4. Run the official codebase-memory Windows installer for v0.10.8, then verify `--version` and
   `doctor`. If activation requires a Codex restart, use CLI verification for the remainder and
   record the MCP-session limitation honestly.
5. Re-index with `mode=full` and `persistence=true`; verify `list_projects`, matching `root_path`,
   `index_status=ready`, artifact metadata, and `.cbmignore` exclusions.
6. Run the verifier's negative control, then one fresh final verifier run and `git diff --check`.
   Runtime test suites, type checks, coverage, mutation, property tests, and Playwright are skipped
   as not applicable because no executable application behavior changes; this limitation will be
   recorded in EVIDENCE.
7. Write EVIDENCE with exact results and source/tool versions.
8. Stage only the approved file list, inspect the staged diff and secret scan, commit with
   `docs: open source MarketLens`, then push `master` to `origin`.

## Git operations authorized by approval

- Read-only status/diff/log checks.
- `git add` with explicit approved paths only.
- One commit: `docs: open source MarketLens`.
- `git push origin master` only after the final gauntlet passes.
- No reset, clean, stash, rebase, amend, force-push, or tag operation is planned. The destructive
  cleanup and fast-forward pull requested by the user occurred before this SPEC and are recorded
  as task history, not as future authorization.
