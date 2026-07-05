"use client";

/**
 * Backend session client (contract: `backend/docs/API.md` §Auth).
 *
 * These calls are **best-effort**. The backend auth endpoints are not built yet;
 * until `NEXT_PUBLIC_API_BASE_URL` points at a running Go API, every call
 * resolves to `null`/no-op so the Firebase-driven client auth keeps working.
 * Wire-compatible with the designed backend, so it "just works" once that ships.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

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

async function api(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (!API_BASE) return null; // backend not configured yet
  try {
    return await fetch(`${API_BASE}${path}`, {
      credentials: "include", // send/receive httpOnly session cookies
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    return null; // backend unreachable — stay client-only
  }
}

/** Exchange a Firebase ID token for a backend session (login or register). */
export async function exchangeGoogleToken(
  idToken: string,
): Promise<ExchangeResult | null> {
  const res = await api("/api/v1/auth/google", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as ExchangeResult;
  } catch {
    return null;
  }
}

/** Revoke the current backend session (clears its httpOnly cookies). */
export async function backendLogout(): Promise<void> {
  await api("/api/v1/auth/logout", { method: "POST" });
}

/** Current backend user, or null when there is no valid backend session. */
export async function backendMe(): Promise<BackendUser | null> {
  const res = await api("/api/v1/auth/me");
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as BackendUser;
  } catch {
    return null;
  }
}
