# Drawing Tools Post-Phase 8 Maintenance

_Date: 2026-07-13; parity/Gann follow-up updated 2026-07-17_
_Status: implemented; Node, build, and browser integration gates verified_
_Scope: drawing manifest, adapters, shared geometry contracts, interaction context, and executable tests_

This document is the current maintenance record after Phase 8. The individual
Phase 0 and Phase 7/8 documents remain useful milestone records, but their tool
and test counts are historical snapshots.

The official-source parity audit and the latest line-family maintenance are recorded in
`DRAWING_TOOLS_TRADINGVIEW_PARITY_AUDIT_2026-07-15.md`. New maintenance work must consult each
manifest entry's `officialDocs` before changing behavior.

## Outcome

- `DRAWING_TOOL_MANIFEST` contains 88 stable entries: four non-persistent modes
  and 84 persistent drawing tools.
- Every persistent id has exactly one registered adapter and one capability-aware
  fixture.
- Cross-cutting behavior is selected by manifest capability rather than a tool-id
  branch in toolbar, hotkey, store, renderer, or interaction code.
- Adapters are deterministic functions of the drawing plus explicitly supplied
  render/interaction context. They do not read Jotai or chart stores.
- Render, hit-test, anchor identity, transform, and spatial bounds are checked by
  an executable Node contract for all persistent adapters.

The maintenance did not change the persisted drawing envelope or backend API.
Existing stable ids, including legacy `fib`, remain decode/render compatible.

## Why a post-Phase 8 audit was required

The original browser adapter audit proved that methods could be called, but it
accepted `null` bounds, did not assert that hit results selected the expected
geometry, and did not resize every exposed handle. Generic fixtures also lacked
the candle snapshots and rich-content payloads required by Wave D tools. A tool
could therefore be registered and still have a visible/rendered region that was
not selectable or was culled incorrectly.

The new audit treats the adapter as a geometry contract rather than a collection
of callable methods. For every persistent tool it requires:

1. a registered adapter whose creation topology agrees with the manifest;
2. a realistic fixture with finite points and capability-required payloads;
3. selected-state rendering without store or browser-runtime access;
4. a finite, non-negative spatial bounding box;
5. unique projected handles with stable integer identities;
6. finite point-preserving body movement and anchor movement;
7. a selectable result at every visible handle/body probe; and
8. exact `anchorIndex` preservation for every non-body handle.

## Current contracts

### Manifest and capabilities

`src/types/drawingToolManifest.ts` is the catalog source of truth. It owns stable
ids, display/group/icon metadata, creation mode and point topology, defaults,
settings features, shortcuts, rollout flags, magnet eligibility, overlay and
lifecycle extensions, data-snapshot/content requirements, position side, alert
projection, and viewport-culling policy.

The renderer consumes `viewportCulling`; hotkeys and toolbar shortcut labels
consume `shortcuts`; position creation/lifecycle code consumes `positionSide`;
and Highlighter defaults are resolved from its manifest entry. Duplicate ids,
duplicate shortcut chords, and adapter/manifest topology drift fail during
bootstrap or contract tests.

### Adapter purity and explicit context

`DrawingAdapter.render()` receives a `Projector`. In addition to coordinate
projection and canvas dimensions, the projector can carry:

- `barIntervalSeconds` for interval-derived labels such as Info Line; and
- read-only `market` data for pixels/labels that depend on candles, symbol tick
  size, price precision, or point value.

`DrawingAdapter.move()` and `moveAnchor()` can receive a small
`DrawingAdapterInteractionContext`. It carries the symbol `tickSize`, active
timeframe interval, and the active chart candle slice needed to keep Position
handles snapped and preserve logical bar width during live transforms. The
composition root derives these inputs once and includes render-relevant values
in the memo signature. Adapters must not import a store to recover them.

Wave D snapshot tools continue to render from immutable `Drawing.dataSnapshot`;
rich tools render from the validated `Drawing.content` envelope. Live market
context is not a replacement for persisted analytical input.

### Geometry parity

For any visible primitive, the following must describe the same projected
geometry:

```text
rendered pixels <-> hit-test candidates <-> bounding box <-> selected handles
```

An extension, fill, deviation band, wick, leader line, or angular sweep may not
exist only in `render()`. Repeated/time-projected tools must use the same bounded
iteration range in render and hit-test. Bounds must include extrema of the actual
finite geometry, not merely the stored anchors.

### Handle identity

`anchorIndex` is authoritative. Targets are visual/priority labels; they are not
an index encoding. Stored points 0 and 1 normally use `p1` and `p2`, while later
stored or virtual handles may share `p0`. Every displayed handle must return the
same integer identity from hit-test and `getAnchors()` so `TransformSession` can
call `moveAnchor()` deterministically.

Body-only tools explicitly return no handles. For a selected drawing, an
unambiguous handle inside the pointer-aware handle radius must resolve to its
exact `anchorIndex`; otherwise the interaction falls back to body movement.

### Compact drag and hit-resolution policy

The first drag on an unselected drawing is always a body drag. Selection and
movement therefore happen in one gesture without a nearby endpoint unexpectedly
resizing the drawing. Handle resize is enabled only after the drawing is already
selected and the pointer is inside the precise input-specific radius. Mouse and
touch use the same decision policy with pointer-aware radii; touch receives the
larger physical target without making mouse hits imprecise.

If multiple projected anchors overlap within that radius and the intended
anchor cannot be identified unambiguously, the result is `body`. This preserves
the compact drawing's current size instead of arbitrarily stretching one end.
The rule applies at interaction resolution, while adapters still expose every
visible handle and its exact `anchorIndex` for deterministic selected resizing.

## Audit fixes

### Catalog and shared behavior

- Moved tool shortcut ownership into the manifest and added normalized lookup,
  formatting, and duplicate-chord validation.
- Replaced hard-coded Long/Short renderer/store checks with manifest
  `viewportCulling` and `positionSide` capabilities.
- Centralized position creation defaults and Highlighter defaults behind pure,
  capability-driven resolvers.
- Corrected default anchor labels so third and later points remain resize handles
  with explicit indices instead of falling through to body movement.

### Projection and radial families

- Forecast now shares one projected triangle for render, fill/edge hit-testing,
  handles, and bounds.
- Sector uses one signed angular sweep contract, including fill/edge selection
  and cardinal extrema in its bounds.
- Fib Wedge uses its third anchor to bound the visible angular sweep in render,
  hit-test, bounds, and selected handles instead of treating it as a full circle.

### Range, channel, and time families

- Price Range right extension now participates in hit-testing and culling bounds,
  not only rendering.
- Flat/Disjoint channel fills are body-selectable, and Disjoint Channel's third
  and fourth handles resize their corresponding stored points.
- Cyclic Lines uses the same bounded sequence in render and hit-test, including
  repetitions beyond the previous hit-test cutoff.
- Time Cycles uses a shared 256-cycle bound. Its second selected handle is
  projected onto the rendered baseline so the visual handle and resize target
  cannot diverge.

### Snapshot/data families

- Regression Trend shares projected center/upper/lower paths across render,
  hit-test, and bounds. Deviation lines are selectable and interleaved samples no
  longer produce invalid bounds.
- Bars Pattern hit-testing follows the rendered candle wicks and bodies; it no
  longer tests an invisible close-only polyline.
- Fixture generation now supplies bounded candle snapshots to snapshot-capable
  tools and valid table/image/social content to rich-content tools.

### Annotation, shape, and freehand families

- One-point annotation and Callout leader connectors are selectable.
- Emoji hit/bounds geometry is derived from its configured font size.
- Arrow, Circle, Ellipse, Rectangle, and Rotated Rectangle handle hits preserve
  explicit `anchorIndex` values.
- Brush endpoint handles now have matching hit candidates and identities.
- Text and Vertical Line explicitly advertise no resize handles because their
  intended interaction is body movement.

### Info Line and Position

- Info Line reads the active bar duration from `Projector.barIntervalSeconds`
  rather than the chart store.
- Position rendering consumes explicit market context for candle marks, tick
  size, precision, and point value. Live move/resize receives tick constraints
  through interaction context.
- Position creation and trade-prefill remain pure projections; runtime context
  does not leak into persisted payloads.
- Initial Long/Short Position geometry is snapped to the symbol tick at creation,
  so its first rendered width/levels are already the same geometry used after a
  move or resize.
- The default Position right edge is resolved by candle index from the active
  chart context, skipping closed-market/session gaps. It uses 20 bars or expands
  to 160 CSS pixels at dense zoom levels when space permits, then fits the
  available right-side canvas room for clicks near the latest bar.
- Default target/stop distance is sampled from the active price scale and capped
  to a 96 CSS-pixel half-height before tick snapping. A fixed percentage of a
  high-precision FX price can no longer push both zones outside the pane.
- Future/whitespace projection uses the candle slice owned by the active chart
  context. Position width therefore stays aligned with the visible replay/chart
  data instead of a stale or global candle series.
- Position body movement uses candle indices when runtime context is available,
  preserving the logical bar span across weekends and other session gaps.
- Whitespace pointer/time projection uses the median candle cadence and a real
  chart logical anchor. This ignores isolated session gaps while remaining the
  exact inverse for replay/fixture slices whose cadence differs from the toolbar.
- Crossed left/right handles retain at least 12 CSS pixels of logical-bar width
  instead of collapsing a 15-minute Position to a one-second line.

### Compact and axis-constrained movement

- Horizontal and Vertical Line body movement preserves the pointer-to-line grab
  offset. The line no longer jumps under the pointer on the first move sample.
- First-drag body preference and selected-only handle resize are shared across
  compact tools, including mouse and touch input. Ambiguous overlapping handles
  deliberately resolve to body movement.
- The creation listener consumes the completing `pointerdown` immediately. After
  a tool commits and synchronously returns to cursor mode, that same DOM event
  cannot fall through into the cursor listener and create a phantom Move/Resize
  command.
- Default body movement and multi-selection movement use one logical candle
  delta when chart context is available. Every anchor is projected through the
  same candle-index mapping, so moving a Rectangle or other default adapter
  across a weekend/session/Replay gap preserves its rendered bar span instead
  of shrinking through raw timestamp addition.
- Drawing, alert, and Replay layers share a reference-counted chart interaction
  lock. Releasing one pointer owner cannot restore chart pan/zoom while another
  transform remains active.
- Captured touch blockers are explicitly non-passive and prevent default before
  stopping propagation. Real mobile touch can resize selected Rectangle handles
  without leaking a simultaneous pan/scale gesture into Lightweight Charts.

## Tests added or strengthened

The primary invariant is
`tests/drawing/allToolAdapterContract.test.ts`. It imports the production
registry in Node and iterates all 84 persistent ids. This makes missing adapters,
store-coupled renderers, null/invalid bounds, detached handles, non-finite
transforms, and anchor-identity drift fail one executable test.

Focused family regression coverage lives in:

- `waveACatalog.test.ts`: range extensions, channel fills/extra anchors, and
  long cyclic projections;
- `waveBCatalog.test.ts`: radial/Fib Wedge angular geometry;
- `waveCCatalog.test.ts`: Time Cycles bound and handle projection;
- `waveDCatalog.test.ts`: Forecast/Sector geometry, Regression bands, and Bars
  Pattern candle hits;
- `toolManifest.test.ts` and `drawingToolPreferences.test.ts`: capabilities,
  shortcuts, and defaults;
- `renderCulling.test.ts`: capability-driven culling and render memo inputs;
- `infoLineTool.test.ts`: explicit bar-interval input, isolated panel rendering,
  segment/anchor hits, and finite panel-aware culling bounds; and
- the Position tests: pure creation/trade-prefill, viewport-aware defaults,
  closed-session timelines, hit resolution, projected geometry, metrics,
  tick-aware transforms, logical-width body movement, and compact mouse/touch
  move versus precise-handle resize; and
- the browser drawing suite: compact Position move/resize, creation-history
  boundaries, cancellation, touch/mouse gestures, the Phase 8 wave flows, and
  immediate Long Position visibility at 1.5 CSS pixels per bar; and
- `mobileDrawing.spec.ts`: real touch Rectangle creation/handle resize with an
  unchanged main-chart logical range.

Run the integrated maintenance gates from `frontend/`:

```bash
npm run typecheck
npm run lint
npm run test:drawing
npm run test:drawing-persistence
npm run test:position
npm run check:drawing-viewport
npm run test:chart-browser -- drawingInteractions.spec.ts
npx playwright test tests/browser/mobileDrawing.spec.ts
npm run benchmark:drawing
```

Do not replace these behavior contracts with TypeScript source-text regexes.
Canvas screenshots can complement them for visual review, but screenshots are
not the identity/geometry oracle.

### Verified maintenance gates

The final maintenance verification completed with:

- `npm run typecheck`: pass;
- `npm run lint`: 0 errors, with two pre-existing Watchlist hook warnings;
- `npm run test:drawing`: 153/153 pass;
- `npm run test:drawing-persistence`: 18/18 pass;
- `npm run test:position`: 41/41 pass;
- `npm run check:drawing-viewport`: 7/7 pass; and
- `npm run build`: pass;
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 23/23 pass
  (full suite, approximately 3.7 minutes); and
- focused browser regressions for dense zoom and right/top-edge placement: 2/2
  pass after the viewport/session-gap fix; and
- mobile Rectangle create/resize regression: 1/1 pass with touch input and no
  chart viewport drift; and
- `npm run benchmark:drawing`: pass through the 5,000-drawing workload, with
  median spatial-index rebuild below 2 ms and median query below 0.2 ms.

## Adding or maintaining a tool

1. Add or update its manifest entry. Declare every cross-cutting behavior as a
   capability; do not add an id branch to a shared consumer.
2. Register one adapter (a family file may register several related ids).
3. Keep rendering, hit-testing, bounds, and handles on shared projected geometry.
4. Return explicit `anchorIndex` for every visible non-body handle.
5. Use the projector/interaction context for runtime read-only inputs; never read
   a store from an adapter.
6. Extend the capability-aware fixture when the tool needs snapshots or content.
7. Add a focused family regression and keep the all-adapter contract green.
8. Document intentional TradingView differences and any bounded work limit.

## 2026-07-16/17 follow-up (supersedes the deferred list)

The original post-Phase 8 deferred list is no longer the current feature state:

- Magnet strength remains Off/Weak/Strong for OHLC, with `Snap to indicators`
  delivered as an independent capability. Visible overlays and OHLC candidates
  use one projected-distance policy and preserve fallback behavior.
- Dynamic line/channel/Fib Channel alerts now snapshot versioned data-space
  targets. Open and push evaluation share the moving-boundary evaluator; trigger
  requests carry normalized previous/current market evidence and
  `armingRevision`; Go reloads the target and recomputes the condition before
  persistence. Finite domains enter the bootstrapped `expired` lifecycle.
- Brush/Highlighter capture normalized pen pressure, render bounded
  variable-width segments, and simplify without discarding pressure ramps or
  spikes. Mouse/touch strokes remain constant-width by design.
- Gann Fan/Square/Box use typed persisted configs and verified nine-angle/eighth
  defaults. Square/Box price/time rows persist independent color, opacity,
  width, and line style; `Use one color` selects the shared drawing color at
  render time. Enabling logical-bar scale locking captures the object's current
  price-per-bar ratio before resize, avoiding a jump to the legacy fallback.
  This claims observed built-ins plus custom settings, not undocumented
  TradingView template names.
- Fixed/Anchored Volume Profile select complete measured ticks first, then
  validated lower-timeframe OHLCV, then chart bars. Partial coverage never
  displaces a complete coarser source.
- The manifest-derived visual matrix covers all persistent ids semantically and
  every creation-enabled id with a stable Playwright screenshot name. Browser
  runs use a fixed clock, manifest-id selectors, representative/full/per-id
  modes, and reviewed platform baselines under the browser snapshot directory.

Remaining boundaries are explicit rather than hidden: vertical/time alerts and
touch tolerance need separate condition semantics; incomplete market history
falls back instead of being reconstructed speculatively; executable third-party
embeds remain unsupported; and no blanket pixel-for-pixel TradingView
equivalence is claimed. See
`DRAWING_TOOLS_TRADINGVIEW_PARITY_AUDIT_2026-07-15.md` for the current evidence.
