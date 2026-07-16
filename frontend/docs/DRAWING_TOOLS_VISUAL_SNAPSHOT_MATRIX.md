# Drawing Tools Visual/Browser Snapshot Matrix

_Last updated: 2026-07-17_

The matrix is generated from `src/types/drawingToolManifest.ts`; it is not a
second hand-maintained catalog. `tests/drawing/visualSnapshotMatrix.ts` emits
one row for every persistent drawing id (including the hidden legacy `fib`
entry). Each row records the creation topology, deterministic fixture point
count, toolbar group, screenshot filename, and the visual features that should
be inspected.

## Correctness boundary

`tests/drawing/allToolAdapterContract.test.ts` and the matrix unit test remain
the correctness oracle. They execute the production adapter for every
persistent id and verify finite geometry, bounds, movement, resize, and hit
identity. Screenshots are review artifacts only: fonts, device-pixel-ratio,
browser version, and GPU rasterization can change pixels without changing
geometry.

This follows the TradingView maintenance rule: read the tool's official
documentation before changing its adapter or settings. Start with the
[TradingView drawing catalog](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/),
then use the dedicated article URL in the manifest when one exists.

## Running the matrix

Fast, server-independent checks:

```text
npm.cmd run test:drawing
```

Browser capture is deliberately opt-in so normal CI does not require a Next
dev server or a local Edge/Chromium installation. Set the flag below to capture
every manifest tool that is visible in a creation menu:

```powershell
$env:DRAWING_VISUAL_MATRIX = "1"
npm.cmd run test:chart-browser -- drawingSnapshotMatrix.spec.ts
```

For a faster review pass, use `DRAWING_VISUAL_MATRIX=representative`; it
captures one stable case from each major visual family. With no flag the spec is
skipped, so the ordinary browser suite does not incur matrix startup cost.
During focused maintenance, pass one manifest id or a comma-separated id list
to run only the tools being changed:

```powershell
$env:DRAWING_VISUAL_MATRIX = "trendline,channel"
npm.cmd run test:chart-browser -- drawingSnapshotMatrix.spec.ts
```

Tool selection does not depend on translated accessible names or flyout order.
The spec opens the manifest-owned group and clicks
`[data-drawing-tool-id="<id>"]`, so focused and full runs exercise the same
catalog identity used by production creation.

The spec installs its clock before navigation and then fixes `Date`/`Intl` at
`2026-07-16T02:00:00Z` while allowing intervals and animation frames to keep
running. This stabilizes countdown/time-axis labels without freezing chart
interaction. Push endpoints are also stubbed so notification availability
cannot change the drawing pixels.

Playwright compares the chart against repository-owned, platform-specific
baselines in
`tests/browser/drawingSnapshotMatrix.spec.ts-snapshots/`, using stable logical
names such as `drawing-trendline.png` and a 0.5% pixel-difference tolerance.
Reviewed baseline PNGs are committed artifacts, not disposable test output.
Refresh them explicitly with Playwright's `--update-snapshots` flag, inspect the
actual/expected/diff result, and commit only intentional changes; a normal
matrix run must fail when paint output changes. Hidden/legacy tools remain
covered by the adapter contract and matrix unit test; they are intentionally
marked `contract-only` because TradingView-style creation menus do not expose
them.

When comparing a changed tool with TradingView, review the Playwright actual,
expected, and diff PNGs next to the geometry-contract output. Do not replace
geometry assertions with pixel diffs, and do not add one handwritten browser
test per tool: add a capability or fixture rule to the manifest-derived matrix
instead.

## 2026-07-17 verification record

- `npm.cmd run test:drawing`: 219/219 semantic and adapter-contract tests pass.
- Full matrix capture and replay pass for 83 creation-enabled ids; the hidden
  legacy `fib` id remains contract-only.
- Browser selection uses stable `data-drawing-tool-id` attributes, so a label or
  flyout-order change cannot silently exercise the wrong adapter.
