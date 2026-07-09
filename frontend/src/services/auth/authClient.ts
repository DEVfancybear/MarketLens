"use client";

import { currentIdToken } from "@/services/auth/firebaseAuth";
import {
  backendAuthConfigured,
  ensureBackendGoogleSession,
} from "@/services/api/resources/authApi";

export type {
  BackendUser,
  ExchangeResult,
} from "@/services/api/resources/authApi";
export {
  backendLogout,
  backendMe,
  backendRefresh,
  exchangeGoogleToken,
} from "@/services/api/resources/authApi";

export { backendAuthConfigured, ensureBackendGoogleSession };

export async function ensureCurrentBackendSession(): Promise<boolean> {
  if (!backendAuthConfigured()) return false;
  const idToken = await currentIdToken();
  if (!idToken) return false;
  return Boolean(await ensureBackendGoogleSession(idToken));
}
