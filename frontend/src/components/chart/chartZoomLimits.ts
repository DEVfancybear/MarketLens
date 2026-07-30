import type { IChartApi } from "lightweight-charts";

/**
 * Match TradingView's deepest horizontal zoom on every viewport.
 *
 * TradingView allows a bar slot to grow to about half the live plot width.
 * Deriving the limit from that width preserves the same two-slot extreme on
 * desktop, split layouts, browser zoom, and mobile without breakpoint branches.
 */
export const DEEP_ZOOM_MIN_VISIBLE_SLOTS = 2;

export function responsiveMaxBarSpacing(plotWidth: number): number | null {
  if (!Number.isFinite(plotWidth) || plotWidth <= 0) return null;
  return plotWidth / DEEP_ZOOM_MIN_VISIBLE_SLOTS;
}

export function applyResponsiveMaxBarSpacing(chart: IChartApi): number | null {
  const paneElement = chart.panes()[0]?.getHTMLElement();
  if (!paneElement) return null;

  let priceScaleWidth: number;
  try {
    priceScaleWidth = chart.priceScale("right", 0).width();
  } catch {
    return null;
  }

  const paneWidth = paneElement.getBoundingClientRect().width;
  const maxBarSpacing = responsiveMaxBarSpacing(paneWidth - priceScaleWidth);
  if (maxBarSpacing === null) return null;

  const timeScale = chart.timeScale();
  const current = timeScale.options().maxBarSpacing;
  if (!Number.isFinite(current) || Math.abs(current - maxBarSpacing) > 0.05) {
    timeScale.applyOptions({ maxBarSpacing });
  }
  return maxBarSpacing;
}
