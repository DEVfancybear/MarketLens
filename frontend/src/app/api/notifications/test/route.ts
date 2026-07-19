import { NextResponse, type NextRequest } from "next/server";
import {
  sendExternalAlertNotifications,
  type ExternalAlertChannel,
} from "@/server/externalNotifications";
import { secretMatches } from "@/server/requestSecurity";

export const runtime = "nodejs";

interface TestRequest {
  channel?: ExternalAlertChannel;
}

function authorized(req: NextRequest): boolean {
  return secretMatches(
    req.headers.get("x-alert-webhook-secret"),
    process.env.ALERT_WEBHOOK_SECRET,
  );
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
      note: "Tin nhắn kiểm tra cảnh báo bên ngoài",
    },
    { [channel]: true },
  );
  const failed = results.find((result) => !result.ok);
  return NextResponse.json(
    { ok: !failed, results },
    { status: failed ? 207 : 200 },
  );
}
