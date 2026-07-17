import type { IndicatorRuntimeDefinition } from "@/services/api/resources/indicatorRuntimeApi";
import type {
  IndicatorConfig,
  IndicatorInputValues,
  IndicatorStyleValues,
} from "@/types";

export function defaultIndicatorInputs(
  definition: IndicatorRuntimeDefinition,
): IndicatorInputValues {
  return Object.fromEntries(
    definition.inputs.map((input) => [input.key, input.defaultValue]),
  );
}

export function indicatorStyleFieldKey(styleKey: string, field: string): string {
  return `${styleKey}.${field}`;
}

export function defaultIndicatorStyles(
  definition: IndicatorRuntimeDefinition,
): IndicatorStyleValues {
  const values: IndicatorStyleValues = {};
  for (const style of definition.styles) {
    values[indicatorStyleFieldKey(style.key, "visible")] = style.defaultVisible;
    if (style.supportsColor) {
      values[indicatorStyleFieldKey(style.key, "color")] = style.defaultColor;
    }
    if (style.supportsLineWidth && style.defaultLineWidth != null) {
      values[indicatorStyleFieldKey(style.key, "lineWidth")] = style.defaultLineWidth;
    }
    if (style.supportsLineStyle && style.defaultLineStyle != null) {
      values[indicatorStyleFieldKey(style.key, "lineStyle")] = style.defaultLineStyle;
    }
  }
  return values;
}

function legacyConfigValue(config: IndicatorConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key];
}

export function indicatorInputsFromConfig(
  definition: IndicatorRuntimeDefinition,
  config: IndicatorConfig,
): IndicatorInputValues {
  const legacy: IndicatorInputValues = {};
  for (const [inputKey, configKey] of Object.entries(definition.legacyInputBindings ?? {})) {
    const value = legacyConfigValue(config, configKey);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      legacy[inputKey] = value;
    }
  }
  return {
    ...defaultIndicatorInputs(definition),
    ...legacy,
    ...(config.inputValues ?? {}),
  };
}

export function indicatorStylesFromConfig(
  definition: IndicatorRuntimeDefinition,
  config: IndicatorConfig,
): IndicatorStyleValues {
  const legacy: IndicatorStyleValues = {};
  for (const [styleKey, configKey] of Object.entries(definition.legacyStyleBindings ?? {})) {
    const value = legacyConfigValue(config, configKey);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      legacy[styleKey] = value;
    }
  }
  return {
    ...defaultIndicatorStyles(definition),
    ...legacy,
    ...(config.styleValues ?? {}),
  };
}

export function indicatorConfigFromDefinition(
  definition: IndicatorRuntimeDefinition,
  id: string,
  overrides: Partial<IndicatorConfig> = {},
): IndicatorConfig {
  return {
    id,
    type: definition.type,
    visible: true,
    separatePane: !definition.overlay,
    name: definition.shortTitle || definition.name,
    inputValues: defaultIndicatorInputs(definition),
    styleValues: defaultIndicatorStyles(definition),
    requiresHistoryContext: definition.requiresHistoryContext,
    ...overrides,
  };
}
