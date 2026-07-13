# Drawing Tools Phase 0 Characterization Baseline

_Date: 2026-07-11_  
_Status: implemented_

> Historical milestone snapshot. The catalog has since expanded from 35 to 84
> persistent adapters. Current contracts and verification guidance live in
> `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`.

This document records the safety net established before the drawing tool
maintenance refactor. Phase 0 changes test and diagnostic contracts; it does not
change drawing geometry or persisted payload shape.

## Delivered

- One generated fixture path for every one of the 35 persistent `DrawingTool`
  ids, including legacy `fib` and three-point long/short fixtures.
- A development-only executable adapter audit that verifies:
  - registry ids exactly match `DRAWING_TOOLS`;
  - one fixture is produced for every registered id;
  - point count and numeric geometry are valid;
  - real adapter render, bounds, anchors, move, and hit-test methods execute;
  - every fixture survives a JSON persistence round-trip.
- Browser gesture coverage for trendline create, select, body move, undo, redo,
  delete, and chart zoom restoration.
- Command history characterization for create/move/property/duplicate/delete,
  bounded history, and redo invalidation.
- Executable viewport subscription tests replacing the stale source regex gate.
- Executable adapter behavior tests replacing source regex gates for Brush,
  Highlighter, Path, Vertical Line, and Rectangle attached text.
- A repeatable spatial-index benchmark at 100, 500, 1,000, and 5,000 drawings.

## Verification commands

```bash
npm run typecheck
npm run test:drawing
npm run check:drawing-viewport
npm run test:chart-browser -- drawingInteractions.spec.ts
npm run benchmark:drawing
go test ./internal/drawings
```

Baseline result on 2026-07-11:

| Gate | Result |
| --- | --- |
| TypeScript typecheck | Pass |
| Drawing Node tests | 27/27 pass |
| Viewport contract gate | 7/7 pass |
| Drawing browser tests | 2/2 pass; adapter audit and gesture transaction each run three consecutive iterations |
| Backend drawing tests | Pass |

## Spatial-index performance baseline

Environment: Node v24.16.0, Windows x64, 30 iterations. Values are
characterization measurements, not CI thresholds. Phase 1 should derive budgets
from repeated CI measurements before enforcing limits.

| Drawings | Visible query result | Rebuild median | Rebuild p95 | Query median | Query p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 53 | 0.081 ms | 0.554 ms | 0.010 ms | 0.072 ms |
| 500 | 265 | 0.270 ms | 0.688 ms | 0.010 ms | 0.030 ms |
| 1,000 | 530 | 0.474 ms | 1.031 ms | 0.026 ms | 0.086 ms |
| 5,000 | 2,650 | 1.592 ms | 2.478 ms | 0.134 ms | 0.399 ms |

## Gate design decisions

- Correctness gates import and execute production contracts. They do not parse
  TypeScript source formatting.
- Canvas pixels remain useful for visual regression, but semantic state and
  adapter contracts are the primary assertions for gestures and geometry.
- Browser fixtures intercept push endpoints so external Firebase availability
  cannot make drawing tests slow or flaky.
- The development harness exposes snapshots, projected drawing coordinates,
  point diagnostics, and adapter audits only outside production builds.

## Remaining work after Phase 0

The following belongs to later phases rather than characterization:

- Versioned drawing payloads and historical schema migrations.
- Authenticated/anonymous migration and multi-tab conflict semantics.
- A typed manifest as the single source of toolbar, adapter, defaults, settings,
  and serialization metadata.
- Visual snapshots for every tool and measured browser frame-time budgets.
- Magnet, keep-drawing, interval visibility, object tree, grouping, and sync.

These bullets record what remained on 2026-07-11. Phases 1-8 subsequently
implemented the manifest, versioned persistence, and most listed cross-tool
behavior; consult the maintenance plan and post-Phase 8 record for current gaps.
