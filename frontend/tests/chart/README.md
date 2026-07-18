# Chart Tests

This folder contains cloneable TypeScript tests for chart-level behavior that
does not need a browser.

Run:

```bash
npm run test:chart
```

Current coverage:

- bottom time-toolbar range shortcut math,
- TradingView-like chart visual profile margins and right-offset defaults,
- viewport-stability options that prevent whitespace replacement from snapping a user-panned chart,
- `All` shortcut dispatch sentinel,
- nearest loaded candle lookup for `Go to`, explicit out-of-window detection,
  and the no-tail-clamping invariant,
- logical range centering that preserves the current zoom span,
- candle series merge/update planning for REST-history vs realtime races, including stale MT5
  refresh-tail detection,
- custom Pine `request.security()` cache-key policy for MT5 same-window OHLC refreshes,
- local date/time draft parsing,
- fixed Monday-first calendar grid generation.
- viewport-controller write attribution and no-op dedupe,
- crosshair time normalization to UTC timestamps.
- Replay cutoff normalization, session-isolated runtime cache keys, and causal
  fallback behavior during forward navigation and rewind,
- indicator series/label projection clipping and discrete histogram boundary
  handling.

Keep browser/visual assertions out of this folder. Pure chart math belongs here;
DOM rendering and pointer interaction should use a separate browser test suite.

The browser suite is `tests/browser/chartViewportSync.spec.ts`:

```bash
npm run test:chart-browser
```

It runs one deterministic chart fixture through four interaction steps:
crosshair movement across native panes, wheel zoom, autoscale plus viewport
resize, and history prepend with visible timestamp-range preservation.
