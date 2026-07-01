import { deleteToken, getToken } from "firebase/messaging";
import type { Alert } from "@/store/alertStore";
import type { PushPermission, PushRegistration } from "@/store/notificationStore";
import {
  getFirebaseConfigStatus,
  getFirebaseMessaging,
  getFirebaseVapidKey,
} from "@/services/firebase/client";

export interface PushCapability {
  supported: boolean;
  configured: boolean;
  permission: PushPermission;
  error?: string;
}

export interface PushSendPayload {
  token: string;
  title: string;
  body: string;
  alert: Alert;
  triggerPrice: number;
}

function notificationPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

const FIREBASE_ENV_LABEL: Record<string, string> = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
};

export async function getPushCapability(): Promise<PushCapability> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator)
  ) {
    return {
      supported: false,
      configured: false,
      permission: "unsupported",
      error: "Push notifications are not supported in this browser.",
    };
  }

  const config = getFirebaseConfigStatus();
  const vapidKey = getFirebaseVapidKey();
  if (!config.configured || !vapidKey) {
    return {
      supported: true,
      configured: false,
      permission: notificationPermission(),
      error: [
        ...config.missing.map((key) => FIREBASE_ENV_LABEL[key] ?? key),
        !vapidKey ? "NEXT_PUBLIC_FIREBASE_VAPID_KEY" : "",
      ]
        .filter(Boolean)
        .join(", "),
    };
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return {
      supported: false,
      configured: true,
      permission: notificationPermission(),
      error: "Firebase Messaging is not supported in this browser.",
    };
  }

  return {
    supported: true,
    configured: true,
    permission: notificationPermission(),
  };
}

export async function registerPushToken(): Promise<PushRegistration> {
  const capability = await getPushCapability();
  if (!capability.supported) {
    throw new Error(capability.error ?? "Push notifications are unsupported.");
  }
  if (!capability.configured) {
    throw new Error(capability.error ?? "Firebase push is not configured.");
  }

  let permission = notificationPermission();
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    throw new Error("Firebase Messaging is unavailable.");
  }

  const registration = await navigator.serviceWorker.register(
    "/firebase-messaging-sw.js",
  );
  const token = await getToken(messaging, {
    vapidKey: getFirebaseVapidKey(),
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    throw new Error("Firebase did not return a push token.");
  }

  const now = Date.now();
  return {
    token,
    permission,
    createdAt: now,
    updatedAt: now,
  };
}

export async function unregisterPushToken(): Promise<void> {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return;
  try {
    await deleteToken(messaging);
  } catch {
    /* Token may already be gone or unavailable. Local state is still cleared. */
  }
}

export async function sendAlertPush(
  payload: PushSendPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: payload.token,
        title: payload.title,
        body: payload.body,
        data: {
          alertId: payload.alert.id,
          symbol: payload.alert.symbol,
          condition: payload.alert.condition,
          targetPrice: String(payload.alert.price),
          triggerPrice: String(payload.triggerPrice),
        },
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Push send failed.",
    };
  }
}
