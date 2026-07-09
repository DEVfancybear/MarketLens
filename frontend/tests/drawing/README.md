# Drawing Tests

This folder contains TypeScript tests for shared drawing-tool behavior.

The current suite focuses on `shapeGeometry.ts`, the common helper layer used by
shape-like TradingView tools:

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
- Hit-testing must preserve TradingView priority while avoiding unnecessary
  candidate sorting in the hot path.

## Run

Use the repo-level script:

```bash
npm run test:drawing
```

The script compiles these `.ts` tests with `tsconfig.test.json` into
`.test-build/`, then runs them with Node's built-in test runner. `.test-build/`
is ignored because it is generated output; the test source and config are kept
in git.

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
- Hit-test priority, especially anchor-vs-body and z-index ordering
