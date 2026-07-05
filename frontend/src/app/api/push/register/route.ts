import { NextResponse, type NextRequest } from "next/server";
import { registerPushDevice } from "@/server/pushAlertStore";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }
  await registerPushDevice(body.token);
  return NextResponse.json({ ok: true });
}
