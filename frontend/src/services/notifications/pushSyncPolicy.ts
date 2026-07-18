export type WorkerDeliveryCredential =
  | { status: "idle" | "loading" | "failed" }
  | { status: "ready"; token: string };

const CREDENTIAL_RETRY_BASE_MS = 1_000;
const CREDENTIAL_RETRY_MAX_MS = 60_000;

/**
 * Caps credential retries at one request per minute while keeping the first
 * recovery attempts quick. Callers reset the attempt counter after success or
 * whenever the workspace identity changes.
 */
export function workerCredentialRetryDelay(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.trunc(attempt))
    : 0;
  const exponent = Math.min(normalizedAttempt, 30);
  return Math.min(
    CREDENTIAL_RETRY_MAX_MS,
    CREDENTIAL_RETRY_BASE_MS * 2 ** exponent,
  );
}

export function canSyncClosedBrowserAlerts(
  workspaceReady: boolean,
  credential: WorkerDeliveryCredential,
): credential is { status: "ready"; token: string } {
  return workspaceReady && credential.status === "ready" && credential.token.length > 0;
}

/** Startup/register calls may omit credentials; never erase a prior signed token. */
export function resolveStoredDeliveryToken(
  requested: string | undefined,
  existing: string | undefined,
): string | undefined {
  const next = requested?.trim();
  return next || existing;
}
