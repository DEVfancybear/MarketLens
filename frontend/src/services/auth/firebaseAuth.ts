"use client";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getFirebaseApp,
  getFirebaseAuthConfigStatus,
} from "@/services/firebase/client";
import type { AuthUser } from "@/store/authStore";

/** Firebase Auth wrapper — Google sign-in / sign-up (register == first sign-in). */

export function authConfigStatus() {
  return getFirebaseAuthConfigStatus();
}

export function authConfigured(): boolean {
  return authConfigStatus().configured;
}

function authInstance(): Auth {
  return getAuth(getFirebaseApp());
}

export function mapUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoURL,
  };
}

/**
 * Opens the Google account chooser and signs the user in. On first sign-in
 * Firebase auto-creates the account (this is also "register"). Throws on
 * failure; the caller maps popup-closed / config errors to UI state.
 */
export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithPopup(authInstance(), provider);
}

export async function signOutUser(): Promise<void> {
  await signOut(authInstance());
}

/**
 * Subscribe to auth state. Fires once immediately (with the current user or
 * null), then on every sign-in/out. If Firebase auth isn't configured, reports
 * `null` once so the app resolves to the anonymous state instead of hanging on
 * "loading".
 */
export function subscribeAuth(
  onChange: (user: AuthUser | null, firebaseUser: User | null) => void,
): () => void {
  if (!authConfigured()) {
    onChange(null, null);
    return () => {};
  }
  return onAuthStateChanged(authInstance(), (user) =>
    onChange(mapUser(user), user),
  );
}

/** Fresh Firebase ID token for the current user, or null when signed out. */
export async function currentIdToken(): Promise<string | null> {
  if (!authConfigured()) return null;
  const user = authInstance().currentUser;
  return user ? user.getIdToken() : null;
}
