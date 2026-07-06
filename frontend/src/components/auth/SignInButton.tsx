"use client";
import { Loader2 } from "lucide-react";
import { useSetAtom } from "jotai";
import { authConfigStatus, signInWithGoogle } from "@/services/auth/firebaseAuth";
import { setAuthErrorAtom, setAuthStatusAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import { GoogleIcon } from "./GoogleIcon";

/** "Sign in with Google" button. First sign-in also registers the account. */
export function SignInButton({
  busy = false,
  error = null,
}: {
  busy?: boolean;
  error?: string | null;
}) {
  const setStatus = useSetAtom(setAuthStatusAtom);
  const setError = useSetAtom(setAuthErrorAtom);
  const doLog = useSetAtom(logAtom);

  const onClick = async () => {
    if (busy) return;

    const config = authConfigStatus();
    if (!config.configured) {
      const missing = config.missing.join(", ");
      const message = missing
        ? `Firebase auth config missing: ${missing}`
        : "Firebase auth not configured";
      setError(message);
      setStatus("anonymous");
      doLog(
        "error",
        `${message}. Set NEXT_PUBLIC_FIREBASE_* in frontend/.env.local or repo root .env.local.`,
      );
      return;
    }

    setError(null);
    setStatus("authenticating");
    try {
      await signInWithGoogle();
      // onAuthStateChanged (useAuthSession) flips status to "authed".
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      // User dismissing the popup is not an error worth surfacing.
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        setStatus("anonymous");
        return;
      }

      const msg = (err as Error)?.message ?? "Sign-in failed";
      setStatus("anonymous");
      setError(msg);
      doLog("error", `Google sign-in failed: ${msg}`);
    }
  };

  const label = busy ? "Signing in..." : error ? "Auth error" : "Sign in";

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex h-7 items-center gap-2 rounded px-2.5 text-[11px] font-medium transition-colors hover:bg-terminal-hover disabled:opacity-60 ${
        error ? "text-bear hover:text-bear" : "text-ink-muted hover:text-ink"
      }`}
      title={error ?? "Sign in with Google"}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <GoogleIcon size={14} />
      )}
      <span>{label}</span>
    </button>
  );
}
