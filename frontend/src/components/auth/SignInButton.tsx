"use client";
import { Loader2 } from "lucide-react";
import { useSetAtom } from "jotai";
import { signInWithGoogle, authConfigured } from "@/services/auth/firebaseAuth";
import { setAuthStatusAtom, setAuthErrorAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import { GoogleIcon } from "./GoogleIcon";

/** "Sign in with Google" button. First sign-in also registers the account. */
export function SignInButton({ busy = false }: { busy?: boolean }) {
  const setStatus = useSetAtom(setAuthStatusAtom);
  const setError = useSetAtom(setAuthErrorAtom);
  const doLog = useSetAtom(logAtom);

  const onClick = async () => {
    if (busy) return;
    if (!authConfigured()) {
      setError("Firebase auth not configured");
      doLog(
        "error",
        "Google sign-in unavailable — set NEXT_PUBLIC_FIREBASE_* env vars",
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

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex h-7 items-center gap-2 rounded px-2.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink disabled:opacity-60"
      title="Sign in with Google"
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <GoogleIcon size={14} />
      )}
      <span>{busy ? "Signing in…" : "Sign in"}</span>
    </button>
  );
}
