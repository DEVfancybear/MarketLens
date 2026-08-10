import {
  type AutoscaleInfo,
  type ColorType,
  type CrosshairMode,
  type DeepPartial,
  type GridOptions,
  type LineStyle,
  type PriceScaleOptions,
  type TimeScaleOptions,
} from "lightweight-charts";
import type { Theme } from "@/store/uiStore";
import type { IndicatorSeries, Timeframe } from "@/types";
import { DEFAULT_BAR_SPACING, chartColors, makeTickMarkFormatter } from "./chartTheme";

// Keep this policy module runtime-independent from Lightweight Charts. Version
// 5 is ESM-only, while the pure Node regression suite compiles these helpers to
// CommonJS. These are the documented stable enum wire values.
const COLOR_TYPE_SOLID = "solid" as ColorType.Solid;
const CROSSHAIR_MODE_NORMAL = 0 as CrosshairMode.Normal;
const LINE_STYLE_SOLID = 0 as LineStyle.Solid;
const LINE_STYLE_DOTTED = 1 as LineStyle.Dotted;
const LINE_STYLE_DASHED = 2 as LineStyle.Dashed;

export const RIGHT_OFFSET_BARS = 8;
export const MIN_BAR_SPACING = 1.5;
export const PRICE_SCALE_MIN_WIDTH = 74;
export const MAIN_PRICE_SCALE_MARGINS = { top: 0.08, bottom: 0.08 } as const;
export const INDICATOR_PANE_HEIGHT = 124;
export const VOLUME_TYPICAL_BAR_FRACTION = 0.25;
const MIN_VOLUME_SCALE_SAMPLES = 5;

export function indicatorSeriesPriceFormatOptions(series: IndicatorSeries) {
  const type = series.valueFormat;
  if (type === "volume" || type === "percent") {
    return {
      priceFormat: {
        type,
        ...(series.precision == null
          ? {}
          : { precision: series.precision, minMove: 1 / 10 ** series.precision }),
      },
    };
  }
  if (series.precision == null) return {};
  return {
    priceFormat: {
      type: "price" as const,
      precision: series.precision,
      minMove: 1 / 10 ** series.precision,
    },
  };
}

/**
 * Reserve stable headroom for volume panes based on the typical visible bar.
 * A quiet symbol whose largest bar is only slightly above its median should
 * not render as a solid wall, while genuine spikes remain fully visible.
 */
export function volumeScaleCeiling(points: readonly { value: number }[]): number | undefined {
  const values = points
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (values.length < MIN_VOLUME_SCALE_SAMPLES) return undefined;
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
  return median / VOLUME_TYPICAL_BAR_FRACTION;
}

export function volumeAutoscaleInfo(
  original: AutoscaleInfo | null,
  ceiling: number | undefined,
): AutoscaleInfo | null {
  if (!original?.priceRange || ceiling == null || !Number.isFinite(ceiling)) return original;
  return {
    ...original,
    priceRange: {
      minValue: Math.min(0, original.priceRange.minValue),
      maxValue: Math.max(ceiling, original.priceRange.maxValue),
    },
  };
}

export function getDefaultBarSpacing(_timeframe: Timeframe): number {
  return DEFAULT_BAR_SPACING;
}

export function timeScaleDefaults(timeframe: Timeframe) {
  return {
    rightOffset: RIGHT_OFFSET_BARS,
    barSpacing: getDefaultBarSpacing(timeframe),
    minBarSpacing: MIN_BAR_SPACING,
  };
}

export function mainPriceScaleOptions(theme: Theme): DeepPartial<PriceScaleOptions> {
  const colors = chartColors(theme);
  return {
    borderColor: colors.border,
    borderVisible: true,
    scaleMargins: MAIN_PRICE_SCALE_MARGINS,
    entireTextOnly: true,
    ticksVisible: false,
    minimumWidth: PRICE_SCALE_MIN_WIDTH,
    textColor: colors.axisText,
  };
}

export function panePriceScaleOptions(theme: Theme): DeepPartial<PriceScaleOptions> {
  const colors = chartColors(theme);
  return {
    borderColor: colors.border,
    borderVisible: true,
    entireTextOnly: true,
    ticksVisible: false,
    minimumWidth: PRICE_SCALE_MIN_WIDTH,
    textColor: colors.axisText,
  };
}

export function timeScaleOptions(
  theme: Theme,
  timeframe: Timeframe,
  timeZone?: string,
): DeepPartial<TimeScaleOptions> {
  return {
    ...timeScaleRuntimeOptions(theme, timeZone),
    ...timeScaleDefaults(timeframe),
  };
}

/**
 * Time-scale presentation options that are safe to reapply to a live chart.
 *
 * Viewport defaults deliberately live in `timeScaleOptions()` for chart
 * creation and in `ChartViewportController.reset()` for market changes. A
 * runtime theme/time-format update must not mutate bar spacing or right offset
 * ahead of the controller's single market-change transaction.
 */
export function timeScaleRuntimeOptions(
  theme: Theme,
  timeZone?: string,
): DeepPartial<TimeScaleOptions> {
  const colors = chartColors(theme);
  return {
    borderColor: colors.border,
    borderVisible: true,
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: makeTickMarkFormatter(timeZone),
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: true,
    shiftVisibleRangeOnNewBar: true,
    allowShiftVisibleRangeOnWhitespaceReplacement: false,
    ticksVisible: false,
  };
}

export function gridOptions(
  theme: Theme,
  visible: boolean,
): DeepPartial<GridOptions> {
  const colors = chartColors(theme);
  const color = visible ? colors.grid : "rgba(0,0,0,0)";
  return {
    vertLines: { color, style: LINE_STYLE_SOLID },
    horzLines: { color, style: LINE_STYLE_SOLID },
  };
}

export function layoutOptions(theme: Theme, fontSize = 12) {
  const colors = chartColors(theme);
  return {
    background: { type: COLOR_TYPE_SOLID, color: colors.background },
    textColor: colors.text,
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
    fontSize,
    attributionLogo: false,
  };
}

export function transparentLayoutOptions(theme: Theme, fontSize = 10) {
  const colors = chartColors(theme);
  return {
    background: { type: COLOR_TYPE_SOLID, color: "transparent" },
    textColor: colors.text,
    fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
    fontSize,
    attributionLogo: false,
  };
}

export function crosshairOptions(theme: Theme) {
  const colors = chartColors(theme);
  return {
    mode: CROSSHAIR_MODE_NORMAL,
    vertLine: {
      color: colors.crosshair,
      width: 1 as const,
      style: LINE_STYLE_DASHED,
      labelBackgroundColor: colors.crosshairLabelBg,
    },
    horzLine: {
      color: colors.crosshair,
      width: 1 as const,
      style: LINE_STYLE_DASHED,
      labelBackgroundColor: colors.crosshairLabelBg,
    },
  };
}

export function candlestickOptions(theme: Theme, precision: number) {
  const colors = chartColors(theme);
  return {
    upColor: colors.bull,
    downColor: colors.bear,
    borderUpColor: colors.bull,
    borderDownColor: colors.bear,
    wickUpColor: colors.bull,
    wickDownColor: colors.bear,
    borderVisible: false,
    wickVisible: true,
    priceFormat: { type: "price" as const, precision, minMove: 1 / 10 ** precision },
    priceLineVisible: true,
    priceLineWidth: 1 as const,
    priceLineStyle: LINE_STYLE_DOTTED,
    lastValueVisible: false,
  };
}

/**
 * Keep the live-price marker aligned with the candle body instead of the most
 * recent tick direction. A downtick above the candle open is still bullish,
 * and an uptick below the candle open is still bearish.
 */
export function currentPriceMarkerIsUp(
  price: number,
  candleOpen: number | null | undefined,
): boolean {
  return candleOpen == null ? true : price >= candleOpen;
}
