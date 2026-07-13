"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { Check, X } from "lucide-react";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { useChartCtx } from "@/components/chart/ChartContext";
import { setChartInteractionLocked } from "@/components/chart/chartInteractionLock";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { backendSessionAtom, setBackendSessionAtom } from "@/store/authStore";
import { setActiveToolAtom, symbolAtom, timeframeAtom } from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import {
  chartLayoutPresetAtom,
  replayLayoutModeAtom,
} from "@/store/replayLayoutStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  forkActiveReplay,
  startReplaySession,
} from "@/services/replay/replaySocket";
import { fmtDateTime } from "@/utils/time";
import type { Candle } from "@/types";
import {
  nearestReplayCandidateIndex,
  reconcileReplayPreviewIndex,
} from "@/components/chart/replayViewport";
import {
  beginReplayReselectionAtom,
  beginReplaySelectionAtom,
  cancelReplaySelectionAtom,
  requestReplayWorkspaceAtom,
  replaySelectionModeAtom,
  replaySessionInputAt,
} from "./replayUiState";

declare global {
  interface Window {
    __replaySelectionTest?: {
      begin: (mode?: "selecting" | "reselecting") => void;
      cancel: () => void;
      dropSession: () => void;
      snapshot: () => {
        active: boolean;
        candidateCount: number;
        previewIndex: number | null;
        selection: string;
      };
    };
  }
}

function rgbaChannel(value: string, alpha: number, fallback: string): string {
  const channel = value.trim() || fallback;
  return `rgba(${channel.split(/\s+/).join(",")},${alpha})`;
}

/** Touch-, pointer-, and keyboard-capable UTC candidate selection overlay. */
export function ReplaySelectionLayer({ candidates }: { candidates: Candle[] }) {
  const ctx = useChartCtx();
  const platform = useTerminalPlatform();
  const selection = useAtomValue(replaySelectionModeAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const layoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const projection = useReplayClientProjection();
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const requestReplayWorkspace = useSetAtom(requestReplayWorkspaceAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewIndexRef = useRef<number | null>(null);
  const previewTimeRef = useRef<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const seededSelectionRef = useRef<"idle" | "selecting" | "reselecting">("idle");
  const dirtyRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const active = selection !== "idle" && backendSession;
  const candidateSeries = useMemo(() => candidates, [candidates]);
  const candidateTimes = useMemo(
    () => candidateSeries.map((candle) => candle.time),
    [candidateSeries],
  );

  const nearestIndex = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!ctx || !canvas || candidateSeries.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const time = ctx.chart.timeScale().coordinateToTime(x);
    if (time == null) {
      // Coordinate-to-time is null in pre/post-data whitespace and briefly
      // while the chart is settling. Resolve against projected candidates so
      // the initial mobile line still lands inside the visible viewport.
      let bestIndex: number | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < candidateSeries.length; index++) {
        const projected = ctx.chart.timeScale().timeToCoordinate(
          candidateSeries[index].time as UTCTimestamp,
        );
        if (projected == null) continue;
        const distance = Math.abs(projected - x);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
      return bestIndex ?? (x < rect.width / 2 ? 0 : candidateSeries.length - 1);
    }
    const index = nearestReplayCandidateIndex(
      candidateTimes,
      time as number,
    );
    return index >= 0 ? index : null;
  }, [candidateSeries, candidateTimes, ctx]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const widthPx = Math.max(1, Math.round(rect.width * dpr));
    const heightPx = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== widthPx || canvas.height !== heightPx) {
      canvas.width = widthPx;
      canvas.height = heightPx;
    }
    const graphics = canvas.getContext("2d");
    if (!graphics) return;
    graphics.setTransform(dpr, 0, 0, dpr, 0, 0);
    graphics.clearRect(0, 0, rect.width, rect.height);
    dirtyRef.current = false;

    const index = previewIndexRef.current;
    const candle = index == null ? undefined : candidateSeries[index];
    if (!active || !candle) return;
    const projectedX = ctx.chart.timeScale().timeToCoordinate(
      candle.time as UTCTimestamp,
    );
    if (projectedX == null) return;

    const styles = getComputedStyle(document.documentElement);
    const reselecting = selection === "reselecting";
    const accent = styles.getPropertyValue(reselecting ? "--choch" : "--accent").trim() ||
      (reselecting ? "#f3b95f" : "#7c73ff");
    const channel = styles.getPropertyValue(reselecting ? "--choch-rgb" : "--accent-rgb");
    const contrast = styles.getPropertyValue("--accent-contrast").trim() || "#080b13";
    const x = Math.max(0, Math.min(rect.width, projectedX));

    graphics.fillStyle = rgbaChannel(channel, 0.09, reselecting ? "243 185 95" : "124 115 255");
    graphics.fillRect(x, 0, Math.max(0, rect.width - x), rect.height);
    graphics.strokeStyle = accent;
    graphics.lineWidth = platform === "mobile" ? 2 : 1.5;
    graphics.setLineDash([5, 4]);
    graphics.beginPath();
    graphics.moveTo(x, 0);
    graphics.lineTo(x, rect.height);
    graphics.stroke();
    graphics.setLineDash([]);

    const label = fmtDateTime(candle.time);
    graphics.font = '600 11px "Inter", system-ui, sans-serif';
    const labelWidth = graphics.measureText(label).width + 16;
    const labelCenter = Math.max(
      labelWidth / 2 + 4,
      Math.min(rect.width - labelWidth / 2 - 4, x),
    );
    const labelY = platform === "mobile" ? 48 : 4;
    graphics.fillStyle = accent;
    graphics.fillRect(labelCenter - labelWidth / 2, labelY, labelWidth, 22);
    graphics.fillStyle = contrast;
    graphics.textBaseline = "middle";
    graphics.textAlign = "center";
    graphics.fillText(label, labelCenter, labelY + 11.5);
    graphics.textAlign = "start";
  }, [active, candidateSeries, ctx, platform, selection]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (dirtyRef.current) draw();
    });
  }, [draw]);

  const updatePreview = useCallback((index: number | null) => {
    if (index === previewIndexRef.current) return;
    previewIndexRef.current = index;
    setPreviewIndex(index);
    dirtyRef.current = true;
    scheduleDraw();
  }, [scheduleDraw]);

  const selectPreviewIndex = useCallback((index: number | null) => {
    const candidate = index == null ? undefined : candidateSeries[index];
    const safeIndex = candidate ? index : null;
    previewTimeRef.current = candidate?.time ?? null;
    updatePreview(safeIndex);
  }, [candidateSeries, updatePreview]);

  const commitSelection = useCallback((index: number | null) => {
    const candle = index == null ? undefined : candidateSeries[index];
    if (!active || !candle) return;
    cancelSelection();
    setBottomTab("replay");
    const request = projection.snapshot
      ? forkActiveReplay(new Date(candle.time * 1000).toISOString())
      : startReplaySession(replaySessionInputAt(
          candle.time,
          { symbol, chartTimeframe: timeframe },
          replayMode,
          layoutPreset,
        ));
    void request.catch(() => {
      // Surface the projection/store error in the full Replay workspace. Do not
      // revive an obsolete selector after the user has already navigated away.
      requestReplayWorkspace();
    });
  }, [
    active,
    cancelSelection,
    candidateSeries,
    layoutPreset,
    projection.snapshot,
    replayMode,
    requestReplayWorkspace,
    setBottomTab,
    symbol,
    timeframe,
  ]);

  useLayoutEffect(() => {
    if (active) setActiveTool("cursor");
  }, [active, setActiveTool]);

  useEffect(() => {
    if (selection !== "idle" && !backendSession) cancelSelection();
  }, [backendSession, cancelSelection, selection]);

  useLayoutEffect(() => {
    if (!active) return;
    if (candidateSeries.length === 0) {
      previewTimeRef.current = null;
      seededSelectionRef.current = "idle";
      updatePreview(null);
      return;
    }
    const currentIndex = previewIndexRef.current;
    const previousTime = previewTimeRef.current;
    if (currentIndex == null || previousTime == null) return;
    const nextIndex = reconcileReplayPreviewIndex(
      candidateTimes,
      previousTime,
      currentIndex,
    );
    if (
      nextIndex !== currentIndex ||
      candidateSeries[currentIndex]?.time !== previousTime
    ) {
      selectPreviewIndex(nextIndex);
    }
  }, [
    active,
    candidateSeries,
    candidateTimes,
    selectPreviewIndex,
    updatePreview,
  ]);

  useEffect(() => {
    if (!ctx) return;
    setChartInteractionLocked(ctx.chart, "replay-selection", active);
    if (!active) {
      activePointerRef.current = null;
      previewTimeRef.current = null;
      updatePreview(null);
    }
    return () => setChartInteractionLocked(ctx.chart, "replay-selection", false);
  }, [active, ctx, updatePreview]);

  // Mobile has no hover event before the first tap. Seed the selector from the
  // chart centre so the vertical Replay line is visible immediately.
  useEffect(() => {
    if (!active) {
      seededSelectionRef.current = "idle";
      return;
    }
    if (
      !ctx ||
      candidateSeries.length === 0 ||
      seededSelectionRef.current === selection
    ) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    selectPreviewIndex(
      nearestIndex(rect.left + rect.width / 2) ?? candidateSeries.length - 1,
    );
    seededSelectionRef.current = selection;
  }, [active, candidateSeries.length, ctx, nearestIndex, selection, selectPreviewIndex]);

  useEffect(() => {
    if (!ctx) return;
    const redraw = () => {
      dirtyRef.current = true;
      scheduleDraw();
    };
    ctx.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const canvas = canvasRef.current;
    const observer = canvas && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(redraw)
      : null;
    if (canvas) observer?.observe(canvas);
    redraw();
    return () => {
      ctx.chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      observer?.disconnect();
    };
  }, [ctx, scheduleDraw]);

  useEffect(() => {
    dirtyRef.current = true;
    scheduleDraw();
  }, [active, candidateSeries, ctx?.version, scheduleDraw]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__replaySelectionTest = {
      begin: (mode = "selecting") => {
        const store = getDefaultStore();
        store.set(setBackendSessionAtom, true);
        store.set(
          mode === "reselecting"
            ? beginReplayReselectionAtom
            : beginReplaySelectionAtom,
        );
      },
      cancel: () => {
        const store = getDefaultStore();
        store.set(cancelReplaySelectionAtom);
        store.set(setBackendSessionAtom, false);
      },
      dropSession: () => {
        getDefaultStore().set(setBackendSessionAtom, false);
      },
      snapshot: () => ({
        active,
        candidateCount: candidateSeries.length,
        previewIndex: previewIndexRef.current,
        selection,
      }),
    };
    return () => {
      delete window.__replaySelectionTest;
    };
  }, [active, candidateSeries.length, selection]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    if (
      event.pointerType !== "mouse" &&
      activePointerRef.current !== event.pointerId
    ) return;
    if (activePointerRef.current !== null) event.preventDefault();
    selectPreviewIndex(nearestIndex(event.clientX));
  }, [active, nearestIndex, selectPreviewIndex]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      !active ||
      event.button > 0 ||
      !event.isPrimary ||
      activePointerRef.current !== null
    ) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The document fallback below still owns pointerup/pointercancel.
    }
    selectPreviewIndex(nearestIndex(event.clientX));
  }, [active, nearestIndex, selectPreviewIndex]);

  const finishPointerAt = useCallback((pointerId: number, clientX: number) => {
    if (!active || activePointerRef.current !== pointerId) return;
    const index = nearestIndex(clientX);
    selectPreviewIndex(index);
    activePointerRef.current = null;
    const canvas = canvasRef.current;
    try {
      canvas?.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released capture.
    }
    commitSelection(index);
  }, [active, commitSelection, nearestIndex, selectPreviewIndex]);

  const cancelPointer = useCallback((pointerId: number) => {
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) return;
    const handleUp = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      finishPointerAt(event.pointerId, event.clientX);
    };
    const handleCancel = (event: PointerEvent) => cancelPointer(event.pointerId);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointercancel", handleCancel, true);
    return () => {
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointercancel", handleCancel, true);
    };
  }, [active, cancelPointer, finishPointerAt]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!active || candidateSeries.length === 0) return;
    const current = previewIndexRef.current ?? candidateSeries.length - 1;
    let next = current;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(candidateSeries.length - 1, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = candidateSeries.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitSelection(current);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelSelection();
      return;
    } else {
      return;
    }
    event.preventDefault();
    selectPreviewIndex(next);
  }, [active, cancelSelection, candidateSeries.length, commitSelection, selectPreviewIndex]);

  const previewCandle = previewIndex == null ? undefined : candidateSeries[previewIndex];
  const previewLabel = previewCandle ? fmtDateTime(previewCandle.time) : "No bar available";

  return (
    <>
      <canvas
        ref={canvasRef}
        data-chart-ui
        data-replay-selection-canvas
        role="slider"
        aria-label="Replay start bar"
        aria-hidden={!active}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, candidateSeries.length - 1)}
        aria-valuenow={previewCandle ? previewIndex ?? 0 : 0}
        aria-valuetext={previewLabel}
        tabIndex={active ? 0 : -1}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={(event) => finishPointerAt(event.pointerId, event.clientX)}
        onPointerCancel={(event) => cancelPointer(event.pointerId)}
        onLostPointerCapture={(event) => cancelPointer(event.pointerId)}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || activePointerRef.current !== null) return;
          // Keep the seeded/last preview on mobile and keyboard flows. Desktop
          // users also retain the last deliberate candidate instead of losing the line.
        }}
        onContextMenu={(event) => {
          if (!active) return;
          event.preventDefault();
          cancelSelection();
        }}
        className="absolute inset-0 h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        style={{
          zIndex: 30,
          pointerEvents: active ? "auto" : "none",
          cursor: active ? "crosshair" : "default",
          touchAction: active ? "none" : "auto",
        }}
      />

      {active && platform === "mobile" && (
        <div
          data-chart-ui
          data-mobile-replay-selection
          className="pointer-events-none absolute inset-x-2 bottom-2 z-40 flex justify-center"
        >
          <div className="pointer-events-auto flex min-h-14 w-full max-w-md items-center gap-2 rounded-2xl border border-terminal-border-strong bg-terminal-raised/95 p-1.5 pl-3 shadow-floating backdrop-blur-xl">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand shadow-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <strong className="block text-xs font-bold text-ink">Select Replay bar</strong>
              <span className="block truncate text-[11px] text-ink-muted">{previewLabel}</span>
            </span>
            <button
              type="button"
              aria-label="Use selected Replay bar"
              disabled={!previewCandle}
              onClick={() => commitSelection(previewIndexRef.current)}
              className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-brand px-3 text-[var(--accent-contrast)] transition-colors active:bg-brand-hover disabled:opacity-45"
            >
              <Check size={18} />
            </button>
            <button
              type="button"
              aria-label="Cancel Replay bar selection"
              onClick={() => cancelSelection()}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted transition-colors active:bg-terminal-pressed active:text-bear"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
