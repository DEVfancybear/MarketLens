# Pine Runtime Go Migration

_Date: 2026-07-09. Updated 2026-07-22 for generic Pine v5 source execution,
replay-causal evaluation, the submitted Swing Highs/Lows fixture, removal of
the legacy `SWING_SR` catalog entry, and shared Pine color-literal parsing.
Scope: move indicator parsing/calculation out of the frontend and into the Go
backend._

## Goal

The custom-indicator runtime is owned by `backend/internal/pineruntime`. The
frontend no longer ships a Pine compiler; it only calls backend schema/compile
APIs and renders the returned `IndicatorResult`.

The migration goal is to make the backend the owner of Pine parsing and
compilation, while the frontend stays responsible for:

- Pine Editor UI and saved-script actions.
- Indicator settings UI generated from backend schemas.
- Chart rendering from backend-normalized `PineCompilation` payloads.
- No browser-side Pine parsing/compilation fallback.

## Non-Goals

- Do not execute arbitrary Pine, JavaScript, or Go plugins.
- Do not call TradingView private APIs for compilation.
- Do not make the frontend compile user code in the steady state.
- Do not special-case indicator names such as ADR, VSA, RSI, or future scripts.
- Do not restore `SWING_SR` as a formula-specific backend branch. Older saved
  presets may retain that type, but new catalog responses must not advertise it.
- Do not persist market candles in the Pine runtime. Candles remain market-data
  runtime input.

## Implemented State

Implemented on 2026-07-09:

| Concern | Current owner |
| --- | --- |
| Script metadata extraction | Go `backend/internal/pineruntime` API |
| Input schema extraction | Go `backend/internal/pineruntime` API |
| Style schema extraction | Go `backend/internal/pineruntime` API, including plot/hline/fill and line/box/label objects |
| Pine subset compilation | Go `backend/internal/pineruntime` through `/api/v1/pine-runtime/compile` |
| Built-in indicator calculations | Go `backend/internal/pineruntime` registry through `/api/v1/indicator-runtime/compute` |
| Active indicator dispatch | Frontend runtime caches call the Go built-in/Pine endpoints; `services/indicators.ts` reads cached results only |
| Overlay rendering | `frontend/src/components/chart/PriceChart.tsx` |
| Separate pane rendering | Native LWC panes in `frontend/src/components/chart/PriceChart.tsx` |
| Script persistence | Backend Phase 9 `/api/v1/pine-scripts` |
| Replay boundary | Backend `replayCutoff` normalization shared by catalog and user source |
| Generic fixture parity | Pine v5 Swing Highs/Lows UDT/pivot/label regression fixture |

Frontend chart rendering now uses `frontend/src/services/pineRuntimeCache.ts`.
CUSTOM indicators no longer call the compiler synchronously from
`computeIndicator()`. The chart/pane effects request backend compilation, render
the latest cached `IndicatorResult`, and rerender when the cache resolves.

As of 2026-07-16, registered built-ins also use the Go runtime through
`frontend/src/services/indicatorRuntimeCache.ts`. `services/indicators.ts` is a
display adapter for cached API results and must not regain calculation logic.

Go runtime supports the chart-visible subset currently needed by VSA Volume,
Better RSI, ADR-style object-heavy scripts, and multi-moving-average overlays:

- Plot/hline/fill output.
- Per-bar color series and histogram plots. Scalar Style defaults/legacy
  overrides do not replace an evaluated series-color palette.
- Pine `linebr` plots split into independent line segments at `na` gaps.
- Pine `hline`/`fill` reference outputs marked with `extendToVisibleRange` so
  frontend chart panes can project them onto the active logical viewport,
  including TradingView-style right-offset whitespace beyond the latest candle.
- `request.security()` for current-symbol fixed higher-timeframe aggregation on
  chart candles, including positional or named required arguments.
- Nested `request.security()` expression fallback for scripts that place the call
  inside larger ternary expressions.
- Multiline user-defined functions declared with `=>`, including nested
  `if`/`else if`/`else` and `switch` expression bodies.
- Moving-average helpers `ta.sma`, `ta.ema`, `ta.rma`, `ta.wma`, `ta.hma`, and
  `ta.vwma`, plus common OHLC sources including `hlcc4`.
- Mutable Pine drawing objects compiled into immutable chart output:
  `line.new/set_*`, `box.new/set_*`, `label.new/set_*`, and `table.new/cell`.
- Market-aware `syminfo.tickerid/type/mintick/timezone`, tick-precision string
  formatting, and timezone-aware `str.format_time()` from the common runtime
  request context.

The previous `frontend/src/services/pineScript.ts` fallback has been deleted.
Unsupported language features must now be added to Go or reported as backend
diagnostics; do not reintroduce a browser compiler.

## Target Ownership

Backend responsibilities after migration:

| Concern | Target owner |
| --- | --- |
| Parse source metadata | Go `internal/pineruntime` |
| Extract input definitions | Go `internal/pineruntime` |
| Extract style definitions | Go `internal/pineruntime` |
| Compile supported Pine subset | Go `internal/pineruntime` |
| Runtime diagnostics/errors | Go `internal/pineruntime` |
| Concurrent compile work | Go goroutines with request-scoped context |

Frontend responsibilities after migration:

| Concern | Target owner |
| --- | --- |
| Pine Editor text editing | Frontend |
| Save/load/delete/favorite source scripts | Frontend calling Phase 9 APIs |
| Settings dialog rendering | Frontend using backend schemas |
| Compile-result caching | Frontend runtime cache |
| Lightweight Charts series/object rendering | Frontend |

## Backend Package

Implemented package:

```text
backend/internal/pineruntime/
  handler.go       # Fiber HTTP handlers
  compiler.go      # shared user/catalog compile orchestration and diagnostics
  builtin_runtime.go # built-in HTTP contract delegating exclusively to Compile
  builtin_sources.go # catalog config-to-Pine-input/style mapping
  sources/*.pine   # source for each supported catalog entry (including attributed LuxAlgo FVG)
  stateful_parser.go # AST parser for UDTs, methods, blocks, tuples, loops, objects
  stateful_eval.go # ordered closed-bar VM and reference-type operations
  stateful_runtime.go # state/history, security contexts, and normalized primitives
  runtime_common.go # bounded ordered goroutine jobs and shared runtime inputs/timeframes
  runtime_jobs.go  # fixed worker pool, singleflight, timeout, panic recovery, LRU
  scanner.go       # balanced call scanning, args, source lines
  schema.go        # indicator()/study(), input.*(), plot/hline/fill style extraction
  expression.go    # expression tokenizer/parser/evaluator
  request_security.go # request.security() timeframe aggregation and expansion
  object_runtime.go # line/box/label/table object compilation
  value.go         # Pine value model and series helpers
  models.go        # request/response structs
  compiler_test.go # VSA, Better RSI, ADR object runtime, HTTP contract tests
```

Keep this package isolated from persistence packages. It should not import
`internal/pinescripts` except through higher-level handlers if a future
compile-by-id endpoint is added.

## Pine compatibility boundary

This package implements an allowlisted Pine subset, not TradingView's full
Pine v3-v6 compiler. Every source uses one public pipeline:

```text
source + properties + normalized OHLCV
  -> parse / validate / fail-closed diagnostics
  -> pure-series evaluator or ordered stateful bar VM
  -> IndicatorResult chart primitives
```

Built-ins are not native formula adapters. `SMA`, `EMA`, `VWAP`, `RSI`,
`MACD`, `ADR`, and `FVG` are embedded `.pine` files passed to the same
`Compile` function as a saved or public user script. The catalog only maps
legacy UI properties to source inputs/styles. `SWING_SR` is no longer a catalog
source or executable runtime type. Existing rows may still contain the opaque
legacy value; clients can offer an explicit migration/unavailable state, but the
backend never selects a hidden replacement formula.

The stateful path executes historical candles sequentially and commits variable
history after each bar, matching the closed-bar part of Pine's execution model.
Every declared user/catalog source is conservatively marked as requiring
bounded pre-viewport history. This intentionally accepts extra history fetches
for pointwise scripts so `var`, objects, `bar_index`, UDF state, and future Pine
features cannot silently reset at a viewport boundary.
It supports the subset exercised by generic fixtures and the supplied LuxAlgo
source: UDT/default fields, methods, function-local `var`, tuples, typed
reference arrays, ascending/descending and `for ... in` loops, history,
`ta.cum`, pivots, child `request.security()` contexts, boxes, lines, deletion,
tables, plots, and fills.

Both expression evaluators use the same scanner and recognize Pine color
literals as one typed token.
The accepted forms are `#RRGGBB` and `#RRGGBBAA`, with case-insensitive hex
digits and the optional `AA` pair carrying opacity (`00` transparent, `FF`
opaque). Literals work directly in visual calls, through assignments, as
`input.color()` defaults, and inside `color.new()`. Malformed lengths or
non-hex values fail with a compile diagnostic instead of being coerced.
`color.new(base, transp)` replaces any existing literal alpha using Pine's
transparency scale (`0` opaque, `100` invisible). This
follows TradingView's documented [color type](https://www.tradingview.com/pine-script-docs/language/type-system/#color)
and [color input](https://www.tradingview.com/pine-script-docs/concepts/inputs/#color-input)
contracts.

Deliberate limits:

- No realtime tick rollback/re-execution or `varip` semantics. `barstate`
  reflects the supplied closed-bar snapshot.
- No strategies, orders, broker emulator, libraries/imports, maps, matrices,
  polylines, `while`, or unsupported visual calls. These fail before execution.
- `alertcondition()` is parsed so historical visuals still compile, but alert
  event delivery is reported as unsupported.
- `request.security()` uses the current symbol and supplied candle data. Higher
  timeframes run in independent aggregated contexts and become visible on the
  final sub-bar. Required arguments can be positional or named, and prior
  intermediate assignments are re-executed against the child OHLCV context.
  Multi-symbol, invalid-timeframe, plain lower-timeframe, and lower-timeframe
  array requests fail closed because missing sub-bars cannot be reconstructed
  from chart candles.
- Unknown evaluated identifiers/functions return a compile error. Advertised
  support must be backed by a semantic regression test, not inferred from
  accepted syntax.

These constraints follow Pine's documented distinction between sequential bar
execution, qualifier/history semantics, reference types, and requested data
contexts. They must remain explicit when the subset grows.

## Generic Pine source and execution contract

The runtime is source-driven rather than name-driven. Pine itself requires one
global declaration and the current chart-output executor accepts `indicator()`
and legacy `study()` declarations. `strategy()` and `library()` are detected and
fail closed because their distinct execution contracts are not implemented.
The optional `//@version=N` annotation is exposed in metadata and is inherently
part of the source/cache hash; v5 is the compatibility target for the submitted
fixture. Missing and legacy pre-v5 annotations compile with an explicit
compatibility warning, v6 compiles with a subset warning, and a version newer
than v6 fails closed. Full version-gated v5/v6 behavior (for example boolean
conversion, lazy logical operators, and dynamic-request differences) is not yet
emulated.

Metadata extraction preserves literal or enum-valued named and positional
declaration arguments using the documented `indicator()` signature: `title`,
`shorttitle`, `overlay`, `format`, `precision`, `scale`, `max_bars_back`,
`timeframe`, `timeframe_gaps`, `explicit_plot_zorder`, `max_lines_count`,
`max_labels_count`, `max_boxes_count`, `calc_bars_count`,
`max_polylines_count`, `dynamic_requests`, and `behind_chart`. This metadata is
not a claim that every property has runtime parity. The API exposes
overlay/timeframe for caller-side placement/routing; both execution paths retain
the newest line/label/box outputs according to the declared limits (default 50).
A non-empty declaration timeframe and the
`timeframe_gaps`, `calc_bars_count`, or `dynamic_requests` properties fail
closed because they would change execution semantics the runtime does not yet
model. Formatting, z-order, polylines, and behind-chart semantics remain
metadata-only compatibility gaps. Features on the runtime's explicit
unsupported list fail closed; other
syntax is supported only where covered by parser/runtime diagnostics and
regression fixtures. An unimplemented declaration property's metadata is
informational rather than silently treated as a fully implemented behavior.

The historical evaluator follows TradingView's closed-bar sequence:

1. Select the accessible dataset and any required warm-up bars.
2. Update OHLCV, `bar_index`, and bar-state values for the current bar.
3. Execute the source from start to finish using data available at that bar.
4. Commit series/history and drawing state before advancing to the next bar.

For an inclusive `replayCutoff`, the evaluator retains caller-supplied candles
before the selected bar as warm-up context, but it executes and emits only bars
at or before the cutoff. This endpoint does not fetch missing history itself.
It must not use the full live dataset and then merely hide future
outputs: pivots, labels, boxes, lines, fills, requested higher-timeframe data,
and history buffers all have to be causal at the boundary. A source-created
object whose creation/anchor is in the future is absent; an object that began
before the boundary is clipped to the boundary and cannot retain a right
extension. The cutoff is included in the runtime cache key.

The backend currently models the closed-bar portion of Pine. It does not model
realtime tick rollback/re-execution or `varip`; `barstate` therefore describes
the supplied closed-bar snapshot. This limitation is intentional and must stay
visible in API diagnostics until a tick engine is implemented. The semantics are
based on TradingView's [execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/),
[declaration statements](https://www.tradingview.com/pine-script-docs/language/declaration-statements/),
[variable declarations](https://www.tradingview.com/pine-script-docs/language/variable-declarations/),
[script structure](https://www.tradingview.com/pine-script-docs/language/script-structure/),
[type system](https://www.tradingview.com/pine-script-docs/language/type-system/),
[inputs](https://www.tradingview.com/pine-script-docs/concepts/inputs/),
[objects](https://www.tradingview.com/pine-script-docs/language/objects/),
[labels/text and shapes](https://www.tradingview.com/pine-script-docs/visuals/text-and-shapes/),
[v6 migration guide](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/),
and [repainting guidance](https://www.tradingview.com/pine-script-docs/concepts/repainting/).

### Submitted Swing Highs/Lows fixture

`backend/internal/pineruntime/testdata/swing_high_low_luxalgo.pine` is a
regression fixture copied from the user-provided `swing high low.pine.txt`.
It is Pine v5 and intentionally exercises generic features rather than a
catalog name:

- `input()` values with `group` metadata and color overrides;
- multiline string concatenation and escaped newlines;
- a `pattern` user-defined type with fields and `pattern.new()` construction;
- `ta.pivothigh()` / `ta.pivotlow()` confirmation windows and history access;
- numeric-to-boolean conditions used by Pine v5;
- ternary selection of a nullable UDT;
- persistent variables, back-referenced `bar_index`, and `label.new()` with
  transparent color, style, text color, and tooltip fields.

The fixture must compile through the same endpoint as any saved/public source,
emit a swing label only after the complete right-hand pivot window exists, and
never emit a label after a replay cutoff. Its LuxAlgo copyright and
CC BY-NC-SA 4.0 attribution are retained in the fixture; the runtime does not
claim or publish the source as an original built-in catalog implementation.

## Runtime API

Implemented endpoints under `/api/v1/pine-runtime`.

### `POST /api/v1/pine-runtime/meta`

Extract script title, short title, and overlay/timeframe metadata without candles.

Request:

```json
{
  "sourceCode": "indicator(\"My script\", overlay=true)\nplot(close)"
}
```

Response:

```json
{
  "name": "My script",
  "shortTitle": "My script",
  "overlay": true,
  "timeframe": "",
  "errors": []
}
```

### `POST /api/v1/pine-runtime/inputs`

Return settings rows for the Inputs tab.
Inputs preserve Pine `group` and `inline` metadata. The frontend uses `inline`
to render TradingView-style horizontal rows for related controls such as
checkbox, moving-average type, length, source, and color.

Request:

```json
{
  "sourceCode": "...",
  "inputOverrides": {
    "length": 20
  }
}
```

Response:

```json
{
  "inputs": [
    {
      "key": "length",
      "title": "Length",
      "kind": "int",
      "defaultValue": 14,
      "options": null,
      "group": "Calculation",
      "inline": "ma1"
    }
  ],
  "errors": []
}
```

### `POST /api/v1/pine-runtime/styles`

Return style rows for plots, hlines, fills, and supported drawing objects.

Request:

```json
{
  "sourceCode": "...",
  "styleOverrides": {
    "plot:RSI.visible": true
  }
}
```

Response:

```json
{
  "styles": [
    {
      "key": "plot:RSI",
      "label": "RSI",
      "target": "plot",
      "visible": true,
      "color": "#ffffff",
      "lineWidth": 2,
      "lineStyle": "solid"
    }
  ],
  "errors": []
}
```

### `POST /api/v1/pine-runtime/compile`

Compile a script against the supplied OHLCV window. `replayCutoff` is optional
for direct callers, but when present it is an inclusive Unix-seconds boundary
and is enforced by the backend before execution and output normalization.

Request:

```json
{
  "scriptId": "optional-client-or-backend-id",
  "sourceCode": "...",
  "timeframe": "15m",
  "replayCutoff": 1783420800,
  "candles": [
    {
      "time": 1783420800,
      "open": 1.142,
      "high": 1.143,
      "low": 1.141,
      "close": 1.1425,
      "volume": 120
    }
  ],
  "inputOverrides": {},
  "styleOverrides": {}
}
```

Response shape must remain compatible with the current frontend
`PineCompilation` contract:

```json
{
  "meta": {
    "name": "My script",
    "overlay": false,
    "timeframe": ""
  },
  "result": {
    "id": "custom-id",
    "series": [],
    "hlines": [],
    "fills": [],
    "labels": [],
    "boxes": [],
    "tables": []
  },
  "errors": [],
  "warnings": [],
  "unsupportedFeatures": []
}
```

The common runtime normalizes candle order, keeps the supplied pre-cutoff
history (up to the compile limit), then evaluates only through `replayCutoff`.
It removes
future labels/objects, clips geometry crossing the boundary, disables
right-side extensions, and includes the cutoff in the compile cache key. Omit
the field for live behavior. Values outside the validated Unix-seconds range
are rejected; JavaScript millisecond values are not accepted.

The frontend renderer should not need to understand backend internals. It should
only receive normalized chart primitives.

### `POST /api/v1/indicator-runtime/compute`

Resolve a built-in catalog entry, map its opaque `config` to Pine inputs/styles,
and pass the resulting `CompileRequest` to the same compiler used by
`/pine-runtime/compile`. The separate route preserves the existing frontend
transport; it is not a separate formula runtime.

```json
{
  "indicatorType": "FVG",
  "indicatorId": "chart-instance-id",
  "timeframe": "15m",
  "replayCutoff": 1783420800,
  "config": {
    "inputValues": {
      "thresholdPer": 0,
      "auto": false,
      "showLast": 0,
      "mitigationLevels": false,
      "timeframe": "",
      "extend": 20,
      "dynamic": false,
      "showDash": false,
      "dashLoc": "Top Right",
      "textSize": "Small"
    }
  },
  "candles": []
}
```

The embedded, attributed Pine v5 `Fair Value Gap [LuxAlgo]` catalog source
implements:

- Bullish: `low > high[2]`, `close[1] > high[2]`, and the relative gap is
  greater than the manual or cumulative-range auto threshold.
- Bearish: the symmetric `high < low[2]` and `close[1] < low[2]` conditions.
- Fixed boxes start at chart bar `n-2`, end at `n+extend`, and are removed only
  when a close strictly crosses the FVG's mitigation boundary.
- Optional mitigation lines, newest unmitigated levels, per-bar dynamic fills,
  and dashboard location/text size follow the source inputs.
- The configured higher timeframe runs in an independent child context and is
  mapped back only on its final chart sub-bar. A lower timeframe cannot be
  reconstructed from coarser OHLC, so the supplied chart candles are the
  deterministic fallback until market-data fan-out exists.

There is no FVG-specific 300-bar default. The runtime analyzes the candle
window the chart has loaded, capped globally at 5,000 candles for request
safety, and the viewport layer renders only series that intersect the current
pan/zoom window. The source file preserves LuxAlgo attribution and the
CC BY-NC-SA 4.0 notice. Pine `alertcondition()` events are reported but are not
yet part of the common `IndicatorResult` contract.

### Legacy `SWING_SR` removal

`SWING_SR` was a temporary catalog implementation for the earlier common
indicator runtime. It is removed from the active catalog and from the
source-backed built-in set so the runtime has one generic Pine path. This is a
catalog/API change, not a request to delete user data:

- New catalog responses and new indicator presets must not create `SWING_SR`.
- Existing persisted rows remain readable as opaque configs. Hydration should
  mark them as deprecated/unavailable (or offer an explicit migration to a
  saved Pine source) instead of silently substituting a different formula.
- The runtime must reject a direct `SWING_SR` compute request with a structured
  diagnostic, while `CUSTOM`/saved/public scripts continue through the generic
  compiler.
- Historical changelog entries remain historical; they do not imply that the
  removed catalog entry is still supported.

## Concurrency Model

Fiber already handles simultaneous HTTP requests concurrently. Both compile
and built-in requests additionally pass through `runtimeJobGroup[T]`:

- Each runtime group owns four long-lived workers and a bounded queue; distinct
  requests cannot create an unbounded number of goroutines.
- Equivalent requests share one in-flight job (singleflight).
- Completed results live in a bounded 64-entry LRU; no unbounded user/script
  cache is retained.
- Work has an independent 5s context and panic recovery. Context failures map
  to HTTP 408, queue saturation to 503, and internal/panic failures to 500.
- Compile and indicator keys contain source/type (the source hash inherently
  includes its Pine version and declaration text), timeframe, input/style
  properties, normalized candle tail, and replay cutoff. User, script, and
  chart-instance identity are excluded, then the handler rebinds the cached
  result ID to each caller.
- Independent pure-series output branches use `runOrderedJobs`, a bounded group
  that retains declaration order so goroutine scheduling cannot change series
  keys or snapshots.

Do not share mutable evaluator state across requests. Each compile request owns
its parser state, variable store, series buffers, and emitted primitives.

Recommended limits:

- Request timeout: 5s initial target, configurable.
- Max source size: configurable, default 256 KB.
- Max candles per compile: configurable, default 5,000.
- Max emitted objects per script: respect Pine-style limits from source where
  present, otherwise backend defaults.

## Frontend Integration

Add a typed ky resource:

```text
frontend/src/services/api/resources/pineRuntimeApi.ts
```

The resource should expose:

```ts
getPineMeta(sourceCode)
getPineInputs(sourceCode, inputOverrides)
getPineStyles(sourceCode, styleOverrides)
compilePine(sourceCode, candles, inputOverrides, styleOverrides, replayCutoff?)
```

Then migrate call sites:

| Frontend caller | Migration |
| --- | --- |
| `PineEditor.tsx` preview/add validation | Call backend compile endpoint |
| `chartStore.ts` save-name derivation | Call backend meta endpoint where async is acceptable; keep a tiny local fallback only for offline anonymous mode |
| `IndicatorSettingsDialog.tsx` | Hydrate input/style schemas from backend and cache by `scriptId/sourceHash` |
| `IndicatorLegend.tsx` status inputs | Use cached backend input schema |
| `services/indicators.ts` CUSTOM dispatch | Read cached backend `IndicatorResult`; do not synchronously compile |
| `PriceChart.tsx` | Trigger async compile cache refresh when visible candles/source/overrides change |

The chart render path must not block on an HTTP request. It should:

1. Render the most recent cached compile result if present.
2. Show nothing or a lightweight loading state for that custom indicator while
   the first backend compile is pending.
3. Ignore stale compile responses if source, candles, replay boundary, or
   overrides changed before the response returned.

## Cache Keys

Use a stable cache key:

```text
scriptId/sourceHash + candleRangeHash + inputHash + styleHash + timeframe +
replayCutoff
```

The candle range hash should include first candle time, last candle time, candle
count, and replay cursor when active. The source hash already changes with its
version annotation and declaration arguments. Do not stringify every candle
for normal render invalidation; full candles are only sent in the compile
request.

For scripts that use `request.security()`, the frontend cache is intentionally
window-based (`length`, first bar time, last bar time) rather than full-OHLC
based. MT5 refreshes the latest rates every few seconds with the same bar
timestamps; recompiling and blanking the result during each refresh removes and
re-adds object-heavy overlays such as ADR, which visually reloads the chart. The
cache keeps the latest successful result per script/symbol/timeframe while a new
compile is pending.

The Go runtime also has a narrow bootstrap for lagged higher-timeframe SMA
expressions, for example:

```pine
request.security(syminfo.tickerid, "D", ta.sma(high - low, length)[1])
```

TradingView usually has enough preloaded daily history for this to be warmed up
before the visible intraday window. If the backend request only contains a short
daily context, the strict SMA remains `na`; the bootstrap fills missing strict
values from the completed higher-timeframe buckets available in the request.

## Migration Plan

### Phase A - Backend runtime shell

Status: implemented for plot/hline/fill, daily `request.security()`, and common object APIs.

1. Added `internal/pineruntime` models and handlers.
2. Added `/api/v1/pine-runtime/meta`, `/inputs`, `/styles`, `/compile`.
3. Return structured runtime diagnostics instead of panics or generic 500s.
4. Added tests for VSA, Better RSI, ADR object runtime, and HTTP compile route.
5. Added a partial-daily `request.security()` warm-up regression test for ADR-style scripts.

### Phase B - Frontend async adapter

Status: implemented for compile result cache.

1. Added `src/services/api/resources/pineRuntimeApi.ts`.
2. Added `src/services/pineRuntimeCache.ts`.
3. Wired Pine Editor preview/add-to-chart validation to backend compile.
4. `PriceChart` requests backend compile asynchronously and renders cached results into overlay or native-pane series.
5. `IndicatorSettingsDialog` and legend status-line input summaries request backend schemas.
6. `request.security()` scripts request extra historical candles and use a window-based cache key so
   MT5 same-window OHLC refreshes do not temporarily blank overlay output.

### Phase C - Chart runtime migration

Status: implemented for CUSTOM indicator render path.

1. `computeIndicator()` no longer calls `compilePineScript()` synchronously for CUSTOM indicators.
2. Chart/pane components request backend compile through effects.
3. The cached backend `IndicatorResult` drives Lightweight Charts rendering.
4. Replay-visible candle slices are the same `candles` input passed into chart/pane rendering.

### Phase D - Remove frontend compiler ownership

Status: implemented.

1. Removed `frontend/src/services/pineScript.ts`.
2. Added `frontend/src/services/pineRuntimeTypes.ts` for API contract types and default editor source.
3. Stopped adding Pine support in TypeScript; Go is the source of truth.
4. Ported object runtime support (`line`, `box`, `label`, `table`) and daily `request.security()` to Go.

## Error Handling

Backend errors should be user-actionable:

| Error | Frontend behavior |
| --- | --- |
| Parse error | Show Pine Editor status and line/column when available |
| Unsupported feature | Show warning; render supported output if safe |
| Timeout | Keep previous cached output and show non-blocking warning |
| Too many candles/source too large | Ask frontend to reduce request size or paginate visible range |
| Network/backend unavailable | Keep previous cached output or render an empty result for that indicator |

Never return a blank chart because a custom indicator failed. Indicator failure
must be isolated to that indicator.

## Testing

Backend tests:

- Metadata extraction for v3/v4/v5 `study()` and `indicator()`.
- Input extraction for `input()`, `input.int`, `input.float`, `input.bool`,
  `input.color`, `input.source`, grouped inputs, and Pine `inline` row metadata.
- Shared `#RRGGBB`/`#RRGGBBAA` expression parsing across vector and stateful
  execution, including assignments, `input.color()` defaults, `color.new()`,
  invalid-literal diagnostics, and source-default catalog compilation without
  legacy color overrides.
- Style extraction for `plot`, `hline`, `fill`, labels, lines, boxes, and tables.
- Compile fixtures for VSA Volume, Better RSI, ADR 50 SR Pro, and the
  10-in-1 moving-average script shape.
- Replay safety: compile only receives and emits values for supplied candles.
- Concurrency: compile multiple scripts in parallel without data races.
- Shared saved scripts: equivalent source/properties/candles coalesce even
  when saved by different users or under different script IDs, and every HTTP
  response still carries its own requested instance ID.
- Common compiler parity: every current built-in resolves to a `.pine` source;
  an FVG catalog request and the same source saved under another user's script
  ID produce the same primitives while retaining their own instance IDs.
- Generic stateful fixtures cover identity-neutral UDT/tuple/array/object
  execution, independent security state, function-local `var`, fixed boxes,
  dynamic fills, tables, input-source pivots, and closed-bar history.
- The submitted Swing Highs/Lows v5 fixture compiles through the generic path,
  preserves multiline descriptions and label properties, confirms pivots only
  after their right-hand window, and produces no future labels under replay.
- Declaration-property coverage records named and positional literal/enum
  values (`shorttitle`, format/precision/scale, lookback/object limits,
  timeframe gaps, and `calc_bars_count`) as metadata. Tests separately cover
  the object-limit semantics currently used by the stateful executor.
- FVG source behavior: middle-candle confirmation, threshold, strict geometry,
  dynamic/dashboard output, and loaded-window history without a fixed 300-bar
  limit.

Frontend tests:

- Pine Editor calls backend compile before add-to-chart.
- Settings dialog uses backend schema cache.
- Settings dialog preserves Pine `inline` rows and chart legends prefer
  `shorttitle` metadata when present.
- Chart ignores stale compile responses after timeframe/symbol/replay changes.
- CUSTOM indicator render does not block main chart initialization.
- Logout clears user-specific script/schema/compile cache.
- Indicator pane projection keeps sparse Pine `hline()`/`fill()` references
  extended through right-offset whitespace without extending dynamic plots or
  `linebr` helper segments.
- Sparse FVG segments retain both anchors when crossing a viewport, return an
  empty slice safely when the viewport misses them, and never index past the
  point array while panning.

Manual checks:

- Add VSA, Better RSI, and ADR from Pine Editor.
- Add 10-in-1 moving averages from Pine Editor and confirm the chart shows
  `10 in 1 MAs` with visible MA lines and horizontal Inputs rows.
- Add the submitted Swing Highs/Lows v5 source from the Pine Editor; verify
  confirmed labels, multiline tooltips, style colors, and no labels beyond a
  selected Replay candle.
- Change inputs and style values.
- Switch symbol/timeframe while custom indicators are visible.
- Start replay, select a past bar, then switch timeframe.
- Submit a legacy `SWING_SR` compute request and verify the runtime rejects it;
  a client may separately present an unavailable/migration state, but it must
  not silently execute a replacement formula.
- Sign out and confirm user script data is cleared from view.

## Acceptance Criteria

- New Pine language support is implemented in Go, not in frontend TypeScript.
- Frontend chart render path no longer synchronously compiles Pine scripts.
- Existing supported scripts keep visual parity: VSA colored volume, Better RSI
  hlines/fills/cycler/line-break highlights, ADR lines/labels/table.
- Backend compile responses are deterministic for the same source, candles,
  inputs, and styles.
- Backend handles multiple compile requests concurrently without shared-state
  corruption.
- Frontend remains responsive while custom indicators compile.

## Open Decisions

- Whether compile-by-script-id should be added:
  `POST /api/v1/pine-runtime/compile/:scriptId`.
- Whether a market-data fan-out endpoint should supply true lower-timeframe
  candles to an indicator running on a coarser chart.
