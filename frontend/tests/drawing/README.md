# Drawing Tests

This folder contains TypeScript tests for shared drawing-tool behavior. The
current production catalog has 84 persistent adapters (plus four non-persistent
manifest modes).

The current suite covers shared geometry plus Phase 0 characterization contracts:

- Anchor hit results must carry an explicit `anchorIndex`, including middle
  vertices that all share the generic `p0` target label.
- Ellipse selection must follow the actual ellipse geometry, not the rectangular
  bounding box.
- Filled polygons such as Triangle must be selectable from both closed edges and
  their interior.
- Sampled quadratic/cubic curves must provide stable body hit-testing and
  bounding boxes for viewport culling.
- Ray and Extended Line body hit-tests must match their one-way / two-way
  extension behavior, and axis-aligned line tools must drag on the expected
  axis only.
- Drawing viewport culling must use each tool adapter's `boundingBox()` instead
  of raw anchors, so extended geometry remains visible/selectable after pan/zoom.
- The render-loop memo guard must repaint when hover or multi-select state
  changes, even when drawing points and the primary selected id are unchanged.
- The interaction machine factory must return fresh mutable containers so
  rAF-based live previews and multi-drag state cannot leak between gestures.
- Hit-testing must preserve the selection-aware TradingView drag policy while
  avoiding unnecessary candidate sorting in the hot path: an unselected first
  drag moves the body, selected handles require the precise pointer-aware radius,
  and ambiguous overlapping anchors resolve to body.
- Command history round-trips create, move, property, duplicate, delete,
  undo, and redo transactions.
- The shared viewport subscription observes range/size/input changes and
  removes every listener cleanly.
- Real Brush, Path, Vertical Line, and Rectangle adapters are exercised by
  behavior tests instead of source-text regex checks.
- `allToolAdapterContract.test.ts` imports the production registry in Node and
  audits registration, capability-aware fixtures, selected rendering, finite
  bounds, body movement, anchor movement, selectable geometry, and exact
  `anchorIndex` identity for all 84 persistent tool ids.
- Browser tests retain registration/gesture integration coverage while the Node
  contract is the fast catalog-wide geometry oracle.
- Browser gesture smoke tests cover create, select, move, undo, redo, delete,
  and restoration of chart zoom interaction. Mouse and touch cases cover the
  shared first-drag/selected-handle policy.
- Position creation tests assert tick-snapped, viewport-visible initial geometry,
  candle-index session-gap handling, and logical-width body movement; and
  axis-constrained movement tests assert Horizontal/Vertical Line grab-offset
  preservation.
- Body movement for every drawing adapter uses logical candle-index deltas, so
  rectangles and other multi-anchor tools preserve their width across weekend,
  market-session, and unloaded-data gaps. Touch resize owns the gesture through
  the shared chart-interaction lock and blocks the underlying chart pan/zoom.
- Phase 5 persistence contracts cover historical flat-payload migration, current-schema
  round-trips for every persistent tool, transient-field stripping, quarantine of unknown/future
  payloads, clipboard validation, stale-load cancellation, retrying/persisted outbox behavior,
  anonymous-to-authenticated migration, and last-write-wins revision rebasing.

## Run

Use the repo-level script:

```bash
npm run test:drawing
```

The script compiles these `.ts` tests with `tsconfig.test.json` into
`.test-build/`, then runs them with Node's built-in test runner. `.test-build/`
is ignored because it is generated output; the test source and config are kept
in git.

Run only the persistence boundary/outbox contracts with:

```bash
npm run test:drawing-persistence
```

## Add Cases

Add tests here when changing:

- `src/components/chart/drawing/tools/plugins/shapeGeometry.ts`
- `src/components/chart/drawing/tools/plugins/lineGeometry.ts`
- Shape plugin hit-testing or anchor behavior
- Line plugin hit-testing, extension behavior, or axis-constrained movement
- Shape plugin viewport bounds or curve sampling
- Renderer viewport culling or memo-guard keys
- Multi-point shape drag/resize behavior that relies on `anchorIndex`
- Interaction state-machine helpers that underpin pointermove preview behavior
- Common pointer-frame coalescing, including immediate feedback, latest-sample collapse, and exact
  pointerup flush behavior
- Hit-test priority, especially anchor-vs-body and z-index ordering
- Selection-aware hit resolution for mouse and touch: unselected first drag,
  selected precise-handle radius, and overlapping-anchor body fallback
- Any adapter render/hit/bounds divergence, including extensions, fills,
  repeated projections, radial sweeps, candle wicks/bodies, and leader lines
- Adapter runtime inputs: pass read-only values through projector/interaction
  context; add memo-key coverage and never read a store from a plugin
- Tool manifest shortcuts, viewport-culling policy, position side, snapshots,
  content, or other shared capabilities
- The command transaction boundary or viewport event subscription contract

## Browser contracts

Run the drawing browser suite with:

```bash
npm run test:chart-browser -- drawingInteractions.spec.ts
```

The suite uses semantic development-only harnesses; it does not inspect source
text or depend on canvas screenshots for state assertions.

The focused mobile rectangle contract can be run with:

```bash
npx playwright test tests/browser/mobileDrawing.spec.ts
```

It creates, moves, and resizes a rectangle through touch input and verifies that
the chart viewport does not move while the drawing owns the gesture.

## Last verified gates (2026-07-13)

- `npm run typecheck`: pass
- `npm run lint`: 0 errors; two pre-existing Watchlist hook warnings
- `npm run test:drawing`: 153/153 pass
- `npm run test:drawing-persistence`: 18/18 pass
- `npm run test:position`: 41/41 pass
- `npm run check:drawing-viewport`: 7/7 pass
- `npm run build`: pass
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 23/23 pass
  (full suite, approximately 3.7 minutes)
- Focused dense-zoom regression `compact one-click Long position`: pass; the
  initial box is at least 158 CSS pixels wide and target/stop stay in the pane
  before any move or resize
- Focused right/top-edge creation regression: pass; available width is honored
  and both target/stop remain inside the pane
