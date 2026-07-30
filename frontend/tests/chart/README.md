# Chart Tests

This folder contains cloneable TypeScript tests for chart-level behavior that
does not need a browser.

Run:

```bash
npm run test:chart
```

Current coverage:

- bottom time-toolbar range shortcut math,
- TradingView-like chart visual profile margins, candle palette, initial
  density, and right-offset defaults,
- viewport-stability options that prevent whitespace replacement from snapping a user-panned chart,
- `All` shortcut dispatch sentinel,
- nearest loaded candle lookup for `Go to`, explicit out-of-window detection,
  and the no-tail-clamping invariant,
- logical range centering that preserves the current zoom span,
- candle series merge/update planning for REST-history vs realtime races, including stale MT5
  refresh-tail detection,
- candle data-window reset policy for symbol/timeframe changes whose timestamps
  overlap, same-market history prepends, and disjoint replacements,
- custom Pine `request.security()` cache-key policy for MT5 same-window OHLC refreshes,
- local date/time draft parsing,
- fixed Monday-first calendar grid generation.
- viewport-controller write attribution and no-op dedupe,
- price-scale gesture activation, public visible-range scaling, missed-release
  recovery, repeated drag cleanup, and multi-pane auto-scale reset,
- responsive half-plot deep-zoom limits derived from the live plot width across
  compact mobile and wide desktop layouts,
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

It runs one deterministic chart fixture through crosshair movement across
native panes, wheel zoom, repeated plot pan, cancelled and repeated price-axis
scaling, double-click auto-scale reset, pane resize, and history prepend with
visible timestamp-range preservation.
