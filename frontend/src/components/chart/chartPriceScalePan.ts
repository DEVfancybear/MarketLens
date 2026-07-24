import type { IChartApi } from "lightweight-charts";

interface PriceScalePanGesture {
  pointerId: number;
  paneIndex: number;
  startX: number;
  startY: number;
  activated: boolean;
}

type PanPointerDown = Pick<
  PointerEvent,
  "button" | "clientX" | "clientY" | "isPrimary" | "pointerId" | "pointerType" | "target"
>;

type PanPointerMove = Pick<
  PointerEvent,
  "buttons" | "clientX" | "clientY" | "isPrimary" | "pointerId"
>;

const gestures = new WeakMap<IChartApi, PriceScalePanGesture>();
const DRAG_THRESHOLD_PX = 1;

/**
 * Arm a possible plot drag without changing price-scale mode yet.
 *
 * A plain click must not permanently disable auto-scale. The matching
 * capture-phase pointermove calls `continuePriceScalePan()` before Lightweight
 * Charts processes that first drag sample.
 */
export function beginPriceScalePan(
  chart: IChartApi,
  event: PanPointerDown,
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

  gestures.set(chart, {
    pointerId: event.pointerId,
    paneIndex,
    startX: event.clientX,
    startY: event.clientY,
    activated: false,
  });
  return paneIndex;
}

/**
 * Switch only the dragged pane to manual scale on the first real movement.
 * Returns the owned pane while the gesture is active.
 */
export function continuePriceScalePan(
  chart: IChartApi,
  event: PanPointerMove,
): number | null {
  const gesture = gestures.get(chart);
  if (
    !gesture ||
    !event.isPrimary ||
    event.pointerId !== gesture.pointerId ||
    (event.buttons & 1) === 0
  ) {
    if (gesture && event.pointerId === gesture.pointerId && (event.buttons & 1) === 0) {
      gestures.delete(chart);
    }
    return null;
  }

  if (!gesture.activated) {
    const moved =
      Math.abs(event.clientX - gesture.startX) +
      Math.abs(event.clientY - gesture.startY);
    if (moved < DRAG_THRESHOLD_PX) return null;
    chart.priceScale("right", gesture.paneIndex).setAutoScale(false);
    gesture.activated = true;
  }
  return gesture.paneIndex;
}

export function endPriceScalePan(
  chart: IChartApi,
  event?: Pick<PointerEvent, "pointerId">,
): void {
  const gesture = gestures.get(chart);
  if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
  gestures.delete(chart);
}

export function resetPriceScalePan(chart: IChartApi): void {
  gestures.delete(chart);
  chart.panes().forEach((_pane, paneIndex) => {
    chart.priceScale("right", paneIndex).setAutoScale(true);
  });
}
