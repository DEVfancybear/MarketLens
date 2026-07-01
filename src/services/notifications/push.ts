import { deleteToken, getToken } from "firebase/messaging";
import type { Alert } from "@/store/alertStore";
import type { PushPermission, PushRegistration } from "@/store/notificationStore";
import type { ServerPushAlert } from "@/types/pushAlerts";
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

async function postJson(
  url: string,
  body: unknown,
  init?: Pick<RequestInit, "keepalive">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: init?.keepalive,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      return { ok: false, error: payload?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Request failed.",
    };
  }
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

function waitForServiceWorkerActive(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active) return Promise.resolve(registration);

  const pendingWorker = registration.installing ?? registration.waiting;
  if (!pendingWorker) {
    return navigator.serviceWorker.ready.then(() => registration);
  }

  return new Promise((resolve, reject) => {
    const worker = pendingWorker;
    const timeout = window.setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      reject(new Error("Service worker did not become active in time."));
    }, 10_000);

    function onStateChange() {
      if (worker.state !== "activated") return;
      window.clearTimeout(timeout);
      worker.removeEventListener("statechange", onStateChange);
      resolve(registration);
    }

    worker.addEventListener("statechange", onStateChange);
  });
}

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
  await registration.update().catch(() => undefined);
  const activeRegistration = await waitForServiceWorkerActive(registration);
  const token = await getToken(messaging, {
    vapidKey: getFirebaseVapidKey(),
    serviceWorkerRegistration: activeRegistration,
  });

  if (!token) {
    throw new Error("Firebase did not return a push token.");
  }

  const now = Date.now();
  const registered = await postJson("/api/push/register", { token });
  if (!registered.ok) {
    throw new Error(`Push token server registration failed: ${registered.error}`);
  }

  return {
    token,
    permission,
    createdAt: now,
    updatedAt: now,
  };
}

export async function unregisterPushToken(): Promise<void> {
  const messaging = await getFirebaseMessaging();
  let token: string | undefined;
  if (messaging) {
    try {
      token = await getToken(messaging, {
        vapidKey: getFirebaseVapidKey(),
      });
    } catch {
      token = undefined;
    }
  }
  if (!messaging) return;
  try {
    await deleteToken(messaging);
  } catch {
    /* Token may already be gone or unavailable. Local state is still cleared. */
  }
  if (token) {
    await postJson("/api/push/unregister", { token });
  }
}

export async function unregisterServerPushToken(token: string): Promise<void> {
  await postJson("/api/push/unregister", { token });
}

export async function syncServerPushAlerts({
  token,
  settingsPush,
  alerts,
}: {
  token: string;
  settingsPush: boolean;
  alerts: Alert[];
}, init?: Pick<RequestInit, "keepalive">): Promise<{ ok: true } | { ok: false; error: string }> {
  const serverAlerts: ServerPushAlert[] = alerts.map((alert) => ({
    id: alert.id,
    symbol: alert.symbol,
    condition: alert.condition,
    price: alert.price,
    note: alert.note,
    recurring: alert.recurring,
    updatedAt: Math.round((alert.updatedAt ?? alert.createdAt) * 1000),
  }));
  return postJson(
    "/api/push/alerts/sync",
    {
      token,
      settingsPush,
      alerts: serverAlerts,
    },
    init,
  );
}

export async function sendAlertPush(
  payload: PushSendPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return postJson("/api/push/send", {
    token: payload.token,
    title: payload.title,
    body: payload.body,
    data: {
      alertId: payload.alert.id,
      symbol: payload.alert.symbol,
      condition: payload.alert.condition,
      targetPrice: String(payload.alert.price),
      triggerPrice: String(payload.triggerPrice),
      source: "browser",
    },
  });
}
