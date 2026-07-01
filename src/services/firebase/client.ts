import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getMessaging,
  isSupported,
  type Messaging,
} from "firebase/messaging";

export interface FirebaseClientConfigStatus {
  configured: boolean;
  missing: string[];
}

const FIREBASE_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

const REQUIRED_CONFIG: Array<keyof typeof FIREBASE_CONFIG> = [
  "apiKey",
  "projectId",
  "appId",
  "messagingSenderId",
];

let messagingPromise: Promise<Messaging | null> | null = null;

export function getFirebaseConfigStatus(): FirebaseClientConfigStatus {
  const missing = REQUIRED_CONFIG.filter((key) => !FIREBASE_CONFIG[key]);
  return { configured: missing.length === 0, missing };
}

export function getFirebaseVapidKey(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";
}

function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp(FIREBASE_CONFIG);
}

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  const config = getFirebaseConfigStatus();
  if (!config.configured) return null;

  if (!messagingPromise) {
    messagingPromise = isSupported()
      .then((supported) => {
        if (!supported) return null;
        return getMessaging(getFirebaseApp());
      })
      .catch(() => null);
  }

  return messagingPromise;
}
