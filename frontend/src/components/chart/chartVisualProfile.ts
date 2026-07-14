import {
  type ColorType,
  type CrosshairMode,
  type DeepPartial,
  type GridOptions,
  type LineStyle,
  type PriceScaleOptions,
  type TimeScaleOptions,
} from "lightweight-charts";
import type { Theme } from "@/store/uiStore";
import type { Timeframe } from "@/types";
import { BAR_SPACING, chartColors, makeTickMarkFormatter } from "./chartTheme";

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

export function getDefaultBarSpacing(timeframe: Timeframe): number {
  return BAR_SPACING[timeframe] ?? 8;
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
  const colors = chartColors(theme);
  return {
    borderColor: colors.border,
    borderVisible: true,
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: makeTickMarkFormatter(timeZone),
    ...timeScaleDefaults(timeframe),
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
