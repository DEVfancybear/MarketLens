# Candle Virtualization — Phase 2 Viewport-Aware Derived Data

_Implemented: 2026-07-11. Browser performance gate pending a focused capture._

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
http://localhost:3000/?chartPerf=1&chartFixture=5000
await window.__chartBenchmark.run()
copy(window.__chartPerformanceProbe.exportJson())
```

The Phase 2 gate is:

1. parity tests remain green;
2. built-in realtime work records append/latest cache hits rather than repeated
   full rebuilds;
3. `indicator.viewport.pointsAvoided` is positive and retained windows exceed
   shifts during pan/zoom;
4. derived CPU (`indicator.compute` plus `indicator.compute.incremental` and
   `indicator.projection`) improves by at least 30% against the isolated Phase 1
   capture;
5. no empty visible region, Replay future leak, or indicator discontinuity is
   observed.

The ≥30% browser CPU gate remains pending until the post-change JSON capture is
recorded. Phase 3 must not begin from whole-app frame percentiles contaminated
by a background tab or unrelated live MT5 work.
