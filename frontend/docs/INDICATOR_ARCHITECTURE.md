# INDICATOR ARCHITECTURE

_Date: 2026-07-17. Scope: built-in indicators plus source-code indicators created from the
bottom Pine Editor._

## Architecture rule

Indicators are data-series overlays, not chart interaction objects. Do not mix indicator state with
drawing state, alert state, or chart pointer handling. Every indicator must consume only the candle
array it is given, and the caller must pass the replay-aware visible candle slice. This keeps
indicator rendering no-look-ahead by construction.

All indicator formulas are Pine source compiled by one backend pipeline.
Registered built-ins differ only because the backend catalog supplies their
source/default mapping; saved/public scripts supply source from storage. Both
call `pineruntime.Compile`. The frontend does not calculate built-ins or compile
Pine source; see
[`../../docs/PINE_RUNTIME_GO_MIGRATION.md`](../../docs/PINE_RUNTIME_GO_MIGRATION.md).
Do not execute user-provided source with `eval`, `new Function`, dynamic imports,
or any other general JavaScript execution path.

## Overview

The indicator subsystem has two families:

1. Built-in indicators: SMA, EMA, VWAP, RSI, MACD, ADR, FVG, Swing S/R.
2. Source-code indicators: saved Pine-like scripts from the bottom `Pine Editor` tab.

Both families converge into the same `IndicatorConfig` model and chart render contract. An async
runtime request populates the appropriate cache, and `computeIndicator(config, candles)` only
selects the cached `IndicatorResult`; it never calculates a series.

```
BottomPanel / IndicatorMenu
        |
        v
chartStore indicators[] + pineScripts[]
        |
        v
services/indicators.ts + runtime caches
        |
        +-- POST indicator-runtime/compute (catalog source -> Compile)
        |
        +-- pineRuntimeCache for CUSTOM backend compile results
        |
        v
IndicatorResult { id, series[] }
        |
        +-- PriceChart overlay line series
        |
        +-- PriceChart native Lightweight Charts pane
```

## Key files

| Concern | File |
|---|---|
| Indicator and script types | `src/types/indicators.ts` |
| Indicator state, persistence, script actions | `src/store/chartStore.ts` |
| Backend indicator presets API | `src/services/api/resources/indicatorsApi.ts` |
| Built-in runtime API/cache and display adapter | `src/services/api/resources/indicatorRuntimeApi.ts`, `src/services/indicatorRuntimeCache.ts`, `src/services/indicators.ts` |
| Backend Pine source catalog | `backend/internal/pineruntime/builtin_sources.go`, `sources/*.pine` |
| Shared compiler/stateful VM | `backend/internal/pineruntime/compiler.go`, `stateful_parser.go`, `stateful_eval.go`, `stateful_runtime.go` |
| Common goroutine scheduler/input/timeframe helpers | `backend/internal/pineruntime/runtime_jobs.go`, `runtime_common.go` |
| Pine runtime API client/cache | `src/services/api/resources/pineRuntimeApi.ts`, `src/services/pineRuntimeCache.ts` |
| Pine runtime shared types/default source | `src/services/pineRuntimeTypes.ts` |
| Bottom Pine Editor + embedded script storage | `src/components/pine/PineEditor.tsx` |
| Indicator dropdown entry points | `src/components/toolbar/IndicatorMenu.tsx` |
| Backend Pine scripts API | `src/services/api/resources/pineScriptsApi.ts` |
| Shared settings dialog | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
| Settings architecture guide | `SETTTING_ARCHITECTURE.md` |
| Overlay rendering on price chart | `src/components/chart/PriceChart.tsx` |
| Overlay and native pane rendering | `src/components/chart/PriceChart.tsx` |
| Bottom tab mounting | `src/components/layout/BottomPanel.tsx` |

## Data model

`IndicatorConfig` is the chart-attached instance:

```ts
type BuiltInIndicatorType = "SMA" | "EMA" | "VWAP" | "RSI" | "MACD" | "ADR" | "FVG" | "SWING_SR";
type IndicatorType = BuiltInIndicatorType | "CUSTOM";

interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  length: number;
  length2?: number;
  length3?: number;
  color: string;
  color2?: string;
  visible: boolean;
  separatePane?: boolean;
  name?: string;
  scriptId?: string;
  sourceCode?: string;
  inputValues?: Record<string, string | number | boolean>;
  styleValues?: Record<string, string | number | boolean>;
}
```

`CustomIndicatorScript` is the saved source-code library item:

```ts
interface CustomIndicatorScript {
  id: string;
  name: string;
  sourceCode: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}
```

The split matters:

- `pineScripts[]` is the saved script library.
- `indicators[]` is the active chart instance list.
- A saved script can be loaded/edited without being active on the chart.
- An active custom indicator stores `scriptId` and a copy of `sourceCode` so chart rendering is
  deterministic from `indicators[]`.
- An active custom indicator stores `inputValues` as per-instance Pine input overrides. This allows
  multiple instances of the same saved script to use different settings.
- An active custom indicator stores `styleValues` as per-instance visual overrides for plots,
  hlines, fills, and supported Pine objects. See `SETTTING_ARCHITECTURE.md`.

## State and persistence

State lives in `chartStore.ts`:

| Atom | Purpose | Persistence |
|---|---|---|
| `indicatorsAtom` | Active chart indicator instances | Backend `indicator_presets.config` in authenticated mode; localStorage `indicators` for anonymous/cache fallback |
| `pineScriptsAtom` | Saved Pine-like source-code scripts | Backend `pine_scripts` in authenticated mode; localStorage `pineScripts` for anonymous/cache fallback |
| `pineEditorScriptIdAtom` | Currently loaded script id in editor | runtime |
| `pineEditorTitleAtom` | Current editor title field | runtime |
| `pineEditorSourceAtom` | Current editor source field | runtime |

Hydration is part of `chartStore.hydrateAtom`, which is called by `useStoreHydration()` after mount.
This keeps localStorage access client-only and avoids SSR mismatch.

Authenticated users are then overwritten by the backend Phase 8 bootstrap path:

```
GET /api/v1/sync/bootstrap
  -> indicators: BackendIndicatorPreset[]
  -> useWorkspaceBootstrap()
  -> chartStore.applyRemoteIndicatorsAtom()
  -> indicatorsAtom + local cache update
```

The backend stores the full `IndicatorConfig` as opaque JSON in
`indicator_presets.config`. It also promotes `indicatorType`, `visible`,
`position`, and `clientId` for filtering, ordering, and idempotent writes. The
frontend always sends `IndicatorConfig.id` as `clientId`, then maps
`clientId || config.id || backend id` back to the local indicator id when
hydrating.

Add/remove/toggle/settings changes are optimistic in `chartStore` and then
debounced to:

```
POST   /api/v1/indicators        # create/upsert by clientId
PUT    /api/v1/indicators/:id    # replace by backend id or clientId
DELETE /api/v1/indicators/:id    # delete by backend id or clientId
```

Phase 9 wires Pine script source persistence through `/api/v1/pine-scripts`.
Bootstrap carries script metadata only; the editor fetches full `sourceCode`
when a script is opened or when a metadata row is added to the chart.
CUSTOM indicator configs still carry a source copy so active chart indicators can
render immediately after bootstrap.

## Built-in indicator flow

```
IndicatorMenu click SMA/EMA/etc.
  -> toggleIndicatorAtom(type)
  -> defaultIndicator(type, uid("ind"))
  -> indicatorsAtom update + localStorage/cache write
  -> authenticated mode queues POST/DELETE /api/v1/indicators by clientId
  -> ChartArea sees indicatorsAtom
  -> PriceChart calls ensureIndicatorRuntimeResult(config, visibleCandles)
  -> POST /api/v1/indicator-runtime/compute
  -> Go registry calculates the indicator and returns IndicatorResult
  -> runtime cache notifies PriceChart
  -> computeIndicator reads the cached API result (no formula execution)
  -> Lightweight Charts series receives calculated LinePoint[]
```

Built-in formulas live only in the backend registry. The frontend adapter is deliberately a cache
lookup: it sends the replay-visible candle slice and instance config, then renders the returned
time-aligned `IndicatorResult`. There is no browser fallback calculator; a runtime error is isolated
to an empty result for that indicator instance.

### Fair Value Gap built-in

`FVG` is the embedded, attributed user-provided `Fair Value Gap [LuxAlgo]` Pine
v5 source, executed by the same compiler as a user-saved copy. It
requires the middle candle to close beyond the candle-two-bars-back boundary,
supports manual or cumulative-range auto threshold, and removes a bullish or
bearish record only after the close strictly crosses its mitigation boundary.
Fixed boxes use chart indices `n-2` through `n+extend`; dynamic mode emits the
evolving boundary at every supplied bar. Optional mitigation levels,
unmitigated levels, one configured timeframe, and dashboard location/size are
source inputs exposed by the shared settings dialog.

The FVG request uses the chart's loaded candle window, up to the common 5,000
candle request cap. There is no hardcoded 300-bar history mode: panning/zooming
loads history through the chart and viewport projection culls off-screen
segments. Higher-timeframe signals are confirmed on the final chart sub-bar;
lower-timeframe requests use chart bars as a deterministic fallback because
coarser OHLC cannot reconstruct missing sub-bars. The reference source is
attributed under CC BY-NC-SA 4.0 by LuxAlgo. Alert conditions remain outside
the current `IndicatorResult` contract.

## Source-code indicator flow

The Pine Editor is a bottom-panel tab, not a popup. It has:

- A script toolbar: new, save, save-and-add-to-chart.
- A left embedded `My scripts` list: search, favorite, load/edit, add, delete.
- A source editor with line numbers.

Save flow:

```
PineEditor Save
  -> savePineScriptAtom({ id, name, sourceCode })
  -> POST /api/v1/pine-runtime/meta for title/overlay metadata
  -> insert/update pineScriptsAtom
  -> localStorage `pineScripts` anonymous/cache update
  -> authenticated mode POST /api/v1/pine-scripts with clientId
  -> update active CUSTOM indicators with the same scriptId
```

Add-to-chart flow:

```
PineEditor Play or My scripts Add
  -> POST /api/v1/pine-runtime/compile preview through pineRuntimeApi
  -> if compile errors: show status + log
  -> savePineScriptAtom(...)
  -> addCustomIndicatorFromScriptAtom(savedScript)
  -> if savedScript is metadata-only, GET /api/v1/pine-scripts/:id first
  -> indicatorsAtom gets type: "CUSTOM"
  -> authenticated mode POST /api/v1/indicators with clientId
  -> PriceChart requests backend compile through pineRuntimeCache
  -> computeIndicator() reads cached IndicatorResult without synchronous Pine compile
```

Custom indicator rendering is now asynchronous:

```
PriceChart native series/panes
  -> ensurePineIndicatorResult(config, visibleCandles)
  -> POST /api/v1/pine-runtime/compile
  -> cache IndicatorResult by source hash + candle range + inputs + styles
  -> notify subscribers
  -> chart rerenders cached result
```

`pineRuntimeCache` never compiles Pine in the browser. If the backend compile
fails, the failure is isolated to that indicator result; new Pine language
support belongs in `backend/internal/pineruntime`.

Edit existing custom indicator source:

```
Indicator legend source-code `{}` button
  -> if config.type === "CUSTOM" and scriptId exists:
       loadPineScriptAtom(scriptId)
       GET /api/v1/pine-scripts/:id if sourceCode is not already loaded
       setBottomTabAtom("pine")
```

Authenticated full flow:

```
Save script
  -> /api/v1/pine-scripts stores source + favorite + clientId
Add saved script
  -> load full source when needed
  -> create CUSTOM IndicatorConfig with scriptId + sourceCode copy
  -> /api/v1/indicators stores active chart preset
Reload/login
  -> bootstrap applies pineScripts metadata first
  -> bootstrap applies indicator presets second
  -> active CUSTOM indicators render from their config sourceCode copy
```

Edit existing custom indicator settings:

```
Indicator legend settings gear
  -> setEditingIndicatorAtom(id)
  -> IndicatorSettingsDialog
  -> POST /api/v1/pine-runtime/inputs and /styles
  -> update IndicatorConfig.inputValues
  -> pineRuntimeCache invalidates by input/style hash and recompiles through backend
```

Custom indicators do not bypass `IndicatorSettingsDialog`. The gear edits input values; the `{}`
button edits source code. See `SETTTING_ARCHITECTURE.md`.

## Indicator browser

`components/toolbar/IndicatorMenu.tsx` is a TradingView-style modal opened from
the top toolbar. It intentionally keeps only the product-supported script
surfaces:

- Header: `Indicators, metrics, and strategies`.
- Sidebar tabs: `Favorites`, `My scripts`, and `Store`.
- `Favorites` and `My scripts` are private workspace tabs. They render only
  when `authStatus === "authed"` and read saved Pine scripts from
  `chartStore.pineScripts`.
- `Store` reads public scripts from `GET /api/v1/indicator-store`; the endpoint
  does not require auth and returns `sourceCode` so any visitor can add the
  script to chart.
- Saved scripts can be favorited, added to chart, opened in the bottom Pine
  Editor, or deleted after confirmation.
- Pine Editor publishes the current saved script through
  `POST /api/v1/pine-scripts/:id/publish`.
- `services/privateWorkspaceAccess.ts` owns the shared auth gate for the
  indicator browser tabs, bottom-panel tab list, and Pine Editor mount guard.
  Anonymous/loading/authenticating users see only public Store indicators; the
  bottom panel exposes only `Replay`. Private bottom-panel tabs (`Trade`,
  `Journal`, `Analytics`, `Pine Editor`, `Logs`) are hidden and any stale active
  private tab is remapped to `Replay` without forcing the bottom panel open.
- Do not reintroduce hardcoded TradingView catalog fallback data. Public Store
  rows must come from backend API data only.

## Pine subset compiler contract

`backend/internal/pineruntime` implements a safe, version-agnostic subset
compiler. It is not a full Pine v3-v6 implementation:

- No `eval`.
- No arbitrary JavaScript calls.
- Tokenizer + recursive-descent expression parser.
- Whitelisted identifiers and functions only.
- Output is the same `IndicatorResult` shape as built-ins.
- Histogram plots and per-bar colors are supported for volume-style scripts.
- Horizontal lines, background fill bands, line widths/styles, and per-bar line colors are supported
  for RSI-style scripts.
- Pine line-break plots (`plot(..., style=linebr)` or
  `plot.style_linebr`) must compile into independent line segments separated at
  every `na` gap. Do not emit one sparse line series for `linebr`, because
  Lightweight Charts connects finite points across missing bars and creates
  diagonal bridges that TradingView does not show. Helper segments should keep
  `lastValueVisible=false` and `statusLineVisible=false` so conditional
  highlight plots do not add extra price labels or status-line values.
- Pine reference outputs that are intended to span the current viewport,
  especially `hline()` and `fill()`, must carry `extendToVisibleRange=true`.
  Frontend renderers then project those sparse reference series onto the
  current logical viewport before calling `setData()`. The projection includes
  TradingView-style right-offset whitespace by adding synthetic time slots after
  the last real candle. This prevents right-side blank gaps when Pine compile
  cache and chart viewport ranges differ, without stretching dynamic plots or
  `linebr` helper segments.
- Pure series use the vector evaluator. UDT/typed-array/tuple/loop programs use
  an ordered bar VM with committed history and reference identity. Both paths
  are selected by syntax/AST capability inside the same `Compile` function.
- Frontend compile requests include extra historical candles for scripts using
  `request.security()` so higher-timeframe values are not computed only from
  the visible viewport.

Supported source structure:

```pine
//@version=6
indicator("My script", overlay=true)
len = input.int(20, title="Length")
basis = ta.sma(close, len)
plot(basis, title="SMA", color=color.blue)
```

Compatibility boundaries:

| Area | Implemented | Explicit limit |
|---|---|---|
| Execution | Sequential closed-bar state/history for the stateful subset; batch pure-series evaluation | No realtime tick rollback/re-execution or `varip` |
| Types/state | Scalars, series, colors, UDTs, tuples, typed reference arrays, methods, `var`, history | No maps, matrices, polylines, libraries/imports |
| Control flow | `if/else`, ternary, compound reassignment, ascending/descending and `for ... in` loops in the stateful subset | No `while`; unsupported AST fails closed |
| Data contexts | Current-symbol higher-timeframe `request.security()` with independent child state and final-subbar mapping | No multi-symbol data or lower-timeframe arrays; unavailable sub-bars are never invented |
| Visuals | Plots, line-break segments, hlines/fills, supported line/box/label/table lifecycles, dynamic baseline fills | Unsupported visual calls fail before execution |
| Trading/events | Historical indicator primitives | No strategies/orders/broker emulation; alert conditions do not deliver events |

Supported identifiers:

- OHLCV: `open`, `high`, `low`, `close`, `volume`
- Derived sources: `hl2`, `hlc3`, `ohlc4`
- Constants: `true`, `false`, `na`
- Pine enum-like identifiers used in metadata: `input.*`, `plot.style_*`, `format.*`,
  `line.style_*`, `label.style_*`, `position.*`, `size.*`, `text.align_*`, `barmerge.*`
- Named call arguments in whitelisted calls, including Pine v4 `input(defval=...)`
- Pine color constants used by source scripts, including the VSA palette colors
- Pine v3 bare enum aliases used by older public scripts: `integer`, `source`, `linebr`,
  `solid`, `dashed`, `dotted`
- Runtime identifiers needed by object scripts: `bar_index`, `barstate.islast`, `time`,
  `barstate.isfirst`, `barstate.ishistory`, `barstate.isconfirmed`, `barstate.isrealtime`,
  `last_bar_index`, `last_bar_time`, `timeframe.period`, and the supported `syminfo.*` fields.

Supported expression features:

- Arithmetic with precedence and unary minus.
- Comparisons: `>`, `>=`, `<`, `<=`, `==`, `!=`.
- Logical `and` / `or` / `not`.
- Ternary conditionals, including color palettes.
- History references such as `series[1]`.
- Typed declarations such as `float volumeMA = 0`.
- `var` state in the bar VM; selected declaration qualifiers accepted by the
  pure-series subset. `varip` is rejected because realtime rollback semantics
  are not implemented.
- Compound assignments such as `x += 1`, parsed as reassignment syntax.
- One-line helper functions in the form `helper(float value, int length) => expression`.
- Pine v3 indentation-based `if ... else` expressions for supported assignment patterns.
- Wilder-style recursive assignments like `x := nz(x[1]) + (source - nz(x[1])) / length`.
- Self-referential assignments with history, such as `cycler[1]`, must evaluate point-by-point in
  scalar context. Do not rebuild full series inside each bar loop.

Supported functions:

- Inputs: `input`, `input.int`, `input.float`, `input.source`, `input.bool`, `input.color`
- Pure series: `ta.sma`, `ta.ema`, `ta.rma`, `ta.wma`, `ta.hma`, `ta.vwma`,
  `ta.vwap`, `ta.rsi`, `ta.change`, `ta.crossover`, `ta.crossunder`,
  `ta.pivothigh`, and `ta.pivotlow`, plus their implemented legacy aliases.
- Stateful calls required by current generic fixtures/catalog sources:
  `ta.cum`, `ta.pivothigh`, and `ta.pivotlow`.
- Math/helpers: `math.abs`, `math.max`, `math.min`, `abs`, `max`, `min`, `nz`, `na`,
  `color(base, transp)`, `color.new(base, transp)`, `str.tostring`, `str.format_time`
- Timeframe bridge: current-symbol
  `request.security(..., timeframe, expression, lookahead=barmerge.lookahead_off)`
  over higher-timeframe candles aggregated from the supplied chart runtime for
  common second/minute/day/week/month strings, plus `time(timeframe)`.
  The Go runtime has a narrow bootstrap path for lagged SMA security expressions such as
  `ta.sma(high - low, length)[1]`: if the strict SMA is still `na` because the supplied higher-
  timeframe history is shorter than TradingView would normally preload, it fills missing values from
  the completed higher-timeframe buckets that are available. This prevents ADR-style scripts from
  disappearing on 1m/5m windows while preserving strict values once enough history exists.
- Plot metadata: `plot(..., title=..., color=..., style=plot.style_columns)`,
  `plot(..., style=linebr|plot.style_linebr)`, `hline(...)`,
  `fill(hlineA, hlineB, color, transp=...)`
- Indicator metadata: `indicator("Name", overlay=true|false)` and `study(...)`
- Stateful reference subset: typed arrays preserve handle identity; `line.new`,
  `box.new`, `label.new`, `table.new`, handle deletion, array mutation, and
  `table.cell` become chart series, labels, and dashboard metadata. The legacy
  pure object projection remains for its fixture-tested setters. Neither path
  matches an indicator title or formula.

Object-heavy Pine scripts can emit one object per trading day. The frontend cache keeps only the
latest few emitted segments per object handle before rendering, so ADR-style historical lines remain
readable across 1m/5m/15m/H1 instead of flooding the chart.

Active Pine objects may deliberately contain a short future tail. The Go object runtime uses this
for `line.new` right-edge extension and anchors active `label.style_label_left` labels at the same
future timestamp. `indicatorPointsInViewport()` must therefore preserve points after the newest real
candle whenever the overscan window reaches the live tail. If those points are clipped, Lightweight
Charts never registers their timestamps, `timeToCoordinate()` returns `null`, and current ADR H50/L50
labels disappear. Historical windows must continue to upper-clip future points so panning backward
does not retain unrelated live objects.

For custom scripts that use `request.security()`, the frontend runtime cache is keyed by the candle
window (`length`, first bar time, last bar time) rather than every OHLC value. MT5 can refresh the
latest bars every few seconds with the same timestamps; recompiling and temporarily rendering an
empty result on each refresh would remove and re-add Pine overlay series, which makes the chart look
like it reloads. The cache keeps the latest successful result for the same script/symbol/timeframe
while a new compile is pending.

Unsupported Pine features fail visibly instead of silently producing an empty
chart. Strategies/orders, libraries/imports, maps/matrices/polylines, legacy
unsupported collection constructors, `while`, multi-symbol data,
`request.security_lower_tf`, `varip`, and unsupported visuals are blocking
errors. `alertcondition()` remains non-blocking for historical visuals but is
listed in `unsupportedFeatures` because event delivery is absent.

## Render contract

`computeIndicator(cfg, candles)` is the only render entry point. It returns:

```ts
interface IndicatorResult {
  id: string;
  series: {
    key: string;
    color: string;
    data: { time: number; value: number; color?: string }[];
    type?: "line" | "histogram" | "baselineFill";
    lineWidth?: 1 | 2 | 3 | 4;
    lineStyle?: 0 | 1 | 2 | 3 | 4;
    baseValue?: number;
    fillBelowBase?: boolean;
    lastValueVisible?: boolean;
    lineVisible?: boolean;
  }[];
  labels?: {
    key: string;
    price: number;
    text: string;
    color: string;
    backgroundColor?: string;
    time?: number;
  }[];
  dashboard?: {
    key: string;
    title: string;
    subtitle?: string;
    rows: { label: string; value: string; valueColor?: string }[];
  };
}
```

Overlay indicators render in `PriceChart`:

- `indicators.filter(i => i.visible && !i.separatePane)`
- One Lightweight Charts line, histogram, or baseline-fill series per returned `series[]`.
- Histogram and line points may carry per-bar colors, matching scripts such as VSA volume palettes
  and Better RSI cycler colors.
- Optional `labels` and `dashboard` metadata render as DOM overlays projected from price/time
  coordinates; this is used by the ADR object-script compatibility path.
- Overlay labels are clipped when their projected anchor is off-screen to the left. Do not clamp
  historical off-screen labels to the left edge, or ADR labels will stack over the chart.
- At the live tail, viewport culling keeps the bounded future points emitted by mutable Pine objects.
  This is distinct from `extendToVisibleRange`: object geometry owns its short right extension,
  while reference outputs such as `hline()` are re-projected across the whole logical viewport.
- Series are keyed by indicator id and recreated only when series count changes.

Separate-pane indicators render in native Lightweight Charts 5 panes owned by
`PriceChart`:

- `indicators.filter(i => i.visible && i.separatePane)`
- `PriceChart` creates stable preserved panes in indicator-store order.
- Every pane shares the candle chart's time scale, logical range, crosshair, and
  right-side whitespace projection without an event bridge.
- Hidden indicators keep an empty preserved pane so toggling visibility does
  not reorder neighboring panes.
- `linebr` output is already split by the backend runtime. The pane renderer
  should render those returned segments as independent line series and must not
  merge them back together.
- Series marked `extendToVisibleRange` are normalized through
  `indicatorSeriesProjection.ts` in `PriceChart`, so
  hlines and filled bands track the visible logical viewport for every
  indicator, including the right-offset whitespace area.
- Histogram and line points preserve per-bar `data[].color` before applying fallback colors.
- Series APIs are retained in refs and reused between candle updates. Recreate only when the
  returned series signature changes; otherwise call `setData()` on existing series.
- Pine hlines and fill bands should emit sparse reference points only. The
  frontend projection layer owns viewport/right-offset expansion; do not add
  fake candle data or compile-time right-tail candles to fix visual gaps.

The source of `candles` must be `useChartSeries()` from `ChartArea`, not raw full history. During
Replay that projection contains only server-revealed bars.

Indicator-event alerts are not part of the current runtime response or Alert
Center model. The deferred backend-only implementation is documented in
[`../../docs/PIVOT_FORMATION_ALERT_PLAN.md`](../../docs/PIVOT_FORMATION_ALERT_PLAN.md).
Do not detect pivot formation from returned series in the frontend.

## Overlay vs separate pane

Built-in defaults:

- Overlay: SMA, EMA, VWAP, ADR, FVG, Swing S/R.
- Separate pane: RSI, MACD.

Custom script default:

- `indicator(..., overlay=true)` -> overlay on price chart.
- `indicator(..., overlay=false)` or omitted overlay -> separate pane.

When a saved script is updated, active custom indicators with the same `scriptId` are patched with
the new `sourceCode` and `separatePane` derived from the latest metadata.

## Error handling

Compile errors are local to the source-code indicator:

- Pine Editor `Play` validates against a recent candle preview before saving/adding.
- Compile errors show in the Pine Editor status line and are sent to `logAtom`.
- Rendering a broken active script returns no series rather than crashing the chart.

Do not throw from render-time chart effects for user script errors. User source errors are content
errors, not application runtime errors.

## Extensibility

To add a new built-in indicator:

1. Add the type to `BuiltInIndicatorType`.
2. Add a `.pine` file under `backend/internal/pineruntime/sources/` and a
   config/input/style mapping in `builtin_sources.go`. Do not add a native Go
   formula dispatch.
3. Add backend catalog completeness, common-compiler parity, validation, and
   HTTP-contract tests.
4. Add frontend instance defaults in `defaultIndicator`; these are UI defaults,
   not calculation logic.
5. Add a menu option in `IndicatorMenu`.
6. Add settings schema through the shared settings architecture if needed. See
   `SETTTING_ARCHITECTURE.md`; do not create an indicator-specific settings modal.
7. Keep `services/indicators.ts` as a cache-result adapter. Never add a browser
   formula or fallback calculator.

To add a new Pine subset function:

1. Add a whitelist case in `backend/internal/pineruntime/expression.go`.
2. Implement the calculation as a pure series helper in the Go runtime package.
3. Return `pineValue` as either scalar, series, color, color series, string, or bool.
4. Add a backend fixture test in `backend/internal/pineruntime/compiler_test.go`.

## Verification checklist

Before considering indicator work complete:

- `npm run typecheck`
- `npm run lint`
- App loads at `http://localhost:3000`
- Built-in SMA/EMA add/remove still works
- RSI/MACD separate panes still sync pan/zoom with main chart
- Pine Editor bottom tab opens without popup
- Save creates a row in `My scripts`
- Add places the custom indicator on the chart
- Editing a saved script updates any active custom indicator using the same script id
- Invalid source shows an editor error and does not crash the chart
- Replay mode uses only visible candles for built-in and custom indicators
