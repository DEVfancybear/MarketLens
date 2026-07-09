# SETTTING ARCHITECTURE

_Date: 2026-07-03. Scope: common TradingView-style settings for built-in and Pine source-code indicators._

This document is the maintenance guide for indicator settings. The important rule is simple:

**Do not build one settings dialog per indicator.** The settings UI is shared. Indicator-specific
controls must come from a schema, and CUSTOM Pine indicators must get that schema from their
`input.*()` declarations through the Go Pine runtime API.

The filename intentionally follows the requested project spelling: `SETTTING_ARCHITECTURE.md`.

## Goals

- One settings gear opens the same `IndicatorSettingsDialog` for every active indicator.
- CUSTOM indicators render settings from Pine source, not from hardcoded indicator names.
- A chart can hold multiple instances of the same saved script with different input values.
- The Pine runtime re-compiles with per-instance input overrides.
- Style overrides for plots, hlines, fills, and supported Pine objects are common and per instance.
- The source-code button (`{}`) remains the route to the bottom Pine Editor.

## Data Flow

```
Indicator legend gear
  -> setEditingIndicatorAtom(indicator.id)
  -> IndicatorSettingsDialog
     -> built-in schema OR POST /api/v1/pine-runtime/inputs
     -> built-in style schema OR POST /api/v1/pine-runtime/styles
     -> local draft values
     -> updateIndicatorAtom({ inputValues, styleValues / built-in fields })
  -> indicatorsAtom persisted to backend/local anonymous cache
  -> PriceChart / IndicatorPane invalidates pineRuntimeCache
  -> POST /api/v1/pine-runtime/compile with inputValues/styleValues
     -> EvalContext.inputOverrides
     -> style overrides applied to visual declarations
     -> evaluated Pine values
     -> IndicatorResult
```

## Key Files

| Concern | File |
|---|---|
| Shared settings dialog | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
| Active indicator model | `src/types/indicators.ts` |
| Indicator persistence/actions | `src/store/chartStore.ts` |
| Pine input/style schema API client | `src/services/api/resources/pineRuntimeApi.ts` |
| Pine runtime shared types/default source | `src/services/pineRuntimeTypes.ts` |
| Shared output/status style keys | `src/services/indicatorStyle.ts` |
| Built-in indicator defaults | `src/services/indicators.ts` |
| Overlay/separate-pane settings entry points | `src/components/chart/PriceChart.tsx`, `src/components/chart/IndicatorPane.tsx` |
| Shared legend controls | `src/components/chart/IndicatorLegend.tsx` |
| Regression guard | `scripts/check-pine-indicator.mjs` |

## Core State Contract

`IndicatorConfig` owns settings for the active chart instance:

```ts
export type IndicatorInputValue = string | number | boolean;
export type IndicatorInputValues = Record<string, IndicatorInputValue>;

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  visible: boolean;
  separatePane?: boolean;

  // Built-in fields.
  length: number;
  length2?: number;
  length3?: number;
  color: string;
  color2?: string;

  // CUSTOM fields.
  name?: string;
  scriptId?: string;
  sourceCode?: string;
  inputValues?: IndicatorInputValues;
  styleValues?: IndicatorStyleValues;
}
```

`IndicatorConfig.inputValues` is per active indicator instance, not per saved Pine script. This
matters because two chart instances can share the same `scriptId` but use different Period, Source,
colors, or ratios.

`IndicatorConfig.styleValues` is also per active indicator instance. It stores only visual values
that differ from defaults, so opening a settings dialog and pressing `Ok` does not rewrite Pine
defaults such as transparent fills.

## Pine Input Schema

`POST /api/v1/pine-runtime/inputs` parses top-level assignments like:

```pine
len = input.int(14, "Period", minval=1)
src = input(close, type=source)
showMA = input.bool(false, "Show Volume Moving Average")
colHigh = input.color(color.red, "ADR H50 Color", group="Colors")
```

Each definition has:

```ts
interface PineInputDefinition {
  key: string;              // assigned Pine variable, e.g. "len"
  title: string;            // displayed label
  kind: PineInputKind;      // int, float, bool, color, source, string, timeframe
  defaultValue: IndicatorInputValue;
  group?: string;
  inline?: string;
  tooltip?: string;
  options?: IndicatorInputValue[];
  min?: number;
  max?: number;
  step?: number;
}
```

The stable settings key is the assigned variable name, not the title. Titles can duplicate or
change; variable names are what the runtime evaluates later.

## Pine Style Schema

`POST /api/v1/pine-runtime/styles` parses visual declarations into style rows:

- `plot(...)`
- `hline(...)`
- `fill(...)`
- supported object APIs: `line.new`, `box.new`, `label.new`

Each definition has:

```ts
interface PineStyleDefinition {
  key: string;              // e.g. "plot:1", "hline:h70", "line:lnHigh"
  title: string;
  target: "plot" | "hline" | "fill" | "line" | "box" | "label";
  group: string;            // Plots, Horizontal Lines, Fills, Objects
  defaultVisible: boolean;
  defaultColor: string;
  defaultLineWidth?: IndicatorLineWidth;
  defaultLineStyle?: IndicatorLineStyle;
  supportsColor: boolean;
  supportsLineWidth: boolean;
  supportsLineStyle: boolean;
}
```

Style values use derived keys:

```ts
"plot:1.visible"
"plot:1.color"
"plot:1.lineWidth"
"plot:1.lineStyle"
"line:lnHigh.color"
```

TradingView-style common output/status settings use reserved keys:

```ts
"__output.precision"
"__output.labelsOnPriceScale"
"__output.valuesInStatusLine"
"__input.inputsInStatusLine"
```

These keys are shared by built-ins and CUSTOM indicators. They are not Pine variable names and must
not be passed through `EvalContext.inputOverrides`.

Persist only values that differ from `defaultStyleValues()`. This is important for scripts with
dynamic color palettes or transparent fills; saving default style values as overrides can flatten
their intended runtime color logic.

## Dialog Rendering

`IndicatorSettingsDialog` has three tabs:

- `Inputs`: renders Pine inputs or built-in input schema.
- `Style`: renders common visual controls from built-in style schema or backend Pine style schema.
  Rows can expose visibility, color, line width, and line style.
  Pine `input.color(...)` controls remain in `Inputs`, because those are script-authored inputs.
  The bottom of the tab always renders TradingView-style common controls:
  `Output Values -> Precision`, `Labels on price scale`, `Values in status line`, and
  `Input Values -> Inputs in status line`.
- `Visibility`: common instance controls such as `Visible`, plus built-in pane placement where
  supported.

The dialog edits local draft state. It only writes to `indicatorsAtom` when the user clicks `Ok`.
`Cancel`, close, or `Esc` discard the draft.

## Runtime Override Contract

CUSTOM indicators compile through:

```ts
POST /api/v1/pine-runtime/compile
```

The Go compiler stores overrides in:

```go
evalContext.inputOverrides map[string]InputValue
```

During assignment evaluation, `evaluateInputExpression(expression, context, variableName)` checks
whether `inputOverrides` has a value for that variable. If yes, it converts the UI value back to the
correct Pine runtime value:

- `int` / `float` -> number
- `bool` -> bool
- `color` -> color
- `source` -> evaluated source series such as `close`, `hl2`, or `volume`
- `string` / `timeframe` -> string

The same `inputOverrides` map must be passed to child contexts:

- helper functions
- `request.security(...)` higher-timeframe contexts
- scalar contexts for self-referential series such as `cycler[1]`

Missing this propagation causes settings to work in one part of a script but silently fall back to
defaults in another part.

## Runtime Style Contract

CUSTOM indicator style overrides compile through:

```ts
POST /api/v1/pine-runtime/compile
```

The compiler applies style values after expression evaluation and before emitting
`IndicatorResult`:

- plot visibility/color/line width/line style
- hline visibility/color/line width/line style
- fill visibility/color
- `line.new` visibility/color/line width/line style
- `box.new` visibility/color
- `label.new` visibility/text color

For dynamic color series, a user-set style color intentionally overrides the generated per-bar
colors. If no style color override is persisted, the original Pine color logic remains intact.

`indicatorStyle.ts` applies the common output/status keys:

- `Labels on price scale` maps to `IndicatorSeries.lastValueVisible`.
- `Precision` maps to `IndicatorSeries.precision`, and chart renderers convert it into
  Lightweight Charts `priceFormat`.
- `Values in status line` controls whether the legend appends the latest non-flat output values.
- `Inputs in status line` controls whether the legend appends input parameters such as RSI length
  or Pine input defaults.

## Built-In Indicators

Built-ins do not have Pine source, but they still use the shared dialog renderer. Their schemas live
inside `IndicatorSettingsDialog.tsx`:

- `builtInInputFields(type)`
- `builtInStyleDefinitions(type)`

Adding a built-in setting should update those schema functions and `defaultIndicator()`. Do not add
a second modal or branch the renderer by indicator name.

Built-in compute functions consume `styleValues` through shared `builtin:primary` and
`builtin:secondary` keys. If the UI exposes a style control for a built-in, the compute path must
consume it.

## CUSTOM Source Flow

The legend uses four controls:

- eye: show/hide indicator
- gear: open shared settings dialog
- `{}`: open source in the bottom Pine Editor
- trash: remove from chart without confirmation

For CUSTOM indicators, the gear must not load the editor. Source editing and settings editing are
separate surfaces.

## Adding Support For Future Pine Inputs

When a new public script needs an unsupported input kind:

1. Extend `PineInputKind`.
2. Update `inferInputKind()` and `inputDefaultValue()` in `backend/internal/pineruntime/schema.go`.
3. Update `InputField` in `IndicatorSettingsDialog.tsx` to render the UI control.
4. Update `inputOverrideValue()` in `backend/internal/pineruntime/compiler.go` to convert the saved value into a `pineValue`.
5. Add a focused backend test in `backend/internal/pineruntime/compiler_test.go`.

Do not special-case the indicator title, saved script name, or source filename.

When a new visual primitive needs style support:

1. Extend `PineStyleTarget` if needed.
2. Add extraction to `ExtractStyles()` in `backend/internal/pineruntime/schema.go`.
3. Add runtime application in the compiler path that emits that visual primitive.
4. Add or update guard coverage in `backend/internal/pineruntime/compiler_test.go`.

Do not add an indicator-name branch such as `if (name.includes("ADR"))`.

## Known Limits

- Schema extraction currently targets the common public-script pattern: top-level assignment to
  `input.*()` or legacy `input(..., type=...)`.
- `inline` and `tooltip` metadata are parsed for future use, but the current UI does not fully
  reproduce TradingView's inline layout and tooltip surface yet.
- Indicator timeframe is displayed when `indicator(..., timeframe=...)` or legacy
  `resolution=...` exists. Full TradingView-style timeframe switching still depends on runtime
  support for that script pattern.
- Object style support currently targets line, box, and label visuals. Tables/dashboard styling is
  not part of the common style schema yet.

## Verification

Run these before pushing changes to settings or Pine input runtime:

```powershell
npm run check:pine-indicator
npm run typecheck
npm run lint
npm run build
```

Manual checks should include:

- VSA Wyckoff Volume: changing ratios updates histogram colors after `Ok`.
- VSA Wyckoff Volume: Style `Volume` color override flattens the dynamic palette only after the
  user explicitly changes the style color.
- Better RSI: changing Period or Src updates the RSI pane after `Ok`.
- Better RSI: Style can hide/change hlines, fill, and plotted RSI lines without breaking fill
  boundaries.
- ADR 50 SR Pro: changing ADR Period or colors updates overlay lines/labels after `Ok`.
- ADR 50 SR Pro: Style object rows can hide/change supported line, box, and label visuals.
- Gear opens settings for CUSTOM indicators; `{}` opens the source editor.
