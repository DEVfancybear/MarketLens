import { NextResponse, type NextRequest } from "next/server";
import {
  sendExternalAlertNotifications,
  type ExternalAlertChannel,
  type ExternalAlertMessage,
} from "@/server/externalNotifications";

export const runtime = "nodejs";

interface SendRequest {
  message?: ExternalAlertMessage;
  channels?: Partial<Record<ExternalAlertChannel, boolean>>;
}

function validMessage(message: ExternalAlertMessage | undefined): message is ExternalAlertMessage {
  return Boolean(
    message?.alertId &&
      message.symbol &&
      message.condition &&
      Number.isFinite(message.targetPrice) &&
      Number.isFinite(message.triggerPrice) &&
      Number.isFinite(message.triggeredAt),
  );
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SendRequest | null;
  if (!validMessage(body?.message)) {
    return NextResponse.json(
      { error: "Valid alert message is required." },
      { status: 400 },
    );
  }

  const results = await sendExternalAlertNotifications(
    { ...body.message, source: "browser-open" },
    body?.channels ?? {},
  );
  const failed = results.find((result) => !result.ok);
  return NextResponse.json(
    { ok: !failed, results },
    { status: failed ? 207 : 200 },
  );
}
