import { NextResponse, type NextRequest } from "next/server";
import { evaluatePushAlerts } from "@/server/pushAlertEvaluator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.PUSH_WORKER_SECRET;
  if (!secret) return true;
  return req.headers.get("x-push-worker-secret") === secret;
}

async function evaluate(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await evaluatePushAlerts();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return evaluate(req);
}

export async function POST(req: NextRequest) {
  return evaluate(req);
}
