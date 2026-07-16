/**
 * Typed, persisted configuration shared by the Gann Fan, Square, and Box.
 *
 * The drawing model is intentionally flat for historical tools, but Gann's
 * settings are a coherent discriminated family. Keeping that family nested
 * prevents a dozen unrelated optional properties from leaking into every
 * drawing and gives settings/codec/geometry one common boundary.
 */

export type GannLineStyle = "solid" | "dashed" | "dotted";
export type GannFamily = "fan" | "square" | "box";
/** Verified built-in presets; user edits are represented as `custom`. */
export type GannPreset = "classic" | "eighths" | "custom";

export interface GannRatioConfig {
  /** Positive price/time ratio (the label preserves the exact fraction). */
  ratio: number;
  label: string;
  enabled: boolean;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  lineStyle?: GannLineStyle;
}

export interface GannLevelConfig {
  /** Normalized partition from the first anchor (0) to the second (1). */
  value: number;
  enabled: boolean;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  lineStyle?: GannLineStyle;
}

interface GannCommonConfig {
  version: 1;
  scaleLock: boolean;
  /** Price units per logical bar for the locked 1x1 relationship. */
  priceBarRatio: number;
  preset: GannPreset;
  useOneColor: boolean;
  background: boolean;
  labels: boolean;
  reverse: boolean;
}

export interface GannFanConfig extends GannCommonConfig {
  family: "fan";
  ratios: GannRatioConfig[];
}

export interface GannSquareConfig extends GannCommonConfig {
  family: "square";
  priceLevels: GannLevelConfig[];
  timeLevels: GannLevelConfig[];
  showLevels: boolean;
  showFan: boolean;
  showArcs: boolean;
  showRanges: boolean;
}

export interface GannBoxConfig extends GannCommonConfig {
  family: "box";
  priceLevels: GannLevelConfig[];
  timeLevels: GannLevelConfig[];
  priceBackground: boolean;
  timeBackground: boolean;
  angles: boolean;
  labelLeft: boolean;
  labelRight: boolean;
  labelTop: boolean;
  labelBottom: boolean;
}

export type GannConfig = GannFanConfig | GannSquareConfig | GannBoxConfig;

/** TradingView's documented nine-angle Fan controls. */
export const DEFAULT_GANN_FAN_RATIOS: readonly GannRatioConfig[] = Object.freeze([
  { ratio: 1 / 8, label: "1/8", enabled: true, color: "#787b86" },
  { ratio: 1 / 4, label: "1/4", enabled: true, color: "#f23645" },
  { ratio: 1 / 3, label: "1/3", enabled: true, color: "#ff9800" },
  { ratio: 1 / 2, label: "1/2", enabled: true, color: "#ffeb3b" },
  { ratio: 1, label: "1/1", enabled: true, color: "#4caf50" },
  { ratio: 2, label: "2/1", enabled: true, color: "#089981" },
  { ratio: 3, label: "3/1", enabled: true, color: "#00bcd4" },
  { ratio: 4, label: "4/1", enabled: true, color: "#2962ff" },
  { ratio: 8, label: "8/1", enabled: true, color: "#ab47bc" },
]);

/** Traditional equal-eighth partitions used by Gann Square and Gann Box. */
export const DEFAULT_GANN_GRID_LEVELS: readonly GannLevelConfig[] = Object.freeze([
  { value: 0, enabled: true, color: "#787b86" },
  { value: 1 / 8, enabled: true, color: "#f23645" },
  { value: 2 / 8, enabled: true, color: "#ff9800" },
  { value: 3 / 8, enabled: true, color: "#ffeb3b" },
  { value: 4 / 8, enabled: true, color: "#4caf50" },
  { value: 5 / 8, enabled: true, color: "#089981" },
  { value: 6 / 8, enabled: true, color: "#00bcd4" },
  { value: 7 / 8, enabled: true, color: "#2962ff" },
  { value: 1, enabled: true, color: "#ab47bc" },
]);

/** Historical implementation fallback for drawings with no Gann payload. */
export const LEGACY_GANN_GRID_LEVELS: readonly GannLevelConfig[] = Object.freeze([
  { value: 0, enabled: true },
  { value: 1 / 8, enabled: true },
  { value: 2 / 8, enabled: true },
  { value: 3 / 8, enabled: true },
  { value: 4 / 8, enabled: true },
  { value: 5 / 8, enabled: true },
  { value: 6 / 8, enabled: true },
  { value: 7 / 8, enabled: true },
  { value: 1, enabled: true },
]);

export const DEFAULT_GANN_FAN_CONFIG: GannFanConfig = Object.freeze({
  version: 1,
  family: "fan",
  scaleLock: false,
  priceBarRatio: 1,
  preset: "classic",
  ratios: DEFAULT_GANN_FAN_RATIOS.map((item) => ({ ...item })),
  useOneColor: true,
  background: false,
  labels: true,
  reverse: false,
});

export const DEFAULT_GANN_SQUARE_CONFIG: GannSquareConfig = Object.freeze({
  version: 1,
  family: "square",
  scaleLock: false,
  priceBarRatio: 1,
  preset: "eighths",
  priceLevels: DEFAULT_GANN_GRID_LEVELS.map((item) => ({ ...item })),
  timeLevels: DEFAULT_GANN_GRID_LEVELS.map((item) => ({ ...item })),
  useOneColor: true,
  background: true,
  labels: false,
  reverse: false,
  showLevels: true,
  showFan: true,
  showArcs: false,
  showRanges: false,
});

export const DEFAULT_GANN_BOX_CONFIG: GannBoxConfig = Object.freeze({
  version: 1,
  family: "box",
  scaleLock: false,
  priceBarRatio: 1,
  preset: "eighths",
  priceLevels: DEFAULT_GANN_GRID_LEVELS.map((item) => ({ ...item })),
  timeLevels: DEFAULT_GANN_GRID_LEVELS.map((item) => ({ ...item })),
  useOneColor: true,
  background: true,
  labels: false,
  reverse: false,
  priceBackground: true,
  timeBackground: true,
  angles: false,
  labelLeft: false,
  labelRight: false,
  labelTop: false,
  labelBottom: false,
});

export function cloneGannConfig(config: GannConfig): GannConfig {
  return structuredClone(config);
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!finite(value) || value <= 0) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizedLineStyle(value: unknown): GannLineStyle | undefined {
  return value === "solid" || value === "dashed" || value === "dotted"
    ? value
    : undefined;
}

function normalizedOptionalStyle(
  source: UnknownRecord,
): Pick<GannLevelConfig, "color" | "opacity" | "lineWidth" | "lineStyle"> {
  return {
    ...(typeof source.color === "string" && source.color.trim()
      ? { color: source.color.trim().slice(0, 64) }
      : {}),
    ...(finite(source.opacity)
      ? { opacity: Math.max(0, Math.min(1, source.opacity)) }
      : {}),
    ...(finite(source.lineWidth) && source.lineWidth > 0
      ? { lineWidth: Math.max(0.25, Math.min(12, source.lineWidth)) }
      : {}),
    ...(normalizedLineStyle(source.lineStyle)
      ? { lineStyle: normalizedLineStyle(source.lineStyle) }
      : {}),
  };
}

function normalizedRatios(
  value: unknown,
  fallback: readonly GannRatioConfig[],
): GannRatioConfig[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  const ratios = value.slice(0, 32).flatMap((candidate) => {
    if (!isRecord(candidate) || !finite(candidate.ratio) || candidate.ratio <= 0) {
      return [];
    }
    const ratio = Math.min(candidate.ratio, 1_000_000);
    const label = typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim().slice(0, 20)
      : String(ratio);
    return [{
      ratio,
      label,
      enabled: bool(candidate.enabled, true),
      ...normalizedOptionalStyle(candidate),
    }];
  });
  return ratios.length > 0 ? ratios : fallback.map((item) => ({ ...item }));
}

function normalizedLevels(
  value: unknown,
  fallback: readonly GannLevelConfig[],
): GannLevelConfig[] {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  const levels = value.slice(0, 64).flatMap((candidate) => {
    if (!isRecord(candidate) || !finite(candidate.value)) return [];
    return [{
      value: Math.max(-1_000_000, Math.min(1_000_000, candidate.value)),
      enabled: bool(candidate.enabled, true),
      ...normalizedOptionalStyle(candidate),
    }];
  });
  return levels.length > 0 ? levels : fallback.map((item) => ({ ...item }));
}

function defaultForFamily(family: GannFamily): GannConfig {
  if (family === "fan") return cloneGannConfig(DEFAULT_GANN_FAN_CONFIG);
  if (family === "square") return cloneGannConfig(DEFAULT_GANN_SQUARE_CONFIG);
  return cloneGannConfig(DEFAULT_GANN_BOX_CONFIG);
}

/**
 * Return a complete, bounded Gann payload for settings, geometry and codec use.
 * Historical drawings without a payload receive the family defaults, while a
 * malformed/mismatched discriminant can never leak another family's fields.
 */
export function resolveGannConfig(value: unknown, family: GannFamily): GannConfig {
  const fallback = defaultForFamily(family);
  if (!isRecord(value) || value.family !== family) return fallback;
  const common = {
    version: 1 as const,
    family,
    scaleLock: bool(value.scaleLock, fallback.scaleLock),
    priceBarRatio: boundedNumber(
      value.priceBarRatio,
      fallback.priceBarRatio,
      Number.EPSILON,
      1_000_000_000_000,
    ),
    preset: family === "fan"
      ? value.preset === "classic" || value.preset === "custom"
        ? value.preset
        : fallback.preset
      : value.preset === "eighths" || value.preset === "custom"
        ? value.preset
        : fallback.preset,
    useOneColor: bool(value.useOneColor, fallback.useOneColor),
    background: bool(value.background, fallback.background),
    labels: bool(value.labels, fallback.labels),
    reverse: bool(value.reverse, fallback.reverse),
  };
  if (family === "fan") {
    const fanFallback = fallback as GannFanConfig;
    return {
      ...common,
      family,
      ratios: normalizedRatios(value.ratios, fanFallback.ratios),
    };
  }
  const gridFallback = fallback as GannSquareConfig | GannBoxConfig;
  const grid = {
    ...common,
    priceLevels: normalizedLevels(value.priceLevels, gridFallback.priceLevels),
    timeLevels: normalizedLevels(value.timeLevels, gridFallback.timeLevels),
  };
  if (family === "square") {
    const squareFallback = fallback as GannSquareConfig;
    return {
      ...grid,
      family,
      showLevels: bool(value.showLevels, squareFallback.showLevels),
      showFan: bool(value.showFan, squareFallback.showFan),
      showArcs: bool(value.showArcs, squareFallback.showArcs),
      showRanges: bool(value.showRanges, squareFallback.showRanges),
    };
  }
  const boxFallback = fallback as GannBoxConfig;
  return {
    ...grid,
    family,
    priceBackground: bool(value.priceBackground, boxFallback.priceBackground),
    timeBackground: bool(value.timeBackground, boxFallback.timeBackground),
    angles: bool(value.angles, boxFallback.angles),
    labelLeft: bool(value.labelLeft, boxFallback.labelLeft),
    labelRight: bool(value.labelRight, boxFallback.labelRight),
    labelTop: bool(value.labelTop, boxFallback.labelTop),
    labelBottom: bool(value.labelBottom, boxFallback.labelBottom),
  };
}
