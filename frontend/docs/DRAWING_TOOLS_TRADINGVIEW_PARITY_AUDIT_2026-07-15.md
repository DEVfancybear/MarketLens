# Drawing Tools TradingView Parity Audit

_Date: 2026-07-15_
_Scope: all 84 persistent drawing ids; first implementation slice covers the shared line family_

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

## Remaining explicit parity work

The current engine already has render/hit/move/resize/settings/persistence coverage for every id,
but complete TradingView depth is not claimed. Maintain these as family-sized changes:

- Split Trendline/Ray/Extended stats into TradingView's individual toggles and positions rather
  than the current compact combined label.
- Add direct on-chart text editing targets for horizontal and vertical axis lines.
- Add dynamic alerts for sloped/time-varying lines and channel/Fib projections.
- Add exact regression inputs/source/Pearson R settings.
- Add exact Gann scale locking and the full family preset catalogs.
- Add lower-timeframe/tick reconstruction for volume profiles; current snapshots remain bounded to
  available chart data.
- Add indicator-value magnet snapping and variable-width pressure strokes.
- Build a per-tool visual/browser snapshot matrix. Geometry contracts remain the correctness
  oracle; screenshots supplement rather than replace them.

These differences are intentional until their family implementation and regression suite land;
they must not be hidden behind claims of complete TradingView equivalence.
