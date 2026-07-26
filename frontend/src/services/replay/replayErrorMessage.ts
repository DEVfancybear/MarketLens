import { isApiError } from "../api/errors";

interface ReplayAvailabilityDetails {
  slot?: unknown;
  symbol?: unknown;
  chartTimeframe?: unknown;
  firstAvailableTime?: unknown;
  lastAvailableTime?: unknown;
}

/** Convert Replay API failures into actionable, timezone-safe UI copy. */
export function replayErrorMessage(
  error: unknown,
  fallback = "Replay request failed",
): string {
  if (isApiError(error) && error.code === "data_point_unavailable") {
    const details = availabilityDetails(error.details);
    const first = formatUtc(details?.firstAvailableTime);
    const last = formatUtc(details?.lastAvailableTime);
    const subject = availabilitySubject(details);
    const unavailable = subject
      ? `${subject} has no Replay data at the selected time.`
      : "Replay data is unavailable at the selected time.";

    if (first && last) {
      return `${unavailable} Available UTC range: ${first} to ${last}.`;
    }
    if (first) {
      return `${unavailable} Choose a UTC bar at or after ${first}.`;
    }
    if (last) {
      return `${unavailable} Choose a UTC bar at or before ${last}.`;
    }
    return `${unavailable} Choose another UTC bar and try again.`;
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

function availabilitySubject(details: ReplayAvailabilityDetails | null): string | null {
  if (typeof details?.symbol !== "string" || !details.symbol.trim()) {
    return null;
  }
  const chart = Number.isInteger(details.slot) ? `Chart ${Number(details.slot) + 1}, ` : "";
  const timeframe = typeof details.chartTimeframe === "string" && details.chartTimeframe.trim()
    ? ` ${details.chartTimeframe.trim()}`
    : "";
  return `${chart}${details.symbol.trim().toUpperCase()}${timeframe}`;
}

function availabilityDetails(value: unknown): ReplayAvailabilityDetails | null {
  return value !== null && typeof value === "object"
    ? value as ReplayAvailabilityDetails
    : null;
}

function formatUtc(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  const iso = new Date(timestamp).toISOString();
  const end = iso.slice(17, 19) === "00" ? 16 : 19;
  return `${iso.slice(0, end).replace("T", " ")} UTC`;
}
