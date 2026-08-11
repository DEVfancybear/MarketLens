import {
  DEFAULT_POSITION_STATS,
  type Drawing,
} from "../../../../types/drawing";
import { getDrawingToolPositionSide } from "../../../../types/drawingToolManifest";
import { levelFromTicks, roundToTick, safeTickSize } from "./positionMetrics";
import { nearestCandleIndex } from "../coordinates/drawingCoordinates";
import { STANDARD_ACCOUNT_DEFAULT_RISK_PERCENT } from "../../../../services/execution/orderRiskDefaults";

export interface PositionDrawingInitialization {
  drawing: Drawing;
  side: "long" | "short";
}

export interface PositionDrawingCreationOptions {
  barCount?: number;
  riskPriceDistance?: number;
  entryTime?: number;
  rightEdgeTime?: number;
}

export const POSITION_DEFAULT_BAR_COUNT = 20;
export const POSITION_DEFAULT_MIN_WIDTH_PX = 160;
export const POSITION_DEFAULT_RISK_HEIGHT_PX = 96;

/** Keep a newly-created Position leg readable at dense chart zoom levels. */
export function positionBarCountForViewport(
  barSpacing: number | null | undefined,
  minWidthPx = POSITION_DEFAULT_MIN_WIDTH_PX,
  availableRightWidthPx?: number | null,
): number {
  if (!Number.isFinite(barSpacing) || Number(barSpacing) <= 0) {
    return POSITION_DEFAULT_BAR_COUNT;
  }
  const spacing = Number(barSpacing);
  const hasAvailableWidth =
    Number.isFinite(availableRightWidthPx) && Number(availableRightWidthPx) > 0;
  const targetWidth = hasAvailableWidth
    ? Math.min(minWidthPx, Number(availableRightWidthPx))
    : minWidthPx;
  const minimumBars = hasAvailableWidth && Number(availableRightWidthPx) <
    POSITION_DEFAULT_BAR_COUNT * spacing
    ? 1
    : POSITION_DEFAULT_BAR_COUNT;
  const widthBars = hasAvailableWidth && targetWidth < minWidthPx
    ? Math.max(1, Math.floor(targetWidth / spacing))
    : Math.ceil(targetWidth / spacing);
  return Math.max(minimumBars, widthBars);
}

/**
 * Pick the symmetric price distance that fits on both sides of the entry.
 * The caller samples the chart's active price scale at equal pixel offsets.
 */
export function positionRiskDistanceForViewport(
  entryPrice: number,
  upperPrice: number | null | undefined,
  lowerPrice: number | null | undefined,
): number | undefined {
  const distances = [upperPrice, lowerPrice]
    .filter((price): price is number => Number.isFinite(price))
    .map((price) => Math.abs(price - entryPrice))
    .filter((distance) => distance > 0);
  return distances.length > 0 ? Math.min(...distances) : undefined;
}

export function resolvePositionCreationTimeline(
  entryTime: number,
  barIntervalSeconds: number,
  barCount: number,
  candles: readonly { time: number }[],
): { entryTime: number; rightEdgeTime: number } {
  const interval = Number.isFinite(barIntervalSeconds) && barIntervalSeconds > 0
    ? barIntervalSeconds
    : 3600;
  const count = Number.isFinite(barCount) && barCount > 0
    ? Math.max(1, Math.ceil(barCount))
    : POSITION_DEFAULT_BAR_COUNT;
  const firstTime = candles[0]?.time;
  const lastTime = candles[candles.length - 1]?.time;
  // Whitespace is a real logical chart location. Snapping it to the nearest
  // loaded candle shifts a right-edge click backward and pushes the new box
  // offscreen. Only in-range points participate in candle-index snapping.
  if (
    firstTime == null ||
    lastTime == null ||
    entryTime < firstTime ||
    entryTime > lastTime
  ) {
    return { entryTime, rightEdgeTime: entryTime + interval * count };
  }
  const entryIndex = nearestCandleIndex(candles, entryTime);
  if (entryIndex == null) {
    return { entryTime, rightEdgeTime: entryTime + interval * count };
  }
  const snappedEntryTime = candles[entryIndex].time;
  const targetIndex = entryIndex + count;
  if (targetIndex < candles.length) {
    return {
      entryTime: snappedEntryTime,
      rightEdgeTime: candles[targetIndex].time,
    };
  }
  const lastIndex = candles.length - 1;
  return {
    entryTime: snappedEntryTime,
    rightEdgeTime:
      candles[lastIndex].time + (targetIndex - lastIndex) * interval,
  };
}

/**
 * Expand a one-point Position creation into its editable entry/target/stop
 * projection without reading chart or trade state.
 */
export function initializePositionDrawing(
  drawing: Drawing,
  barIntervalSeconds: number,
  tickSize?: number,
  options: PositionDrawingCreationOptions = {},
): PositionDrawingInitialization | null {
  const side = getDrawingToolPositionSide(drawing.tool);
  const entryPoint = drawing.points[0];
  if (!side || drawing.points.length !== 1 || !entryPoint) return null;

  const interval = Number.isFinite(barIntervalSeconds) && barIntervalSeconds > 0
    ? barIntervalSeconds
    : 3600;
  const tick = safeTickSize(tickSize);
  const entry = roundToTick(entryPoint.price, tick);
  const creationEntryTime = Number.isFinite(options.entryTime)
    ? Number(options.entryTime)
    : entryPoint.time;
  const barCount = Number.isFinite(options.barCount) && Number(options.barCount) > 0
    ? Math.max(1, Math.ceil(Number(options.barCount)))
    : POSITION_DEFAULT_BAR_COUNT;
  const tRight =
    Number.isFinite(options.rightEdgeTime) && Number(options.rightEdgeTime) > creationEntryTime
      ? Number(options.rightEdgeTime)
      : creationEntryTime + interval * barCount;
  const direction = side === "long" ? 1 : -1;
  // Persist valid market prices from the first frame. If creation leaves the
  // three levels off-grid, the first body move has to snap them independently
  // and visibly changes the target/stop offsets even for a zero-distance drag.
  const riskDistance =
    Number.isFinite(options.riskPriceDistance) && Number(options.riskPriceDistance) > 0
      ? Number(options.riskPriceDistance)
      : Math.abs(entry * 0.01);
  const riskTicks = Math.max(1, Math.round(riskDistance / tick));
  const target = levelFromTicks(entry, riskTicks, direction, tick);
  const stop = levelFromTicks(entry, riskTicks, direction === 1 ? -1 : 1, tick);

  return {
    side,
    drawing: {
      ...drawing,
      color: drawing.color || "#089981",
      lineWidth: drawing.lineWidth || 1,
      accountSize: drawing.accountSize ?? 1000,
      accountCurrency: drawing.accountCurrency ?? "Default",
      lotSize: drawing.lotSize ?? 1,
      riskValue:
        drawing.riskValue ?? STANDARD_ACCOUNT_DEFAULT_RISK_PERCENT,
      riskValueDefaulted:
        drawing.riskValue == null
          ? true
          : drawing.riskValueDefaulted ?? false,
      riskUnit: drawing.riskUnit ?? "%",
      leverage: drawing.leverage ?? 10000,
      showLabels: drawing.showLabels ?? true,
      targetColor: drawing.targetColor ?? "#089981",
      stopColor: drawing.stopColor ?? "#f23645",
      textColor: drawing.textColor ?? "#ffffff",
      fontSize: drawing.fontSize ?? 12,
      positionStats: drawing.positionStats ?? [...DEFAULT_POSITION_STATS],
      alwaysShowStats: drawing.alwaysShowStats ?? true,
      points: [
        { time: creationEntryTime, price: entry },
        { time: tRight, price: target },
        { time: tRight, price: stop },
      ],
    },
  };
}
