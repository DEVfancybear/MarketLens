"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "@/components/chart/ChartContext";
import {
  selectingAtom,
  reSelectingAtom,
  armAtom,
  cancelSelectAtom,
  cancelReSelectAtom,
  confirmReSelectAtom,
} from "@/store/replayStore";
import { useAtomValue, useSetAtom } from "jotai";
import { getDefaultStore } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import { indexAtOrBefore } from "@/services/replayEngine";
import { fmtDateTime } from "@/utils/time";

/**
 * TradingView-style Bar Replay selection overlay.
 *
 * Handles TWO modes:
 *
 * 1. **Initial selection** (selectingAtom === true):
 *    User has not yet started replay. They click a candle to set the initial
 *    start point and arm replay.
 *
 * 2. **Re-selection** (reSelectingAtom === true):
 *    Replay is already active. The "Select Bar" button was pressed. User can
 *    click a different candle to restart replay from that bar without ever
 *    exiting replay mode.
 *
 * In both modes the canvas:
 *   - captures pointer events (pointer-events: auto, z-index above chart),
 *   - disables chart pan/zoom,
 *   - draws a vertical cursor snapped to the nearest candle + date label
 *     and shaded "future" region,
 *   - clears hover state on leave / cancel.
 *
 * When neither mode is active the canvas is pointer-events:none and paints
 * nothing, so it never blocks normal chart interaction or the drawing layer.
 *
 * **Performance:** hover data is stored in refs, never React state, so mouse
 * move triggers only a lightweight canvas repaint — no store updates, no
 * React re-renders, no candle rebuilds.
 */
export function ReplaySelectionLayer() {
  const ctx = useChartCtx();
  const selecting = useAtomValue(selectingAtom);
  const reSelecting = useAtomValue(reSelectingAtom);
  const arm = useSetAtom(armAtom);
  const cancelSelect = useSetAtom(cancelSelectAtom);
  const cancelReSelect = useSetAtom(cancelReSelectAtom);
  const confirmReSelect = useSetAtom(confirmReSelectAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ---- Transient hover data (refs, never React state) ----
  const hoverIdxRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const isActive = selecting || reSelecting;

  // While not armed, ctx.candles is the full master series. Memoised so
  // hook deps stay stable.
  const candles = useMemo(() => ctx?.candles ?? [], [ctx]);

  // During re-select we need the FULL candle list (not the replay-truncated
  // visible slice) so the user can pick any bar including future ones.
  const fullCandles = useMemo(() => {
    if (!reSelecting) return candles;
    return getDefaultStore().get(candlesAtom);
  }, [reSelecting, candles]);

  // ---- Snap a clientX to the nearest candle index ----
  const nearestIndex = useCallback(
    (clientX: number): number | null => {
      const canvas = canvasRef.current;
      const data = reSelecting ? fullCandles : candles;
      if (!ctx || !canvas || data.length === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const ts = ctx.chart.timeScale();
      const t = ts.coordinateToTime(x);
      if (t == null) return data.length - 1; // right whitespace → last bar
      const time = t as number;
      const before = indexAtOrBefore(data, time);
      const after = Math.min(data.length - 1, before + 1);
      return Math.abs(data[before].time - time) <=
        Math.abs(data[after].time - time)
        ? before
        : after;
    },
    [ctx, candles, fullCandles, reSelecting],
  );

  // ---- Draw the snapping cursor (reads from refs, writes to canvas) ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (
      canvas.width !== rect.width * dpr ||
      canvas.height !== rect.height * dpr
    ) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    const hoverIdx = hoverIdxRef.current;
    const data = reSelecting ? fullCandles : candles;
    if (!isActive || hoverIdx == null || !data[hoverIdx]) return;

    const ts = ctx.chart.timeScale();
    const x = ts.timeToCoordinate(data[hoverIdx].time as UTCTimestamp);
    if (x == null) return;
    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim() || "#2962ff";

    // Shade the would-be-hidden future region.
    g.fillStyle = reSelecting
      ? "rgba(255,152,0,0.07)" // orange tint for re-select mode
      : "rgba(41,98,255,0.07)";
    g.fillRect(x, 0, rect.width - x, rect.height);

    // Vertical selection line.
    g.strokeStyle = reSelecting ? "#ff9800" : accent;
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, rect.height);
    g.stroke();
    g.setLineDash([]);

    // Date label chip.
    const label = fmtDateTime(data[hoverIdx].time);
    // Canvas can't resolve var(--font-sans); use a concrete family.
    g.font = '10px "Inter", system-ui, sans-serif';
    const w = g.measureText(label).width + 12;
    const chipColor = reSelecting ? "#ff9800" : accent;
    g.fillStyle = chipColor;
    g.fillRect(x - w / 2, 4, w, 16);
    g.fillStyle = "#fff";
    g.textBaseline = "middle";
    g.textAlign = "center";
    g.fillText(label, x, 12.5);
    g.textAlign = "start";

    dirtyRef.current = false;
  }, [ctx, isActive, candles, fullCandles, reSelecting]);

  // Schedule a canvas redraw on next rAF (deduplicated).
  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (dirtyRef.current) draw();
    });
  }, [draw]);

  // ---- Disable chart pan/zoom while selecting; restore afterwards ----
  useEffect(() => {
    if (!ctx) return;
    ctx.chart.applyOptions(
      isActive
        ? { handleScroll: false, handleScale: false }
        : { handleScroll: true, handleScale: true },
    );
    if (!isActive) {
      hoverIdxRef.current = null;
      dirtyRef.current = true;
      scheduleDraw();
    }
    return () => {
      ctx.chart.applyOptions({ handleScroll: true, handleScale: true });
    };
  }, [isActive, ctx, scheduleDraw]);

  // ---- Esc / Right-click cancels selection ----
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (reSelecting) cancelReSelect();
        else cancelSelect();
      }
    };
    const onCtx = (e: MouseEvent) => {
      // Right-click cancels re-select (TradingView convention).
      if (reSelecting) {
        e.preventDefault();
        e.stopPropagation();
        cancelReSelect();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onCtx, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onCtx, true);
    };
  }, [isActive, selecting, reSelecting, cancelSelect, cancelReSelect]);

  // Redraw when chart version changes (pan/zoom/resize).
  useEffect(() => {
    dirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw, ctx?.version]);

  // Redraw when active state or candle data changes.
  useEffect(() => {
    dirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw, isActive, candles, fullCandles]);

  // ---- Pointer handlers (ref-based, zero React state updates) ----
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isActive) return;
      const idx = nearestIndex(e.clientX);
      if (idx !== hoverIdxRef.current) {
        hoverIdxRef.current = idx;
        dirtyRef.current = true;
        scheduleDraw();
        const data = reSelecting ? fullCandles : candles;
        if (idx != null && data[idx]) {
          console.debug(
            reSelecting ? "Replay re-select hover:" : "Replay hover:",
            {
              x: Math.round(e.clientX),
              index: idx,
              time: fmtDateTime(data[idx].time),
            },
          );
        }
      }
    },
    [isActive, nearestIndex, scheduleDraw, reSelecting, candles, fullCandles],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isActive) return;
      e.preventDefault();
      const idx = nearestIndex(e.clientX);
      const data = reSelecting ? fullCandles : candles;
      if (idx == null || !data[idx]) return;

      if (reSelecting) {
        // Re-select mode: move anchor + cursor to the chosen bar.
        const total = getDefaultStore().get(candlesAtom).length;
        console.debug("Replay re-select confirmed:", {
          index: idx,
          time: fmtDateTime(data[idx].time),
          timestamp: data[idx].time,
          total,
        });
        confirmReSelect(idx);
      } else {
        // Initial selection mode: arm replay at the chosen bar.
        const total = getDefaultStore().get(candlesAtom).length;
        console.debug("Replay start selected:", {
          index: idx,
          time: fmtDateTime(data[idx].time),
          timestamp: data[idx].time,
          total,
        });
        arm(idx, total);
        setBottomTab("replay");
      }
    },
    [
      isActive,
      nearestIndex,
      reSelecting,
      candles,
      fullCandles,
      confirmReSelect,
      arm,
      setBottomTab,
    ],
  );

  const onPointerLeave = useCallback(() => {
    if (!isActive) return;
    hoverIdxRef.current = null;
    dirtyRef.current = true;
    scheduleDraw();
  }, [isActive, scheduleDraw]);

  return (
    <canvas
      ref={canvasRef}
      onPointerMove={onMove}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => {
        // Prevent browser context menu during selection modes.
        if (isActive) e.preventDefault();
      }}
      className="absolute inset-0 h-full w-full"
      style={{
        zIndex: 30,
        pointerEvents: isActive ? "auto" : "none",
        cursor: isActive ? "crosshair" : "default",
      }}
    />
  );
}
