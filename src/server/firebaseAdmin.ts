import { cert, getApps, initializeApp } from "firebase-admin/app";
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

export async function sendFirebasePush(
  message: FirebasePushMessage,
): Promise<string> {
  ensureFirebaseAdmin();
  return getMessaging().send({
    token: message.token,
    notification: {
      title: message.title,
      body: message.body,
    },
    data: message.data ?? {},
    webpush: {
      fcmOptions: {
        link: "/",
      },
      notification: {
        icon: "/favicon.ico",
        tag: message.data?.alertId ?? "smc-alert",
        requireInteraction: false,
      },
    },
  });
}
