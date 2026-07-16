# Drawing Phase 7 Parity Checklist

_Date: 2026-07-12_  
_Status: implemented_

> Historical Phase 7 verification snapshot. For the current 84-adapter catalog
> and the post-Phase 8 geometry/purity audit, see
> `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`. The deferred items
> below are historical; the 2026-07-16/17 follow-up supersedes them where noted.

This is the executable-scope checklist for Phase 7 of
`DRAWING_TOOLS_MAINTENANCE_REFACTOR_PLAN.md`. Historical payloads keep their
defaults; new optional fields are capability-scoped and pass through the versioned codec.

## Trendline

- [x] Configurable normal/arrow start and end decorations.
- [x] Selected midpoint handle, endpoint price labels, and delta/percent stats.
- [x] Shift constrains creation and endpoint resize to visual 45-degree increments.
- [x] Direct midpoint text editing, precise coordinates, and interval visibility.
- [x] Manifest, settings, geometry, and persistence contract coverage.

## Parallel channel

- [x] Three-anchor creation with a real draggable price-offset anchor; legacy two-point
  payloads retain their historical projection.
- [x] Editable enabled/disabled custom ratio levels.
- [x] Left, right, both, or no extension.
- [x] Background bands and direct text. Render, hit-test, and bounds share level geometry.
- [x] Dynamic sloped-channel alerts were deferred in this historical snapshot;
  the 2026-07-16/17 follow-up now provides immutable time-indexed line/channel/
  Fib Channel targets, shared open/push evaluation, evidence verification, and
  expiration. See `DYNAMIC_DRAWING_ALERTS_PLAN.md`.

## Fibonacci

- [x] Twenty-four editable rows: enable, ratio, color, and per-level text.
- [x] One-color mode, background, reverse, extension, labels, and log math.
- [x] Enabled retracement/extension level alerts snapshot price and provenance.
- [x] Legacy `fib` remains decode/render compatible.

## Text

- [x] Direct creation and re-editing.
- [x] Background, border, multiline wrap, font/style, and exact data-space anchor.
- [x] Shared coordinate and interval-visibility controls.

## Long/Short position

- [x] Formula fixtures cover long/short risk and leverage caps, point value, lot size,
  balances, and PnL.
- [x] Symbol-derived point/tick value and editable lot size.
- [x] Compact/selectable/always-visible stats.
- [x] Historical/future mark resolution, TP/SL lifecycle, and six virtual handles.
- [x] Trade-prefill is a pure projection and does not mutate the drawing.

## Freeform and curves

- [x] Continuous strokes sample at a stable two-CSS-pixel threshold.
- [x] Commit applies deterministic 0.75-CSS-pixel Ramer-Douglas-Peucker simplification.
- [x] Brush/highlighter rendering remains smoothed; curve hit-test samples the curve.
- [x] Pen pressure is normalized and persisted as optional point metadata.
- [x] Completion/cancellation remains owned and tested by `CreationSession`.
- [x] Variable-width pressure rendering was deferred in this historical snapshot;
  normalized pen pressure now drives bounded Brush/Highlighter segments while
  mouse/touch retain configured constant width.

## Regression gates

- `npm run typecheck`
- `npm run lint`
- `npm run test:drawing`
- `npm run test:drawing-persistence`
- `npm run test:position`
- `npm run test:chart-browser -- drawingInteractions.spec.ts`

Recorded result on 2026-07-12: typecheck and lint pass (0 errors; two pre-existing
Watchlist warnings), Drawing 111/111, persistence 17/17, Position 26/26, and browser
interaction 16/16.
