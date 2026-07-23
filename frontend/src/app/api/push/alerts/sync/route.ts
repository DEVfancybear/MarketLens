import { NextResponse, type NextRequest } from "next/server";
import { syncPushAlerts } from "@/server/pushAlertStore";
import type { PushAlertSyncRequest } from "@/types/pushAlerts";
import { MAX_PUSH_ALERTS, requireFirebaseUser, validPushToken } from "@/server/requestSecurity";
import { sanitizePushAlertForStorage } from "@/services/pushAlertSanitizer";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
    );
  } catch {
    return NextResponse.json({ error: "Push token is not available." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, ...result });
}
