import { NextResponse, type NextRequest } from "next/server";
import { syncPushAlerts } from "@/server/pushAlertStore";
import type { PushAlertSyncRequest } from "@/types/pushAlerts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as PushAlertSyncRequest | null;
  if (!body?.token || !Array.isArray(body.alerts)) {
    return NextResponse.json(
      { error: "token and alerts are required." },
      { status: 400 },
    );
  }
  const result = await syncPushAlerts(body);
  return NextResponse.json({ ok: true, ...result });
}
