import { deleteToken, getToken } from "firebase/messaging";
import type { Alert } from "@/store/alertStore";
import type { PushPermission, PushRegistration } from "@/store/notificationStore";
import type { PushAlertTriggerStatus, ServerPushAlert } from "@/types/pushAlerts";
import {
  getFirebaseConfigStatus,
  getFirebaseMessaging,
  getFirebaseVapidKey,
} from "@/services/firebase/client";
import {
  deletePushToken as deleteBackendPushToken,
  registerPushToken as registerBackendPushToken,
} from "@/services/api/resources/alertsApi";

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

export async function registerPushToken(
  syncBackend = false,
): Promise<PushRegistration> {
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
  if (syncBackend) {
    await registerBackendPushToken({
      fcmToken: token,
      platform: "web",
      permission,
    });
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
  if (!messaging) return;
  try {
    await deleteToken(messaging);
  } catch {
    /* Token may already be gone or unavailable. Local state is still cleared. */
  }
}

export async function unregisterServerPushToken(
  token: string,
  syncBackend = false,
): Promise<void> {
  if (syncBackend) {
    await deleteBackendPushToken(token).catch(() => undefined);
  }
  await postJson("/api/push/unregister", { token });
}

export async function syncServerPushAlerts({
  token,
  settingsPush,
  settingsTelegram,
  settingsDiscord,
  alerts,
}: {
  token: string;
  settingsPush: boolean;
  settingsTelegram?: boolean;
  settingsDiscord?: boolean;
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
    push: alert.push,
    telegram: alert.telegram,
    discord: alert.discord,
  }));
  return postJson(
    "/api/push/alerts/sync",
    {
      token,
      settingsPush,
      settingsTelegram,
      settingsDiscord,
      alerts: serverAlerts,
    },
    init,
  );
}

export async function fetchPushTriggerStatus(
  token: string,
): Promise<PushAlertTriggerStatus[]> {
  try {
    const res = await fetch("/api/push/alerts/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { triggers?: PushAlertTriggerStatus[] };
    return body.triggers ?? [];
  } catch {
    return [];
  }
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
