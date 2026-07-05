"use client";
import { useEffect } from "react";
import { getDefaultStore } from "jotai";
import { subscribeAuth } from "@/services/auth/firebaseAuth";
import { exchangeGoogleToken } from "@/services/auth/authClient";
import {
  setAuthUserAtom,
  setBackendSessionAtom,
} from "@/store/authStore";
import { logAtom } from "@/store/uiStore";

/**
 * Mount-once bridge from Firebase Auth → `authStore`. Fires on every sign-in/out.
 * On sign-in it also does a best-effort backend token exchange (no-op until the
 * Go API exists). Mounted in `GlobalRuntime`.
 */
export function useAuthSession(): void {
  useEffect(() => {
    const store = getDefaultStore();

    const unsubscribe = subscribeAuth(async (user, firebaseUser) => {
      store.set(setAuthUserAtom, user);

      if (!user || !firebaseUser) {
        store.set(setBackendSessionAtom, false);
        return;
      }

      // Best-effort: trade the Firebase ID token for a backend session cookie.
      try {
        const idToken = await firebaseUser.getIdToken();
        const result = await exchangeGoogleToken(idToken);
        store.set(setBackendSessionAtom, Boolean(result));
        if (result?.isNewUser) {
          store.set(logAtom, "info", "Welcome — account created");
        }
      } catch {
        store.set(setBackendSessionAtom, false);
      }
    });

    return unsubscribe;
  }, []);
}
