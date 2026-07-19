import { NextResponse, type NextRequest } from "next/server";
import { registerPushDevice } from "@/server/pushAlertStore";
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
  try {
    await registerPushDevice(body.token, userId);
  } catch {
    return NextResponse.json({ error: "Push token is not available." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
