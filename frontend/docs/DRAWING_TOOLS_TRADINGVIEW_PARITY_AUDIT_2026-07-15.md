# Drawing Tools TradingView Parity Audit

_Date: 2026-07-15_
_Follow-up implementation: 2026-07-16_
_Gann settings/scale-lock refinement: 2026-07-17_
_Scope: all 84 persistent drawing ids; initial line-family slice plus the eight follow-up contracts_

## Maintenance rule

Before changing a drawing tool, read `DrawingToolManifestEntry.officialDocs` and the family
architecture document. The manifest always supplies at least TradingView's official catalog page;
tools with a dedicated article should replace that fallback with the exact article URL when the
tool is actively maintained. A change is not complete until render, hit-test, bounds, handles,
settings, persistence and browser gestures still agree.

Primary catalog:

- https://www.tradingview.com/support/categories/drawings/
- https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/

## Research coverage by current family

| Current ids | Official behavior pages reviewed | Important contract |
| --- | --- | --- |
| `trendline`, `ray`, `extendedLine`, `horizontal`, `horizRay`, `vertical`, `crossLine` | Dedicated TradingView pages for every listed tool | Shared line style; tool-appropriate text, labels, midpoint/stats, coordinates, visibility and alerts. Crossline has price and time labels and Alt+C. |
| `channel`, `flatTopBottom`, `disjointChannel`, `regressionTrend` | Parallel Channel and Regression Trend | Channel levels, left/right extension, fill, offset coordinate; regression deviations/source/Pearson R. |
| `fib`, `fibRetracement`, `fibExtension`, `fibTimeZone`, `fibSpeedFan`, `trendFibTime`, `fibCircles`, `fibSpeedArcs`, `fibWedge`, `pitchfan`, `gannFan`, `gannSquare`, `gannBox` | Dedicated Fib Retracement, Trend-Based Extension, Time Zone, fan/time/circle/arc/wedge/Pitchfan and Gann pages | Configurable levels, reverse, labels/prices/text, fill, log calculation, exact point topology and template/visibility behavior. |
| `pitchfork`, `insidePitchfork`, `schiffPitchfork`, `modifiedSchiffPitchfork` | TradingView catalog and dedicated linked pitchfork articles | Median/parallel levels, variant-specific origin, fill, extension and level controls. |
| `abcdPattern`, `xabcdPattern`, `trianglePattern`, `threeDrivesPattern`, `headShouldersPattern`, Elliott ids | Dedicated pattern pages and Elliott Wave theory/tools | Exact labeled point count, ratios/validation labels, style and coordinates; drawing tools are manual, not automatic detectors. |
| `cyclicLines`, `timeCycles` | Cyclic Lines page and catalog | Repeated time-only projection must share one bounded render/hit range. |
| `long`, `short`, `forecast`, `barsPattern`, `ghostFeed`, `sector` | Dedicated TradingView pages | Position math/levels, projected geometry and immutable historical snapshots must remain consistent. |
| `anchoredVWAP`, `fixedVolumeProfile`, `anchoredVolumeProfile` | Dedicated AVWAP/FRVP/AVP pages | One/two anchor topology; calculations use volume and, for profiles, bounded lower-timeframe selection with documented fallback. |
| `priceRange`, `dateRange`, `datePriceRange` | Dedicated range pages and catalog | Price/time/bar statistics, background/text, coordinate editing and extensions. |
| Shape/freehand ids | Rectangle, Circle, Ellipse, Polyline, Triangle, Arc and Brush pages plus catalog | Fill/text/style and exact visible body geometry; open/closed topology must match the named tool. |
| Annotation/rich-content ids | TradingView catalog and linked Text/Note/Table/Callout/Comment/Image/X pages | Safe text/content editing, style, coordinates and visibility; executable embeds remain intentionally unsupported. |

## Implemented in this audit slice

1. Added `officialDocs` to the single typed manifest. Every current entry has an official
   TradingView source, and focused tools use the exact article URL.
2. Added capability-driven `price-label` and `time-label` settings instead of tool-id checks.
3. Corrected Horizontal Line and Horizontal Ray so their price labels can be disabled and use
   symbol precision/tick metadata instead of a hard-coded four decimals.
4. Corrected Vertical Line so its time label is visible independently of selection and can be
   disabled.
5. Corrected Crossline to render both price and time labels by default, expose both Style toggles,
   retain precise Coordinates/Visibility, and keep Alt+C.
6. Consolidated Trendline/Ray/Extended Line visual parity into `lineParity.ts`: endpoint arrows,
   midpoint marker, attached text, price labels and stats no longer exist only on Trendline.
7. Added executable tests for label visibility and line-family parity. The all-adapter geometry
   contract continues to cover all 84 persistent ids.

## 2026-07-16 parity follow-up

The eight explicit follow-up items from the 2026-07-15 audit are now implemented as shared family
contracts rather than tool-specific patches:

1. Trendline, Ray, and Extended Line stats use seven independently persisted toggles: Price range,
   Percent change, Change in pips, Bars range, Date/time range, Distance, and Angle. Placement is
   Left/Center/Right/Auto, `always show` is independent of selection, Bars range uses logical candle
   indices, and Distance uses projected CSS pixels as observed in TradingView.
2. Horizontal and Vertical axis labels expose manifest-owned `axis-price`/`axis-time` editing
   targets. Their transparent DOM hit regions open the same inline text editor used by other
   capability-driven drawing text, without adding tool-id branches to the interaction manager.
3. Technical alerts snapshot versioned data-coordinate targets for Trendline, Info Line, Trend
   Angle, Ray, Extended Line, Parallel Channel, and Fib Channel levels. Segment/ray/infinite domains,
   moving-boundary crossings, channel operators, open-browser evaluation, closed-browser replay,
   immutable provenance, server-side evidence recomputation, arming revisions, and expiration are
   described in `DYNAMIC_DRAWING_ALERTS_PLAN.md`.
4. Regression Trend now owns typed upper/lower deviation values and enable toggles, all eight
   TradingView source choices (`Open`, `High`, `Low`, `Close`, `HL2`, `HLC3`, `OHLC4`, `HLCC4`),
   base/upper/lower line toggles, right extension, and Pearson R. Calculation, render, hit-test,
   bounds, settings, codec, and legacy defaults resolve through the same configuration.
5. Gann Fan/Square/Box share a versioned typed configuration. Fan uses the verified nine ratios
   from `1/8` through `8/1`; Square/Box expose editable price/time eighth levels with independently
   persisted color, opacity, width, and line style. `Use one color` switches rendering between the
   drawing color and those level styles without changing geometry. Scale locking uses logical
   chart-bar distance and a persisted price-per-bar ratio, so weekends and market gaps do not
   distort the 1x1 relationship. Enabling the lock captures the current drawing ratio before any
   resize, rather than applying the legacy `1` fallback and making the object jump. Verified
   built-in `classic`/`eighths` defaults and bounded custom rows are explicit; unverified
   TradingView template names are not invented.
6. Fixed and Anchored Volume Profile use a deterministic detail order: complete measured ticks,
   complete lower-timeframe OHLCV, then chart bars. Snapshot capture and runtime revalidate interval
   coverage/parent-volume conservation, reject partial or unit/mixed tick detail, and retain the
   documented chart-timeframe fallback. Profile row allocation, up/down classification, POC, and
   value-area tie breaking are shared by render, hit-test, and bounds.
7. Magnet preferences keep TradingView's Weak/Strong OHLC policy and add `Snap to indicators` as an
   independent option. Visible overlay values compete with OHLC candidates by projected distance
   and fall back safely when no overlay is available. Pen input persists normalized pressure;
   Brush/Highlighter render bounded variable-width segments, and simplification preserves pressure
   ramps and spikes while mouse/touch strokes retain their configured width.
8. The manifest-derived visual matrix has one row for every persistent id and real Playwright chart
   screenshots for every creation-enabled id. It supports representative, full-catalog, and
   comma-separated per-id runs, fixes the browser clock, selects tools by manifest id, and compares
   against reviewed platform baselines. The executable adapter/geometry contracts remain the
   semantic oracle; screenshots cover paint order, fills, labels, and handles.

## Honest parity boundary

This follow-up closes the named audit gaps; it is not a blanket claim that every pixel, preset,
gesture, product workflow, or future TradingView behavior is equivalent. The implementation is
bounded by the official behavior reviewed on 2026-07-15/16 and by deterministic data available to
the chart. In particular, incomplete tick/lower-timeframe history falls back instead of being
guessed, legacy two-point pixel-offset channels are not valid alert sources, vertical/time alerts
and touch tolerance are separate condition models, and executable third-party embeds remain
unsupported. Any later family change must repeat the official-source review and keep geometry,
settings, persistence, evaluator, and browser evidence aligned.
