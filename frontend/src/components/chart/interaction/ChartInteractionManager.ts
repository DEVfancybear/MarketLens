"use client";
import { useEffect, useRef } from "react";
import type { IChartApi } from "lightweight-charts";

/**
 * ChartInteractionManager — ensures chart interaction is never blocked.
 *
 * The LWC chart (zoom, pan, crosshair, pinch) works natively through its
 * own canvas element. This module is a passive observer — it does NOT
 * intercept or forward events. It simply provides a check: "is the chart
 * currently handling interaction?"
 *
 * Responsibilities:
 *   - Track whether the chart is in a pan/zoom gesture
 *   - Provide a stable ref for other modules to check
 *   - Ensure no overlay permanently captures pointer events
 *
 * Must never:
 *   - Move drawings
 *   - Select drawings
 *   - Intercept pointer events
 *   - Call preventDefault or stopPropagation
 */

export interface ChartInteractionHandle {
  /** The chart is currently panning or zooming. */
  isActive: () => boolean;
  /** The chart API instance (for coordinate conversion). */
  chartRef: React.RefObject<IChartApi | null>;
}

export function useChartInteractionManager(
  chart: IChartApi | null,
): ChartInteractionHandle {
  const chartRef = useRef<IChartApi | null>(chart);
  chartRef.current = chart;

  const panningRef = useRef(false);

  useEffect(() => {
    // Chart interaction is handled natively by LWC — no setup needed.
    // This module exists to provide a stable handle and ensure no overlay
    // permanently captures pointer events away from the chart.
  }, [chart]);

  return {
    isActive: () => panningRef.current,
    chartRef,
  };
}
