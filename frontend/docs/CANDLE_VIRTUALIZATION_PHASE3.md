# Candle Virtualization — Phase 3 Chunked Canonical Repository

_Implemented and benchmarked: 2026-07-11._

## Scope

Phase 3 introduces immutable candle chunks at the market-data ingress boundary.
The chart, Replay, drawings, alerts, SMC, indicators, and trading code continue
to receive the existing flat candle arrays during migration. Primary-series
windowing remains deferred.

## Repository model

Each symbol/timeframe repository stores:

- immutable chunks of at most 256 candles;
- global start offsets for every chunk;
- total length, first/last timestamp, revision, and access time;
- a lazily materialized flat compatibility array cached by repository identity.

Exact timestamp lookup first binary-searches chunk end times and then the
selected chunk. Global-index lookup binary-searches chunk start offsets. Neither
operation flattens or scans the full history.

## Ingress integration

`marketDataStore` now owns both the canonical repository record and its flat
compatibility record. Existing selectors and actions are unchanged.

- Realtime append/update clones only the tail chunk.
- Delayed historical correction clones only the containing chunk.
- History prepend builds chunks for the new page and retains every unchanged
  existing chunk by reference.
- Overlapping REST refresh preserves live forming bars with the same rules as
  the previous array merge.
- The compatibility view is materialized only after a repository revision and
  reused for repeated reads.

The current active flat array remains intentionally available. Removing it
would require a separate consumer migration and would break synchronous drawing
and trade atoms that currently read array selectors.

## Inactive cache budget

Repositories are bounded to ten inactive/active market keys and 50,000 candles
in aggregate. The target key and currently selected market are protected;
remaining entries are evicted least-recently-used. Their flat compatibility
arrays are removed in the same commit so an evicted market reloads normally.

## Correctness policy

- Timestamp remains the stable identity.
- Chunks and repository metadata are frozen after publication.
- Candle values remain normalized, sorted, deduplicated, and capped at the
  existing 5,000-bar live-store limit.
- History/live precedence and forming-tail behavior match the legacy merge.
- Flat consumers observe the same timestamps and values.
- Replay remains isolated from live repository contents and cannot see future
  bars.

## Automated validation

Tests cover:

- chunk sizes and cached flat materialization;
- timestamp/global-index lookup across chunk boundaries;
- tail and delayed correction chunk identity;
- history prepend identity retention and legacy value parity;
- overlapping refresh/forming-bar parity;
- max-candle trimming;
- inactive LRU eviction with active-key protection.

## Performance counters

Integrated live ingress reports:

- `candle.repository.upsert`;
- `candle.repository.merge`;
- `candle.repository.materialize`;
- `candle.repository.chunksReused` and `chunksCreated`;
- `candle.repository.evictions`.

## Focused Phase 3 benchmark

Open a fresh foreground tab:

```text
http://localhost:3000/?chartPerf=1&chartFixture=5000&chartBenchmarkProfile=phase3
```

Then run:

```js
await window.__chartBenchmark.run()
copy(window.__chartPerformanceProbe.exportJson())
```

The profile disables saved indicators and, before the normal chart interaction
script, runs the same deterministic workload through both implementations:

- seed the newest 900 candles;
- prepend the remaining history in ten pages;
- apply ten delayed corrections;
- materialize the compatibility view after every repository mutation.

Acceptance counters:

- `benchmark.profile.phase3` equals 1;
- `benchmark.repository.prepends` and `corrections` equal 10;
- final repository length is 5,000;
- repository candle/chunk reference reuse is positive;
- legacy candle reference reuse is zero or materially lower;
- repository prepend/correction time plus compatibility materialization does
  not regress materially versus the legacy path;
- fresh-page heap remains bounded and all correctness tests stay green.

## Final Phase 3 capture

The fresh-page 5,000-candle capture passed every repository invariant:

- profile marker 1, ten prepends, ten delayed corrections, and 5,000 final
  candles;
- 77,440 repository candle references reused versus 49,990 in the legacy path;
- the 27,450-reference difference is the unchanged history retained across ten
  prepends (both paths retain 4,999 references per delayed correction);
- 360 chunk references reused and 24 chunks in the final repository;
- repository prepend took 7.6ms, correction 0.8ms, and all 20 compatibility
  materializations 5.5ms;
- legacy prepend took 22.3ms and correction 1.3ms.

The conservative repository total including every compatibility materialization
was 13.9ms versus 23.6ms for the legacy array path, a 41.1% reduction. The
integrated live-store path also recorded five merges totaling 1.5ms and five
materializations totaling 0.4ms.

Fresh-page heap usage was 68.6MB (164.2MB committed) and stayed bounded. The
chart retained one intentional 4,700-point Replay-prefix `setData`, followed by
600 incremental candle updates. Frame p95 was 16.8ms; one 5.7-second
background-tab interval invalidates max frame and wall-clock duration but does
not affect the repository timing/counter gate.

Phase 3 is complete. The primary candle replacement cost was only 6.9ms for one
intentional operation, so current traces do not justify Phase 4 primary-series
windowing. That phase remains optional and deferred unless larger-history
captures identify the primary canvas data size as a material bottleneck.
