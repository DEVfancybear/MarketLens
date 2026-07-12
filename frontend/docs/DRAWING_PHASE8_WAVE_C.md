# Drawing Phase 8 — Wave C

_Date: 2026-07-12_  
_Status: implemented_  
_Scope: reusable labeled-anchor pattern framework and time cycles_

## Delivered catalog

| Family | Stable tool ids | Stored anchors |
| --- | --- | --- |
| Harmonic/chart patterns | `abcdPattern`, `xabcdPattern`, `trianglePattern`, `threeDrivesPattern`, `headShouldersPattern` | 4, 5, 4, 7, 7 |
| Elliott waves | `elliottImpulse`, `elliottTriangle`, `elliottTripleCombo`, `elliottCorrection`, `elliottDoubleCombo` | 6, 6, 6, 4, 4 |
| Cycles | `timeCycles` | 2 |

The persistent manifest now contains 73 tool ids. Pattern coordinate labels and point counts live in
the manifest, so the creation session, coordinate editor, renderer, adapter fixtures, and browser
tests share one topology contract.

Creation is enabled by default. `NEXT_PUBLIC_DRAWING_PHASE8_WAVE_C=false` removes Wave C creation
entries while retaining adapters and codecs for existing saved drawings.

## Official behavior baseline

- ABCD uses four significant pivots and three alternating legs. Common variants compare AB/CD and
  BC/CD relationships; exact ratios are analytical guides rather than guaranteed signals.
- XABCD extends the harmonic topology with an initial X pivot.
- Head and Shoulders consists of left shoulder, head, right shoulder, and a neckline and can be
  upright or inverted.
- Elliott Impulse represents five motive waves; Elliott Correction represents A-B-C. Triangle,
  Double Combo, and Triple Combo use the official A-B-C-D-E, W-X-Y, and W-X-Y-X-Z labels.
- Time Cycles repeat equal circular time spans defined by two initial points.

Primary references:

- https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/
- https://www.tradingview.com/support/solutions/43000570202-abcd-pattern-drawing-tool/
- https://www.tradingview.com/support/solutions/43000653212-elliott-wave-theory-and-tools/
- https://in.tradingview.com/support/solutions/43000570149-head-and-shoulders-drawing-tool/
- https://www.tradingview.com/support/folders/43000547459-how-to-use-various-drawing-tools/
- https://www.tradingview.com/charting-library-docs/latest/ui_elements/drawings/Drawings-List/

## Shared pattern contract

`LabeledPatternTools.ts` owns the common behavior:

- Fixed point completion from manifest `minPoints`/`maxPoints`.
- Manifest-provided semantic coordinate labels.
- Connected leg rendering, selected anchor handles, segment/body hit tests, movement, resize, and
  label-aware spatial bounds.
- Price-leg ratio labels calculated against the preceding leg.
- A compact green/red validation chip contributed by a pure topology validator.
- Optional pattern fill and the Head-and-Shoulders neckline extension.

Tool-specific validators remain geometry-only:

- ABCD compares CD/AB against the common AB=CD tolerance.
- Head and Shoulders checks that the head exceeds both shoulders and that shoulders are reasonably
  balanced; the same rule supports inverted patterns.
- Elliott Impulse checks wave-2 retracement and that wave 3 is not the shortest motive leg.
- Elliott Correction checks that B is shorter than A.
- Other harmonic/Elliott topologies report whether successive pivots alternate direction.

## Time Cycles contract

- Two points define the first diameter and baseline.
- Semicircular cycles repeat at equal CSS-pixel spacing across the viewport.
- Rendering and hit testing are capped, preventing tiny/corrupt spacing from creating unbounded work.
- Both stored anchors remain available for precise coordinates, magnets, movement, and resize.

## Model and migration

No drawing property, schema migration, or backend endpoint was added. The Wave C model is the
existing versioned drawing envelope plus stable ids, finite point arrays, and manifest labels.
Fixtures were extended from five to seven points so every supported topology passes the same codec
and adapter audit. Older clients quarantine unknown Wave C ids without affecting known objects.

## Intentional differences

- These are manual analytical drawings. Validation chips describe the placed geometry; they do not
  auto-detect patterns or provide trading signals.
- Ratio labels currently use absolute price-leg length. TradingView's complete time ratio, percent
  mode, pattern presets, and ratio tolerance configuration require a future pattern settings schema.
- Triangle Pattern uses four alternating pivots; it does not auto-close or forecast a breakout.
- Head-and-Shoulders uses a fixed seven-anchor contour and draws the stored Neck 1–Neck 2 line.
- Elliott validation covers the safest core checks only. It does not recursively detect subwaves,
  project future waves, or reproduce the separate automatic Elliott indicator.
- Dynamic alerts are not advertised because pattern targets are multi-anchor and time-varying.

## Performance review

- Pattern render/hit complexity is linear in a maximum of seven anchors.
- Validation and ratios are computed only during dirty-driven render/hit calls and perform no store
  writes or candle scans.
- Time Cycles caps render work at 256 cycles and hit work at 128 cycles.
- The shared 5,000-object spatial benchmark remains rectangle-based; Wave C adds no new global index
  work and all family adapters have finite or explicit viewport bounds.

## Verification

- `npm run typecheck`: passing.
- `npm run build`: passing.
- `npm run lint`: passing with 0 errors and the same 2 pre-existing Watchlist warnings.
- `npm run test:drawing`: 121/121 passing.
- `npm run test:drawing-persistence`: 17/17 passing.
- `npm run test:chart-browser -- drawingInteractions.spec.ts`: 19/19 passing in 2.3 minutes.
- `npm run benchmark:drawing`: at 5,000 drawings, rebuild median 1.993 ms and query median 0.146 ms.

## Remaining Phase 8 wave

- Wave D: data-dependent and rich-content tools.
