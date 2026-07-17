# SETTTING ARCHITECTURE

_Updated: 2026-07-18. The filename retains the project-requested spelling._

The terminal has one settings dialog for every indicator. Its fields come from
the backend `IndicatorDefinition`; React never defines a schema for a named
indicator.

## Data flow

```text
Legend gear
  -> setEditingIndicatorAtom(instance id)
  -> POST /api/v1/indicator-runtime/definition
       catalog instance: resolve embedded source by type
       saved/public instance: inspect supplied sourceCode
  -> IndicatorSettingsDialog renders definition.inputs/definition.styles
  -> updateIndicatorAtom({ inputValues, styleValues, visible })
  -> common indicator runtime cache invalidates by full config
  -> POST /api/v1/indicator-runtime/compute
```

Overlay versus separate-pane placement is derived from the backend Pine
`indicator(..., overlay=...)` metadata. It is not selected by checking a type
name in the dialog.

## Definition shape

```ts
interface IndicatorRuntimeDefinition {
  type: string;
  name: string;
  shortTitle?: string;
  description?: string;
  overlay: boolean;
  inputs: PineInputDefinition[];
  styles: PineStyleDefinition[];
  legacyInputBindings?: Record<string, string>;
  legacyStyleBindings?: Record<string, string>;
  requiresHistoryContext: boolean;
  sourceAvailable: boolean;
}
```

`PineInputDefinition` supports integer, float, boolean, color, source, string,
and timeframe controls plus options, bounds, grouping, inline rows, and
tooltips. `PineStyleDefinition` describes visibility, color, line width, and
line style for plots and supported objects.

## Instance state

```ts
interface IndicatorConfig {
  id: string;
  type: string;
  visible: boolean;
  separatePane?: boolean;
  sourceCode?: string;
  scriptId?: string;
  inputValues?: Record<string, string | number | boolean>;
  styleValues?: Record<string, string | number | boolean>;
  requiresHistoryContext?: boolean;
}
```

Legacy top-level fields remain optional only for persisted preset
compatibility. `indicatorInputsFromConfig` and `indicatorStylesFromConfig` use
backend-provided bindings to migrate them generically.

## Shared tabs

- **Inputs** groups backend input definitions and supports Pine `inline` rows.
- **Style** renders every backend style definition plus common status-line and
  output-precision controls.
- **Visibility** controls instance visibility. Pane placement remains metadata
  driven.
- **Defaults** restores backend definition defaults for inputs and styles.

## Key files

| Concern | File |
|---|---|
| Shared dialog | `src/components/toolbar/IndicatorSettingsDialog.tsx` |
| Definition API cache | `src/services/indicatorDefinitions.ts` |
| Pure defaults/legacy hydration | `src/services/indicatorDefinitionModel.ts` |
| Runtime API contract | `src/services/api/resources/indicatorRuntimeApi.ts` |
| Instance persistence/actions | `src/store/chartStore.ts` |
| Shared input-row layout | `src/components/toolbar/indicatorSettingsInputRows.ts` |
| Common output/status styles | `src/services/indicatorStyle.ts` |
| Regression guard | `scripts/check-pine-indicator.mjs` |

## Maintenance rule

Adding an indicator setting means changing its Pine `input.*()` declaration or
backend definition metadata. Do not add a frontend type switch, a local default
object, or another dialog. A new catalog source should work without modifying
this settings component.
