# Drawing Phase 8 — Wave D

_Date: 2026-07-12_  
_Status: implemented_  
_Scope: immutable candle snapshots, analytical projections, and safe rich-content cards_

## Delivered catalog

| Family | Stable tool ids | Contract |
| --- | --- | --- |
| Data lines | `anchoredVWAP`, `regressionTrend` | 1/2 anchors plus an immutable candle snapshot |
| Profiles/patterns | `fixedVolumeProfile`, `anchoredVolumeProfile`, `barsPattern`, `ghostFeed` | 1/2 anchors plus bounded snapshot-derived geometry |
| Projections | `forecast`, `sector` | Three fixed anchors |
| Rich content | `table`, `image`, `socialEmbed` | Two-anchor canvas card or one-anchor inline-text card |

The persistent manifest now contains 84 tool ids. Creation is enabled by default;
`NEXT_PUBLIC_DRAWING_PHASE8_WAVE_D=false` hides Wave D creation while adapters and codecs remain
available for saved drawings.

## Official behavior baseline

- Anchored VWAP accumulates typical-price × volume from a user-selected anchor.
- Fixed/Anchored Volume Profile distribute volume across price rows and highlight the point of
  control. Fixed range uses two time anchors; anchored range continues from one anchor.
- Regression Trend renders a least-squares center line and deviation channel and reports Pearson R.
- Bars Pattern and Ghost Feed copy historical price movement into a movable comparison region.
- Forecast and Sector are manual projection/measurement geometries.
- Table, Image, and social/idea drawings attach presentation content to chart coordinates.

Primary references:

- https://www.tradingview.com/support/solutions/43000707989-anchored-volume-profile-drawing-tool/
- https://www.tradingview.com/support/solutions/43000518108-regression-trend-drawing-tool/
- https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/
- https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/
- https://www.tradingview.com/support/solutions/43000632957-how-to-insert-images-on-the-chart/
- https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/

## Snapshot and persistence contract

At the successful creation transaction, the interaction manager copies candles from the current
symbol into `Drawing.dataSnapshot`. `anchor-to-latest` and `between-anchors` are manifest
capabilities, not tool-id branches. A snapshot is schema version 1, capped at the newest 1,000
samples, volume-normalized to non-negative values, and rendered without reading the live candle
store. This keeps reload, undo/redo, symbol switching, and historical drawings deterministic.

`Drawing.content` is a discriminated `table | image | social` envelope. The persistence codec caps
tables at 20×12 cells and 200 characters per cell, accepts only HTTPS image URLs (or bounded
PNG/JPEG/WebP data URLs), and allowlists X/Twitter/TradingView hosts for social cards. Canvas text is
script-free. No iframe, HTML execution, or third-party embed runtime is persisted or rendered.

## Geometry and performance

- Pure helpers own cumulative VWAP, least-squares regression/deviation/correlation, and volume-bin
  aggregation; tests assert numeric behavior and conservation of total volume.
- Every adapter exposes render, hit-test, move, anchors, and finite spatial bounds. Missing snapshots
  fail closed, which preserves compatibility with older payloads without inventing market data.
- Snapshot work happens once per committed creation and is capped at 1,000 candles. Render/hit work
  is O(samples), and profiles cap rows at 100 (24 by default). No adapter writes to the store.
- Rich cards render entirely on the existing canvas, so no DOM lifecycle or remote network work is
  introduced into the dirty-frame loop.

## Intentional differences

- Volume profiles attribute each candle's volume to its typical-price bin; they do not reconstruct
  lower-timeframe/tick volume or expose TradingView's full row/value-area settings.
- Regression uses a fixed ±2 residual-standard-deviation channel. Anchored VWAP does not yet expose
  bands or session/reset options.
- Bars Pattern and Ghost Feed normalize source movement into the destination anchors rather than
  cloning every TradingView style control.
- Forecast and Sector are manual visual projections, not statistical forecasts or signals.
- Image is a safe static canvas card and does not fetch/decode a remote bitmap during rendering.
  Social embeds are static cards, never executable third-party iframes.
- Dynamic alerts are not advertised for snapshot-derived or rich-content geometry.

## Verification

- `npm run typecheck`: passing.
- `npm run test:drawing`: 128/128 passing.
- `npm run test:drawing-persistence`: 18/18 passing.
- `npm run build`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist warnings.
- `npm run benchmark:drawing`: at 5,000 drawings, rebuild median 2.414 ms and query median 0.181 ms.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 20/20 passing in 2.7 minutes.

Phase 8 is complete: Waves A–D have bounded catalogs, rollout flags, executable contracts,
persistence behavior, browser coverage, and documented intentional differences.
