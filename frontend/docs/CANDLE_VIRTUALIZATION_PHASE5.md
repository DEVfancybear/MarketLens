# Candle Virtualization — Phase 5 Rollout and Rollback

_Implemented: 2026-07-11. Deterministic optimized/legacy A/B capture pending._

## Phase 4 decision

Phase 4 primary-series windowing is intentionally skipped. The final Phase 3
capture measured one intentional primary `setData` at 6.9ms followed by 600
incremental updates. Primary canvas data size is not a material bottleneck, so
adding timestamp anchoring and a second logical-index domain would increase
Replay, pane, drawing, and crosshair risk without measured benefit.

## Rollout modes

Phase 5 retains both behavior paths:

| Mode | Derived indicators | Market candle storage |
| --- | --- | --- |
| `optimized` | incremental cache + viewport output | chunk repository + flat compatibility view |
| `legacy` | full indicator compute + full projection | array normalize/merge/upsert |
| `auto` | selected by history/device policy | same effective selection |

Precedence is query override, localStorage, deployment environment, then
`auto`.

### Instant per-tab override

```text
?chartOptimization=optimized
?chartOptimization=legacy
?chartOptimization=auto
```

The query override is the fastest rollback mechanism and requires only a page
reload.

### Persistent internal opt-in

```js
localStorage.setItem("chartOptimization", "optimized"); location.reload()
localStorage.setItem("chartOptimization", "legacy"); location.reload()
localStorage.removeItem("chartOptimization"); location.reload()
```

### Deployment default/kill switch

Set `NEXT_PUBLIC_CHART_OPTIMIZATION_MODE` to `optimized`, `legacy`, or `auto`
at build time. Query/local overrides remain available to internal testing.

## Auto policy

`auto` enables the optimized path when either:

- history contains at least 5,000 candles; or
- history contains at least 900 candles and the device reports at least four
  logical processors and 4GB device memory.

Smaller histories on limited devices retain the legacy path. Explicit modes
always win, enabling controlled rollout and reproducible comparisons.

## Telemetry

Every benchmark capture records:

- `rollout.requested.auto|optimized|legacy`;
- `rollout.effective.optimized|legacy`;
- `rollout.derived.enabled|disabled`;
- `rollout.repository.enabled|disabled`.

Live market ingress additionally records optimized versus legacy repository
writes. Existing Phase 0–3 operation, frame, worker, React, and heap metrics
remain unchanged.

## Deterministic A/B gate

Open separate fresh foreground tabs and run the same Phase 2 built-in workload.

Optimized:

```text
http://localhost:3000/?chartPerf=1&chartFixture=5000&chartBenchmarkProfile=phase2&chartOptimization=optimized
```

Legacy:

```text
http://localhost:3000/?chartPerf=1&chartFixture=5000&chartBenchmarkProfile=phase2&chartOptimization=legacy
```

In each tab:

```js
await window.__chartBenchmark.run()
copy(window.__chartPerformanceProbe.exportJson())
```

Acceptance requirements:

1. telemetry confirms the requested/effective mode;
2. optimized mode records 1,500 incremental built-in appends and viewport
   points avoided;
3. legacy mode records neither incremental cache hits nor viewport slicing;
4. timestamps, final values, Replay count, and visible behavior remain equal;
5. optimized derived CPU/write time is materially lower without heap or frame
   regression;
6. switching to `legacy` and reloading restores the fallback immediately.

The legacy path must remain in the repository through multiple stable releases.
Its removal is explicitly outside this phase and requires retained production
telemetry plus a separate reviewed change.
