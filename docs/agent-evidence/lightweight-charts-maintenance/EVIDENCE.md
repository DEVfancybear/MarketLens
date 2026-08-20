## Evidence Report — Lightweight Charts v5 maintenance (Tier 2)

- Spec approval: not obtained (autonomous run); confidence is correspondingly downgraded.
- Source state: `HEAD bfadc28d62a6e5a0e2d64860d875ca791bf96f96` plus working-tree hash `58753a68e0d42bb6bf4dc020d99e2014e80c5ed8dafdd9a29e908baad37eeefc` (computed by `node tools/source-state-lightweight-charts.mjs`).
- Toolchain: frontend `package.json`/`package-lock.json`, Node `v24.19.0`, TypeScript `5.7.3`, Playwright `1.61.1`.
- Entry point: `node tools/gauntlet-lightweight-charts.mjs` from `frontend/`.
- Independent verification: not performed (Tier 2).

### Spec → Test mapping

| Scenario / invariant | Test or layer | Status |
|---|---|---|
| Stable supported dependency resolves `5.2.0` | Gauntlet version assertion; `node -p` package and lockfile checks | pass |
| v5 series/marker API compatibility | `npm run typecheck`; source scan for v4 calls | pass |
| Latest-bar and append paths preserve incremental update plan | `tests/chart/candleSeries.test.ts` (existing) | pass |
| Resize notifications coalesce to latest dimensions | `tests/chart/chartResizeScheduler.test.ts` (2 tests) | pass |
| Pending resize work is cancelled on cleanup | `tests/chart/chartResizeScheduler.test.ts` | pass |
| Chart/replay/viewport invariants | `npm run test:chart` — 192 passed, 0 failed | pass |
| Browser resize/canvas regression | `npx playwright test tests/browser/chartViewportSync.spec.ts -g "crosshair, zoom, resize, and prepend stay synchronized"` | unverified — Next dev server cannot load missing `@tailwindcss/postcss` from existing `node_modules` |

### Gauntlet (final fresh run)

| Layer | Command | Result |
|---|---|---|
| Tests | `npm run test:chart` | 192 passed, 0 failed |
| Types | `npm run typecheck` | exit 0, 0 errors |
| Lint | `npm run lint` | exit 0, 0 errors/warnings |
| Manual mutation | `node tools/mutate-resize-scheduler.mjs` | 3/3 killed |
| Dependency/version | package + lockfile + installed package checks | all `5.2.0` |
| Playwright UI | targeted browser test above | blocked before test collection by missing `@tailwindcss/postcss` |
| Changed-line coverage | no coverage runner configured for this Node test setup | skipped (unverified) |
| Property-based tests | no fast-check/property layer for resize scheduling | skipped (n-a) |
| Real execution | Next dev server via Playwright webServer | blocked by same missing PostCSS plugin |
| Supply-chain audit | `npm audit --omit=dev --audit-level=high` | pre-existing failure: 3 high advisories via `next → postcss → nanoid`, no fix available; no dependency was added or upgraded by this change |
| Suite health | chart suite is single-worker deterministic; targeted helper tests pass | pass |

### Honest notes

- The repository already pinned the latest stable upstream release `lightweight-charts@5.2.0`; package metadata and lockfile were verified rather than replaced with an unreleased preview build.
- `PriceChart` now coalesces `ResizeObserver` bursts into one latest-size `chart.resize(..., true)` transaction per animation frame and cancels pending work during teardown. Existing v5 incremental `series.update()` fast paths remain unchanged.
- `frontend/tsconfig.test.json` now uses Node module resolution so its existing CommonJS test command is valid; before this change it failed immediately with TypeScript `TS5095`.
- Codebase-memory MCP tools/CLI were unavailable in this session, so discovery used the documented fallback (`rg` and authoritative source reads); this limitation was not hidden.
- Unrelated pre-existing working-tree changes under `.artifacts/`, `.codebase-memory/`, and `.tmp-tencentdb-agent-memory/` were preserved.
