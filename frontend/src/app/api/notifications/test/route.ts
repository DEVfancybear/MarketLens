import { NextResponse, type NextRequest } from "next/server";
import {
  sendExternalAlertNotifications,
  type ExternalAlertChannel,
} from "@/server/externalNotifications";

export const runtime = "nodejs";

interface TestRequest {
  channel?: ExternalAlertChannel;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.ALERT_WEBHOOK_SECRET;
  if (!secret) return true;
  return req.headers.get("x-alert-webhook-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as TestRequest | null;
  const channel = body?.channel;
  if (channel !== "telegram" && channel !== "discord") {
    return NextResponse.json(
      { error: "channel must be telegram or discord." },
      { status: 400 },
    );
  }

  const results = await sendExternalAlertNotifications(
    {
      alertId: "test",
      symbol: "TEST",
      condition: "crossUp",
      targetPrice: 100,
      triggerPrice: 101,
      triggeredAt: Date.now(),
      source: "test",
      note: "External alert test message",
    },
    { [channel]: true },
  );
  const failed = results.find((result) => !result.ok);
  return NextResponse.json(
    { ok: !failed, results },
    { status: failed ? 207 : 200 },
  );
}
