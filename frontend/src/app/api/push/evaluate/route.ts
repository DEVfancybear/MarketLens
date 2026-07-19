import { NextResponse, type NextRequest } from "next/server";
import { evaluatePushAlerts } from "@/server/pushAlertEvaluator";
import { secretMatches } from "@/server/requestSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const workerSecret = process.env.PUSH_WORKER_SECRET;
  if (secretMatches(req.headers.get("x-push-worker-secret"), workerSecret)) return true;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secretMatches(req.headers.get("authorization"), `Bearer ${cronSecret}`)) return true;
  return !workerSecret && !cronSecret && process.env.NODE_ENV !== "production";
}

async function evaluate(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await evaluatePushAlerts({
    debug: req.nextUrl.searchParams.get("debug") === "1",
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return evaluate(req);
}

export async function POST(req: NextRequest) {
  return evaluate(req);
}
