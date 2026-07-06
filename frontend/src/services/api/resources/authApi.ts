import { getJson, isBackendApiConfigured, postJson } from "@/services/api/client";
import { isUnauthorizedApiError } from "@/services/api/errors";

export interface BackendUser {
  id: string;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export interface ExchangeResult {
  user: BackendUser;
  isNewUser: boolean;
}

export function backendAuthConfigured(): boolean {
  return isBackendApiConfigured();
}

/** Exchange a Firebase ID token for Go httpOnly access/refresh cookies. */
export async function exchangeGoogleToken(
  idToken: string,
): Promise<ExchangeResult | null> {
  if (!backendAuthConfigured()) return null;
  return postJson<ExchangeResult>("auth/google", { idToken });
}

/** Current backend user, or null when there is no valid backend session. */
export async function backendMe(): Promise<BackendUser | null> {
  if (!backendAuthConfigured()) return null;
  try {
    return await getJson<BackendUser>("auth/me");
  } catch (error) {
    if (isUnauthorizedApiError(error)) return null;
    throw error;
  }
}

/** Rotate backend cookies using the refresh cookie. */
export async function backendRefresh(): Promise<boolean> {
  if (!backendAuthConfigured()) return false;
  try {
    await postJson<{ ok: true }>("auth/refresh");
    return true;
  } catch (error) {
    if (isUnauthorizedApiError(error)) return false;
    throw error;
  }
}

/** Revoke the current backend session and clear backend auth cookies. */
export async function backendLogout(): Promise<void> {
  if (!backendAuthConfigured()) return;
  try {
    await postJson<{ ok: true }>("auth/logout");
  } catch (error) {
    if (isUnauthorizedApiError(error)) return;
    throw error;
  }
}

/**
 * Ensure the browser has a usable backend session for the current Firebase
 * identity. Existing cookies are preferred, then refresh, then Firebase token
 * exchange. This avoids creating a new backend session on every app reload.
 */
export async function ensureBackendGoogleSession(
  idToken: string,
): Promise<ExchangeResult | null> {
  if (!backendAuthConfigured()) return null;

  const existing = await backendMe();
  if (existing) return { user: existing, isNewUser: false };

  if (await backendRefresh()) {
    const refreshed = await backendMe();
    if (refreshed) return { user: refreshed, isNewUser: false };
  }

  return exchangeGoogleToken(idToken);
}
