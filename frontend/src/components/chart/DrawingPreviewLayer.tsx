"use client";

import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import type { Drawing, Timeframe } from "@/types";
import { TF_SECONDS } from "@/types";
import { mt5SymbolInfoAtom } from "@/store/mt5Store";
import { resolvedChartTimeZoneAtom } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useChartCtx } from "./ChartContext";
import {
  drawingTimeToCoordinate,
  resolveCandleBarIntervalSeconds,
} from "./drawing/coordinates/drawingCoordinates";
import { renderDrawing, type Projector } from "./drawing/drawingRenderer";
import { isDrawingVisibleAtTimeframe } from "./drawing/visibility/drawingIntervalVisibility";

export function DrawingPreviewLayer({
  drawings,
  symbol,
  timeframe,
}: {
  drawings: Drawing[];
  symbol: string;
  timeframe: Timeframe;
}) {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bridgeSymbolInfo = useAtomValue(mt5SymbolInfoAtom)[symbol];
  const timeZone = useAtomValue(resolvedChartTimeZoneAtom);
  const visibleDrawings = useMemo(
    () =>
      drawings
        .filter(
          (drawing) =>
            drawing.visible !== false &&
            isDrawingVisibleAtTimeframe(drawing, timeframe),
        )
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [drawings, timeframe],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const graphics = canvas.getContext("2d");
    if (!graphics) return;
    graphics.setTransform(dpr, 0, 0, dpr, 0, 0);
    graphics.clearRect(0, 0, rect.width, rect.height);

    const catalog = getMarketSymbol(symbol);
    const tickSize =
      bridgeSymbolInfo?.tickSize ?? bridgeSymbolInfo?.point ?? catalog?.tickSize;
    const tickValue = bridgeSymbolInfo?.tickValue;
    const pointValue =
      Number.isFinite(tickValue) &&
      Number(tickValue) > 0 &&
      Number.isFinite(tickSize) &&
      Number(tickSize) > 0
        ? Number(tickValue) / Number(tickSize)
        : 1;
    const barIntervalSeconds = resolveCandleBarIntervalSeconds(
      ctx.candles,
      TF_SECONDS[timeframe],
      60,
    );
    const projector: Projector = {
      toX: (time) =>
        drawingTimeToCoordinate(
          ctx.chart,
          ctx.candles,
          TF_SECONDS[timeframe],
          time,
        ),
      toY: (price) => ctx.candleSeries.priceToCoordinate(price),
      width: rect.width,
      height: rect.height,
      barIntervalSeconds,
      market: {
        symbol,
        candles: ctx.candles,
        timeZone,
        tickSize,
        pricePrecision: catalog?.pricePrecision ?? 2,
        pointValue,
      },
    };

    for (const drawing of visibleDrawings) {
      graphics.save();
      renderDrawing(graphics, drawing, projector, false);
      graphics.restore();
    }
  }, [bridgeSymbolInfo, ctx, symbol, timeZone, timeframe, visibleDrawings]);

  return (
    <canvas
      ref={canvasRef}
      data-drawing-preview-canvas
      data-drawing-count={visibleDrawings.length}
      className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
    />
  );
}
