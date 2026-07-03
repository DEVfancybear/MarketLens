# SETTTING ARCHITECTURE

_Date: 2026-07-03. Scope: common TradingView-style settings for built-in and Pine source-code indicators._

This document is the maintenance guide for indicator settings. The important rule is simple:

**Do not build one settings dialog per indicator.** The settings UI is shared. Indicator-specific
controls must come from a schema, and CUSTOM Pine indicators must get that schema from their
`input.*()` declarations.

The filename intentionally follows the requested project spelling: `SETTTING_ARCHITECTURE.md`.

## Goals

- One settings gear opens the same `IndicatorSettingsDialog` for every active indicator.
- CUSTOM indicators render settings from Pine source, not from hardcoded indicator names.
- A chart can hold multiple instances of the same saved script with different input values.
- The Pine runtime re-compiles with per-instance input overrides.
- The source-code button (`{}`) remains the route to the bottom Pine Editor.

## Data Flow

```
Indicator legend gear
  -> setEditingIndicatorAtom(indicator.id)
  -> IndicatorSettingsDialog
     -> built-in schema OR extractPineInputDefinitions(sourceCode)
     -> local draft values
     -> updateIndicatorAtom({ inputValues / built-in fields })
  -> indicatorsAtom persisted to localStorage
  -> computeIndicator(config, candles)
     -> CUSTOM: computeCustomIndicator(config, candles)
        -> compilePineScript(sourceCode, candles, id, inputValues)
           -> EvalContext.inputOverrides
           -> evaluated Pine values
           -> IndicatorResult
```

## Key Files

| Concern | File |
|---|---|
| Shared settings dialog | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
| Active indicator model | `src/types/indicators.ts` |
| Indicator persistence/actions | `src/store/chartStore.ts` |
| Pine input schema extraction and runtime overrides | `src/services/pineScript.ts` |
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
}
```

`IndicatorConfig.inputValues` is per active indicator instance, not per saved Pine script. This
matters because two chart instances can share the same `scriptId` but use different Period, Source,
colors, or ratios.

## Pine Input Schema

`extractPineInputDefinitions(sourceCode)` parses top-level assignments like:

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

## Dialog Rendering

`IndicatorSettingsDialog` has three tabs:

- `Inputs`: renders Pine inputs or built-in input schema.
- `Style`: renders built-in color controls. Pine color inputs stay in `Inputs`, because
  TradingView exposes `group="Colors"` inputs there when the script author declares them.
- `Visibility`: common instance controls such as `Visible`, plus built-in pane placement where
  supported.

The dialog edits local draft state. It only writes to `indicatorsAtom` when the user clicks `Ok`.
`Cancel`, close, or `Esc` discard the draft.

## Runtime Override Contract

CUSTOM indicators compile through:

```ts
compilePineScript(sourceCode, candles, indicatorId, inputValues)
```

The compiler stores overrides in:

```ts
EvalContext.inputOverrides: Map<string, IndicatorInputValue>
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

## Built-In Indicators

Built-ins do not have Pine source, but they still use the shared dialog renderer. Their schemas live
inside `IndicatorSettingsDialog.tsx`:

- `builtInInputFields(type)`
- `builtInStyleFields(type)`

Adding a built-in setting should update those schema functions and `defaultIndicator()`. Do not add
a second modal or branch the renderer by indicator name.

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
2. Update `inferInputKind()` and `inputDefaultValue()` in `pineScript.ts`.
3. Update `InputField` in `IndicatorSettingsDialog.tsx` to render the UI control.
4. Update `inputOverrideValue()` to convert the saved value into a `PineValue`.
5. Add a focused guard in `scripts/check-pine-indicator.mjs`.

Do not special-case the indicator title, saved script name, or source filename.

## Known Limits

- Schema extraction currently targets the common public-script pattern: top-level assignment to
  `input.*()` or legacy `input(..., type=...)`.
- `inline` and `tooltip` metadata are parsed for future use, but the current UI does not fully
  reproduce TradingView's inline layout and tooltip surface yet.
- Indicator timeframe is displayed when `indicator(..., timeframe=...)` or legacy
  `resolution=...` exists. Full TradingView-style timeframe switching still depends on runtime
  support for that script pattern.

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
- Better RSI: changing Period or Src updates the RSI pane after `Ok`.
- ADR 50 SR Pro: changing ADR Period or colors updates overlay lines/labels after `Ok`.
- Gear opens settings for CUSTOM indicators; `{}` opens the source editor.
