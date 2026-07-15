export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface FloatingPoint {
  x: number;
  y: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

/**
 * Fixed overlays need the visual viewport on mobile. The layout viewport does
 * not shrink with the on-screen keyboard and can leave menus/dialog controls
 * underneath it.
 */
export function getViewportRect(): ViewportRect {
  if (typeof window === "undefined") {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }

  const visual = window.visualViewport;
  const left = visual?.offsetLeft ?? 0;
  const top = visual?.offsetTop ?? 0;
  const width = visual?.width ?? window.innerWidth;
  const height = visual?.height ?? window.innerHeight;

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

export function clampFloatingPoint(
  point: FloatingPoint,
  size: FloatingSize,
  viewport: ViewportRect,
  padding = 8,
): FloatingPoint {
  const minX = viewport.left + padding;
  const minY = viewport.top + padding;
  const maxX = Math.max(minX, viewport.right - size.width - padding);
  const maxY = Math.max(minY, viewport.bottom - size.height - padding);

  return {
    x: Math.min(Math.max(point.x, minX), maxX),
    y: Math.min(Math.max(point.y, minY), maxY),
  };
}
