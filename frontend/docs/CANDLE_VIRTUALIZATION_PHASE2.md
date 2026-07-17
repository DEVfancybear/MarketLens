# Candle Virtualization — Phase 2 Viewport-Aware Derived Data

_Implemented and benchmarked: 2026-07-11._

> Superseded for indicator calculation on 2026-07-16. Built-in formulas and
> warmup/recursive state now live in the Go indicator runtime; the frontend
> retains only viewport projection and an async API-result cache. The local
> dependency and incremental-computation sections below are historical Phase 2
> benchmark context, not the current execution architecture.

## Scope

Phase 2 virtualizes derived chart work without windowing the canonical candle
array or the primary candlestick series. Alerts, trading, Replay, SMC, and Pine
execution continue to receive their existing correctness domains.

## Viewport model

`CandleViewport` converts the Lightweight Charts logical range into:

- a clamped visible candle range;
- a larger render range with at least 200 bars of left overscan and 80 bars of
  right overscan;
- doubled history-side overscan while panning left;
- a revision that changes only after the visible range crosses the inner 25%
  hysteresis boundary.

Overlay and pane series publish only visible+overscan points. Moving inside the
retained window does not replace normal indicator data. Extended reference
lines still follow the exact visible range. Indicator labels are culled outside
an 80px screen overscan. Drawing geometry already uses `SpatialIndex` viewport
queries in `CanvasRenderer`, so Phase 2 preserves that path rather than adding
a second drawing window.

## Dependency metadata and computation cache

Built-ins now declare their dependency class:

| Indicator | Dependency | Incremental behavior |
| --- | --- | --- |
| SMA | finite lookback | recompute the latest `length` closes |
| EMA | recursive | resume from the preceding EMA state |
| RSI | recursive | resume Wilder gain/loss state |
| MACD | recursive | resume fast, slow, and signal EMA state |
| VWAP | UTC-day session | scan only the active session |
| ADR | full history | safe full recompute |
| Custom Pine | unknown/full history | safe Pine runtime fallback |

Recursive metadata specifies a maximum 256-bar checkpoint interval. The
current cache retains restart state for every candle, which is denser than that
limit and makes append/latest correction O(1). Cached output arrays are stable:
new points append and forming-candle corrections replace only the tail instead
of cloning every historical output point.

History prepend, delayed historical correction, changed configuration, symbol
or timeframe change, ADR, and unknown custom code retain full-history rebuilds.
This is intentional: a performance fallback must not guess an unsafe dependency
range.

## Correctness policy

- Candle timestamps remain the identity and binary-search key.
- The cache consumes only the candle array supplied by the current live/Replay
  projection; it cannot reveal future Replay candles.
- Windowing happens after indicator computation, so indicator warmup,
  recursive state, and session boundaries remain exact.
- A viewport shift changes presentation data only. Canonical indicator output
  remains cached and can be republished when the user pans back.
- Full replacement remains mandatory for historical changes or unknown
  dependency metadata.

## Automated validation

- viewport clamping, directional overscan, hysteresis, and timestamp slicing;
- dependency classification and fallback behavior;
- EMA/MACD recursive parity against independent full-history recurrences;
- Wilder RSI state parity;
- SMA and UTC-session VWAP tail parity, including a latest-candle correction;
- all existing chart, Replay, pane, write-plan, and SMC tests.

## Performance counters

The Phase 0 probe now exposes:

- `indicator.cache.append` and `indicator.cache.update-latest`;
- `indicator.cache.identityHits`, `indicator.cache.rebuilds`, and
  `indicator.cache.fullHistoryFallbacks`;
- `indicator.compute.incremental` duration;
- `indicator.viewport.windowShifts` and
  `indicator.viewport.windowRetained`;
- `indicator.viewport.pointsAvoided`.

## Post-change benchmark gate

Use the same focused 5,000-candle fixture with the tab kept in the foreground:

```text
http://localhost:3000/?chartPerf=1&chartFixture=5000&chartBenchmarkProfile=phase2
await window.__chartBenchmark.run()
copy(window.__chartPerformanceProbe.exportJson())
```

The Phase 2 gate is:

1. parity tests remain green;
2. common indicator-runtime work records append/latest cache hits rather than repeated
   full rebuilds;
3. `indicator.viewport.pointsAvoided` is positive and retained windows exceed
   shifts during pan/zoom;
4. derived CPU (`indicator.compute` plus `indicator.compute.incremental` and
   `indicator.projection`) improves by at least 30% against the isolated Phase 1
   capture;
5. no empty visible region, Replay future leak, or indicator discontinuity is
   observed.

The `phase2` benchmark profile now derives a deterministic five-indicator
workload from the first five backend catalog definitions without modifying the
saved indicator workspace. This keeps the benchmark backend-driven and prevents
the benchmark harness from becoming a second frontend catalog. Historical
captures below retain the names used when those captures were recorded.

## First post-change capture

The first 5,000-candle capture used the saved custom-Pine workspace rather than
a deterministic built-in workload. It confirmed that viewport presentation is
active:

- 467,740 offscreen indicator points were not published;
- 435 viewport notifications retained the current window versus 102 shifts;
- 11,198 unchanged indicator writes were skipped;
- pane-anchor updates remained incremental (295 updates, five replacements).

It is not a valid built-in incremental gate. All 1,209 measured computations
were custom-Pine full-history fallbacks, so no `indicator.cache.append` or
`indicator.cache.update-latest` counter could occur. Derived compute plus
projection totaled 2,561ms, indicator `setData` totaled 2,209ms, frame p95 was
100.1ms, and 300 long tasks totaled 21,780ms. Heap usage was 493MB after an
already-running development session, so it also requires a fresh-page capture
before comparison.

The follow-up adds the deterministic `phase2` URL profile above. Custom Pine
identity reuse is keyed by the Pine runtime revision: repeated renders can
reuse a result, while an async compile completion changes the revision and
invalidates the placeholder safely.

## Final Phase 2 capture

The fresh-page deterministic built-in capture passed the Phase 2 invariants:

- five initial full rebuilds seeded the five built-ins;
- exactly 1,500 incremental appends handled five indicators across 300 Replay
  bars, with no additional full rebuild;
- incremental compute totaled 45.2ms (p95 0.1ms), while initial full compute
  totaled 12.6ms;
- viewport projection avoided publishing 1,520,349 points;
- retained viewport windows outnumbered shifts 684 to 147;
- indicator latest/append writes used 2,093 `update` calls, while 350 structural
  replacements corresponded to render-window shifts;
- indicator `setData` time was 547.7ms and indicator projection was 875.6ms;
- only 79 long tasks totaled 4,401ms;
- fresh-page heap usage was 58.0MB.

Against the first post-change custom-fallback capture, compute plus projection
fell from 2,561ms to 933.4ms (-63.6%), indicator `setData` time fell from
2,209.2ms to 547.7ms (-75.2%), and long-task count fell from 300 to 79. The
workload is intentionally different—the earlier capture proved the safe custom
fallback and the final profile isolates supported built-ins—so the exact cache
counters, parity tests, and deterministic profile are the primary acceptance
evidence.

Frame p95 was 66.7ms and React commit p95 was 14.3ms. One 12.6-second frame
interval shows that the tab was briefly backgrounded, invalidating max frame
and wall-clock duration but not the counter-level cache gate. Phase 2 is
complete; primary candle series windowing remains deferred and Phase 3 may
proceed with chunked canonical storage when requested.
