"use client";
import { Loader2 } from "lucide-react";
import { useSetAtom } from "jotai";
import { authConfigStatus, signInWithGoogle } from "@/services/auth/firebaseAuth";
import { setAuthErrorAtom, setAuthStatusAtom } from "@/store/authStore";
import { reportFrontendError } from "@/services/feedback/errorReporter";
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
      reportFrontendError(new Error(message), {
        title: "Sign-in unavailable",
        logPrefix: "Google sign-in config",
      });
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

      const reported = reportFrontendError(err, {
        title: "Google sign-in failed",
        logPrefix: "Google sign-in failed",
      });
      setStatus("anonymous");
      setError(reported.message);
    }
  };

  const label = busy ? "Signing in..." : error ? "Sign-in failed" : "Sign in";

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
