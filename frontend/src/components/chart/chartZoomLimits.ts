import type { IChartApi } from "lightweight-charts";

/**
 * Preserve pattern context at the deepest horizontal zoom on every viewport.
 *
 * The density target controls visual size, while the minimum count protects
 * compact mobile charts. The returned spacing is always derived from the live
 * plot width, so desktop, split layouts, browser zoom, and mobile all use the
 * same policy without viewport-specific branches.
 */
const DEEP_ZOOM_DENSITY_PX = 30;
export const DEEP_ZOOM_MIN_VISIBLE_BARS = 12;

export function responsiveMaxBarSpacing(plotWidth: number): number | null {
  if (!Number.isFinite(plotWidth) || plotWidth <= 0) return null;
  const visibleBarFloor = Math.max(
    DEEP_ZOOM_MIN_VISIBLE_BARS,
    Math.ceil(plotWidth / DEEP_ZOOM_DENSITY_PX),
  );
  return plotWidth / visibleBarFloor;
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
