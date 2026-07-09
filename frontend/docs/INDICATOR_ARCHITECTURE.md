# INDICATOR ARCHITECTURE

_Date: 2026-07-03. Scope: built-in indicators plus source-code indicators created from the
bottom Pine Editor._

## Architecture rule

Indicators are data-series overlays, not chart interaction objects. Do not mix indicator state with
drawing state, alert state, or chart pointer handling. Every indicator must consume only the candle
array it is given, and the caller must pass the replay-aware visible candle slice. This keeps
indicator rendering no-look-ahead by construction.

Custom Pine-like scripts pass through the whitelist compiler in
`backend/internal/pineruntime`. The frontend does not compile Pine source; see
[`../../docs/PINE_RUNTIME_GO_MIGRATION.md`](../../docs/PINE_RUNTIME_GO_MIGRATION.md).
Do not execute user-provided source with `eval`, `new Function`, dynamic imports,
or any other general JavaScript execution path.

## Overview

The indicator subsystem has two families:

1. Built-in indicators: SMA, EMA, VWAP, RSI, MACD, ADR.
2. Source-code indicators: saved Pine-like scripts from the bottom `Pine Editor` tab.

Both families converge into the same `IndicatorConfig` model and the same chart render contract:
`computeIndicator(config, candles) -> IndicatorResult`.

```
BottomPanel / IndicatorMenu
        |
        v
chartStore indicators[] + pineScripts[]
        |
        v
services/indicators.ts
        |
        +-- built-in calculation functions
        |
        +-- pineRuntimeCache for CUSTOM backend compile results
        |
        v
IndicatorResult { id, series[] }
        |
        +-- PriceChart overlay line series
        |
        +-- IndicatorPane separate lightweight chart
```

## Key files

| Concern | File |
|---|---|
| Indicator and script types | `src/types/indicators.ts` |
| Indicator state, persistence, script actions | `src/store/chartStore.ts` |
| Backend indicator presets API | `src/services/api/resources/indicatorsApi.ts` |
| Built-in indicator calculations and dispatch | `src/services/indicators.ts` |
| Pine runtime API client/cache | `src/services/api/resources/pineRuntimeApi.ts`, `src/services/pineRuntimeCache.ts` |
| Pine runtime shared types/default source | `src/services/pineRuntimeTypes.ts` |
| Bottom Pine Editor + embedded script storage | `src/components/pine/PineEditor.tsx` |
| Indicator dropdown entry points | `src/components/toolbar/IndicatorMenu.tsx` |
| Backend Pine scripts API | `src/services/api/resources/pineScriptsApi.ts` |
| Shared settings dialog | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
| Settings architecture guide | `SETTTING_ARCHITECTURE.md` |
| Overlay rendering on price chart | `src/components/chart/PriceChart.tsx` |
| Separate pane rendering | `src/components/chart/IndicatorPane.tsx` |
| Bottom tab mounting | `src/components/layout/BottomPanel.tsx` |

## Data model

`IndicatorConfig` is the chart-attached instance:

```ts
type BuiltInIndicatorType = "SMA" | "EMA" | "VWAP" | "RSI" | "MACD" | "ADR";
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
  -> PriceChart or IndicatorPane calls computeIndicator(config, visibleCandles)
  -> Lightweight Charts series receives calculated LinePoint[]
```

Built-ins are implemented as pure functions in `services/indicators.ts`. They take candles and
parameters, return time-aligned `LinePoint[]`, and never read global chart state.

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
  -> PriceChart / IndicatorPane requests backend compile through pineRuntimeCache
  -> computeIndicator() reads cached IndicatorResult without synchronous Pine compile
```

Custom indicator rendering is now asynchronous:

```
PriceChart / IndicatorPane
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
- `Favorites` and `My scripts` read saved Pine scripts from `chartStore.pineScripts`.
- `Store` reads public scripts from `GET /api/v1/indicator-store`; the endpoint
  does not require auth and returns `sourceCode` so any visitor can add the
  script to chart.
- Saved scripts can be favorited, added to chart, opened in the bottom Pine
  Editor, or deleted after confirmation.
- Pine Editor publishes the current saved script through
  `POST /api/v1/pine-scripts/:id/publish`.
- Do not reintroduce hardcoded TradingView catalog fallback data. Public Store
  rows must come from backend API data only.

## Pine-like compiler contract

`backend/internal/pineruntime` implements a safe subset compiler:

- No `eval`.
- No arbitrary JavaScript calls.
- Tokenizer + recursive-descent expression parser.
- Whitelisted identifiers and functions only.
- Output is the same `IndicatorResult` shape as built-ins.
- Histogram plots and per-bar colors are supported for volume-style scripts.
- Horizontal lines, background fill bands, line widths/styles, and per-bar line colors are supported
  for RSI-style scripts.
- Daily `request.security()` aggregation and object APIs (`line`, `box`, `label`, `table`) are
  compiled in Go for ADR-style scripts. Frontend compile requests include extra historical candles
  for scripts that use `request.security()` so higher-timeframe values are not computed only from
  the visible viewport.

Supported source structure:

```pine
//@version=6
indicator("My script", overlay=true)
len = input.int(20, title="Length")
basis = ta.sma(close, len)
plot(basis, title="SMA", color=color.blue)
```

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
- Declaration qualifiers used by public scripts: `var`, `varip`, `const`, `series`, `simple`.
- Compound assignments such as `x += 1`, parsed as reassignment syntax.
- One-line helper functions in the form `helper(float value, int length) => expression`.
- Pine v3 indentation-based `if ... else` expressions for supported assignment patterns.
- Wilder-style recursive assignments like `x := nz(x[1]) + (source - nz(x[1])) / length`.
- Self-referential assignments with history, such as `cycler[1]`, must evaluate point-by-point in
  scalar context. Do not rebuild full series inside each bar loop.

Supported functions:

- Inputs: `input`, `input.int`, `input.float`, `input.source`, `input.bool`, `input.color`
- Series: `ta.sma`, `ta.ema`, `ta.rma`, `ta.rsi`, `ta.vwap`, `ta.highest`, `ta.lowest`,
  `ta.change`, `ta.atr`, `ta.crossover`, `ta.crossunder`, plus Pine v3 aliases such as `sma`,
  `ema`, `rma`, `rsi`; common helpers `ta.stdev`, `ta.barssince`, `ta.valuewhen`,
  `ta.rising`, and `ta.falling`.
- Math/helpers: `math.abs`, `math.max`, `math.min`, `abs`, `max`, `min`, `nz`, `na`,
  `color(base, transp)`, `color.new(base, transp)`, `str.tostring`, `str.format_time`
- Timeframe bridge: `request.security(..., timeframe, expression, lookahead=barmerge.lookahead_off)`
  over higher-timeframe candles aggregated from the chart runtime for common second/minute/day/week
  and month strings, plus `time(timeframe)` and `timeframe.change(timeframe)`.
  The Go runtime has a narrow bootstrap path for lagged SMA security expressions such as
  `ta.sma(high - low, length)[1]`: if the strict SMA is still `na` because the supplied higher-
  timeframe history is shorter than TradingView would normally preload, it fills missing values from
  the completed higher-timeframe buckets that are available. This prevents ADR-style scripts from
  disappearing on 1m/5m windows while preserving strict values once enough history exists.
- Plot metadata: `plot(..., title=..., color=..., style=plot.style_columns)`, `hline(...)`,
  `fill(hlineA, hlineB, color, transp=...)`
- Indicator metadata: `indicator("Name", overlay=true|false)` and `study(...)`
- Object runtime subset: `line.new` with `line.set_*`, `box.new` with `box.set_*`,
  `label.new` with `label.set_*`, and `table.new`/`table.cell` are converted into chart overlay
  series, labels, and dashboard metadata. Object rendering honors common `x1/y1/x2/y2`, `xloc`,
  and `extend` arguments where they map cleanly to Lightweight Charts data. Labels carry text,
  text color, optional background color, and projected time/price; active `label.style_label_left`
  labels are moved to the emitted object's right edge to avoid line/text collisions. This is a
  shared subset, not an indicator-name adapter.

Object-heavy Pine scripts can emit one object per trading day. The frontend cache keeps only the
latest few emitted segments per object handle before rendering, so ADR-style historical lines remain
readable across 1m/5m/15m/H1 instead of flooding the chart.

For custom scripts that use `request.security()`, the frontend runtime cache is keyed by the candle
window (`length`, first bar time, last bar time) rather than every OHLC value. MT5 can refresh the
latest bars every few seconds with the same timestamps; recompiling and temporarily rendering an
empty result on each refresh would remove and re-add Pine overlay series, which makes the chart look
like it reloads. The cache keeps the latest successful result for the same script/symbol/timeframe
while a new compile is pending.

Unsupported Pine features should fail with a user-visible compile error instead of silently doing
the wrong thing. Examples: strategies, orders, arrays, loops, multi-symbol `request.security`,
sessions, alerts, multi-line custom functions, tuple-return functions beyond the whitelisted
surface, and general-purpose block statements outside the whitelisted assignment/object patterns.

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
- Series are keyed by indicator id and recreated only when series count changes.

Separate-pane indicators render in `IndicatorPane`:

- `indicators.filter(i => i.visible && i.separatePane)`
- Each pane owns its own lightweight chart.
- Time scale is synchronized to the main chart logical range.
- Histogram and line points preserve per-bar `data[].color` before applying fallback colors.
- Series APIs are retained in refs and reused between candle updates. Recreate only when the
  returned series signature changes; otherwise call `setData()` on existing series.
- Pine hlines and fill bands should emit sparse points only: first/last real candle plus a small
  flat right-extension tail. This keeps Better RSI light while matching TradingView's right-offset
  whitespace rendering.

The source of `candles` must be `useVisibleCandles()` from `ChartArea`, not raw full history. This
is the replay safety rule.

## Overlay vs separate pane

Built-in defaults:

- Overlay: SMA, EMA, VWAP, ADR.
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
2. Add calculation function(s) in `services/indicators.ts`.
3. Add a `case` in `computeIndicator`.
4. Add defaults in `defaultIndicator`.
5. Add a menu option in `IndicatorMenu`.
6. Add settings schema through the shared settings architecture if needed. See
   `SETTTING_ARCHITECTURE.md`; do not create an indicator-specific settings modal.

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
