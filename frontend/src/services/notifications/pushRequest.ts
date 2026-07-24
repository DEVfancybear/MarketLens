export type PushPostResult =
  | { ok: true }
  | { ok: false; error: string };

export interface AuthenticatedPushPostOptions {
  idToken: string;
  keepalive?: boolean;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
export const PUSH_REQUEST_TIMEOUT_MESSAGE =
  "Push request timed out. Please try again.";

function retryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function abortLike(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    /\b(?:abort(?:ed)?|timed?\s*out|timeout)\b/i.test(error.message)
  );
}

export function pushRequestErrorMessage(
  error: unknown,
  fallback = "Request failed.",
): string {
  if (abortLike(error)) return PUSH_REQUEST_TIMEOUT_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}

function responseError(
  payload: { error?: string | { message?: string } } | null,
  status: number,
): string {
  if (typeof payload?.error === "string" && payload.error) {
    return payload.error;
  }
  if (
    payload?.error &&
    typeof payload.error === "object" &&
    typeof payload.error.message === "string" &&
    payload.error.message
  ) {
    return payload.error.message;
  }
  return `HTTP ${status}`;
}

function wait(ms: number): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => globalThis.setTimeout(resolve, ms))
    : Promise.resolve();
}

/**
 * Timeout-bounded JSON request used by browser push routes. Retries are opt-in:
 * registration is idempotent, while send/sync callers must not accidentally
 * duplicate provider-visible work.
 */
export async function postAuthenticatedPushJson(
  url: string,
  body: unknown,
  options: AuthenticatedPushPostOptions,
): Promise<PushPostResult> {
  const retries = Math.max(0, Math.trunc(options.retries ?? 0));
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS;
  const retryDelayMs = Math.max(
    0,
    Number.isFinite(options.retryDelayMs)
      ? Number(options.retryDelayMs)
      : 250,
  );

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      controller.abort(
        new DOMException(PUSH_REQUEST_TIMEOUT_MESSAGE, "TimeoutError"),
      );
    }, timeoutMs);
    try {
      const response = await (options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.idToken}`,
        },
        body: JSON.stringify(body),
        keepalive: options.keepalive,
        signal: controller.signal,
      });
      if (response.ok) return { ok: true };
      const payload = (await response.json().catch(() => null)) as {
        error?: string | { message?: string };
      } | null;
      if (attempt < retries && retryableStatus(response.status)) {
        await wait(retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error: responseError(payload, response.status),
      };
    } catch (error) {
      if (attempt < retries) {
        await wait(retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error:
          controller.signal.aborted || abortLike(error)
            ? PUSH_REQUEST_TIMEOUT_MESSAGE
            : pushRequestErrorMessage(error),
      };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  return { ok: false, error: "Request failed." };
}
