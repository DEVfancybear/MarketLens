"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  clampFloatingPoint,
  getViewportRect,
  type FloatingPoint,
} from "@/utils/viewport";

export interface FloatingSurfaceLayout extends FloatingPoint {
  maxHeight: number;
  maxWidth: number;
}

/** Shared viewport clamping for context menus and cursor-anchored popups. */
export function useFloatingSurface(
  anchor: FloatingPoint,
  padding = 8,
) {
  const { x, y } = anchor;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<FloatingSurfaceLayout>(() => ({
    x,
    y,
    maxHeight: 0,
    maxWidth: 0,
  }));

  const update = useCallback(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const viewport = getViewportRect();
    const availableWidth = Math.max(0, viewport.width - padding * 2);
    const availableHeight = Math.max(0, viewport.height - padding * 2);
    const bounds = element.getBoundingClientRect();
    const point = clampFloatingPoint(
      { x, y },
      {
        width: Math.min(bounds.width, availableWidth),
        height: Math.min(bounds.height, availableHeight),
      },
      viewport,
      padding,
    );

    setLayout({
      ...point,
      maxHeight: availableHeight,
      maxWidth: availableWidth,
    });
  }, [padding, x, y]);

  useLayoutEffect(() => {
    update();
    const visualViewport = window.visualViewport;
    const observer = new ResizeObserver(update);
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    window.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
    };
  }, [update]);

  return { surfaceRef, layout };
}
