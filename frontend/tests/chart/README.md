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
- nearest loaded candle lookup for `Go to`,
- logical range centering that preserves the current zoom span,
- candle series merge/update planning for REST-history vs realtime races,
- custom Pine `request.security()` cache-key policy for MT5 same-window OHLC refreshes,
- local date/time draft parsing,
- fixed Monday-first calendar grid generation.

Keep browser/visual assertions out of this folder. Pure chart math belongs here;
DOM rendering and pointer interaction should use a separate browser test suite.
