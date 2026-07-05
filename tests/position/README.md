# Position Tests

This folder contains TypeScript tests for the Long / Short Position drawing tool.
See `docs/POSITION_TOOL_ARCHITECTURE.md` for the full rendering and interaction
contract.

The current suite focuses on shared tick/price math because the settings dialog,
canvas labels, and future position-template code must all agree on the same
TradingView-style contract:

- `Ticks` is the integer distance between entry and target/stop in symbol ticks.
- `Price` is derived from `entry +/- ticks * tickSize`.
- Editing a price should snap to the symbol tick size and round-trip back to the
  same tick count.
- Long and Short use the same math, with opposite profit/stop directions.
- Lot sizing is derived from Long/Short `SL-entry` distance, account risk,
  symbol tick value, and broker lot step/min/max.
- Numeric inputs must allow temporary drafts like empty text, `-`, or `.`
  without committing them as zero.

## Run

Use the repo-level script:

```bash
npm run test:position
```

The script compiles these `.ts` tests with `tsconfig.test.json` into
`.test-build/`, then runs them with Node's built-in test runner.  `.test-build/`
is ignored because it is generated output; the test source and config are kept
in git.

## Add Cases

Add tests here when changing:

- `src/components/chart/drawing/tools/positionMetrics.ts`
- `src/components/chart/drawing/tools/positionGeometry.ts`
- `src/components/chart/drawing/tools/positionInput.ts`
- `src/services/positionLotSizing.ts`
- Long/Short Position settings fields for `Ticks`, `Price`, or `Entry price`
- Position labels that display tick count or price
- Position handle movement, resize behavior, or body dragging
- Position drawing to Trade ticket prefill behavior
- Position drawing to Trade ticket lot/quantity prefill behavior
- Symbol metadata that changes tick size or price formatting

Prefer testing the shared math helpers instead of duplicating component-level
logic.  The UI should consume the helpers, not reinvent tick/price or lot
sizing conversion.
