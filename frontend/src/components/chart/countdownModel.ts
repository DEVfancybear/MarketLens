import { TF_SECONDS, type Timeframe } from "../../types";

const UNIX_WEEK_FALLBACK_ANCHOR = Date.UTC(1970, 0, 5) / 1000;

function isUsableBarOpen(value: number | null | undefined, nowSeconds: number): value is number {
  return Number.isFinite(value) && Number(value) >= 0 && Number(value) <= nowSeconds;
}

function fixedTimeframeAnchor(
  timeframe: Exclude<Timeframe, "1M">,
  nowSeconds: number,
  barOpenTime?: number | null,
): number {
  if (isUsableBarOpen(barOpenTime, nowSeconds)) return Math.floor(barOpenTime);

  // Epoch zero was a Thursday, so it cannot be the weekly fallback anchor.
  // Once history is available, the broker's real bar-open timestamp wins.
  return timeframe === "1W" ? UNIX_WEEK_FALLBACK_ANCHOR : 0;
}

function nextFixedBoundary(
  timeframe: Exclude<Timeframe, "1M">,
  nowSeconds: number,
  barOpenTime?: number | null,
): number {
  const span = TF_SECONDS[timeframe];
  const anchor = fixedTimeframeAnchor(timeframe, nowSeconds, barOpenTime);
  const elapsed = Math.max(0, nowSeconds - anchor);
  const completedBars = Math.floor(elapsed / span);
  return anchor + (completedBars + 1) * span;
}

function addUtcMonths(anchorSeconds: number, months: number): number {
  const anchor = new Date(anchorSeconds * 1000);
  const rawMonth = anchor.getUTCMonth() + months;
  const targetYear = anchor.getUTCFullYear() + Math.floor(rawMonth / 12);
  const targetMonth = ((rawMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(anchor.getUTCDate(), lastDay),
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
  ) / 1000;
}

function nextMonthlyBoundary(
  nowSeconds: number,
  barOpenTime?: number | null,
): number {
  const now = new Date(nowSeconds * 1000);
  const fallback = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const anchor = isUsableBarOpen(barOpenTime, nowSeconds)
    ? Math.floor(barOpenTime)
    : fallback;
  const anchorDate = new Date(anchor * 1000);
  let monthOffset = Math.max(
    1,
    (now.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12
      + now.getUTCMonth()
      - anchorDate.getUTCMonth(),
  );
  let boundary = addUtcMonths(anchor, monthOffset);

  // Advance from the original anchor so end-of-month clamping never compounds.
  while (boundary <= nowSeconds) {
    monthOffset += 1;
    boundary = addUtcMonths(anchor, monthOffset);
  }
  return boundary;
}

/** Return the next formal bar-close timestamp in UTC seconds. */
export function nextBarCloseTime(
  timeframe: Timeframe,
  nowSeconds: number,
  barOpenTime?: number | null,
): number | null {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) return null;
  return timeframe === "1M"
    ? nextMonthlyBoundary(nowSeconds, barOpenTime)
    : nextFixedBoundary(timeframe, nowSeconds, barOpenTime);
}

/** Return whole seconds until the next formal bar close. */
export function secondsUntilBarClose(
  timeframe: Timeframe,
  nowSeconds: number,
  barOpenTime?: number | null,
): number {
  const boundary = nextBarCloseTime(timeframe, nowSeconds, barOpenTime);
  if (boundary == null) return 0;
  return Math.max(0, Math.ceil(boundary - nowSeconds));
}
