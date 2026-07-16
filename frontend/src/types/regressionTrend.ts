export const REGRESSION_TREND_SOURCES = [
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
  "hlcc4",
] as const;

export type RegressionTrendSource = (typeof REGRESSION_TREND_SOURCES)[number];

/** Optional persisted fields owned by the Regression Trend capability. */
export interface RegressionTrendProperties {
  regressionUpperDeviation?: number;
  regressionLowerDeviation?: number;
  regressionUseUpperDeviation?: boolean;
  regressionUseLowerDeviation?: boolean;
  regressionSource?: RegressionTrendSource;
  regressionShowBaseLine?: boolean;
  regressionShowUpperLine?: boolean;
  regressionShowLowerLine?: boolean;
  regressionExtendLines?: boolean;
  regressionShowPearsonR?: boolean;
}

/** Fully resolved settings used by creation, rendering, and persistence. */
export interface RegressionTrendConfig {
  regressionUpperDeviation: number;
  regressionLowerDeviation: number;
  regressionUseUpperDeviation: boolean;
  regressionUseLowerDeviation: boolean;
  regressionSource: RegressionTrendSource;
  regressionShowBaseLine: boolean;
  regressionShowUpperLine: boolean;
  regressionShowLowerLine: boolean;
  regressionExtendLines: boolean;
  regressionShowPearsonR: boolean;
}

export const DEFAULT_REGRESSION_TREND_CONFIG: Readonly<RegressionTrendConfig> =
  Object.freeze({
    regressionUpperDeviation: 2,
    regressionLowerDeviation: -2,
    regressionUseUpperDeviation: true,
    regressionUseLowerDeviation: true,
    regressionSource: "close",
    regressionShowBaseLine: true,
    regressionShowUpperLine: true,
    regressionShowLowerLine: true,
    regressionExtendLines: false,
    regressionShowPearsonR: true,
  });

export function isRegressionTrendSource(
  value: unknown,
): value is RegressionTrendSource {
  return (
    typeof value === "string" &&
    (REGRESSION_TREND_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * Historical payloads had no Regression Trend fields. Resolving every value at
 * the boundary preserves their original Close / +/-2 / all-lines behavior.
 */
export function resolveRegressionTrendConfig(
  value: RegressionTrendProperties | Record<string, unknown> | null | undefined,
): RegressionTrendConfig {
  const defaults = DEFAULT_REGRESSION_TREND_CONFIG;
  return {
    regressionUpperDeviation:
      typeof value?.regressionUpperDeviation === "number" &&
      Number.isFinite(value.regressionUpperDeviation)
        ? value.regressionUpperDeviation
        : defaults.regressionUpperDeviation,
    regressionLowerDeviation:
      typeof value?.regressionLowerDeviation === "number" &&
      Number.isFinite(value.regressionLowerDeviation)
        ? value.regressionLowerDeviation
        : defaults.regressionLowerDeviation,
    regressionUseUpperDeviation:
      typeof value?.regressionUseUpperDeviation === "boolean"
        ? value.regressionUseUpperDeviation
        : defaults.regressionUseUpperDeviation,
    regressionUseLowerDeviation:
      typeof value?.regressionUseLowerDeviation === "boolean"
        ? value.regressionUseLowerDeviation
        : defaults.regressionUseLowerDeviation,
    regressionSource: isRegressionTrendSource(value?.regressionSource)
      ? value.regressionSource
      : defaults.regressionSource,
    regressionShowBaseLine:
      typeof value?.regressionShowBaseLine === "boolean"
        ? value.regressionShowBaseLine
        : defaults.regressionShowBaseLine,
    regressionShowUpperLine:
      typeof value?.regressionShowUpperLine === "boolean"
        ? value.regressionShowUpperLine
        : defaults.regressionShowUpperLine,
    regressionShowLowerLine:
      typeof value?.regressionShowLowerLine === "boolean"
        ? value.regressionShowLowerLine
        : defaults.regressionShowLowerLine,
    regressionExtendLines:
      typeof value?.regressionExtendLines === "boolean"
        ? value.regressionExtendLines
        : defaults.regressionExtendLines,
    regressionShowPearsonR:
      typeof value?.regressionShowPearsonR === "boolean"
        ? value.regressionShowPearsonR
        : defaults.regressionShowPearsonR,
  };
}
