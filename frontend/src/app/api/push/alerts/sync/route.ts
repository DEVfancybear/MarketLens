import { NextResponse, type NextRequest } from "next/server";
import { syncPushAlerts } from "@/server/pushAlertStore";
import type { PushAlertSyncRequest } from "@/types/pushAlerts";
import { MAX_PUSH_ALERTS, requireFirebaseUser, validPushToken } from "@/server/requestSecurity";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await requireFirebaseUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as PushAlertSyncRequest | null;
  if (!validPushToken(body?.token) || !Array.isArray(body.alerts)) {
    return NextResponse.json(
      { error: "token and alerts are required." },
      { status: 400 },
    );
  }
  if (body.alerts.length > MAX_PUSH_ALERTS) {
    return NextResponse.json({ error: "Too many alerts." }, { status: 413 });
  }
  let result;
  try {
    result = await syncPushAlerts(body, userId);
  } catch {
    return NextResponse.json({ error: "Push token is not available." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, ...result });
}
