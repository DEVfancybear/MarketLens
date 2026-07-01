import { NextResponse, type NextRequest } from "next/server";
import {
  firebaseAdminConfigured,
  sendFirebasePush,
} from "@/server/firebaseAdmin";

export const runtime = "nodejs";

interface PushRequestBody {
  token?: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  if (!firebaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Firebase Admin is not configured." },
      { status: 503 },
    );
  }

  let body: PushRequestBody;
  try {
    body = (await req.json()) as PushRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.token || !body.title || !body.body) {
    return NextResponse.json(
      { error: "token, title, and body are required." },
      { status: 400 },
    );
  }

  try {
    const messageId = await sendFirebasePush({
      token: body.token,
      title: body.title,
      body: body.body,
      data: body.data ?? {},
    });

    return NextResponse.json({ ok: true, messageId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Firebase push send failed.",
      },
      { status: 500 },
    );
  }
}
