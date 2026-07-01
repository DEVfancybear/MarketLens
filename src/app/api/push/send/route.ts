import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

interface PushRequestBody {
  token?: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

function privateKey(): string {
  return (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
}

function firebaseAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      privateKey(),
  );
}

function ensureFirebaseAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey(),
    }),
  });
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
    ensureFirebaseAdmin();
    const messageId = await getMessaging().send({
      token: body.token,
      notification: {
        title: body.title,
        body: body.body,
      },
      data: body.data ?? {},
      webpush: {
        fcmOptions: {
          link: "/",
        },
        notification: {
          icon: "/favicon.ico",
          tag: "smc-alert",
          requireInteraction: false,
        },
      },
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
