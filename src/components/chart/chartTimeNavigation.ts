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
export type ViewportRect = { width: number; height: number };
export type ElementAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type FloatingDialogSize = { width: number; height: number };
export type FloatingDialogPosition = { left: number; top: number };
export type ChartTimeZoneId = "exchange" | string;
export type ChartTimeZoneOption = {
  id: ChartTimeZoneId;
  label: string;
  timeZone?: string;
};

export const GO_TO_DATE_MAX_SPAN_BARS = 34;
export const GO_TO_DATE_MIN_SPAN_BARS = 10;
export const GO_TO_DATE_TARGET_RATIO = 0.42;
export const EXCHANGE_TIME_ZONE_ID = "exchange";
export const CHART_TIME_ZONE_OPTIONS: ChartTimeZoneOption[] = [
  { id: "UTC", label: "UTC", timeZone: "UTC" },
  { id: EXCHANGE_TIME_ZONE_ID, label: "Exchange" },
  { id: "Pacific/Honolulu", label: "Honolulu", timeZone: "Pacific/Honolulu" },
  { id: "America/Anchorage", label: "Anchorage", timeZone: "America/Anchorage" },
  { id: "America/Juneau", label: "Juneau", timeZone: "America/Juneau" },
  { id: "America/Los_Angeles", label: "Los Angeles", timeZone: "America/Los_Angeles" },
  { id: "America/Phoenix", label: "Phoenix", timeZone: "America/Phoenix" },
  { id: "America/Vancouver", label: "Vancouver", timeZone: "America/Vancouver" },
  { id: "America/Denver", label: "Denver", timeZone: "America/Denver" },
  { id: "America/Mexico_City", label: "Mexico City", timeZone: "America/Mexico_City" },
  { id: "America/El_Salvador", label: "San Salvador", timeZone: "America/El_Salvador" },
  { id: "America/Bogota", label: "Bogota", timeZone: "America/Bogota" },
  { id: "America/Chicago", label: "Chicago", timeZone: "America/Chicago" },
  { id: "America/Lima", label: "Lima", timeZone: "America/Lima" },
  { id: "America/Caracas", label: "Caracas", timeZone: "America/Caracas" },
  { id: "America/New_York", label: "New York", timeZone: "America/New_York" },
  { id: "America/Santiago", label: "Santiago", timeZone: "America/Santiago" },
  { id: "America/Toronto", label: "Toronto", timeZone: "America/Toronto" },
  { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires", timeZone: "America/Argentina/Buenos_Aires" },
  { id: "America/Halifax", label: "Halifax", timeZone: "America/Halifax" },
  { id: "America/Sao_Paulo", label: "Sao Paulo", timeZone: "America/Sao_Paulo" },
  { id: "Atlantic/Azores", label: "Azores", timeZone: "Atlantic/Azores" },
  { id: "Atlantic/Reykjavik", label: "Reykjavik", timeZone: "Atlantic/Reykjavik" },
  { id: "Africa/Casablanca", label: "Casablanca", timeZone: "Africa/Casablanca" },
  { id: "Europe/London", label: "London", timeZone: "Europe/London" },
  { id: "Europe/Paris", label: "Paris", timeZone: "Europe/Paris" },
  { id: "Europe/Berlin", label: "Berlin", timeZone: "Europe/Berlin" },
  { id: "Europe/Athens", label: "Athens", timeZone: "Europe/Athens" },
  { id: "Asia/Dubai", label: "Dubai", timeZone: "Asia/Dubai" },
  { id: "Asia/Kolkata", label: "Mumbai", timeZone: "Asia/Kolkata" },
  { id: "Asia/Bangkok", label: "Bangkok", timeZone: "Asia/Bangkok" },
  { id: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh", timeZone: "Asia/Ho_Chi_Minh" },
  { id: "Asia/Singapore", label: "Singapore", timeZone: "Asia/Singapore" },
  { id: "Asia/Hong_Kong", label: "Hong Kong", timeZone: "Asia/Hong_Kong" },
  { id: "Asia/Shanghai", label: "Shanghai", timeZone: "Asia/Shanghai" },
  { id: "Asia/Tokyo", label: "Tokyo", timeZone: "Asia/Tokyo" },
  { id: "Asia/Seoul", label: "Seoul", timeZone: "Asia/Seoul" },
  { id: "Australia/Sydney", label: "Sydney", timeZone: "Australia/Sydney" },
  { id: "Pacific/Auckland", label: "Auckland", timeZone: "Pacific/Auckland" },
];

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

export function firstCandleIndexAtOrAfter(
  candles: Candle[],
  timeSec: number,
): number | null {
  if (candles.length === 0) return null;
  let lo = 0;
  let hi = candles.length - 1;
  let result = candles.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid].time >= timeSec) {
      result = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return result;
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

export function goToDateLogicalRange(
  targetIndex: number,
  currentRange: { from: number; to: number } | null,
  preferredSpan = GO_TO_DATE_MAX_SPAN_BARS,
): { from: number; to: number } {
  const currentSpan =
    currentRange &&
    Number.isFinite(currentRange.from) &&
    Number.isFinite(currentRange.to) &&
    currentRange.to > currentRange.from
      ? currentRange.to - currentRange.from
      : preferredSpan;
  const span = Math.max(
    GO_TO_DATE_MIN_SPAN_BARS,
    Math.min(currentSpan, preferredSpan),
  );
  const leftBars = span * GO_TO_DATE_TARGET_RATIO;
  return {
    from: targetIndex - leftBars,
    to: targetIndex + (span - leftBars),
  };
}

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseDateDraft(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (parts.month < 1 || parts.month > 12) return null;
  if (parts.day < 1 || parts.day > 31) return null;
  if (parts.hour > 23 || parts.minute > 59) return null;
  return parts;
}

function zonedParts(date: Date, timeZone?: string): DateTimeParts {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  if (timeZone) options.timeZone = timeZone;
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function chartTimeZoneToIntlTimeZone(
  timeZoneId: ChartTimeZoneId = EXCHANGE_TIME_ZONE_ID,
): string | undefined {
  return timeZoneId === EXCHANGE_TIME_ZONE_ID ? undefined : timeZoneId;
}

export function isSupportedChartTimeZone(value: string): boolean {
  if (value === EXCHANGE_TIME_ZONE_ID) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function timeZoneOffsetMinutes(date: Date, timeZone?: string): number {
  if (!timeZone) return -date.getTimezoneOffset();
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function parseLocalDateTime(
  date: string,
  time: string,
  timeZone?: string,
): number | null {
  const parts = parseDateDraft(date, time);
  if (!parts) return null;
  if (!timeZone) {
    const parsed = new Date(`${date}T${time}:00`);
    const value = parsed.getTime();
    return Number.isFinite(value) ? Math.floor(value / 1000) : null;
  }

  const wallTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  );
  let utcMs = wallTimeAsUtc;
  for (let i = 0; i < 4; i++) {
    const offset = timeZoneOffsetMinutes(new Date(utcMs), timeZone);
    const nextUtcMs = wallTimeAsUtc - offset * 60 * 1000;
    if (Math.abs(nextUtcMs - utcMs) < 1000) {
      utcMs = nextUtcMs;
      break;
    }
    utcMs = nextUtcMs;
  }
  return Number.isFinite(utcMs) ? Math.floor(utcMs / 1000) : null;
}

export function formatDateInput(timeMs: number, timeZone?: string): string {
  const parts = zonedParts(new Date(timeMs), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}`;
}

export function formatTimeInput(timeMs: number, timeZone?: string): string {
  const parts = zonedParts(new Date(timeMs), timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(
    2,
    "0",
  )}`;
}

export function formatGoToMarkerLabel(timeSec: number, timeZone?: string): string {
  const date = new Date(timeSec * 1000);
  const options = timeZone ? { timeZone } : undefined;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    ...options,
  }).format(date);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...options,
  }).format(date);
  const parts = zonedParts(date, timeZone);
  const day = String(parts.day).padStart(2, "0");
  const year = String(parts.year).slice(-2);
  return `${weekday} ${day} ${month} '${year}\n${formatTimeInput(
    date.getTime(),
    timeZone,
  )}`;
}

export function formatUtcOffset(date = new Date(), timeZone?: string): string {
  const offsetMinutes = timeZoneOffsetMinutes(date, timeZone);
  if (offsetMinutes === 0) return "UTC";
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

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function goToDialogPosition(
  anchor: ElementAnchor,
  viewport: ViewportRect,
  dialog: FloatingDialogSize,
  gap = 8,
): FloatingDialogPosition {
  const maxLeft = viewport.width - dialog.width - gap;
  const left = clamp(anchor.left - gap, gap, maxLeft);
  const aboveTop = anchor.top - dialog.height - gap;
  const belowTop = anchor.bottom + gap;
  const maxTop = viewport.height - dialog.height - gap;

  return {
    left,
    top: aboveTop >= gap ? aboveTop : clamp(belowTop, gap, maxTop),
  };
}
