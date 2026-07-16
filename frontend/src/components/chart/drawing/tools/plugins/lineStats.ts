import type { Drawing, LineStat, LineStatsPosition } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { Segment } from "./lineGeometry";
import { angleDeg } from "./shared";

const LEGACY_COMBINED_STATS: readonly LineStat[] = [
  "priceRange",
  "percentChange",
];

export interface LineStatItem {
  id: LineStat;
  text: string;
}

export function resolveEnabledLineStats(drawing: Drawing): LineStat[] {
  if (Array.isArray(drawing.lineStats)) return [...new Set(drawing.lineStats)];
  return drawing.showStats ? [...LEGACY_COMBINED_STATS] : [];
}

function signed(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
  })}`;
}

function duration(seconds: number): string {
  const total = Math.max(0, Math.round(Math.abs(seconds)));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function inferredPipSize(proj: Projector, price: number): number {
  const tick = proj.market?.tickSize;
  if (tick && Number.isFinite(tick) && tick > 0) {
    // Fractional-pip FX quotes add exactly one digit to the conventional
    // 4-decimal (non-JPY) or 2-decimal (JPY) pip. Do not multiply ordinary
    // 4/2-decimal ticks: doing so made a 4-digit EURUSD quote report 1/10 of
    // the actual move.
    const normalized = tick.toFixed(12).replace(/0+$/, "");
    const decimalPoint = normalized.indexOf(".");
    const decimals = decimalPoint < 0
      ? 0
      : normalized.length - decimalPoint - 1;
    return decimals === 5 || decimals === 3 ? tick * 10 : tick;
  }
  return Math.abs(price) < 10 ? 0.0001 : 0.01;
}

function nearestBarIndex(
  candles: readonly { time: number }[],
  time: number,
): number | null {
  if (candles.length === 0) return null;
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  const before = candles[low - 1];
  const after = candles[low];
  return Math.abs(before.time - time) <= Math.abs(after.time - time)
    ? low - 1
    : low;
}

/**
 * TradingView's Bars range follows logical series bars, not elapsed wall-clock
 * periods. That distinction matters across weekends/session gaps (a Friday to
 * Monday span is one bar on a daily chart, not three 24-hour periods).
 */
function logicalBarsBetween(
  proj: Projector,
  firstTime: number,
  secondTime: number,
): number {
  const candles = proj.market?.candles ?? [];
  if (
    candles.length > 1 &&
    firstTime >= candles[0].time &&
    firstTime <= candles[candles.length - 1].time &&
    secondTime >= candles[0].time &&
    secondTime <= candles[candles.length - 1].time
  ) {
    const firstIndex = nearestBarIndex(candles, firstTime);
    const secondIndex = nearestBarIndex(candles, secondTime);
    if (firstIndex !== null && secondIndex !== null) {
      return Math.abs(secondIndex - firstIndex);
    }
  }
  const barSeconds = Math.max(1, proj.barIntervalSeconds ?? 60);
  return Math.round(Math.abs(secondTime - firstTime) / barSeconds);
}

export function lineStatItems(
  drawing: Drawing,
  anchors: Segment,
  proj: Projector,
): LineStatItem[] {
  const [first, second] = drawing.points;
  if (!first || !second) return [];
  const delta = second.price - first.price;
  const percent = first.price === 0 ? 0 : (delta / first.price) * 100;
  const elapsed = second.time - first.time;
  const bars = logicalBarsBetween(proj, first.time, second.time);
  const distance = Math.hypot(
    anchors.b.x - anchors.a.x,
    anchors.b.y - anchors.a.y,
  );
  const values: Record<LineStat, string> = {
    priceRange: signed(delta, 8),
    percentChange: `${signed(percent, 2)}%`,
    pips: `${signed(delta / inferredPipSize(proj, first.price), 1)} pips`,
    barsRange: `${bars} bars`,
    dateTimeRange: duration(elapsed),
    distance: `${distance.toFixed(1)} px`,
    angle: `${angleDeg(
      anchors.a.x,
      anchors.a.y,
      anchors.b.x,
      anchors.b.y,
    ).toFixed(2)}°`,
  };
  return resolveEnabledLineStats(drawing).map((id) => ({ id, text: values[id] }));
}

export function lineStatsAnchor(
  anchors: Segment,
  position: LineStatsPosition | undefined,
  viewportWidth: number,
): { x: number; y: number } {
  let ratio = position === "left" ? 0 : position === "center" ? 0.5 : 1;
  if (position === "auto") {
    ratio = anchors.b.x + 140 < viewportWidth ? 1 : anchors.a.x > 140 ? 0 : 0.5;
  }
  return {
    x: anchors.a.x + (anchors.b.x - anchors.a.x) * ratio + 6,
    y: anchors.a.y + (anchors.b.y - anchors.a.y) * ratio + 5,
  };
}
