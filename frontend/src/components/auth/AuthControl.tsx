"use client";
import { useAtomValue } from "jotai";
import { authErrorAtom, authStatusAtom, authUserAtom } from "@/store/authStore";
import { SignInButton } from "./SignInButton";
import { UserMenu } from "./UserMenu";

/**
 * Toolbar auth widget. Renders the Google sign-in button when anonymous and the
 * account menu when signed in. Subscribes only to the two auth atoms, so it does
 * not re-render on unrelated store changes.
 */
export function AuthControl() {
  const status = useAtomValue(authStatusAtom);
  const user = useAtomValue(authUserAtom);
  const error = useAtomValue(authErrorAtom);

  if (status === "authed" && user) return <UserMenu user={user} />;
  // While Firebase reports the initial state, render nothing to avoid a flash of
  // the sign-in button for already-signed-in users.
  if (status === "loading") return null;
  return <SignInButton busy={status === "authenticating"} error={error} />;
}
