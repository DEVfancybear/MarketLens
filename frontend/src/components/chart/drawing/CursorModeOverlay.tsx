"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { DrawingTool } from "@/types";

interface LocalPoint {
  x: number;
  y: number;
}

interface DemonstrationStroke {
  id: number;
  points: LocalPoint[];
  expiresAt: number;
}

const DEMONSTRATION_LIFETIME_MS = 2_800;
const DEMONSTRATION_FADE_MS = 1_200;

function isInside(element: HTMLElement, event: PointerEvent): boolean {
  const rect = element.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right &&
    event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function localPoint(element: HTMLElement, event: PointerEvent): LocalPoint {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function cursorFor(tool: DrawingTool): string {
  if (tool === "crosshair") return "crosshair";
  if (tool === "dotCursor" || tool === "magicCursor") return "none";
  if (tool === "eraser") return "cell";
  if (tool === "demonstrationCursor") return "crosshair";
  return tool === "cursor" ? "default" : "crosshair";
}

/**
 * Non-persistent TradingView cursor behavior. Dot and Magic are visual pointer
 * variants. Demonstration owns Alt/Option + pointer strokes and lets them fade
 * without touching drawing history or persistence.
 */
export function CursorModeOverlay({
  activeTool,
  color,
  canvasRef,
}: {
  activeTool: DrawingTool;
  color: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const strokesRef = useRef<DemonstrationStroke[]>([]);
  const activeStrokeRef = useRef<DemonstrationStroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const nextStrokeIdRef = useRef(1);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef<LocalPoint | null>(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const root = canvasRef.current?.parentElement;
    if (!root) return;
    const previousCursor = root.style.cursor;
    root.style.cursor = cursorFor(activeTool);
    return () => {
      root.style.cursor = previousCursor;
    };
  }, [activeTool, canvasRef]);

  useEffect(() => {
    const root = canvasRef.current?.parentElement;
    if (!root) return;

    const scheduleFrame = () => {
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame((now) => {
        frameRef.current = null;
        strokesRef.current = strokesRef.current.filter(
          (stroke) => stroke.expiresAt > now,
        );
        setFrame((value) => value + 1);
        if (strokesRef.current.length > 0) scheduleFrame();
      });
    };

    const handleMove = (event: PointerEvent) => {
      if (isInside(root, event)) {
        pointerRef.current = localPoint(root, event);
      } else if (activePointerRef.current == null) {
        pointerRef.current = null;
      }

      if (
        activeTool !== "demonstrationCursor" ||
        activePointerRef.current !== event.pointerId ||
        !activeStrokeRef.current
      ) {
        if (activeTool === "dotCursor" || activeTool === "magicCursor") {
          setFrame((value) => value + 1);
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = localPoint(root, event);
      const points = activeStrokeRef.current.points;
      const previous = points.at(-1);
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.5) {
        points.push(point);
      }
      scheduleFrame();
    };

    const handleDown = (event: PointerEvent) => {
      if (
        activeTool !== "demonstrationCursor" ||
        !event.altKey ||
        event.button !== 0 ||
        !isInside(root, event)
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const stroke: DemonstrationStroke = {
        id: nextStrokeIdRef.current++,
        points: [localPoint(root, event)],
        expiresAt: performance.now() + DEMONSTRATION_LIFETIME_MS,
      };
      strokesRef.current.push(stroke);
      activeStrokeRef.current = stroke;
      activePointerRef.current = event.pointerId;
      scheduleFrame();
    };

    const finishStroke = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const stroke = activeStrokeRef.current;
      if (stroke && stroke.points.length === 1) {
        const point = stroke.points[0];
        stroke.points.push({ x: point.x + 0.01, y: point.y + 0.01 });
      }
      activeStrokeRef.current = null;
      activePointerRef.current = null;
      scheduleFrame();
    };

    const handleLeave = (event: PointerEvent) => {
      if (!isInside(root, event) && activePointerRef.current == null) {
        pointerRef.current = null;
        setFrame((value) => value + 1);
      }
    };

    window.addEventListener("pointerdown", handleDown, true);
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", finishStroke, true);
    window.addEventListener("pointercancel", finishStroke, true);
    window.addEventListener("pointerout", handleLeave, true);
    return () => {
      window.removeEventListener("pointerdown", handleDown, true);
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", finishStroke, true);
      window.removeEventListener("pointercancel", finishStroke, true);
      window.removeEventListener("pointerout", handleLeave, true);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      activeStrokeRef.current = null;
      activePointerRef.current = null;
    };
  }, [activeTool, canvasRef]);

  const now = typeof performance === "undefined" ? 0 : performance.now();
  const pointer = pointerRef.current;
  const showDot = activeTool === "dotCursor" && pointer;
  const showMagic = activeTool === "magicCursor" && pointer;
  void frame;

  return (
    <svg
      data-cursor-mode-overlay
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[6] h-full w-full overflow-visible"
    >
      {strokesRef.current.map((stroke) => {
        const remaining = stroke.expiresAt - now;
        const opacity = Math.max(
          0,
          Math.min(1, remaining / DEMONSTRATION_FADE_MS),
        );
        return (
          <polyline
            key={stroke.id}
            points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opacity * 0.72}
          />
        );
      })}
      {showDot && (
        <circle
          cx={pointer.x}
          cy={pointer.y}
          r={3.5}
          fill={color}
          stroke="rgba(255,255,255,0.9)"
          strokeWidth={1}
        />
      )}
      {showMagic && (
        <text
          x={pointer.x + 4}
          y={pointer.y - 4}
          fill={color}
          fontSize={20}
          fontWeight={700}
          textAnchor="middle"
        >
          ✦
        </text>
      )}
    </svg>
  );
}
