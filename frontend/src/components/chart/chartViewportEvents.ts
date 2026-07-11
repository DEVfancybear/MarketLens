import type { IChartApi } from "lightweight-charts";
import {
  incrementChartPerformanceCounter,
  isChartPerformanceProbeEnabled,
  recordChartPerformanceDuration,
} from "../../services/chartPerformanceProbe";

const INPUT_EVENTS = [
  "wheel",
  "dblclick",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
] as const;

const POINTER_EVENTS = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
] as const;

export type ChartViewportEventSource = "range" | "size" | "input";

function eventRoot(chart: IChartApi): HTMLElement {
  const chartElement = chart.chartElement();
  return chartElement.parentElement ?? chartElement;
}

/**
 * One viewport invalidation contract for every overlay.
 *
 * Lightweight Charts reports horizontal range changes, but price-scale drags,
 * pinch gestures, axis double-click resets, and some wheel/autoscale settling
 * also change (time, price) -> pixel projection. Overlays live outside LWC's
 * internal renderer, so they need this extra input-level nudge to stay pinned
 * to candles like TradingView drawings.
 */
export function subscribeChartViewportEvents(
  chart: IChartApi,
  onViewportChange: (source: ChartViewportEventSource) => void,
): () => void {
  const timeScale = chart.timeScale();
  const root = eventRoot(chart);
  const options: AddEventListenerOptions = { capture: true, passive: true };

  const recordInput = (type: string) => {
    if (!isChartPerformanceProbeEnabled()) return;
    const startedAt = performance.now();
    incrementChartPerformanceCounter(`input.${type}.events`);
    requestAnimationFrame((paintAt) =>
      recordChartPerformanceDuration("input.next-frame", paintAt - startedAt, { type }),
    );
  };

  const handleRangeChange = () => onViewportChange("range");
  const handleSizeChange = () => onViewportChange("size");
  const handleInputEvent = (event: Event) => {
    recordInput(event.type);
    onViewportChange("input");
  };
  const handlePointerEvent = (event: Event) => {
    const pointer = event as PointerEvent;
    if (event.type !== "pointermove" || pointer.buttons !== 0) {
      recordInput(event.type);
      onViewportChange("input");
    }
  };

  timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
  timeScale.subscribeSizeChange(handleSizeChange);

  for (const type of INPUT_EVENTS) {
    root.addEventListener(type, handleInputEvent, options);
  }
  for (const type of POINTER_EVENTS) {
    root.addEventListener(type, handlePointerEvent, options);
  }

  return () => {
    timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
    timeScale.unsubscribeSizeChange(handleSizeChange);
    for (const type of INPUT_EVENTS) {
      root.removeEventListener(type, handleInputEvent, options);
    }
    for (const type of POINTER_EVENTS) {
      root.removeEventListener(type, handlePointerEvent, options);
    }
  };
}
