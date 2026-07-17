import type {
  IndicatorResult,
  IndicatorStyleValues,
} from "@/types";

export const STYLE_OUTPUT_PRECISION_KEY = "__output.precision";
export const STYLE_LABELS_ON_PRICE_SCALE_KEY = "__output.labelsOnPriceScale";
export const STYLE_VALUES_IN_STATUS_LINE_KEY = "__output.valuesInStatusLine";
export const STYLE_INPUTS_IN_STATUS_LINE_KEY = "__input.inputsInStatusLine";

export function commonStyleDefaults(): IndicatorStyleValues {
  return {
    [STYLE_OUTPUT_PRECISION_KEY]: "default",
    [STYLE_LABELS_ON_PRICE_SCALE_KEY]: true,
    [STYLE_VALUES_IN_STATUS_LINE_KEY]: true,
    [STYLE_INPUTS_IN_STATUS_LINE_KEY]: true,
  };
}

export function styleBool(
  values: IndicatorStyleValues | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = values?.[key];
  if (value === undefined) return fallback;
  return value === true || value === "true";
}

export function valuesInStatusLine(values: IndicatorStyleValues | undefined): boolean {
  return styleBool(values, STYLE_VALUES_IN_STATUS_LINE_KEY, true);
}

export function inputsInStatusLine(values: IndicatorStyleValues | undefined): boolean {
  return styleBool(values, STYLE_INPUTS_IN_STATUS_LINE_KEY, true);
}

function formatLegendValue(value: number): string {
  const fixed = Math.abs(value) >= 1000 ? value.toFixed(2) : value.toFixed(1);
  return fixed.replace(/\.0$/, "");
}

export function indicatorResultValueText(result: IndicatorResult): string {
  const values = result.series
    .filter((series) => series.type !== "baselineFill")
    .filter((series) => series.statusLineVisible !== false)
    .filter((series) => {
      const first = series.data.find((item) => Number.isFinite(item.value));
      if (!first) return false;
      return series.data.some((item) => Math.abs(item.value - first.value) > 1e-9);
    })
    .flatMap((series) => {
      const point = [...series.data].reverse().find((item) =>
        Number.isFinite(item.value),
      );
      return point ? [formatLegendValue(point.value)] : [];
    });
  return values.slice(0, 4).join(" ");
}
