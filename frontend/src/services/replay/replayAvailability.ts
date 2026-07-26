import type { CreateReplaySessionInput } from "../api/resources/replayApi";
import { isApiError } from "../api/errors";

export interface ReplayUnavailableTrack {
  slot: number;
  symbol: string;
  chartTimeframe: string;
  firstAvailableTime?: string;
  lastAvailableTime?: string;
}

interface AvailabilityDetails {
  slot?: unknown;
  symbol?: unknown;
  chartTimeframe?: unknown;
  firstAvailableTime?: unknown;
  lastAvailableTime?: unknown;
}

export function replayTrackIdentity(
  track: Pick<ReplayUnavailableTrack, "slot" | "symbol" | "chartTimeframe">,
): string {
  return `${track.slot}:${track.symbol}:${track.chartTimeframe}`;
}

/** Decode the exact pane that rejected a synchronized Replay timestamp. */
export function replayUnavailableTrack(error: unknown): ReplayUnavailableTrack | null {
  if (!isApiError(error) || error.code !== "data_point_unavailable") return null;
  if (!error.details || typeof error.details !== "object") return null;
  const details = error.details as AvailabilityDetails;
  if (
    !Number.isInteger(details.slot) ||
    typeof details.symbol !== "string" ||
    !details.symbol.trim() ||
    typeof details.chartTimeframe !== "string" ||
    !details.chartTimeframe.trim()
  ) {
    return null;
  }

  return {
    slot: Number(details.slot),
    symbol: details.symbol.trim().toUpperCase(),
    chartTimeframe: details.chartTimeframe.trim(),
    firstAvailableTime: validIso(details.firstAvailableTime),
    lastAvailableTime: validIso(details.lastAvailableTime),
  };
}

/**
 * Return the optional track that can be isolated from an all-chart request.
 * The active pane is marked `required`, so it can never be silently removed.
 */
export function recoverableReplayTrack(
  error: unknown,
  input: CreateReplaySessionInput,
): ReplayUnavailableTrack | null {
  if (input.mode !== "all_charts" || input.tracks.length <= 1) return null;
  const unavailable = replayUnavailableTrack(error);
  if (!unavailable) return null;
  const failed = input.tracks.find((track) =>
    track.slot === unavailable.slot &&
    track.symbol.toUpperCase() === unavailable.symbol &&
    track.chartTimeframe === unavailable.chartTimeframe
  );
  return failed && !failed.required ? unavailable : null;
}

function validIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}
