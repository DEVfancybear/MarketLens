"use client";
import { useEffect, useState } from "react";

const EXTERNAL_SYNC_TOKEN_KEY = "externalAlertSyncToken";

function createExternalSyncToken(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `external:${random}`;
}

/** Stable per-browser id used to sync/reconcile Telegram/Discord-only alerts
 *  with the closed-browser worker when no FCM registration exists. */
export function useExternalSyncToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let existing = window.localStorage.getItem(EXTERNAL_SYNC_TOKEN_KEY);
    if (!existing) {
      existing = createExternalSyncToken();
      window.localStorage.setItem(EXTERNAL_SYNC_TOKEN_KEY, existing);
    }
    setToken(existing);
  }, []);

  return token;
}
