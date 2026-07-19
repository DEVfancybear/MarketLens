import { NextResponse, type NextRequest } from "next/server";
import { getPushDevice } from "@/server/pushAlertStore";
import { alertSignature } from "@/server/pushAlertEvaluator";
import type {
  PushAlertExpirationStatus,
  PushAlertTriggerStatus,
} from "@/types/pushAlerts";
import { requireFirebaseUser, validPushToken } from "@/server/requestSecurity";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const userId = await requireFirebaseUser(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!validPushToken(body?.token)) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  const device = await getPushDevice(body.token, userId);
  if (!device) {
    return NextResponse.json({ ok: true, triggers: [], expirations: [] });
  }

  const triggers: PushAlertTriggerStatus[] = [];
  const expirations: PushAlertExpirationStatus[] = [];
  for (const alert of device.alerts) {
    const state = device.alertState[alert.id];
    if (!state) continue;
    if (state.signature !== alertSignature(alert)) continue;
    if (state.lastTriggeredAt !== undefined) {
      triggers.push({
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        price: alert.price,
        recurring: alert.recurring,
        armingRevision: alert.armingRevision,
        triggerPrice: state.triggerPrice ?? alert.price,
        targetPrice: state.targetPrice,
        triggeredAt: state.lastTriggeredAt,
        evidence: state.triggerEvidence,
      });
    }
    if (state.expiredAt !== undefined) {
      expirations.push({
        alertId: alert.id,
        symbol: alert.symbol,
        armingRevision: alert.armingRevision,
        expiredAt: state.expiredAt,
      });
    }
  }

  return NextResponse.json({ ok: true, triggers, expirations });
}
