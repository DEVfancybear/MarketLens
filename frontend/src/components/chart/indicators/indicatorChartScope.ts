import type { IndicatorConfig } from "@/types";

export interface IndicatorChartContext {
  layoutId: string;
  chartId: string;
}

export function bindIndicatorToChart(
  indicator: IndicatorConfig,
  context: IndicatorChartContext,
): IndicatorConfig {
  return {
    ...indicator,
    chartScope: {
      layoutId: context.layoutId,
      chartId: context.chartId,
    },
  };
}

export function indicatorBelongsToChart(
  indicator: Pick<IndicatorConfig, "chartScope">,
  context: IndicatorChartContext,
): boolean {
  const scope = indicator.chartScope;
  return (
    !scope ||
    (scope.layoutId === context.layoutId && scope.chartId === context.chartId)
  );
}

export function selectIndicatorsForChart(
  registry: readonly IndicatorConfig[],
  context: IndicatorChartContext,
): IndicatorConfig[] {
  return registry.filter((indicator) => indicatorBelongsToChart(indicator, context));
}

export function scopeLegacyIndicatorsToChart(
  indicators: readonly IndicatorConfig[],
  context: IndicatorChartContext,
): IndicatorConfig[] {
  return indicators.map((indicator) =>
    indicator.chartScope ? indicator : bindIndicatorToChart(indicator, context),
  );
}

export function selectIndicatorsForLayout(
  registry: readonly IndicatorConfig[],
  layoutId: string,
): IndicatorConfig[] {
  return registry.filter(
    (indicator) => !indicator.chartScope || indicator.chartScope.layoutId === layoutId,
  );
}

export function rebindIndicatorsToLayout(
  indicators: readonly IndicatorConfig[],
  context: IndicatorChartContext,
): IndicatorConfig[] {
  return indicators.map((indicator) =>
    bindIndicatorToChart(indicator, {
      layoutId: context.layoutId,
      chartId: indicator.chartScope?.chartId ?? context.chartId,
    }),
  );
}

/** Replace one layout's slice while preserving indicator presets owned elsewhere. */
export function mergeIndicatorLayoutRegistry(
  registry: readonly IndicatorConfig[],
  layoutIndicators: readonly IndicatorConfig[],
  layoutId: string,
): IndicatorConfig[] {
  const incomingIds = new Set(layoutIndicators.map((indicator) => indicator.id));
  const preserved = registry.filter(
    (indicator) =>
      !incomingIds.has(indicator.id) &&
      indicator.chartScope?.layoutId !== layoutId,
  );
  return [...preserved, ...layoutIndicators];
}
