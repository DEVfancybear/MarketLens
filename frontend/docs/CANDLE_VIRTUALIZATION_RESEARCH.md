# Candle Virtualization Research and Rendering Optimization Plan

_Status: Phases 0–1 complete; Phase 2 derived-data work is next._
_Last updated: 2026-07-11._

Phase 0 implementation and capture instructions are recorded in
[`CANDLE_VIRTUALIZATION_PHASE0.md`](./CANDLE_VIRTUALIZATION_PHASE0.md).
Phase 1 incremental optimizations and validation gates are recorded in
[`CANDLE_VIRTUALIZATION_PHASE1.md`](./CANDLE_VIRTUALIZATION_PHASE1.md).

## 1. Executive decision

Do **not** install React Native or render one candle per React/React Native list
item. `VirtualizedList` solves a different problem: it limits the number of
mounted item views in a scroll container. This web chart uses Lightweight
Charts, which draws series through HTML5 canvas and already avoids creating one
DOM node or React component per candle.

The useful idea to transfer is the **windowing model**, not the component:

- keep canonical data outside the renderer;
- derive a visible logical range;
- add directional overscan;
- prioritize visible work over offscreen work;
- batch newly required work;
- retain stable identity and cached results;
- load older pages only near the leading boundary;
- measure fill rate, input latency, frame time, and memory together.

For this repository, the recommended order is:

1. instrument the current pipeline;
2. remove redundant full-array indicator and projection work;
3. virtualize/cache **derived computation** around the viewport;
4. store history in stable chunks while preserving a canonical series;
5. window the primary Lightweight Charts candle series only if measured
   histories substantially larger than the current 5,000-bar cap still require
   it.

This avoids replacing a fast canvas renderer with thousands of React items and
targets the actual full-series recomputation paths found in the code audit.

## 2. Research sources

Primary sources used for this proposal:

- [React Native VirtualizedList documentation](https://reactnative.dev/docs/virtualizedlist)
  describes a finite active render window, blank space outside it, adaptive
  incremental rendering, `PureComponent` semantics, and the fill-rate versus
  responsiveness trade-off.
- [React Native FlatList optimization guide](https://reactnative.dev/docs/optimizing-flatlist-configuration)
  documents `windowSize`, `maxToRenderPerBatch`, `updateCellsBatchingPeriod`,
  fixed item layout, memoization, and the memory/blank-area trade-off.
- [React Native `computeWindowedRenderLimits` source](https://github.com/react/react-native/blob/main/packages/virtualized-lists/Lists/VirtualizeUtils.js)
  starts with the visible interval, expands to a capped overscan interval,
  records scroll direction, and limits how many new cells enter each batch.
- [Lightweight Charts 4.2 `ISeriesApi` documentation](https://tradingview.github.io/lightweight-charts/docs/4.2/api/interfaces/ISeriesApi)
  defines full replacement through `setData`, latest-bar append/update through
  `update`, `barsInLogicalRange`, and the higher cost of historical updates.
- [Lightweight Charts realtime update guidance](https://tradingview.github.io/lightweight-charts/docs/4.0/)
  warns against frequent `setData` calls and recommends `update` for the latest
  point.
- [Lightweight Charts infinite-history demo](https://tradingview.github.io/lightweight-charts/tutorials/demos/infinite-history)
  uses visible logical range changes to request older pages near the left edge.
- [Lightweight Charts primitive performance guidance](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesPrimitiveBase)
  notes that viewport callbacks run frequently and should remain simple or use
  caching and stable references.

The project currently depends on `lightweight-charts@4.2.3`; recommendations
must be verified against that API before using functionality from newer major
versions.

## 3. What VirtualizedList actually optimizes

React Native's list architecture has four relevant layers:

1. **Canonical collection** — opaque `data` accessed through `getItem` and
   `getItemCount`.
2. **Viewport metrics** — scroll offset, visible length, zoom scale, and scroll
   direction/velocity.
3. **Render window** — visible items plus capped overscan before and after.
4. **Batch scheduler** — visible/high-priority cells first; offscreen cells are
   filled incrementally.

Key properties and their trade-offs:

| VirtualizedList concept | Benefit | Cost/risk |
| --- | --- | --- |
| `initialNumToRender` | Fast first screen | Too small creates initial blanks; too large increases startup work |
| `windowSize` | Overscan reduces blank areas during fast scroll | Larger windows use more memory and mount more items |
| `maxToRenderPerBatch` | Caps new synchronous work | Small batches can fall behind scrolling |
| `updateCellsBatchingPeriod` | Spreads offscreen work over time | Long periods increase fill latency |
| `getItemLayout` | Avoids measuring fixed-size items | Requires deterministic item geometry |
| stable keys / `PureComponent` | Reuses cells and skips equal props | Mutable data or unstable identity can leave stale UI |
| `removeClippedSubviews` | Detaches offscreen native views | May produce missing-content bugs and does not necessarily free JS objects |

The source algorithm is especially relevant: visible content is chosen first,
overscan expands around it, and the expansion is constrained by the number of
new items. This is a scheduling policy, not merely `array.slice(...)`.

## 4. Why candles are not list rows

### 4.1 Different rendering units

A `VirtualizedList` row is a mounted React/native view with layout, lifecycle,
props, and potentially local state. A Lightweight Charts candlestick is data
consumed by an imperative canvas series. There is no candle component to unmount
with `removeClippedSubviews` or memoize with `React.memo`.

Replacing the candle series with a horizontal list would add:

- thousands of React reconciliation units;
- per-item layout/style/hit-test overhead;
- a second scrolling system that must match chart zoom and logical ranges;
- manual price-scale transforms, crosshair lookup, time-axis labels, and
  drawing/indicator synchronization;
- visible seams or blanks when the list fill rate loses to pan velocity.

That is a regression in architecture and should not be pursued.

### 4.2 Canvas does not mean all upstream work is free

Canvas prevents DOM-per-candle cost, but full input replacement can still cost
time in JavaScript and inside the chart library:

- map/normalize every candle;
- allocate a new series array;
- rebuild chart data structures after `setData`;
- recompute indicators over the full input;
- transfer full arrays to workers;
- rebuild crosshair/time lookup maps;
- repaint drawing and indicator overlays.

Therefore the correct virtualization boundary is usually **before** canvas:
canonical history, derived analysis windows, incremental series updates, and
viewport-aware overlays.

## 5. Current repository audit

### 5.1 Data ownership and limits

The live path is:

```text
REST/WebSocket
  -> marketDataStore candles by symbol:timeframe
  -> useMarketData mirrors active candles
  -> chartStore.candlesAtom
  -> useChartSeries (live or Replay)
  -> PriceChart + indicators + SMC + drawings
```

Current limits and policies:

| Area | Current behavior |
| --- | --- |
| Live cache | `marketDataStore.ts` caps each series at `MAX_CANDLES = 5000` |
| Initial history | 60–900 bars depending on timeframe |
| Older page | 60–1,000 bars depending on timeframe |
| Prefetch | `PriceChart` loads left history when logical `range.from <= 120` |
| SMC | worker-throttled to 90ms; engine slices to the most recent 1,500 bars |
| Replay | server projection maps all revealed bars, preserving identity with a `WeakMap` |

The current history policy already resembles `onStartReached`: start with a
bounded dataset and prepend older pages near the left edge. That should remain.

### 5.2 Main candle series: good fast path already exists

`PriceChart.tsx` classifies updates:

- same timestamp/latest bar -> `series.update()`;
- one appended candle -> finalize previous and `series.update()`;
- Replay animation -> incremental `series.update()` frames;
- history prepend, context replacement, or theme/structure change ->
  `series.setData()`.

This matches Lightweight Charts guidance. Any optimization must preserve the
O(1) realtime path and must not turn ordinary ticks into window replacements.

### 5.3 Structural work that is still O(n)

The audit found the following full-series work:

| Location | Work |
| --- | --- |
| `marketDataStore.updateCandleAtom` | Builds an updated array and runs an element-by-element identity check |
| `candleSeries.ts` | Normalizes/sorts/merges and slices arrays for historical or delayed updates |
| `useMarketData` | Mirrors the active cache into a second Jotai candle atom |
| `useChartSeries` Replay path | Maps every revealed Replay bar on projection-array change |
| `PriceChart` structural path | Maps all candles to Lightweight Charts data and calls `setData` |
| `PriceChart` lookup | Rebuilds a full `Map<time, candle>` on structural replacement |
| overlay indicators | `computeIndicator(cfg, candles)` and `series.setData(...)` for every candle-array change |
| separate panes | Rebuilds anchor and indicator arrays with `setData` |
| SMC worker | Posts the full candle array; compute later retains only the last 1,500 |

The largest immediate concern is derived series: the primary candle series can
take the latest-bar fast path while indicators still recompute and replace their
entire series on that same update.

### 5.4 Logical-index coupling

Drawings, panes, Replay viewport restoration, crosshair data, and history
prefetch use candle time or Lightweight Charts logical indices. Removing old
candles from the primary series changes logical indices. A naive render slice
would cause:

- viewport jumps after each window shift;
- incorrect left-edge history thresholds;
- pane/main time-scale drift;
- drawing anchors resolving against a different logical index;
- Replay burst and pause presentation state losing its prefix relationship.

This is why primary-series windowing is a later, guarded phase.

## 6. Mapping list virtualization to chart virtualization

| VirtualizedList | Chart equivalent |
| --- | --- |
| item | candle or derived indicator point |
| item key | candle UTC timestamp; never array index |
| viewport | `timeScale.getVisibleLogicalRange()` |
| item layout | fixed logical bar index/bar spacing; no DOM measurement |
| render window | visible candle indices plus overscan |
| `windowSize` | overscan measured in visible-range lengths or bars |
| leading/trailing fill preference | bias left while panning into history; bias right while returning live |
| `maxToRenderPerBatch` | maximum new chunks/indicator points computed per scheduled task |
| batching period | `requestAnimationFrame`, worker task, or idle/background scheduling |
| blank spacer | not acceptable for primary OHLC; optional whitespace only with proven semantics |
| external item state | canonical candle repository and drawing/indicator stores |
| `onStartReached` | existing left-history prefetch callback |
| fill-rate telemetry | percentage of viewport/overscan backed by canonical and derived data |

The primary chart must prefer temporary extra memory over visible blank candles.
Unlike a social feed, a missing candle changes visual and analytical meaning.

## 7. Proposed architecture

### 7.1 Three distinct windows

Do not use one slice for every consumer.

```text
Canonical history window
  largest; authoritative loaded candles retained in chunks

Render window
  primary canvas data; initially remains all loaded candles (<= 5,000)

Analysis window
  visible range + indicator warmup + overscan; consumer-specific
```

Suggested types:

```ts
type CandleRange = { first: number; last: number };

type CandleViewport = {
  visible: CandleRange;
  overscan: CandleRange;
  direction: "left" | "right" | "idle";
  revision: number;
};

type IndicatorDependency =
  | { kind: "finite"; lookback: number }
  | { kind: "recursive"; checkpointEvery: number }
  | { kind: "session"; boundary: "day" | "week" | "month" }
  | { kind: "full-history" };
```

### 7.2 Canonical chunk repository

Replace repeated monolithic-array ownership only after profiling validates the
need. A proposed `CandleRepository` would retain immutable chunks of 256 or 512
candles keyed by `{symbol, timeframe}`:

```text
chunk 0 [t0 ... t255]
chunk 1 [t256 ... t511]
...
hot tail [forming/latest bars]
```

Required operations:

- binary search timestamp -> global index;
- retrieve range without sorting the complete history;
- prepend a history page while reusing unaffected chunks;
- replace latest/forming candle without copying every chunk;
- expose stable `revision`, `firstTime`, `lastTime`, and `length`;
- materialize a flat array only for consumers that require it;
- evict inactive symbol/timeframe caches under a documented memory budget.

This mirrors VirtualizedList's opaque data accessors without importing its UI
component.

### 7.3 Viewport controller

Create one chart-owned controller subscribed to visible logical range changes.
It should coalesce high-frequency pan/zoom notifications to animation frames and
publish a range only when integer boundaries materially change.

Initial policy to benchmark, not ship blindly:

```text
visibleBars = ceil(to) - floor(from) + 1
leftOverscan  = max(200, visibleBars * 2)
rightOverscan = max(80,  visibleBars * 1)

if panning left:
  leftOverscan *= 2
if following live:
  rightOverscan = max(rightOverscan, 50)
```

Clamp to loaded data. Use timestamps to re-anchor after history prepend; do not
persist raw logical indices across a structural `setData`.

### 7.4 Indicator computation windows

This is the highest-value virtualization target.

#### Finite-lookback indicators

For SMA(20), RSI(14), or similar finite dependencies:

```text
computeStart = overscan.first - (lookback - 1)
computeEnd   = overscan.last
publish      = overscan range only
```

Cache by `{indicator signature, symbol, timeframe, candle revision, chunk}`.
When only the latest candle changes, invalidate only the tail chunk and update
the latest output point with `series.update()` where valid.

#### Recursive indicators

EMA and other recursive series need state before the visible window. Store a
checkpoint at chunk boundaries (for example prior EMA value plus input index),
then resume computation from the nearest checkpoint. Do not seed an EMA at the
visible edge; that creates mathematically different values during pan.

#### Session-dependent indicators

VWAP/session metrics must extend the input window to the relevant session
boundary. A generic fixed lookback is insufficient.

#### Arbitrary Pine/custom indicators

Treat unknown dependency graphs as `full-history` until the compiler/runtime
can provide dependency metadata and resumable state. Correctness wins over
window size. Cache compiled results and avoid re-sending/replacing identical
series.

### 7.5 Incremental chart writes

Maintain per-series write plans:

```ts
type SeriesWritePlan =
  | { kind: "none" }
  | { kind: "update-latest"; point: Point }
  | { kind: "append"; points: Point[] }
  | { kind: "replace-window"; points: Point[]; anchorTime: number };
```

Rules:

- never call `setData` for an unchanged or latest-only indicator result;
- use `update` for latest-bar changes and appends;
- reserve `setData` for symbol/timeframe changes, history prepend, changed
  dependency window, or corrected historical data;
- preserve visible time range around a required replacement;
- cache mapped Lightweight Charts point objects so unchanged prefixes keep
  reference identity where possible;
- avoid `applyOptions` on every tick when style/signature is unchanged.

### 7.6 SMC and overlays

- Slice to the existing 1,500-bar SMC cap **before** `worker.postMessage` to
  reduce structured-clone cost.
- Include a monotonic request/revision key and discard stale worker results (the
  current request ID behavior should remain).
- Compute only overlay geometry intersecting visible+overscan time ranges when
  the overlay is purely presentational.
- Retain full domain state for alerts/trading/SMC decisions that must not depend
  on what the user can currently see.

### 7.7 Optional primary-series windowing

Only introduce this if benchmarked flat primary series (for example 20k–100k
bars) is a demonstrated frame/memory bottleneck after derived-series fixes.

Requirements:

1. Feature flag and instant rollback.
2. Timestamp-based viewport anchor before replacement.
3. Overscan large enough that ordinary pan does not call `setData` each frame.
4. Window shifts only after crossing an inner hysteresis boundary.
5. No blank OHLC region during a window transition.
6. Main/pane/drawing/crosshair parity tests.
7. Separate canonical indexes from Lightweight Charts local logical indexes.
8. Replay prefix/burst state translated to the active render window.

Suggested hysteresis:

```text
loaded render window: [first, last]
safe inner window:    [first + 25%, last - 25%]

shift only when visible range exits the safe inner window
```

Do not use per-candle whitespace points merely to preserve every unloaded
logical slot: this still stores a point per timestamp and can distort autoscale,
crosshair, pane alignment, or history semantics.

## 8. Scheduling and priority model

| Priority | Work | Scheduler |
| --- | --- | --- |
| P0 | pointer/crosshair, current candle `series.update`, drag feedback | same frame / existing imperative path |
| P1 | visible indicator tail, price marker, visible drawings | next animation frame or worker result |
| P2 | overscan indicator chunks | worker/idle slices with a bounded batch |
| P3 | history prefetch, inactive cache preparation | async I/O/background |
| P4 | cache compaction/eviction | idle or lifecycle boundary |

Never schedule P2/P3 synchronous work inside a wheel/pointer handler. If
`requestIdleCallback` is used, provide a timeout and fallback because browser
support and idle availability vary. Workers should receive minimal ranges or
transferable typed data rather than repeated 5,000-object structured clones.

## 9. Correctness invariants

Optimization is unacceptable if it changes trading/chart meaning.

- Candle timestamp is the stable identity; array index is not.
- Current forming candle updates must remain O(1) at the chart API boundary.
- No future candle may enter Replay indicators, SMC, drawings, or trading.
- Indicator values must be identical to full-history results within documented
  floating-point tolerance.
- History prepend must preserve the visible timestamp and zoom span.
- Main chart and indicator panes must share the same time domain.
- Drawings anchored outside the active render window remain in persistent state
  and reappear at the exact timestamp when panned back.
- Alerts and trade execution never depend on the visible/render window.
- Market gaps remain gaps; virtualization must not synthesize candles.
- Symbol/timeframe/session changes cancel stale compute and I/O.

## 10. Instrumentation before implementation

Add a development-only `ChartPerformanceProbe` before changing architecture.
Measure:

### 10.1 Timing

- `PriceChart` candle effect duration by write-plan kind;
- `series.setData` and `series.update` call count and surrounding JS duration;
- `computeIndicator` duration by indicator/type;
- indicator projection/mapping duration;
- SMC worker post size, queue delay, compute time, and round-trip time;
- history normalize/merge duration;
- visible-range callback frequency and coalescing ratio;
- React commit duration for `ChartArea`, `PriceChart`, panes, legends, and
  overlays.

### 10.2 Responsiveness

- animation-frame p50/p95/p99 during drag pan, wheel zoom, and Replay;
- dropped-frame ratio;
- long tasks over 50ms;
- input-to-next-paint latency for pan, zoom, crosshair, and toolbar input;
- number of full `setData` operations during 30 seconds of realtime ticks (goal:
  zero unless a structural event occurs).

### 10.3 Memory and allocation

- candle object count by active/inactive market;
- flattened arrays and point arrays allocated per second;
- indicator cache size;
- worker payload bytes per second;
- JS heap before/after symbol switches and ten history prepends;
- detached chart/worker instances after unmount.

Use `performance.mark/measure`, `PerformanceObserver` for long tasks where
available, React Profiler builds, Chrome Performance/Memory panels, and a small
in-app development overlay. Do not ship verbose probes in production.

## 11. Benchmark matrix and acceptance gates

### 11.1 Data sizes

- 900 bars (normal first paint);
- 5,000 bars (current maximum);
- 20,000 bars (future extended history);
- 100,000 bars (stress test, not a default product requirement).

### 11.2 Workloads

- no indicators;
- three built-in overlays;
- two separate panes;
- one recursive indicator plus session VWAP;
- two custom Pine indicators;
- SMC enabled;
- Replay at 1x, 3x, and 10x;
- continuous forming-bar refresh;
- ten left-history prepends;
- rapid symbol/timeframe switching;
- four synchronized Replay charts where supported.

### 11.3 Interaction scripts

1. Drag-pan left/right continuously for 10 seconds.
2. Wheel/pinch zoom in and out for 10 seconds.
3. Move crosshair over dense candles and drawings.
4. Follow live while forming candle changes.
5. Pan to the history boundary and trigger repeated page loads.
6. Start/pause/step fast Replay while indicators and SMC are visible.

### 11.4 Proposed gates

Treat these as initial targets to validate against actual developer hardware:

- no visible blank candle region;
- zero incorrect/missing drawing or indicator anchors;
- full-history versus windowed indicator parity within `1e-9` where algorithms
  are deterministic;
- no realtime full-series `setData` call;
- pan/zoom frame p95 <= 16.7ms on the agreed reference machine at 5,000 bars;
- no interaction-blocking task > 50ms in the common 5,000-bar scenario;
- input-to-next-paint p95 <= 100ms;
- memory returns near baseline after inactive market eviction and chart unmount;
- at least 30% reduction in indicator+projection CPU time before enabling the
  optimization by default.

Record hardware, browser build, display refresh rate, data seed, and enabled
features with every benchmark. A percentage without a reproducible scenario is
not an acceptance result.

## 12. Phased implementation plan

### Phase 0 — baseline and probes

- Add performance marks/counters without behavior changes.
- Create deterministic candle fixtures at 900/5k/20k/100k.
- Add scripted pan/zoom/Replay benchmark harness.
- Capture baseline traces and heap snapshots.

Exit gate: bottlenecks ranked by measured main-thread/worker time.

### Phase 1 — no-regret incremental work

- Skip indicator `setData` when signature/data revision is unchanged.
- Add latest-point/append plans for built-in indicators.
- Stop repeated `applyOptions` when style is unchanged.
- Slice SMC input before worker transfer.
- Coalesce visible-range notifications to one per animation frame.
- Avoid duplicate candle ownership/mirroring where architecture permits.

Exit gate: correctness tests pass and common realtime path produces no full
series replacement.

### Phase 2 — viewport-aware derived data

- Add `CandleViewport` and dependency metadata.
- Window finite-lookback indicators with warmup.
- Add recursive checkpoints and session-boundary expansion.
- Cache output chunks and invalidate only changed dependencies.
- Project drawing/label geometry only for visible+overscan.

Exit gate: full-history parity tests and >=30% measured derived CPU reduction.

### Phase 3 — chunked canonical repository

- Introduce immutable candle chunks behind current selectors.
- Preserve compatibility flat arrays during migration.
- Add binary time/index lookup and inactive-cache budgets.
- Convert history prepend and delayed correction to chunk-local updates.

Exit gate: lower allocation/heap without changing consumers or timestamps.

### Phase 4 — optional primary canvas window

- Run only if Phase 0–3 traces still identify primary `setData`/canvas data
  size as a material bottleneck.
- Implement window hysteresis and timestamp anchoring behind a feature flag.
- Prove pane/drawing/Replay/history parity.

Exit gate: measurable improvement at large history sizes, zero blank regions,
and instant rollback available.

### Phase 5 — rollout

- Internal opt-in.
- Development telemetry comparison: legacy vs optimized.
- Gradual default-on by data size/device capability if needed.
- Remove the legacy path only after multiple stable releases and retained
  benchmark evidence.

## 13. Testing plan

### Pure unit tests

- visible/overscan range calculation and clamping;
- directional bias and hysteresis;
- timestamp/index binary search;
- chunk prepend/update/eviction;
- write-plan classification;
- finite warmup and recursive checkpoint resume;
- full versus windowed indicator parity;
- cancellation/revision ordering.

### Integration tests

- realtime latest update does not call `setData`;
- history prepend preserves visible timestamps;
- main/pane logical ranges remain synchronized;
- drawings disappear/reappear only according to time visibility, never data
  loss;
- Replay reveals no future candle and pause freezes the rendered state;
- custom Pine falls back safely when dependency metadata is absent;
- window shift never produces empty visible OHLC.

### Performance regression tests

- count series API calls by kind;
- enforce maximum indicator recompute ranges for known dependencies;
- assert worker payload is capped;
- record benchmark JSON artifacts and compare against a tolerance, not exact
  wall-clock milliseconds in normal unit CI.

## 14. Risks and rejected approaches

| Approach | Decision | Reason |
| --- | --- | --- |
| React Native `VirtualizedList` for candles | Reject | Wrong renderer/runtime; adds item views and duplicate scroll/scale logic |
| DOM candle components with CSS transforms | Reject | Loses canvas efficiency and chart API behavior |
| Slice every consumer to visible candles | Reject | Breaks indicator warmup, recursive state, sessions, alerts, trading, and Replay correctness |
| Shift primary render window on every pan event | Reject | Causes repeated `setData`, churn, and viewport jumps |
| Use array index as candle key | Reject | History prepend changes every key/index |
| Add whitespace for all unloaded candles | Defer/reject by default | Still O(n) timestamps and uncertain crosshair/autoscale semantics |
| Window only indicators/overlays first | Accept | Targets measured O(n) work while keeping primary chart semantics stable |
| Chunk canonical history | Accept after profiling | Reduces prepend/correction allocation and supports range access |
| Worker for all rendering | Reject | Lightweight Charts canvas and DOM interaction remain main-thread APIs; workers are for computation |

## 15. Recommended next task

The next implementation task should be **Phase 0 instrumentation**, not a
VirtualizedList dependency and not primary-series slicing. Deliver:

1. a reproducible benchmark fixture and interaction script;
2. counters for candle/indicator `setData` versus `update`;
3. indicator, projection, SMC-transfer, history-merge, and frame timing;
4. baseline traces at 900 and 5,000 bars;
5. a ranked finding report that selects Phase 1 changes from evidence.

This produces an optimization path that borrows VirtualizedList's strongest
ideas—finite windows, overscan, priority, batches, stable identity—without
discarding the canvas renderer already optimized for financial charts.
