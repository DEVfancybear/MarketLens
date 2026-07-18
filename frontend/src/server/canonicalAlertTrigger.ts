import type {
  PendingPushAlertTrigger,
  PushWorkerTriggerRequest,
  PushWorkerTriggerResponse,
  ServerPushAlert,
} from "@/types/pushAlerts";
import {
  CanonicalTriggerPersistenceError,
  type CanonicalTriggerCommit,
} from "./pushAlertLifecycle";

interface CanonicalTriggerOptions {
  apiBase?: string;
  workerSecret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function backendBase(configured?: string): string {
  return (configured?.trim() || "http://localhost:8080").replace(/\/+$/, "");
}

function responseFailureIsRetryable(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function failureMessage(
  payload: {
    error?: string | { message?: string };
  } | null,
  status: number,
): string {
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  if (
    payload?.error &&
    typeof payload.error === "object" &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return `Backend trigger persistence failed (${status}).`;
}

/** Writes closed-browser lifecycle/history to Go before any channel delivery. */
export async function acknowledgeCanonicalAlertTrigger(
  deliveryToken: string | undefined,
  alert: ServerPushAlert,
  candidate: PendingPushAlertTrigger,
  options: CanonicalTriggerOptions = {},
): Promise<CanonicalTriggerCommit> {
  const token = deliveryToken?.trim();
  const workerSecret = options.workerSecret ?? process.env.PUSH_WORKER_SECRET ?? "";
  if (!token) {
    throw new CanonicalTriggerPersistenceError(
      "Missing signed alert delivery token.",
      true,
    );
  }
  if (!workerSecret.trim()) {
    throw new CanonicalTriggerPersistenceError(
      "PUSH_WORKER_SECRET is not configured.",
      true,
    );
  }

  const body: PushWorkerTriggerRequest = {
    deliveryToken: token,
    alertId: alert.id,
    triggerPrice: candidate.triggerPrice,
    targetPrice: candidate.targetPrice,
    ...(candidate.triggerEvidence.previous
      ? { previous: candidate.triggerEvidence.previous }
      : {}),
    current: candidate.triggerEvidence.current,
    armingRevision: alert.armingRevision,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    let res: Response;
    try {
      res = await (options.fetchImpl ?? fetch)(
        `${backendBase(options.apiBase ?? process.env.NEXT_PUBLIC_API_BASE_URL)}/api/v1/alerts/worker-trigger`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-push-worker-secret": workerSecret,
          },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new CanonicalTriggerPersistenceError(
        error instanceof Error && error.message
          ? error.message
          : "Backend trigger persistence request failed.",
        true,
      );
    }
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        error?: string | { message?: string };
      } | null;
      throw new CanonicalTriggerPersistenceError(
        failureMessage(payload, res.status),
        responseFailureIsRetryable(res.status),
        res.status,
      );
    }
    const payload = (await res.json().catch(() => null)) as
      | Partial<PushWorkerTriggerResponse>
      | null;
    if (
      !payload ||
      payload.ok !== true ||
      typeof payload.alreadyTriggered !== "boolean" ||
      !payload.event ||
      typeof payload.event.id !== "string" ||
      !payload.event.id
    ) {
      throw new CanonicalTriggerPersistenceError(
        "Backend returned an invalid trigger acknowledgement.",
        true,
        res.status,
      );
    }
    return {
      alreadyTriggered: payload.alreadyTriggered,
      eventId: payload.event.id,
    };
  } finally {
    clearTimeout(timeout);
  }
}
