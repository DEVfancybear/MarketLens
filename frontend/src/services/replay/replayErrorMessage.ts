import { isApiError } from "../api/errors";

interface ReplayAvailabilityDetails {
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

    if (first && last) {
      return `Replay data is unavailable at the selected time. Choose a bar in the available UTC range: ${first} to ${last}.`;
    }
    if (first) {
      return `Replay data is unavailable at the selected time. Choose a UTC bar at or after ${first}.`;
    }
    if (last) {
      return `Replay data is unavailable at the selected time. Choose a UTC bar at or before ${last}.`;
    }
    return "Replay data is unavailable at the selected time. Choose another UTC bar and try again.";
  }

  return error instanceof Error && error.message ? error.message : fallback;
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
