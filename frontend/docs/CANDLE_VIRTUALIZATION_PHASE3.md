# Candle Virtualization — Phase 3 Chunked Canonical Repository

_Implemented: 2026-07-11. Focused browser allocation/heap gate pending._

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

Phase 3 becomes complete after this capture confirms lower candle-object churn
without timestamp, consumer, or heap regression.
