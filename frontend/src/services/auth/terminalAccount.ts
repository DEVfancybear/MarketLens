import { backendLogout } from "@/services/auth/authClient";
import { signOutUser } from "@/services/auth/firebaseAuth";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import type { AuthUser } from "@/store/authStore";

export function authUserInitials(user: AuthUser | null): string {
  if (!user) return "?";
  const source = user.displayName || user.email || "?";
  const parts = source.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts.at(-1)?.[0] ?? "" : "";
  return `${first}${second}`.toUpperCase();
}

export async function signOutFromTerminal() {
  try {
    try {
      await backendLogout();
    } catch (error) {
      reportFrontendError(error, {
        title: "Backend sign-out failed",
        logPrefix: "Backend sign-out failed",
      });
    }
    await signOutUser();
  } catch (error) {
    reportFrontendError(error, {
      title: "Sign-out failed",
      logPrefix: "Firebase sign-out failed",
    });
  }
}
