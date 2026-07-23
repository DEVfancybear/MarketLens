import type { IChartApi } from "lightweight-charts";

/**
 * Lightweight Charts only pans a pane vertically after its price scale leaves
 * auto-scale mode. Call this during capture-phase pointerdown so the scale is
 * manual before the library handles the matching mouse/touch event.
 */
export function beginPriceScalePan(
  chart: IChartApi,
  event: Pick<PointerEvent, "button" | "isPrimary" | "pointerType" | "target">,
): number | null {
  if (
    !event.isPrimary ||
    (event.pointerType === "mouse" && event.button !== 0) ||
    event.target == null
  ) {
    return null;
  }

  const target = event.target as Node;
  const paneIndex = chart.panes().findIndex((pane) =>
    pane.getHTMLElement()?.contains(target) ?? false,
  );
  if (paneIndex < 0) return null;

  chart.priceScale("right", paneIndex).setAutoScale(false);
  return paneIndex;
}

export function resetPriceScalePan(chart: IChartApi): void {
  chart.panes().forEach((_pane, paneIndex) => {
    chart.priceScale("right", paneIndex).setAutoScale(true);
  });
}
