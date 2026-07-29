# TradingView Drawing-Tool Parity: Requested Groups

_Researched and implemented: 2026-07-28._

## Scope and sources

This audit covers every tool currently listed in the requested sections of the
official [TradingView drawing-tools overview](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/):

- 6 Cursors;
- 14 Fibonacci and Gann tools;
- 16 Geometric shapes, including the brushes and arrows listed in that section;
- 12 Annotation and content tools.

The official
[Advanced Charts drawing list](https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/)
was used as a second catalog check. Individual Help Center articles linked from
the overview were read tool by tool. Where TradingView does not publish an
individual article, the overview is the behavior/name authority. Every manifest
entry retains its machine-readable `officialDocs` source.

## Cursors — 6/6

| Official tool | Stable id | Persistence | Implemented behavior |
| --- | --- | --- | --- |
| Cross | `crosshair` | No | Default selection cursor; native horizontal and vertical crosshair lines remain visible |
| Dot | `dotCursor` | No | Selection cursor with a chart-local dot; native crosshair lines remain visible |
| Arrow | `cursor` | No | Classic pointer selection without crosshair lines |
| Demonstration | `demonstrationCursor` | No | `Alt/Option` press and drag creates temporary presentation strokes; click creates a temporary dot; marks fade and never enter history or persistence |
| Magic | `magicCursor` | No | Selection cursor with a chart-local sparkle treatment and no crosshair lines |
| Eraser | `eraser` | No | Resolves the topmost adapter hit and deletes through drawing history |

Cross and Dot intentionally keep crosshair lines; Arrow, Demonstration, Magic,
and Eraser do not. Demonstration follows TradingView's
[temporary drawing contract](https://www.tradingview.com/support/solutions/43000747626-how-to-draw-temporarily-on-the-chart-demonstration-cursor/).

## Fibonacci and Gann — 14/14

| Official tool | Stable id | Anchors | Production contract |
| --- | --- | ---: | --- |
| Fibonacci retracement | `fibRetracement` | 2 | Configurable retracement/extension levels, labels, reverse, background, linear/log projection |
| Trend-based fib extension | `fibExtension` | 3 | A-B impulse projected from C with independently draggable third anchor |
| Fib channel | `fibChannel` | 3 | Ratio-offset parallel levels, external-level bounds, dynamic alert projection |
| Fib time zone | `fibTimeZone` | 2 | Fibonacci-spaced vertical time levels |
| Fib speed resistance fan | `fibSpeedFan` | 2 | Ratio fan from the anchor trend; supports 45-degree constraint |
| Trend-based fib time | `trendFibTime` | 3 | Time projections derived from the A-B span and C origin |
| Fib circles | `fibCircles` | 2 | Concentric Fibonacci-ratio circles; supports 45-degree constraint |
| Fib spiral | `fibSpiral` | 2 | Golden-ratio logarithmic spiral with center/outer anchors and reversible chirality |
| Fib speed resistance arcs | `fibSpeedArcs` | 2 | Fibonacci-ratio resistance arcs |
| Fib wedge | `fibWedge` | 2 | Symmetric wedge boundaries and ratio arcs derived from center/direction anchors |
| Pitchfan | `pitchfan` | 3 | Three-anchor pitch fan |
| Gann fan | `gannFan` | 2 | Configurable angle ratios with price/bar scale locking |
| Gann square | `gannSquare` | 2 | Configurable square grid and price/bar ratio |
| Gann box | `gannBox` | 2 | Configurable box partitions and price/bar ratio |

The key individual references are the official articles for
[Retracement](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/),
[Trend-based extension](https://www.tradingview.com/support/solutions/43000518137-trend-based-fib-extension-drawing-tool/),
[Time Zone](https://www.tradingview.com/support/solutions/43000518155-fib-time-zone-drawing-tool/),
[Speed Fan](https://www.tradingview.com/support/solutions/43000518156-fib-speed-resistance-fan-drawing-tool/),
[Trend-based time](https://www.tradingview.com/support/solutions/43000518136-trend-based-fib-time-drawing-tool/),
[Circles](https://www.tradingview.com/support/solutions/43000518159-fib-circles/),
[Speed Arcs](https://www.tradingview.com/support/solutions/43000518157-fib-speed-resistance-arcs/),
[Wedge](https://www.tradingview.com/support/solutions/43000518153-fib-wedge-drawing-tool/), and
[Pitchfan](https://www.tradingview.com/support/solutions/43000518143-pitchfan-drawing-tool/).

## Geometric shapes — 16/16

| Official tool | Stable id | Creation | Production contract |
| --- | --- | --- | --- |
| Rectangle | `rectangle` | 2 corners | Border/fill/middle line/text/extension; 45-degree constraint |
| Rotated rectangle | `rotatedRect` | 3 points | Oriented closed polygon; 45-degree constraint |
| Path | `path` | Freeform clicks | Open multi-segment path; explicit/double-click finish |
| Circle | `circle` | Center + radius | Circular border/fill and 45-degree constraint |
| Ellipse | `ellipse` | 2 corners | Ellipse border/fill, ellipse-accurate hits, 45-degree constraint |
| Polyline | `polyline` | Freeform clicks | Open finish by double-click/right-click/Escape; closes and fills when the first anchor is clicked |
| Triangle | `triangle` | 3 points | Closed border/fill with interior hit testing |
| Arc | `arc` | 3 points | Sampled arc plus optional area between arc and chord |
| Curve | `curve` | Freeform controls | Adaptive sampled curve with matching hits/bounds |
| Double curve | `doubleCurve` | 4 points | Paired sampled curve geometry |
| Brush | `brush` | Continuous pointer | Pressure-aware simplified freehand stroke |
| Highlighter | `highlighter` | Continuous pointer | Wide translucent simplified freehand stroke |
| Arrow | `arrow` | 2 points | Directed line with terminal arrowhead |
| Arrow marker | `arrowMarker` | 2 points | Marker arrow with 45-degree constraint |
| Arrow mark up | `arrowMarkUp` | 1 point | Fixed-size upward chart mark |
| Arrow mark down | `arrowMarkDown` | 1 point | Fixed-size downward chart mark |

Detailed behavior was checked against the official articles for
[Rectangle](https://www.tradingview.com/support/solutions/43000516984-rectangle-drawing-tool/),
[Circle](https://www.tradingview.com/support/solutions/43000662172-circle-drawing-tool/),
[Ellipse](https://www.tradingview.com/support/solutions/43000516988-ellipse-drawing-tool/),
[Polyline](https://www.tradingview.com/support/solutions/43000516986-polyline-drawing-tool/),
[Triangle](https://www.tradingview.com/support/solutions/43000516814-triangle-drawing-tool/),
[Arc](https://www.tradingview.com/support/solutions/43000516989-arc-drawing-tool/),
[Brush](https://www.tradingview.com/support/solutions/43000516987-brush-drawing-tool/),
[Arrow](https://www.tradingview.com/support/solutions/43000518134-arrow-drawing-tool/), and
[Arrow marks](https://www.tradingview.com/support/solutions/43000518087-arrow-marks-drawing-tools/).
TradingView's current overview lists only Up and Down arrow marks. Left and
Right IDs remain registered solely for saved-layout compatibility and are not
offered for new creation.

## Annotation and content tools — 12/12

| Official tool | Stable id | Creation | Production contract |
| --- | --- | --- | --- |
| Text | `text` | 1 point | Inline text editor and text-style settings |
| Note | `note` | 1 point | Price-linked note with inline editor |
| Price note | `priceNote` | 2 points | Price anchor, leader and label anchor; optional text and 45-degree constraint |
| Pin | `pin` | 1 point | Pin marker with inline note editor |
| Table | `table` | 2 corners | Bounded persisted cell content, border/fill/text rendering |
| Callout | `callout` | 2 points | Leader plus editable callout body |
| Comment | `comment` | 1 point | Compact editable comment |
| Price label | `priceLabel` | 1 point | Price-derived label and alert projection |
| Signpost | `signpost` | 1 point | Compact indexed signpost with editable text |
| Flagmark | `flag` | 1 point | Flag pole/label and editable text |
| Image | `image` | 2 corners | Bounded image content payload, alt/fallback rendering and persisted geometry |
| X posts and ideas | `socialEmbed` | 1 point | Bounded social-card payload and editable URL/text content |

Individual references include
[Text](https://www.tradingview.com/support/solutions/43000516983-text-drawing-tool/),
[Note](https://www.tradingview.com/support/solutions/43000737571-note-drawing-tool/),
[Table](https://www.tradingview.com/support/solutions/43000744162-table-drawing-tool/),
[Callout](https://www.tradingview.com/support/solutions/43000516978-callout-drawing-tool/),
[Comment](https://www.tradingview.com/support/solutions/43000516981-comment-drawing-tool/),
[Price label](https://www.tradingview.com/support/solutions/43000518083-price-label/), and
[Flag mark](https://www.tradingview.com/support/solutions/43000518085-flag-mark-drawing-tool/).
The Price Note and Pin/Note distinction was cross-checked against TradingView's
official product-update articles.

## 2026-07-29 common interaction and handle follow-up

The interaction fixes now live in shared drawing-engine layers instead of a
Rectangle-only event path:

- Primary-button double-click opens the correct settings surface for every
  persistent drawing. The second pointerdown and matching native `dblclick` are
  consumed so the chart cannot also pan, zoom, or reset its viewport.
- `Ctrl`/`Cmd` click is the additive-selection gesture. Starting a drag on a
  member of an existing multi-selection preserves and moves the group.
- `Shift` body drag locks every drawing to the dominant horizontal or vertical
  screen axis.
- Arrow keys nudge every selected, unlocked drawing by one logical market bar
  horizontally or one symbol tick vertically, using one undo transaction.
- Context menus and double-clicks originating in drawing UI overlays do not
  leak into the chart interaction layer.

Handle topology is now declared for every manifest entry:

| Profile | Tools | Resolved edit handles |
| --- | --- | ---: |
| `none` | `vertical`, `text`, non-persistent modes | 0 |
| `endpoints` | `brush`, `highlighter` | 2 sampled-stroke endpoints |
| `position-6` | `long`, `short` | 6 virtual Position handles |
| `rect-8` | `rectangle` | 4 circular corners + 4 square edge midpoints |
| `ellipse-axes-4` | `ellipse` | 4 semantic radius/axis handles |
| `table-grid` | `table` | 4 virtual corner resize handles |
| `corner-box-4` | `image` | 4 virtual corner resize handles |
| `raw-points` | remaining persistent tools | one handle per semantic anchor |

Virtual handles do not expand the persisted coordinate payload. Rectangle,
Ellipse, Table, and Image remain backward-compatible two-point drawings; their
extra handles are resolved for rendering, hit testing, and transforms at
runtime.

The behavior and topology checks use TradingView's official
[drawing-tool catalog](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/),
[Rectangle documentation](https://www.tradingview.com/support/solutions/43000516984-rectangle-drawing-tool/),
[Rectangle node announcement](https://www.tradingview.com/blog/en/alerts-on-rectangle-drawings-55208/),
[Ellipse documentation](https://www.tradingview.com/support/solutions/43000516988-ellipse-drawing-tool/),
[Table documentation](https://www.tradingview.com/support/solutions/43000744162-table-drawing-tool/),
[Image documentation](https://www.tradingview.com/support/solutions/43000632957-how-to-insert-images-on-the-chart/),
[Note double-click documentation](https://www.tradingview.com/support/solutions/43000737571-note-drawing-tool/),
[axis-drag documentation](https://www.tradingview.com/support/solutions/43000538248-how-to-drag-drawings-horizontally-vertically/),
and [multi-select documentation](https://www.tradingview.com/support/solutions/43000537219-how-to-select-several-objects/).

Table row/column-divider persistence and rotated Ellipse geometry require
additional saved-model fields and remain separate geometry work; they are not
represented as generic point handles.

## Compatibility and regression gates

- Legacy `fib`, `arrowMarkLeft`, and `arrowMarkRight` remain decodable and
  renderable, but `preferredForCreation: false` keeps them out of current menus.
- Pitchfork variants belong to Trend Lines in the current Supercharts overview.
- Emoji belongs to Icons, not Annotations.
- `tradingViewRequestedCatalogParity.test.ts` asserts the exact 48-tool inventory
  and ordering, each persistent adapter, point topology, compatibility IDs, and
  Fib Spiral chirality.
- `creationSession.test.ts` locks Polyline close-on-first-anchor behavior.
- `waveBCatalog.test.ts` locks Fib Wedge's two-anchor geometry.
- `allToolAdapterContract.test.ts` executes render, hit, bounds, anchors, move,
  resize, and finite-geometry contracts for all 87 persistent adapters.

## Verification

Verified on 2026-07-29:

- `npm run typecheck`: pass;
- `npm run test:drawing`: 272/272 pass;
- `npm run test:position`: 54/54 pass;
- `playwright test drawingInteractions.spec.ts`: 33/33 pass, including the
  create → select → virtual-corner resize → double-click settings → unchanged
  history/viewport → close-dialog Rectangle flow;
- `git diff --check`: pass.
