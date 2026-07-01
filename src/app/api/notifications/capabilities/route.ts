import { NextResponse } from "next/server";
import { externalNotificationCapabilities } from "@/server/externalNotifications";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(externalNotificationCapabilities());
}
