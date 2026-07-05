import { TF_SECONDS, type Timeframe } from '@/types';

/** UTC day key, e.g. "2026-06-24". */
export function dayKey(timeSec: number): string {
  return new Date(timeSec * 1000).toISOString().slice(0, 10);
}

/** UTC month key, e.g. "2026-06". */
export function monthKey(timeSec: number): string {
  return new Date(timeSec * 1000).toISOString().slice(0, 7);
}

/** Hours in UTC as a float (e.g. 13.5 = 13:30). */
export function utcHours(timeSec: number): number {
  const d = new Date(timeSec * 1000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** Human date+time, "Jun 24, 13:45". */
export function fmtDateTime(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

export function fmtDate(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Snap a timestamp down to the start of its bar for the given timeframe. */
export function floorToBar(timeSec: number, tf: Timeframe): number {
  const s = TF_SECONDS[tf];
  return Math.floor(timeSec / s) * s;
}

/** Convert "YYYY-MM-DD" (+ optional "HH:mm") to UTC seconds. */
export function parseDateInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes("T")
    ? trimmed
    : trimmed.includes(" ")
      ? trimmed.replace(" ", "T")
      : `${trimmed}T00:00:00`;
  const ms = Date.parse(
    normalized.endsWith("Z") ? normalized : `${normalized}Z`,
  );
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
