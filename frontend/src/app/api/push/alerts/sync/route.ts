import { NextResponse, type NextRequest } from "next/server";
import {
  PushDeviceOwnershipError,
  syncPushAlerts,
} from "@/server/pushAlertStore";
import type { PushAlertSyncRequest } from "@/types/pushAlerts";
import { MAX_PUSH_ALERTS, requireFirebaseUser, validPushToken } from "@/server/requestSecurity";
import { sanitizePushAlertForStorage } from "@/services/pushAlertSanitizer";
import {
  ServerOperationTimeoutError,
  withServerOperationTimeout,
} from "@/server/serverOperationTimeout";

export const runtime = "nodejs";
const PUSH_ALERT_SYNC_DEADLINE_MS = 8_000;

function serviceUnavailable(error: string) {
  return NextResponse.json(
    { error },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "1",
      },
    },
  );
}

function logSyncFailure(kind: string, error: unknown): void {
  const summary =
    error && typeof error === "object"
      ? {
          name:
            "name" in error && typeof error.name === "string"
              ? error.name
              : "Error",
          code:
            "code" in error &&
            (typeof error.code === "string" || typeof error.code === "number")
              ? error.code
              : "unknown",
        }
      : { name: typeof error, code: "unknown" };
  // Never log the FCM token, Firebase bearer token, alert payload, or user id.
  console.error(`[push/alerts/sync] ${kind}`, summary);
}

async function handlePost(req: NextRequest, signal: AbortSignal) {
  const userId = await requireFirebaseUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as PushAlertSyncRequest | null;
  if (!body || !validPushToken(body.token) || !Array.isArray(body.alerts)) {
    return NextResponse.json(
      { error: "token and alerts are required." },
      { status: 400 },
    );
  }
  if (body.alerts.length > MAX_PUSH_ALERTS) {
    return NextResponse.json({ error: "Too many alerts." }, { status: 413 });
  }
  const alerts = body.alerts.map(sanitizePushAlertForStorage);
  const invalidIndex = alerts.findIndex((alert) => alert === null);
  if (invalidIndex >= 0) {
    return NextResponse.json(
      { error: `Alert at index ${invalidIndex} is invalid.` },
      { status: 400 },
    );
  }
  const alertIds = new Set(alerts.map((alert) => alert!.id));
  if (alertIds.size !== alerts.length) {
    return NextResponse.json(
      { error: "Alert ids must be unique." },
      { status: 400 },
    );
  }
  let result;
  try {
    result = await syncPushAlerts(
      { ...body, alerts: alerts.filter((alert) => alert !== null) },
      userId,
      { signal },
    );
  } catch (error) {
    if (error instanceof PushDeviceOwnershipError) {
      return NextResponse.json(
        { error: "Push token belongs to another user." },
        { status: 409 },
      );
    }
    logSyncFailure("storage unavailable", error);
    return serviceUnavailable(
      "Push alert sync storage is unavailable. Please try again.",
    );
  }
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: NextRequest) {
  const controller = new AbortController();
  const abortTimer = setTimeout(
    () => controller.abort(new Error("push alert sync deadline exceeded")),
    PUSH_ALERT_SYNC_DEADLINE_MS,
  );
  try {
    return await withServerOperationTimeout(
      "push alert sync",
      PUSH_ALERT_SYNC_DEADLINE_MS,
      () => handlePost(req, controller.signal),
    );
  } catch (error) {
    if (error instanceof ServerOperationTimeoutError) {
      logSyncFailure("deadline exceeded", error);
      return serviceUnavailable(
        "Push alert sync timed out while contacting the database. Please try again.",
      );
    }
    logSyncFailure("unexpected failure", error);
    return serviceUnavailable(
      "Push alert sync service is unavailable. Please try again.",
    );
  } finally {
    clearTimeout(abortTimer);
  }
}
