# INDICATOR ARCHITECTURE

_Date: 2026-07-03. Scope: built-in indicators plus source-code indicators created from the
bottom Pine Editor._

## Architecture rule

Indicators are data-series overlays, not chart interaction objects. Do not mix indicator state with
drawing state, alert state, or chart pointer handling. Every indicator must consume only the candle
array it is given, and the caller must pass the replay-aware visible candle slice. This keeps
indicator rendering no-look-ahead by construction.

Custom Pine-like scripts must be parsed through the whitelist compiler in `services/pineScript.ts`.
Do not execute user-provided source with `eval`, `new Function`, dynamic imports, or any other
general JavaScript execution path.

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
        +-- services/pineScript.ts for CUSTOM indicators
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
| Built-in indicator calculations and dispatch | `src/services/indicators.ts` |
| Pine-like parser/compiler | `src/services/pineScript.ts` |
| Bottom Pine Editor + embedded script storage | `src/components/pine/PineEditor.tsx` |
| Indicator dropdown entry points | `src/components/toolbar/IndicatorMenu.tsx` |
| Built-in settings dialog | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
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

## State and persistence

State lives in `chartStore.ts`:

| Atom | Purpose | Persistence |
|---|---|---|
| `indicatorsAtom` | Active chart indicator instances | localStorage `indicators` |
| `pineScriptsAtom` | Saved Pine-like source-code scripts | localStorage `pineScripts` |
| `pineEditorScriptIdAtom` | Currently loaded script id in editor | runtime |
| `pineEditorTitleAtom` | Current editor title field | runtime |
| `pineEditorSourceAtom` | Current editor source field | runtime |

Hydration is part of `chartStore.hydrateAtom`, which is called by `useStoreHydration()` after mount.
This keeps localStorage access client-only and avoids SSR mismatch.

## Built-in indicator flow

```
IndicatorMenu click SMA/EMA/etc.
  -> toggleIndicatorAtom(type)
  -> defaultIndicator(type, uid("ind"))
  -> indicatorsAtom update + localStorage write
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
  -> extractPineScriptMeta(sourceCode)
  -> insert/update pineScriptsAtom
  -> localStorage `pineScripts`
  -> update active CUSTOM indicators with the same scriptId
```

Add-to-chart flow:

```
PineEditor Play or My scripts Add
  -> compilePineScript(sourceCode, visibleCandles preview)
  -> if compile errors: show status + log
  -> savePineScriptAtom(...)
  -> addCustomIndicatorFromScriptAtom(savedScript)
  -> indicatorsAtom gets type: "CUSTOM"
  -> PriceChart / IndicatorPane renders through computeIndicator()
```

Edit existing custom indicator:

```
Indicator menu / pane settings button
  -> if config.type === "CUSTOM" and scriptId exists:
       loadPineScriptAtom(scriptId)
       setBottomTabAtom("pine")
  -> else:
       setEditingIndicatorAtom(id)
```

Custom indicators intentionally bypass `IndicatorSettingsDialog`; source is the settings surface.

## Pine-like compiler contract

`services/pineScript.ts` implements a safe subset compiler:

- No `eval`.
- No arbitrary JavaScript calls.
- Tokenizer + recursive-descent expression parser.
- Whitelisted identifiers and functions only.
- Output is the same `IndicatorResult` shape as built-ins.
- Histogram plots and per-bar colors are supported for volume-style scripts.
- Horizontal lines, background fill bands, line widths/styles, and per-bar line colors are supported
  for RSI-style scripts.

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
- Pine enum-like identifiers used in metadata: `input.*`, `plot.style_*`, `format.*`
- Named call arguments in whitelisted calls, including Pine v4 `input(defval=...)`
- Pine color constants used by source scripts, including the VSA palette colors
- Pine v3 bare enum aliases used by older public scripts: `integer`, `source`, `linebr`,
  `solid`, `dashed`, `dotted`

Supported expression features:

- Arithmetic with precedence and unary minus.
- Comparisons: `>`, `>=`, `<`, `<=`, `==`, `!=`.
- Logical `and` / `or`.
- Ternary conditionals, including color palettes.
- History references such as `series[1]`.
- Typed declarations such as `float volumeMA = 0`.
- Pine v3 indentation-based `if ... else` expressions for supported assignment patterns.
- Wilder-style recursive assignments like `x := nz(x[1]) + (source - nz(x[1])) / length`.

Supported functions:

- Inputs: `input`, `input.int`, `input.float`, `input.source`, `input.bool`
- Series: `ta.sma`, `ta.ema`, `ta.rma`, `ta.rsi`, `ta.vwap`, `ta.highest`, `ta.lowest`,
  `ta.change`, `ta.atr`, plus Pine v3 aliases such as `sma`, `ema`, `rma`, `rsi`
- Math/helpers: `math.abs`, `math.max`, `math.min`, `abs`, `max`, `min`, `nz`, `color(base, transp)`
- Plot metadata: `plot(..., title=..., color=..., style=plot.style_columns)`, `hline(...)`,
  `fill(hlineA, hlineB, color, transp=...)`
- Indicator metadata: `indicator("Name", overlay=true|false)` and `study(...)`

Unsupported Pine features should fail with a user-visible compile error instead of silently doing
the wrong thing. Examples: strategies, orders, arrays, loops, `request.security`, sessions, alerts,
tables, labels, arbitrary custom functions, and general-purpose block statements outside the
whitelisted assignment patterns.

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
}
```

Overlay indicators render in `PriceChart`:

- `indicators.filter(i => i.visible && !i.separatePane)`
- One Lightweight Charts line, histogram, or baseline-fill series per returned `series[]`.
- Histogram and line points may carry per-bar colors, matching scripts such as VSA volume palettes
  and Better RSI cycler colors.
- Series are keyed by indicator id and recreated only when series count changes.

Separate-pane indicators render in `IndicatorPane`:

- `indicators.filter(i => i.visible && i.separatePane)`
- Each pane owns its own lightweight chart.
- Time scale is synchronized to the main chart logical range.
- Histogram and line points preserve per-bar `data[].color` before applying fallback colors.
- Series APIs are retained in refs and reused between candle updates. Recreate only when the
  returned series signature changes; otherwise call `setData()` on existing series.
- Pine hlines and fill bands should emit first/last points only, not one point per candle.

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
6. Add settings controls in `IndicatorSettingsDialog` if needed.

To add a new Pine subset function:

1. Add a whitelist case in `evaluateCall()` in `services/pineScript.ts`.
2. Implement the calculation as a pure series helper.
3. Return `PineValue` as either `number` or `series`.
4. Add a simple script example to manual QA.

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
