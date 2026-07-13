# Drawing Phase 8 — Wave A

_Date: 2026-07-12_  
_Status: implemented_  
_Scope: bounded catalog expansion using the stable range, channel, annotation, and time-projection families_

> Historical Wave A delivery/verification snapshot. Current catalog-wide
> contracts and follow-up range/channel/time fixes are recorded in
> `DRAWING_TOOLS_POST_PHASE8_MAINTENANCE_2026-07-13.md`.

## Delivered catalog

| Family | Stable tool ids | Creation contract |
| --- | --- | --- |
| Measurement ranges | `priceRange`, `dateRange`, `datePriceRange` | two points |
| Channel variants | `flatTopBottom`, `disjointChannel` | three and four fixed points |
| Annotations | `note`, `callout`, `comment`, `priceLabel`, `signpost`, `flag` | one point, except two-point Callout |
| Time projections | `cyclicLines`, `fibTimeZone` | two points |

All 13 tools are registered once through `drawingToolManifest.ts`, use the existing versioned flat
payload, inherit defaults/favorites/magnets/coordinates/visibility/templates/sync/object-tree/bulk
actions from manifest capabilities, and require no concrete tool-id branches in shared interaction
or persistence code.

Creation is enabled by default. Setting `NEXT_PUBLIC_DRAWING_PHASE8_WAVE_A=false` removes Wave A
entries/groups from the creation toolbar while keeping adapters and decoders active, so rollback
never hides or rewrites drawings that users already saved.

## Official behavior baseline

- TradingView documents Price Range as a vertical price measurement with price, percentage, and
  tick statistics; Date Range as a horizontal time measurement with elapsed time, bars, and volume;
  and Date and Price Range as their combined measurement.
- Flat Top/Bottom and Disjoint Channel belong to the channel family and support attached text.
- Note, Callout, Comment, Price Label, Signpost, and Flag Mark belong to the annotation catalog.
  Note supports direct on-chart text entry linked to its selected price.
- Cyclic Lines repeat the spacing established by the first two vertical lines into the future.
- Fib Time Zone projects vertical lines at Fibonacci time coefficients established by two anchors.

Primary references:

- https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/
- https://www.tradingview.com/support/solutions/43000516996-price-range-drawing-tool/
- https://www.tradingview.com/support/solutions/43000517005-date-range/
- https://www.tradingview.com/support/solutions/43000518161-cyclic-lines/
- https://www.tradingview.com/support/solutions/43000737571-note-drawing-tool/
- https://www.tradingview.com/support/solutions/43000710744-how-to-add-text-to-channel-drawing-tools/
- https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/

## Family contracts

### Measurement ranges

- Geometry is stored as two ordinary `(time, price)` anchors.
- Price Range renders/fills the price span and reports absolute and percentage change.
- Date Range renders/fills the time span and reports elapsed wall-clock time.
- Date and Price Range renders the complete box and combined statistics.
- Rendered boxes, labels, fill, anchors, hit geometry, and spatial bounds describe the same region.

### Channel variants

- Flat Top/Bottom uses a two-point sloped side plus a third anchor that fixes the horizontal side.
- Disjoint Channel stores two independent two-point sides, preserving all four anchors.
- Both support fill and attached text through existing shape/line capabilities.

### Annotations

- Note, Comment, Price Label, Signpost, and Flag Mark use the existing direct text-edit session and
  commit one undoable creation transaction.
- Callout uses a tip anchor and a separate label-center anchor. Its text is editable through shared
  drawing settings/direct selected-shape editing.
- Price Label advertises the existing fixed-price alert snapshot capability.

### Time projections

- Cyclic Lines repeats a constant first-to-second screen spacing across the visible future viewport.
- Fib Time Zone uses coefficients `0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89`.
- Both retain the two source anchors for precise coordinates, magnet snapping, movement, and resize.

## Model and migration

No schema migration or backend endpoint change is required. Tool ids are added to the typed manifest;
the existing drawing codec accepts them, validates finite points, emits the current schema version,
and round-trips all current metadata. Unknown older clients continue to quarantine unsupported ids
instead of corrupting known drawings.

## Intentional differences

- Range labels do not yet show candle count, aggregate volume, or symbol-specific pips/ticks because
  the drawing projector intentionally contains coordinates only, not candle/symbol datasets. Price
  delta, percentage, and elapsed wall time remain deterministic and persistence-safe.
- Range text/style controls reuse the shared shape schema rather than introducing a separate range
  settings dialog.
- Annotation renderers use plain canvas text. Rich content, markdown, images, social embeds, and
  TradingView's complete per-tool decoration catalog remain out of scope for Wave A.
- Fib Time Zone ships the standard fixed coefficient set. Per-level colors, coefficient editing,
  labels alignment, and alternating background zones are deferred to the shared level/fan Wave B.
- Cyclic/Fib time projections are capped to bounded visible/interaction samples so corrupted or very
  small anchor spacing cannot create unbounded render work.

## Verification

- `npm run typecheck`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist hook warnings.
- `npm run test:drawing`: 114/114 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 17/17 passing in 2.1 minutes.
- `npm run benchmark:drawing`: at 5,000 drawings, rebuild median 1.800 ms and visible-query median
  0.117 ms. Query performance matches the Phase 7 baseline; the rebuild sample remains within normal
  run-to-run variance and no new family code runs for unrelated fixtures.

## Remaining Phase 8 waves

- Wave B: shared level/fan geometry.
- Wave C: pattern framework.
- Wave D: data-dependent and rich-content tools.
