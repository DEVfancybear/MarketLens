"use client";
import { useEffect } from "react";
import { getDefaultStore } from "jotai";
import { subscribeAuth } from "@/services/auth/firebaseAuth";
import {
  backendAuthConfigured,
  ensureBackendGoogleSession,
} from "@/services/auth/authClient";
import {
  setAuthErrorAtom,
  setAuthUserAtom,
  setBackendSessionAtom,
} from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import { reportFrontendError } from "@/services/feedback/errorReporter";

/**
 * Mount-once bridge from Firebase Auth to authStore. On sign-in it establishes
 * the Go backend httpOnly cookie session when NEXT_PUBLIC_API_BASE_URL is
 * configured. Mounted in GlobalRuntime.
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

      if (!backendAuthConfigured()) {
        store.set(setBackendSessionAtom, false);
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        const result = await ensureBackendGoogleSession(idToken);
        store.set(setBackendSessionAtom, Boolean(result));
        store.set(setAuthErrorAtom, null);
        if (result?.isNewUser) {
          store.set(logAtom, "info", "Welcome - account created");
        }
      } catch (error) {
        store.set(setBackendSessionAtom, false);
        const reported = reportFrontendError(error, {
          title: "Backend login failed",
          logPrefix: "Backend login failed",
        });
        store.set(setAuthErrorAtom, reported.message);
      }
    });

    return unsubscribe;
  }, []);
}
