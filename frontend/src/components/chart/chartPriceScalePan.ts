import type {
  IChartApi,
  IPriceScaleApi,
  IRange,
} from "lightweight-charts";

interface PriceScalePanGesture {
  pointerId: number;
  paneIndex: number;
  startX: number;
  startY: number;
  activated: boolean;
  kind: "plot-pan" | "price-scale";
  paneTop: number;
  paneHeight: number;
  initialRange: IRange<number> | null;
  priceScale: IPriceScaleApi;
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
const SCALE_MARGIN_FRACTION = 0.2;
const MIN_SCALE_COEFFICIENT = 0.1;

function finitePriceRange(
  range: IRange<number> | null,
): range is IRange<number> {
  return range !== null &&
    Number.isFinite(range.from) &&
    Number.isFinite(range.to) &&
    range.to > range.from;
}

function scaledPriceRange(
  gesture: PriceScalePanGesture,
  clientY: number,
): IRange<number> | null {
  const range = gesture.initialRange;
  if (
    gesture.kind !== "price-scale" ||
    !finitePriceRange(range) ||
    gesture.paneHeight <= 1
  ) {
    return null;
  }

  // Match Lightweight Charts' price-axis scaling curve, but keep the whole
  // gesture in public API state that cannot be stranded by a missed mouseup.
  const padding = (gesture.paneHeight - 1) * SCALE_MARGIN_FRACTION;
  const startPoint =
    gesture.paneHeight - (gesture.startY - gesture.paneTop);
  const currentPoint = Math.max(
    0,
    gesture.paneHeight - (clientY - gesture.paneTop),
  );
  const coefficient = Math.max(
    (startPoint + padding) / (currentPoint + padding),
    MIN_SCALE_COEFFICIENT,
  );
  if (!Number.isFinite(coefficient)) return null;

  const center = (range.from + range.to) / 2;
  const halfSpan = ((range.to - range.from) * coefficient) / 2;
  const next = {
    from: center - halfSpan,
    to: center + halfSpan,
  };
  return finitePriceRange(next) ? next : null;
}

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
  const panes = chart.panes();
  const paneIndex = panes.findIndex((pane) =>
    pane.getHTMLElement()?.contains(target) ?? false,
  );
  if (paneIndex < 0) return null;

  const pane = panes[paneIndex];
  const paneElement = pane.getHTMLElement();
  if (!paneElement) return null;

  let priceScale: IPriceScaleApi;
  let priceScaleWidth: number;
  let initialRange: IRange<number> | null;
  try {
    priceScale = chart.priceScale("right", paneIndex);
    priceScaleWidth = priceScale.width();
    initialRange = priceScale.getVisibleRange();
  } catch {
    return null;
  }

  const paneRect = paneElement.getBoundingClientRect();
  const onRightPriceScale =
    Number.isFinite(priceScaleWidth) &&
    priceScaleWidth > 0 &&
    event.clientX >= paneRect.right - priceScaleWidth &&
    event.clientX <= paneRect.right;

  gestures.set(chart, {
    pointerId: event.pointerId,
    paneIndex,
    startX: event.clientX,
    startY: event.clientY,
    activated: false,
    kind:
      onRightPriceScale && finitePriceRange(initialRange)
        ? "price-scale"
        : "plot-pan",
    paneTop: paneRect.top,
    paneHeight: pane.getHeight(),
    initialRange:
      onRightPriceScale && finitePriceRange(initialRange)
        ? initialRange
        : null,
    priceScale,
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
    try {
      gesture.priceScale.setAutoScale(false);
      gesture.activated = true;
    } catch {
      gestures.delete(chart);
      return null;
    }
  }

  if (gesture.kind === "price-scale") {
    const range = scaledPriceRange(gesture, event.clientY);
    if (!range) {
      gestures.delete(chart);
      return null;
    }
    try {
      gesture.priceScale.setVisibleRange(range);
    } catch {
      gestures.delete(chart);
      return null;
    }
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
