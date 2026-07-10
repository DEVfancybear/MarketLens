# Candle Virtualization — Phase 0 Baseline

_Implemented: 2026-07-11._

## Status

The development-only instrumentation, deterministic fixtures, and scripted
interaction harness are implemented. Typecheck, lint, and chart tests pass.
CPU baselines have been captured for 5,000 bars both without indicators and
with the user's pane/custom-indicator workload. The bottleneck ranking and
Phase 1 selection gate are now evidence-backed. A controlled before/after heap
snapshot sequence is still required for memory-retention conclusions.

## Instrumented pipeline

| Area | Probe keys |
| --- | --- |
| Primary candle writes | `series.candle.setData`, `series.candle.update`, call/point counters |
| Candle mapping | `candle.projection` |
| Indicator compute | `indicator.compute` with indicator type and candle count |
| Indicator mapping/writes | `indicator.projection`, `series.indicator.setData` |
| Pane anchor work | `indicator.pane-anchor-projection`, `series.pane-anchor.setData` |
| SMC | post calls/candles/estimated bytes, worker compute and round-trip, sync fallback |
| History | `history.normalize`, `history.merge` |
| Viewport | notification, coalesced, and rendered-frame counters |
| Responsiveness | frame intervals, long tasks, input-to-next-frame |
| React | `react.commit` plus mount/update commit counters for `ChartArea` |
| Memory | Chromium `performance.memory` fields when exposed |

The probe is excluded by behavior in production and is enabled in development
with `?chartPerf=1`. It retains only the latest 500 detailed samples.

## Deterministic fixtures

Fixtures use a fixed seeded generator and cover 900, 5,000, 20,000, and 100,000
bars. They use ascending Unix-second timestamps, valid OHLC bounds, deterministic
volume, and repeatable market gaps. Enable one with `chartFixture`:

```text
http://localhost:3000/?chartPerf=1&chartFixture=900
http://localhost:3000/?chartPerf=1&chartFixture=5000
http://localhost:3000/?chartPerf=1&chartFixture=20000
http://localhost:3000/?chartPerf=1&chartFixture=100000
```

The fixture replaces only the displayed chart series in development. Normal
market/replay state remains untouched and history prefetch is disabled while a
fixture is active.

## Reproducible capture

1. Run `npm run dev`, then `npm run benchmark:candle-virtualization` for the
   scenario URLs and console commands.
2. Open the 900-bar URL in Chromium DevTools.
3. Record a Performance trace while running:

   ```js
   await window.__chartBenchmark.run()
   ```

4. Export the probe JSON:

   ```js
   copy(window.__chartPerformanceProbe.exportJson())
   ```

5. Capture a heap snapshot after initial load, after the benchmark, and after
   navigating away/unmounting the chart.
6. Repeat at 5,000 bars. Run 20,000 and 100,000 only as extended/stress cases.
7. Record browser build, CPU, RAM, display refresh rate, viewport size, fixture
   size, indicator configuration, SMC state, and Replay options beside each
   artifact.

The default harness performs 120 pan frames, 90 zoom frames, and a 300-bar
Replay prefix reveal. Options can be overridden, for example:

```js
await window.__chartBenchmark.run({ panFrames: 300, zoomFrames: 180, replayBars: 600 })
```

## Baseline finding format

Rank bottlenecks by total time, then validate p95/max and call counts. At minimum
report:

1. indicator compute + projection + full `setData` time;
2. primary candle projection + `setData` time;
3. React commit time;
4. SMC worker transfer overhead and compute time;
5. history merge/normalize time;
6. frame p95/max, long-task count, and input-to-next-frame latency;
7. candle `setData` versus `update` counts during Replay and realtime ticks;
8. heap delta and whether it returns after chart unmount.

The code audit predicts indicator recomputation/replacement will rank first and
SMC transfer will become material with large arrays. These remain hypotheses
until the reference-machine artifacts confirm them; Phase 1 selection must use
the captured results rather than this prediction.

## Measured baseline — 5,000 bars, no indicators

Captured on Edge 150, Windows 10, 838×794 CSS pixels, DPR 1.25, 12 logical
processors. The scripted workload covered 120 pan frames, 90 zoom frames, and a
300-bar Replay reveal.

| Rank | Work | Result | Finding |
| --- | --- | --- | --- |
| 1 | React `ChartArea` commits | 769 commits, 3,552.6ms total, 4.62ms average, p95 8.4ms, p99 11.2ms, max 13.4ms | Dominant measured JS/React cost; Replay produces 568 update and 201 nested-update commits |
| 2 | Candle latest/append writes | 604 updates, 92.1ms total, p95 0.4ms, p99 0.5ms | Lightweight Charts incremental API is healthy; roughly two writes per revealed bar finalize the prior bar then append/update the latest |
| 3 | Required candle replacement | one 4,700-point `setData`, 7.9ms plus 0.4ms projection | Fits within one 60Hz frame at the current 5,000-bar cap |
| 4 | History normalization | six calls, 0.2ms total | Not material in this workload |

Frame interval p95 was 16.8ms, p99 33.3ms, and max 33.5ms with no observed
long task over 50ms. The old `over16.7ms` counter classified normal 60Hz timer
jitter as drops; a `frame.missed-vsync` counter using a 25ms threshold was added
after this run. Viewport invalidation coalesced 526 of 797 notifications (66%).

The 68.4MB heap value is only a point-in-time reading and is not an allocation
or leak result without before/unmount snapshots.

Two fields from this capture are excluded from conclusions:

- `elapsedMs` counted from page initialization rather than benchmark reset;
  reset semantics were corrected after this capture. The measured frame samples
  cover approximately 8.65 seconds.
- SMC posted zero candles because the global SMC runtime did not see the local
  chart fixture. Fixture publication was connected to SMC after this capture;
  SMC timings from this run are invalid.

This baseline supports prioritizing React/replay projection churn before primary
candle-series windowing. The corrected indicator/SMC capture below supplies the
remaining evidence used to select Phase 1 work.

## Measured baseline — 5,000 bars, pane/custom indicators and SMC

Captured on the same Edge/Windows environment after connecting the fixture to
the global SMC runtime. Runtime was 42.2 seconds for the scripted pan, zoom, and
300-bar Replay workload.

### Responsiveness

| Metric | Result |
| --- | --- |
| Frame interval | p50 16.7ms, p95 66.7ms, p99 83.4ms, max 383.4ms |
| Missed-vsync frames (>25ms) | 324 / 1,459 (22.2%) |
| Frames over 33.4ms | 319 / 1,459 (21.9%) |
| Long tasks | 310 calls, 20,059ms total, p95 83ms, p99 114ms, max 129ms |
| React commits | 933 calls, 5,881.8ms total, p95 12.3ms, p99 14.8ms, max 26ms |
| Viewport coalescing | 521 / 807 notifications coalesced (64.6%) |

This workload fails the proposed 5,000-bar interaction gates. The p95 frame is
four 60Hz frame budgets and long tasks occupy about 47.5% of wall-clock runtime.

### Ranked bottlenecks

| Rank | Work | Result | Interpretation |
| --- | --- | --- | --- |
| 1 | Indicator series `setData` | 9,077 calls, 2,999,891 points, 7,556.7ms total, p95 3.5ms, max 30.5ms | Highest directly measured main-thread chart write cost; repeated calls amplify small individual writes |
| 2 | Pane anchor `setData` | 807 calls, 4,056,427 points, 2,699.1ms total, p95 6.8ms | A roughly 5,000-point anchor is replaced on nearly every viewport notification |
| 3 | React commits | 933 calls, 5,881.8ms total, p95 12.3ms | Indicator/viewport/replay state churn keeps React close to the frame budget before canvas work |
| 4 | SMC transfer and queue | 218 posts, 1,057,698 candles, estimated 59.2MB; 12,573.4ms aggregate latency | 92.2% of SMC round-trip time is transfer/queue overhead, not SMC compute |
| 5 | Indicator compute | 939 calls, 920.4ms total, p95 2.8ms | Material call volume, but much smaller than replacement/write cost in this workload |
| 6 | SMC compute | 218 calls, 1,058.4ms total, p95 7.2ms | Worker computation is bounded; full-array delivery is the larger issue |
| 7 | Primary candles | one 4,700-point replacement at 5.3ms; 612 updates at 35.3ms total and p95 0.2ms | Not a current 5,000-bar bottleneck; primary-series windowing is not justified |

Indicator projection itself consumed only 255.2ms. The problem is not mapping
the sparse custom outputs; it is the number of imperative full replacements.
Indicator `setData` plus pane-anchor `setData` consumed 10,255.8ms, over eleven
times the measured indicator-compute time.

The point-in-time heap reading was 800.1MB (`usedJSHeapSize`). That is a strong
allocation-pressure warning compared with the 68.4MB no-indicator reading, but
it is not proof of a leak because forced-GC before/after/unmount snapshots were
not captured under identical conditions.

### Phase 1 selection from evidence

The measured order for Phase 1 is:

1. Stop rebuilding the full pane anchor on viewport-only changes; its candle
   timestamps are structural data, not a per-pan data product.
2. Coalesce and deduplicate extended custom-indicator writes, and skip
   `setData` when projected output/signature is unchanged.
3. Add latest-point/append write plans for built-in indicators and avoid
   repeated style application.
4. Slice SMC input to its existing 1,500-bar compute cap before `postMessage`.
5. Reduce React/nested-update churn after the write paths above are removed,
   then remeasure before considering wider architectural changes.

Primary candle virtualization remains deferred. The current primary series API
path is already incremental and well below the frame budget at 5,000 bars.

## Validation completed in this change

- `npm run typecheck`: pass.
- `npm run lint`: pass with five pre-existing/unchanged hook warnings and zero errors.
- `npm run test:chart`: 65/65 pass, including deterministic fixture tests.
- Development fixture URL: HTTP 200 from the local Next server.
- Browser probe capture: complete for the two 5,000-bar CPU workloads above.
- Controlled before/after/unmount heap snapshots: pending.
