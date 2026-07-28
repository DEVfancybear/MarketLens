import { NextResponse } from "next/server";
import { firebaseWorkerContentSecurityPolicy } from "@/services/security/contentSecurityPolicy";

export const dynamic = "force-dynamic";

const FIREBASE_CDN_VERSION = "12.15.0";

function workerSource(): string {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  };

  return `
importScripts("https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/${FIREBASE_CDN_VERSION}/firebase-messaging-compat.js");

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const firebaseConfig = ${JSON.stringify(config)};
const configured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.messagingSenderId
);

if (configured && self.firebase?.apps?.length === 0) {
  firebase.initializeApp(firebaseConfig);
}

if (configured && self.firebase?.messaging) {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || "🚨 Cảnh báo giá";
    const options = {
      body: payload.notification?.body || payload.data?.body || "",
      icon: "/favicon.ico",
      tag: payload.data?.alertId || "smc-alert",
      data: payload.data || {},
    };
    self.registration.showNotification(title, options);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const symbol = String(event.notification.data?.symbol || "").trim().toUpperCase();
  const targetUrl = symbol
    ? "/?symbol=" + encodeURIComponent(symbol) + "&source=alert"
    : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (symbol && "postMessage" in client) {
          client.postMessage({ type: "OPEN_ALERT_SYMBOL", symbol });
        }
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
`;
}

export function GET() {
  return new NextResponse(workerSource(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-store",
      "Content-Security-Policy": firebaseWorkerContentSecurityPolicy,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
