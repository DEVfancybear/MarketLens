import type { Candle } from "@/types";

export type TimeRangeShortcut =
  | "1D"
  | "5D"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "5Y"
  | "All";

export const TIME_RANGE_SHORTCUTS: TimeRangeShortcut[] = [
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
  "All",
];

export type TimeRange = { from: number; to: number };

function lastCandleTime(candles: Candle[]): number | null {
  const last = candles[candles.length - 1];
  return last ? last.time : null;
}

function addLocalMonths(timeSec: number, months: number): number {
  const date = new Date(timeSec * 1000);
  date.setMonth(date.getMonth() + months);
  return Math.floor(date.getTime() / 1000);
}

function addLocalYears(timeSec: number, years: number): number {
  const date = new Date(timeSec * 1000);
  date.setFullYear(date.getFullYear() + years);
  return Math.floor(date.getTime() / 1000);
}

function startOfLocalYear(timeSec: number): number {
  const date = new Date(timeSec * 1000);
  return Math.floor(new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0).getTime() / 1000);
}

export function shortcutRange(
  shortcut: TimeRangeShortcut,
  candles: Candle[],
): TimeRange | "all" | null {
  const to = lastCandleTime(candles);
  if (to == null) return null;
  if (shortcut === "All") return "all";

  const day = 24 * 60 * 60;
  const from =
    shortcut === "1D"
      ? to - day
      : shortcut === "5D"
        ? to - day * 5
        : shortcut === "1M"
          ? addLocalMonths(to, -1)
          : shortcut === "3M"
            ? addLocalMonths(to, -3)
            : shortcut === "6M"
              ? addLocalMonths(to, -6)
              : shortcut === "YTD"
                ? startOfLocalYear(to)
                : shortcut === "1Y"
                  ? addLocalYears(to, -1)
                  : addLocalYears(to, -5);

  return { from: Math.min(from, to), to };
}

export function nearestCandleIndex(candles: Candle[], timeSec: number): number | null {
  if (candles.length === 0) return null;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = candles[mid].time;
    if (t === timeSec) return mid;
    if (t < timeSec) lo = mid + 1;
    else hi = mid - 1;
  }
  if (lo <= 0) return 0;
  if (lo >= candles.length) return candles.length - 1;
  const before = candles[lo - 1];
  const after = candles[lo];
  return Math.abs(before.time - timeSec) <= Math.abs(after.time - timeSec)
    ? lo - 1
    : lo;
}

export function centeredLogicalRange(
  targetIndex: number,
  currentRange: { from: number; to: number } | null,
  fallbackSpan: number,
): { from: number; to: number } {
  const currentSpan =
    currentRange &&
    Number.isFinite(currentRange.from) &&
    Number.isFinite(currentRange.to) &&
    currentRange.to > currentRange.from
      ? currentRange.to - currentRange.from
      : fallbackSpan;
  const span = Math.max(10, currentSpan);
  return {
    from: targetIndex - span / 2,
    to: targetIndex + span / 2,
  };
}

export function parseLocalDateTime(date: string, time: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00`);
  const value = parsed.getTime();
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

export function formatDateInput(timeMs: number): string {
  const date = new Date(timeMs);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatTimeInput(timeMs: number): string {
  const date = new Date(timeMs);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatUtcOffset(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

export type CalendarCell = {
  key: string;
  date: string;
  day: number;
  inMonth: boolean;
  timeMs: number;
};

export function calendarCells(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(first);
  const mondayBasedOffset = (first.getDay() + 6) % 7;
  start.setDate(first.getDate() - mondayBasedOffset);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const timeMs = date.getTime();
    cells.push({
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      date: formatDateInput(timeMs),
      day: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      timeMs,
    });
  }
  return cells;
}
