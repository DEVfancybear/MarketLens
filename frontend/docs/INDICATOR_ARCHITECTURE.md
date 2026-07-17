# Indicator architecture

_Updated: 2026-07-18._

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
  "config": {
    "inputValues": {},
    "styleValues": {}
  },
  "candles": []
}
```

When `sourceCode` is present it wins. Otherwise the backend resolves source by
`indicatorType`. Both paths construct `CompileRequest` and invoke `Compile`.

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
| Generic chart primitive renderer | `src/components/chart/PriceChart.tsx` |

The frontend may contain generic display policy, such as rendering a
`baselineFill` series or formatting a timeframe input. It must not contain a
list of catalog names or select behavior based on a catalog type.

## Runtime and cache policy

- Runtime requests use the loaded candle range and are capped at 5,000 bars.
- The cap is not a fixed display window: zooming/panning continues to determine
  the visible projection, while runtime history can extend behind it.
- Pine source is never inspected in the browser. The backend declares whether
  an indicator needs extended history through `requiresHistoryContext`.
- Cache keys include the complete dynamic config, symbol, timeframe, and OHLCV
  content, so forming-bar corrections invalidate every indicator consistently.
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
