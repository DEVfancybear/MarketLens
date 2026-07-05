"use client";
import { atom, getDefaultStore, useAtomValue } from "jotai";

/**
 * Authentication state (Google sign-in / sign-up).
 *
 * Source of truth for the *signed-in identity* is Firebase Auth on the client
 * (see `services/auth/firebaseAuth.ts`). The backend session exchange
 * (`services/auth/authClient.ts`) is best-effort and, when it succeeds, flips
 * `backendSession` — the app stays fully usable whether or not the backend is up.
 */

export type AuthStatus =
  | "loading" // initial — Firebase hasn't reported yet
  | "anonymous" // signed out
  | "authenticating" // Google popup in flight
  | "authed"; // signed in

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
}

// ── State atoms ────────────────────────────────────────────────────────────
export const authUserAtom = atom<AuthUser | null>(null);
export const authStatusAtom = atom<AuthStatus>("loading");
export const authErrorAtom = atom<string | null>(null);
/** True once the backend `/auth/google` exchange has established a session. */
export const backendSessionAtom = atom<boolean>(false);

// ── Write atoms (actions) ──────────────────────────────────────────────────
export const setAuthUserAtom = atom(null, (_get, set, user: AuthUser | null) => {
  set(authUserAtom, user);
  set(authStatusAtom, user ? "authed" : "anonymous");
  if (user) set(authErrorAtom, null);
  else set(backendSessionAtom, false);
});

export const setAuthStatusAtom = atom(null, (_get, set, status: AuthStatus) => {
  set(authStatusAtom, status);
});

export const setAuthErrorAtom = atom(null, (_get, set, error: string | null) => {
  set(authErrorAtom, error);
});

export const setBackendSessionAtom = atom(null, (_get, set, ok: boolean) => {
  set(backendSessionAtom, ok);
});

// ── Combined state (compatibility hook) ────────────────────────────────────
interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
  backendSession: boolean;
}

const authCombinedAtom = atom<AuthState>((get) => ({
  user: get(authUserAtom),
  status: get(authStatusAtom),
  error: get(authErrorAtom),
  backendSession: get(backendSessionAtom),
}));

export function useAuthStore(): AuthState;
export function useAuthStore<T>(selector: (state: AuthState) => T): T;
export function useAuthStore<T>(
  selector?: (state: AuthState) => T,
): AuthState | T {
  const combined = useAtomValue(authCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

export function getAuthState(): AuthState {
  return getDefaultStore().get(authCombinedAtom);
}
