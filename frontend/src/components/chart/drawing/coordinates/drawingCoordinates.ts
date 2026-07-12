import type { Candle, Point } from "../../../../types";

export function updateDrawingPoint(
  points: readonly Point[],
  index: number,
  patch: Partial<Point>,
): Point[] {
  if (index < 0 || index >= points.length) return points.map((point) => ({ ...point }));
  const next = points.map((point) => ({ ...point }));
  const time = patch.time ?? next[index].time;
  const price = patch.price ?? next[index].price;
  if (!Number.isFinite(time) || !Number.isFinite(price)) return next;
  next[index] = { time, price };
  return next;
}

export function nearestCandleIndex(candles: readonly Candle[], time: number): number | null {
  if (candles.length === 0 || !Number.isFinite(time)) return null;
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  const right = Math.min(low, candles.length - 1);
  const left = Math.max(0, low - 1);
  return Math.abs(candles[left].time - time) <= Math.abs(candles[right].time - time)
    ? left
    : right;
}

export function timeAtCandleIndex(candles: readonly Candle[], index: number): number | null {
  if (candles.length === 0 || !Number.isFinite(index)) return null;
  const safe = Math.max(0, Math.min(candles.length - 1, Math.round(index)));
  return candles[safe].time;
}

export function toLocalDateTimeInput(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const date = new Date(unixSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalDateTimeInput(value: string): number | null {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}
