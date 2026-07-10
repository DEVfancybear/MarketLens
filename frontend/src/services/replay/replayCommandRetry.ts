import { isApiError } from "../api/errors";

export const REPLAY_VERSION_RETRY_ATTEMPTS = 4;

export function replayConflictVersion(error: unknown): number | null {
  if (!isApiError(error) || error.status !== 409 || error.code !== "version_conflict") {
    return null;
  }
  const value = (error.details as { currentVersion?: unknown } | undefined)?.currentVersion;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Retry only optimistic-version conflicts; every attempt gets a new idempotency key. */
export async function withReplayVersionRetry<T>(
  initialVersion: number,
  send: (expectedVersion: number, attempt: number) => Promise<T>,
  refreshVersion: () => Promise<number>,
  maxAttempts = REPLAY_VERSION_RETRY_ATTEMPTS,
): Promise<T> {
  let expectedVersion = initialVersion;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await send(expectedVersion, attempt);
    } catch (error) {
      if (!isApiError(error) || error.status !== 409 || error.code !== "version_conflict" || attempt + 1 >= maxAttempts) {
        throw error;
      }
      expectedVersion = replayConflictVersion(error) ?? await refreshVersion();
    }
  }
  throw new Error("Replay command retry limit reached");
}
