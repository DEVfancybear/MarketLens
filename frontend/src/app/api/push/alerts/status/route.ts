import { NextResponse, type NextRequest } from "next/server";
import { getPushDevice } from "@/server/pushAlertStore";
import { alertSignature } from "@/server/pushAlertEvaluator";
import type { PushAlertTriggerStatus } from "@/types/pushAlerts";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  const device = await getPushDevice(body.token);
  if (!device) {
    return NextResponse.json({ ok: true, triggers: [] });
  }

  const triggers: PushAlertTriggerStatus[] = [];
  for (const alert of device.alerts) {
    const state = device.alertState[alert.id];
    if (!state || state.lastTriggeredAt === undefined) continue;
    if (state.signature !== alertSignature(alert)) continue;
    triggers.push({
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      price: alert.price,
      recurring: alert.recurring,
      triggerPrice: state.triggerPrice ?? alert.price,
      triggeredAt: state.lastTriggeredAt,
    });
  }

  return NextResponse.json({ ok: true, triggers });
}
