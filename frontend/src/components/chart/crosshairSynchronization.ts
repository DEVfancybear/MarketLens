import type { BusinessDay, Time } from "lightweight-charts";

function isBusinessDay(value: Time): value is BusinessDay {
  return typeof value === "object" && value !== null &&
    "year" in value && "month" in value && "day" in value;
}

/** Convert every LWC time representation to the UTC timestamp used by stores. */
export function crosshairTimeToTimestamp(time: Time | null | undefined): number | null {
  if (time == null) return null;
  if (typeof time === "number") return Number.isFinite(time) ? time : null;
  if (isBusinessDay(time)) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }
  const parsed = Date.parse(time);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
