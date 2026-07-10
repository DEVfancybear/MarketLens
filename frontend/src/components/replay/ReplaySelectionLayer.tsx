"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useAtomValue, useSetAtom } from "jotai";
import { useChartCtx } from "@/components/chart/ChartContext";
import { backendSessionAtom } from "@/store/authStore";
import { symbolAtom, timeframeAtom } from "@/store/chartStore";
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
import { nearestReplayCandidateIndex } from "@/components/chart/replayViewport";
import {
  cancelReplaySelectionAtom,
  replaySelectionModeAtom,
  replaySessionInputAt,
} from "./replayUiState";

/** Presentation-only UTC candidate selection; the backend validates the time. */
export function ReplaySelectionLayer({ candidates }: { candidates: Candle[] }) {
  const ctx = useChartCtx();
  const selection = useAtomValue(replaySelectionModeAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const layoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const projection = useReplayClientProjection();
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const active = selection !== "idle" && backendSession;
  const candidateSeries = useMemo(() => candidates, [candidates]);

  const nearestIndex = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!ctx || !canvas || candidateSeries.length === 0) return null;
    const x = clientX - canvas.getBoundingClientRect().left;
    const time = ctx.chart.timeScale().coordinateToTime(x);
    if (time == null) return candidateSeries.length - 1;
    const index = nearestReplayCandidateIndex(
      candidateSeries.map((candle) => candle.time),
      time as number,
    );
    return index >= 0 ? index : null;
  }, [candidateSeries, ctx]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const graphics = canvas.getContext("2d")!;
    graphics.setTransform(dpr, 0, 0, dpr, 0, 0);
    graphics.clearRect(0, 0, rect.width, rect.height);
    const index = hoverIndexRef.current;
    const candle = index == null ? undefined : candidateSeries[index];
    if (!active || !candle) return;
    const x = ctx.chart.timeScale().timeToCoordinate(candle.time as UTCTimestamp);
    if (x == null) return;
    const accent = selection === "reselecting" ? "#ff9800" : "#2962ff";
    graphics.fillStyle = selection === "reselecting"
      ? "rgba(255,152,0,0.07)"
      : "rgba(41,98,255,0.07)";
    graphics.fillRect(x, 0, rect.width - x, rect.height);
    graphics.strokeStyle = accent;
    graphics.lineWidth = 1.5;
    graphics.setLineDash([4, 3]);
    graphics.beginPath();
    graphics.moveTo(x, 0);
    graphics.lineTo(x, rect.height);
    graphics.stroke();
    graphics.setLineDash([]);
    const label = fmtDateTime(candle.time);
    graphics.font = '10px "Inter", system-ui, sans-serif';
    const width = graphics.measureText(label).width + 12;
    graphics.fillStyle = accent;
    graphics.fillRect(x - width / 2, 4, width, 16);
    graphics.fillStyle = "#fff";
    graphics.textBaseline = "middle";
    graphics.textAlign = "center";
    graphics.fillText(label, x, 12.5);
    graphics.textAlign = "start";
    dirtyRef.current = false;
  }, [active, candidateSeries, ctx, selection]);

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (dirtyRef.current) draw();
    });
  }, [draw]);

  useEffect(() => {
    if (!ctx) return;
    ctx.chart.applyOptions(active
      ? { handleScroll: false, handleScale: false }
      : { handleScroll: true, handleScale: true });
    if (!active) {
      hoverIndexRef.current = null;
      dirtyRef.current = true;
      scheduleDraw();
    }
    return () => ctx.chart.applyOptions({ handleScroll: true, handleScale: true });
  }, [active, ctx, scheduleDraw]);

  useEffect(() => {
    dirtyRef.current = true;
    scheduleDraw();
  }, [active, candidateSeries, ctx?.version, scheduleDraw]);

  const onMove = useCallback((event: React.PointerEvent) => {
    if (!active) return;
    const index = nearestIndex(event.clientX);
    if (index !== hoverIndexRef.current) {
      hoverIndexRef.current = index;
      dirtyRef.current = true;
      scheduleDraw();
    }
  }, [active, nearestIndex, scheduleDraw]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (!active) return;
    event.preventDefault();
    const index = nearestIndex(event.clientX);
    const candle = index == null ? undefined : candidateSeries[index];
    if (!candle) return;
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
    void request.catch(() => undefined);
  }, [
    active,
    cancelSelection,
    candidateSeries,
    layoutPreset,
    nearestIndex,
    projection.snapshot,
    replayMode,
    setBottomTab,
    symbol,
    timeframe,
  ]);

  return (
    <canvas
      ref={canvasRef}
      onPointerMove={onMove}
      onPointerDown={onPointerDown}
      onPointerLeave={() => {
        hoverIndexRef.current = null;
        dirtyRef.current = true;
        scheduleDraw();
      }}
      onContextMenu={(event) => {
        if (!active) return;
        event.preventDefault();
        cancelSelection();
      }}
      className="absolute inset-0 h-full w-full"
      style={{ zIndex: 30, pointerEvents: active ? "auto" : "none", cursor: active ? "crosshair" : "default" }}
    />
  );
}
