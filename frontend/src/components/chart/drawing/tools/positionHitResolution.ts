import type { Drawing } from "@/types";
import { getDrawingToolPositionSide } from "../../../../types/drawingToolManifest";

export interface PositionHitCandle {
  time: number;
  high: number;
  low: number;
}

export interface PositionHit {
  status: "tp_hit" | "sl_hit";
  time: number;
  price: number;
}

function persistedPositionHit(drawing: Drawing): PositionHit | null {
  if (
    !getDrawingToolPositionSide(drawing.tool) ||
    !drawing.points[0] ||
    (drawing.tradeStatus !== "tp_hit" && drawing.tradeStatus !== "sl_hit") ||
    drawing.hitTime == null
  ) {
    return null;
  }
  const price =
    drawing.hitPrice ??
    (drawing.tradeStatus === "tp_hit"
      ? drawing.points[1]?.price ?? drawing.target ?? drawing.points[0].price
      : drawing.points[2]?.price ?? drawing.stop ?? drawing.points[0].price);
  return {
    status: drawing.tradeStatus,
    time: drawing.points[0].time + drawing.hitTime,
    price,
  };
}

export function positionHitDataCoversEntry(
  drawing: Drawing,
  candles: readonly PositionHitCandle[],
): boolean {
  const entry = drawing.points[0];
  return (
    !!getDrawingToolPositionSide(drawing.tool) &&
    !!entry &&
    candles.length > 0 &&
    candles[0].time <= entry.time
  );
}

export function resolvePositionHit(
  drawing: Drawing,
  candles: readonly PositionHitCandle[],
): PositionHit | null {
  if (!getDrawingToolPositionSide(drawing.tool)) return null;
  const persisted = persistedPositionHit(drawing);
  if (!positionHitDataCoversEntry(drawing, candles)) return persisted;
  return detectPositionHit(drawing, candles);
}

export function detectPositionHit(
  drawing: Drawing,
  candles: readonly PositionHitCandle[],
): PositionHit | null {
  const side = getDrawingToolPositionSide(drawing.tool);
  if (!side) return null;
  const entryPoint = drawing.points[0];
  if (!entryPoint || candles.length === 0) return null;
  const entry = entryPoint.price;
  const target = drawing.points[1]?.price ?? drawing.target ?? entry;
  const stop = drawing.points[2]?.price ?? drawing.stop ?? entry;
  let filled = false;
  let firstBar = true;
  for (const candle of candles) {
    if (candle.time < entryPoint.time) continue;
    if (!filled) {
      if (candle.low <= entry && entry <= candle.high) {
        filled = true;
        if (firstBar) {
          firstBar = false;
          continue;
        }
      } else {
        firstBar = false;
        continue;
      }
    }
    if (side === "long") {
      if (candle.low <= stop) return { status: "sl_hit", time: candle.time, price: stop };
      if (candle.high >= target) return { status: "tp_hit", time: candle.time, price: target };
    } else {
      if (candle.high >= stop) return { status: "sl_hit", time: candle.time, price: stop };
      if (candle.low <= target) return { status: "tp_hit", time: candle.time, price: target };
    }
  }
  return null;
}
