# Indicator architecture

_Updated: 2026-07-26._

Indicators are backend-defined and backend-executed. The browser does not own
an indicator catalog, formulas, defaults, input schemas, style schemas, or
per-indicator dispatch. Embedded catalog sources and source saved by users both
reach the same Go `Compile` function.

## End-to-end flow

```text
GET /api/v1/indicator-runtime/catalog
  -> IndicatorMenu renders backend definitions
  -> indicatorConfigFromDefinition creates an instance
  -> indicatorsAtom persists the opaque instance config

Indicator Settings / Legend
  -> POST /api/v1/indicator-runtime/definition
  -> generic Inputs, Style, Visibility UI
  -> inputValues/styleValues persisted on the instance

PriceChart
  -> ensureIndicatorRuntimeResult (one cache for every indicator)
  -> Replay snapshot visibleThrough -> replayCutoff (when Replay is active)
  -> optional history fetch when backend metadata requires it
  -> POST /api/v1/indicator-runtime/compute
  -> ComputeIndicatorRuntime
  -> indicatorCompileRequest
       catalog type: load embedded Pine source
       user script: use request sourceCode
  -> Compile
  -> generic IndicatorResult chart primitives
```

There is deliberately no `CUSTOM` runtime branch in `PriceChart`, no frontend
`switch (indicator.type)`, and no second cache for saved scripts.

## Backend contracts

### Catalog

`GET /api/v1/indicator-runtime/catalog` returns ordered
`IndicatorDefinition` rows. Each row contains:

- stable type key, name, short title, description;
- overlay/pane placement and optional shortcut role;
- extracted Pine input definitions and style definitions;
- `requiresHistoryContext` execution metadata;
- legacy input/style bindings for old persisted chart presets.

The embedded catalog is declared in
`backend/internal/pineruntime/builtin_sources.go`. Static knowledge belongs
there, not in React components.

### Definition

`POST /api/v1/indicator-runtime/definition` accepts either a catalog type or
Pine source and returns the same `IndicatorDefinition` shape. Settings and the
legend therefore render catalog and user scripts identically.

### Compute

`POST /api/v1/indicator-runtime/compute` accepts:

```json
{
  "indicatorType": "catalog-or-script-key",
  "indicatorId": "chart-instance-id",
  "sourceCode": "optional user Pine source",
  "timeframe": "15m",
  "replayCutoff": 1783420800,
  "config": {
    "inputValues": {},
    "styleValues": {}
  },
  "candles": []
}
```

When `sourceCode` is present it wins. Otherwise the backend resolves source by
`indicatorType`. Both paths construct `CompileRequest` and invoke `Compile`.

When Replay is active, `replayCutoff` is copied from the backend-owned
`tracks[0].visibleThrough` timestamp. It is inclusive and expressed in Unix
seconds. The backend filters and clamps the runtime result before it reaches the
chart; the browser must not substitute a local clock or a viewport edge.

## Frontend responsibilities

| Responsibility | File |
|---|---|
| Catalog/definition/compute API | `src/services/api/resources/indicatorRuntimeApi.ts` |
| Cached backend catalog/definitions | `src/services/indicatorDefinitions.ts` |
| Pure definition-to-config defaults/legacy hydration | `src/services/indicatorDefinitionModel.ts` |
| One result/history/LRU cache | `src/services/indicatorRuntimeCache.ts` |
| Stable cache-key policy | `src/services/indicatorRuntimePolicy.ts` |
| Dynamic catalog browser | `src/components/toolbar/IndicatorMenu.tsx` |
| Dynamic settings renderer | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
| Dynamic legend labels/inputs | `src/components/chart/IndicatorLegend.tsx` |
| Separate-pane legend geometry | `src/components/chart/paneLegendLayout.ts` |
| Generic chart primitive renderer | `src/components/chart/PriceChart.tsx` |

The frontend may contain generic display policy, such as rendering a
`baselineFill` series or formatting a timeframe input. It must not contain a
list of catalog names or select behavior based on a catalog type.

### Common output presentation

Pine declaration properties are part of the runtime-to-renderer contract, not
frontend guesses based on a symbol or script name. The compiler normalizes
`indicator(..., format = ...)` to the series `valueFormat` (`price`, `volume`,
or `percent`) and carries optional declaration/style precision on every output
series. `PriceChart` maps those fields to the native chart price formatter for
catalog and saved-source indicators identically.

Histogram series declared with `format.volume` also use one shared visual
profile: the visible median bar targets 25% of the pane while the actual
maximum remains in range. This prevents normal volume from filling the pane on
high-nominal symbols without fixed, symbol-specific divisors.

Every separate indicator pane restores autoscale when its series changes from
empty to non-empty. Async first results (for example RSI warm-up/runtime data)
therefore become visible on their first write even if the pane temporarily had
no native price range. Subsequent writes preserve the user's scale state.

Separate-pane legends use the same identity-neutral geometry pipeline as their
series. `PriceChart` observes the native Lightweight Charts pane elements and
the chart container, measures them on the next animation frame, and stores
chart-local offsets by indicator ID plus ordered pane signature. React render
only consumes those offsets; it never measures native chart DOM synchronously.
Not-yet-laid-out panes are omitted instead of placing their legends at the main
chart origin. Browser coverage verifies multiple pane legends both on initial
load and after viewport resize.

Sparse Pine plots retain their discontinuities. In particular,
`plot.style_linebr` is emitted as a line-break series, so `na` values do not
create connecting vertical or diagonal edges between independent segments.
Reference `hline()` and `fill()` primitives remain backend-defined source
outputs; Better RSI's six levels, range fill, emphasized segments, and
per-bar cycler colors require no renderer special case.

Series-color plots retain their per-bar palette. Schema extraction does not
create a scalar color field for those plots, and the compiler ignores stale
single-color overrides from older persisted instances when the evaluated Pine
color is a series. Static plot colors remain editable normally.

Runtime requests also carry backend-catalog market metadata: ticker, asset
class, minimum tick, and timezone. These values back Pine `syminfo.*`,
`format.mintick`, and time formatting for both built-ins and saved source. They
are included in frontend and backend cache identities so a result calculated
under forex point semantics cannot be reused for a crypto or index symbol.

## Runtime and cache policy

- Runtime requests use the loaded candle range and are capped at 5,000 bars.
- The cap is not a fixed display window: zooming/panning continues to determine
  the visible projection, while runtime history can extend behind it.
- Pine source is never inspected in the browser. The backend declares whether
  an indicator needs extended history through `requiresHistoryContext`.
- Cache keys include the complete dynamic config, symbol metadata, timeframe,
  and OHLCV content, so forming-bar corrections or market-context changes
  invalidate every indicator consistently.
- Replay cache keys also include the session identity and cutoff. A cached
  result is a valid temporary fallback only when its cutoff is less than or
  equal to the requested cutoff in the same Replay session. Live and Replay
  results, and different Replay sessions, are never interchangeable.
- Replay history warm-up is requested strictly before the latest authoritative
  Replay candle, preventing provider OHLC for the forming bucket from importing
  future high/low/close values. A Replay session without a valid cutoff fails
  closed and renders no runtime result until the backend snapshot is ready.
- Frontend projection clips series, labels, and magnet points at the cutoff as
  defense in depth. This does not replace the backend boundary, which applies
  before compilation for catalog and saved/source indicators alike.
- Backend jobs use the bounded worker pool, queue, singleflight, and LRU in
  `runtime_jobs.go`.

## Backward compatibility

Older chart presets stored top-level `length`, `length2`, `color`, and similar
fields. Backend definitions return `legacyInputBindings` and
`legacyStyleBindings`. The generic frontend hydration helper applies those
bindings and then applies modern `inputValues`/`styleValues`, so modern values
win without any indicator-name logic in the browser.

The backend compile adapter keeps accepting those legacy fields until stored
presets have naturally migrated.

## Adding a catalog indicator

1. Add the licensed Pine source under
   `backend/internal/pineruntime/sources/`.
2. Add one backend catalog definition with path, description, property aliases,
   and any object-style metadata not expressible by standard Pine plots.
3. Add compiler/runtime coverage for any new Pine language feature.
4. Add backend definition and compute tests.

No frontend catalog/menu/settings/legend change is required.

## Verification

Run:

```text
cd backend && go test ./...
cd frontend && npm run typecheck
cd frontend && npm run test:chart
cd frontend && npm run check:pine-indicator
```

`check:pine-indicator` fails if the split caches/default service return or if
catalog-name dispatch is added to production frontend indicator code.
