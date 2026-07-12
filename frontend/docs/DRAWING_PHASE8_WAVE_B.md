# Drawing Phase 8 — Wave B

_Date: 2026-07-12_  
_Status: implemented_  
_Scope: shared level, fan, radial, Gann-grid, and median-line geometry_

## Delivered catalog

| Family | Stable tool ids | Anchors |
| --- | --- | --- |
| Parallel Fib levels | `fibChannel` | three |
| Fans and time levels | `fibSpeedFan`, `trendFibTime`, `pitchfan`, `gannFan` | two; three for trend time and pitchfan |
| Radial levels | `fibSpeedArcs`, `fibCircles`, `fibWedge` | two; three for wedge |
| Gann grids | `gannSquare`, `gannBox` | two |
| Median lines | `pitchfork`, `insidePitchfork`, `schiffPitchfork`, `modifiedSchiffPitchfork` | three |

The catalog now contains 62 persistent tool ids. Every Wave B tool is registered through the typed
manifest and consumes existing `fibLevels`, `channelLevels`, common style properties, precise
coordinates, visibility, templates, magnets, history, synchronization, object tree, and versioned
persistence contracts.

Creation is enabled by default. `NEXT_PUBLIC_DRAWING_PHASE8_WAVE_B=false` hides Wave B creation
entries while adapters and codecs remain loaded for existing saved drawings.

## Official behavior baseline

- Fib Channel projects Fibonacci ratios as parallel offsets from a source channel.
- Fib Speed Resistance Fan, Gann Fan, and Pitchfan project ratio/angle rays from an origin.
- Fib Speed Resistance Arcs, Fib Circles, and Fib Wedge apply Fibonacci ratios to radial geometry.
- Trend-Based Fib Time uses a source trend interval and a third projection origin, then places
  Fibonacci levels on the time axis.
- Gann tools visualize time/price proportions; the 1x1 angle is meaningful only with the chart's
  current visual scaling.
- A Pitchfork contains a median line plus upper/lower parallel support/resistance lines. Inside,
  Schiff, and Modified Schiff variants alter the median origin or side spacing.

Primary references:

- https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/
- https://www.tradingview.com/support/solutions/43000518136-trend-based-fib-time-drawing-tool/
- https://www.tradingview.com/support/solutions/43000558494-fib-speed-resistance-fan-drawing-tool-is-inverted-reversed/
- https://www.tradingview.com/support/solutions/43000518151/gann-fan/
- https://www.tradingview.com/support/solutions/43000518149/gann-square/
- https://www.tradingview.com/support/folders/43000547459-how-to-use-various-drawing-tools/
- https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/

## Shared geometry contracts

### Levels and fans

- Fib Channel interpolates enabled Fib ratios between the source baseline and its third-anchor
  parallel offset. External enabled ratios expand render, hit, and culling bounds together.
- Fib Speed Fan projects enabled ratios from the first anchor through ratio points at the second
  anchor's time coordinate. Reverse behavior uses the existing Fib reverse/default geometry path.
- Pitchfan projects rays from its origin through ratio positions along a two-anchor base.
- Gann Fan exposes nine conventional slopes from `1:8` through `8:1` in current CSS-pixel space.
- Trend-Based Fib Time stores A/B/C and projects vertical levels from C using the A-B time span.

### Radial levels

- Speed Arcs use elliptical radii derived from two anchors; Fib Circles use a circular radius.
- Fib Wedge adds a third anchor to bound the angular sector.
- All radial families use a bounded enabled ratio list, exact stored anchors, finite spatial bounds,
  and ellipse/radius-aware body hit tests.

### Gann grids

- Gann Box divides its two-anchor rectangle into eighths in both axes.
- Gann Square adds diagonal/diamond guides to the same time/price grid.
- Fill, border, grid lines, hit geometry, anchors, and spatial bounds share one box contract.

### Pitchfork variants

- Standard Pitchfork draws a median ray from point A through the B-C midpoint and parallel side rays.
- Inside Pitchfork moves the side origins halfway toward the midpoint.
- Schiff Pitchfork moves the median origin halfway from A to B.
- Modified Schiff Pitchfork shifts the median origin halfway in time while retaining A's price.
- Existing channel ratios contribute additional parallel median lines without tool-id branching in
  shared interaction code.

## Model and migration

No payload migration or backend API change is required. Wave B adds stable manifest ids only and
reuses validated optional properties already supported by the drawing codec. The all-tool fixture
test proves encode/decode round trips for every new id. Older clients safely quarantine unknown ids.

## Intentional differences

- Gann slope/ratio geometry is evaluated in current CSS-pixel projection. A future scale-lock
  capability is needed for TradingView's exact price-to-bar ratio preservation and Shift locking.
- Speed Resistance Arcs currently render complete ellipses instead of directional half-arcs. This
  preserves deterministic hit/culling geometry until an explicit arc-direction property is added.
- Wave B reuses the existing Fib level editor. It does not yet expose every TradingView family-
  specific preset, label-alignment option, per-line opacity, or reverse control as a separate schema.
- Pitchfork formulas implement the documented origin differences, but omit TradingView's full
  alternate level presets and per-level fills.
- Dynamic alerts remain unavailable because every Wave B target changes with time/scale; fixed-price
  snapshot alerts would be misleading.

## Performance review

- Fan and pitchfork level counts are bounded by validated settings.
- Radial ratios are bounded and do not sample curves into large point arrays; Canvas primitives are
  used directly.
- Time projections use a fixed coefficient list.
- The existing 5,000-object spatial benchmark remains rectangle-based and therefore measures shared
  index regression, not worst-case radial rendering. Wave B adapter tests exercise every family;
  family-specific frame profiling should be added before enabling thousands of simultaneous radial
  objects.

## Verification

- `npm run typecheck`: passing.
- `npm run build`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist warnings.
- `npm run test:drawing`: 117/117 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 18/18 passing in 2.4 minutes.
- `npm run benchmark:drawing`: at 5,000 drawings, rebuild median 1.921 ms and query median 0.152 ms.

## Remaining Phase 8 waves

- Wave C: pattern framework.
- Wave D: data-dependent and rich-content tools.
