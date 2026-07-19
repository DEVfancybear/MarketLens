import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

export interface FirebasePushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

function privateKey(): string {
  return (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
}

export function firebaseAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      privateKey(),
  );
}

export function ensureFirebaseAdmin() {
  if (getApps().length > 0) return;
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey(),
    }),
  });
}

export function getFirebaseFirestore() {
  ensureFirebaseAdmin();
  return getFirestore();
}

export function getFirebaseAdminAuth() {
  ensureFirebaseAdmin();
  return getAuth();
}

function appUrl(symbol?: string): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  const base = explicit
    ? explicit
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
  if (!symbol) return base;
  const url = new URL(base);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("source", "alert");
  return url.toString();
}

export async function sendFirebasePush(
  message: FirebasePushMessage,
): Promise<string> {
  ensureFirebaseAdmin();
  const data = {
    ...(message.data ?? {}),
    title: message.title,
    body: message.body,
  };
  return getMessaging().send({
    token: message.token,
    data,
    webpush: {
      headers: {
        // 24h, not the previous 300s: the push service drops undelivered
        // messages once TTL elapses, and a closed browser can easily stay
        // closed longer than 5 minutes before it's reopened / reconnects.
        TTL: "86400",
        Urgency: "high",
      },
      fcmOptions: {
        link: appUrl(message.data?.symbol),
      },
    },
  });
}
