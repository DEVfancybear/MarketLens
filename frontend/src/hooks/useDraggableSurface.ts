"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getViewportRect } from "../utils/viewport";

export type DragOffset = { x: number; y: number };

export type SurfaceRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DraggableSurfaceOptions = {
  boundsMargin?: number;
  keyboardStep?: number;
  resetKey?: unknown;
};

const DEFAULT_BOUNDS_MARGIN = 6;
const DEFAULT_KEYBOARD_STEP = 16;
const OFFSET_EPSILON_PX = 0.1;
const CHART_POPUP_BOUNDS_SELECTOR = "[data-chart-popup-bounds]";

function clampAxis(value: number, minimum: number, maximum: number): number {
  // A popup can briefly be wider than its bounds while responsive content is
  // reflowing. Centre that axis instead of oscillating between invalid limits.
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(Math.max(value, minimum), maximum);
}

/** Clamp a translated surface while preserving its un-translated anchor. */
export function clampSurfaceOffset(
  offset: DragOffset,
  baseRect: SurfaceRect,
  boundsRect: SurfaceRect,
  margin = DEFAULT_BOUNDS_MARGIN,
): DragOffset {
  return {
    x: clampAxis(
      offset.x,
      boundsRect.left + margin - baseRect.left,
      boundsRect.right - margin - baseRect.right,
    ),
    y: clampAxis(
      offset.y,
      boundsRect.top + margin - baseRect.top,
      boundsRect.bottom - margin - baseRect.bottom,
    ),
  };
}

export function sameSurfaceOffset(left: DragOffset, right: DragOffset): boolean {
  return Math.abs(left.x - right.x) < OFFSET_EPSILON_PX &&
    Math.abs(left.y - right.y) < OFFSET_EPSILON_PX;
}

function shiftedBack(rect: DOMRect, offset: DragOffset): SurfaceRect {
  return {
    left: rect.left - offset.x,
    top: rect.top - offset.y,
    right: rect.right - offset.x,
    bottom: rect.bottom - offset.y,
  };
}

function boundsFor(element: HTMLElement): SurfaceRect {
  const bounds = element.closest<HTMLElement>(CHART_POPUP_BOUNDS_SELECTOR);
  return bounds?.getBoundingClientRect() ?? getViewportRect();
}

/**
 * Shared Pointer Events drag engine for chart-owned floating surfaces.
 *
 * The hook translates the surface from its CSS anchor, so callers can keep
 * their natural top/left/bottom/flow layout. Bounds come from the nearest
 * `data-chart-popup-bounds` ancestor and fall back to the viewport for
 * portalled surfaces such as context menus.
 */
export function useDraggableSurface(
  options: DraggableSurfaceOptions = {},
) {
  const {
    boundsMargin = DEFAULT_BOUNDS_MARGIN,
    keyboardStep = DEFAULT_KEYBOARD_STEP,
    resetKey,
  } = options;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    pointerStart: DragOffset;
    offsetStart: DragOffset;
    baseRect: SurfaceRect;
  } | null>(null);
  const [offset, setOffsetState] = useState<DragOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const setOffset = useCallback((next: DragOffset) => {
    if (sameSurfaceOffset(offsetRef.current, next)) return;
    offsetRef.current = next;
    setOffsetState((current) => sameSurfaceOffset(current, next) ? current : next);
  }, []);

  const resetKeyRef = useRef(resetKey);
  useLayoutEffect(() => {
    if (Object.is(resetKeyRef.current, resetKey)) return;
    resetKeyRef.current = resetKey;
    setOffset({ x: 0, y: 0 });
  }, [resetKey, setOffset]);

  const clampCurrentOffset = useCallback(() => {
    const element = surfaceRef.current;
    if (!element || window.getComputedStyle(element).visibility === "hidden") return;
    const current = offsetRef.current;
    const next = clampSurfaceOffset(
      current,
      shiftedBack(element.getBoundingClientRect(), current),
      boundsFor(element),
      boundsMargin,
    );
    if (!sameSurfaceOffset(current, next)) setOffset(next);
  }, [boundsMargin, setOffset]);

  useLayoutEffect(() => {
    clampCurrentOffset();
  }, [clampCurrentOffset]);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const bounds = element.closest<HTMLElement>(CHART_POPUP_BOUNDS_SELECTOR);
    let frame = 0;
    const scheduleClamp = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(clampCurrentOffset);
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleClamp);
    const visualViewport = window.visualViewport;
    observer?.observe(element);
    if (bounds) observer?.observe(bounds);
    window.addEventListener("resize", scheduleClamp);
    visualViewport?.addEventListener("resize", scheduleClamp);
    visualViewport?.addEventListener("scroll", scheduleClamp);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleClamp);
      visualViewport?.removeEventListener("resize", scheduleClamp);
      visualViewport?.removeEventListener("scroll", scheduleClamp);
    };
  }, [clampCurrentOffset]);

  const moveTo = useCallback((candidate: DragOffset) => {
    const element = surfaceRef.current;
    if (!element) return;
    const current = offsetRef.current;
    setOffset(clampSurfaceOffset(
      candidate,
      shiftedBack(element.getBoundingClientRect(), current),
      boundsFor(element),
      boundsMargin,
    ));
  }, [boundsMargin, setOffset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    const element = surfaceRef.current;
    if (!element) return;
    const current = offsetRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      offsetStart: current,
      baseRect: shiftedBack(element.getBoundingClientRect(), current),
    };
    setDragging(true);
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic accessibility tests and a few embedded browsers may reject
      // capture even though subsequent Pointer Events still target the handle.
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const element = surfaceRef.current;
    if (!drag || !element || event.pointerId !== drag.pointerId) return;
    const candidate = {
      x: drag.offsetStart.x + event.clientX - drag.pointerStart.x,
      y: drag.offsetStart.y + event.clientY - drag.pointerStart.y,
    };
    setOffset(clampSurfaceOffset(
      candidate,
      drag.baseRect,
      boundsFor(element),
      boundsMargin,
    ));
    event.preventDefault();
    event.stopPropagation();
  }, [boundsMargin, setOffset]);

  const finish = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  }, []);

  const cancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    moveTo(drag.offsetStart);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  }, [moveTo]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const delta: Record<string, DragOffset> = {
      ArrowLeft: { x: -keyboardStep, y: 0 },
      ArrowRight: { x: keyboardStep, y: 0 },
      ArrowUp: { x: 0, y: -keyboardStep },
      ArrowDown: { x: 0, y: keyboardStep },
    };
    if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      moveTo({ x: 0, y: 0 });
      return;
    }
    const step = delta[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const current = offsetRef.current;
    moveTo({ x: current.x + step.x, y: current.y + step.y });
  }, [keyboardStep, moveTo]);

  const resetPosition = useCallback(() => moveTo({ x: 0, y: 0 }), [moveTo]);
  const surfaceStyle = useMemo<CSSProperties>(() => ({
    "--chart-popup-drag-x": `${offset.x}px`,
    "--chart-popup-drag-y": `${offset.y}px`,
  } as CSSProperties), [offset]);

  return {
    surfaceRef,
    surfaceStyle,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown,
    },
    dragHandleClassName: dragging ? "is-dragging" : "",
    dragging,
    resetPosition,
  };
}
