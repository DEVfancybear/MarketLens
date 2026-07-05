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
- `All` shortcut dispatch sentinel,
- nearest loaded candle lookup for `Go to`,
- logical range centering that preserves the current zoom span,
- local date/time draft parsing,
- fixed Monday-first calendar grid generation.

Keep browser/visual assertions out of this folder. Pure chart math belongs here;
DOM rendering and pointer interaction should use a separate browser test suite.
