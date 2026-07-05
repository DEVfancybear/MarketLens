import {
  ColorType,
  CrosshairMode,
  LineStyle,
  type DeepPartial,
  type GridOptions,
  type PriceScaleOptions,
  type TimeScaleOptions,
} from "lightweight-charts";
import type { Theme } from "@/store/uiStore";
import type { Timeframe } from "@/types";
import { BAR_SPACING, chartColors } from "./chartTheme";

export const RIGHT_OFFSET_BARS = 8;
export const MIN_BAR_SPACING = 1.5;
export const PRICE_SCALE_MIN_WIDTH = 74;
export const MAIN_PRICE_SCALE_MARGINS = { top: 0.08, bottom: 0.16 } as const;
export const VOLUME_PRICE_SCALE_MARGINS = { top: 0.87, bottom: 0 } as const;
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
): DeepPartial<TimeScaleOptions> {
  const colors = chartColors(theme);
  return {
    borderColor: colors.border,
    borderVisible: true,
    timeVisible: true,
    secondsVisible: false,
    ...timeScaleDefaults(timeframe),
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: true,
    shiftVisibleRangeOnNewBar: true,
    allowShiftVisibleRangeOnWhitespaceReplacement: true,
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
    vertLines: { color, style: LineStyle.Solid },
    horzLines: { color, style: LineStyle.Solid },
  };
}

export function layoutOptions(theme: Theme, fontSize = 12) {
  const colors = chartColors(theme);
  return {
    background: { type: ColorType.Solid, color: colors.background },
    textColor: colors.text,
    fontFamily: "var(--font-sans)",
    fontSize,
    attributionLogo: false,
  };
}

export function transparentLayoutOptions(theme: Theme, fontSize = 10) {
  const colors = chartColors(theme);
  return {
    background: { type: ColorType.Solid, color: "transparent" },
    textColor: colors.text,
    fontFamily: "var(--font-sans)",
    fontSize,
    attributionLogo: false,
  };
}

export function crosshairOptions(theme: Theme) {
  const colors = chartColors(theme);
  return {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: colors.crosshair,
      width: 1 as const,
      style: LineStyle.Dashed,
      labelBackgroundColor: colors.crosshairLabelBg,
    },
    horzLine: {
      color: colors.crosshair,
      width: 1 as const,
      style: LineStyle.Dashed,
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
    priceLineStyle: LineStyle.Dotted,
    lastValueVisible: false,
  };
}
