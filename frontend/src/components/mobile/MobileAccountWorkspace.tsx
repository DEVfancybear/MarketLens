"use client";

import { useAtomValue } from "jotai";
import { Cloud, CloudOff, LogOut, ShieldCheck, UserRound } from "lucide-react";
import {
  authErrorAtom,
  authStatusAtom,
  authUserAtom,
  backendSessionAtom,
} from "@/store/authStore";
import { SignInButton } from "@/components/auth/SignInButton";
import { authUserInitials, signOutFromTerminal } from "@/services/auth/terminalAccount";

export function MobileAccountAvatar() {
  const user = useAtomValue(authUserAtom);
  if (user?.photoUrl) return <img src={user.photoUrl} alt="" referrerPolicy="no-referrer" />;
  return <span>{authUserInitials(user)}</span>;
}

export function MobileAccountWorkspace() {
  const status = useAtomValue(authStatusAtom);
  const user = useAtomValue(authUserAtom);
  const error = useAtomValue(authErrorAtom);
  const backendSession = useAtomValue(backendSessionAtom);

  if (status !== "authed" || !user) {
    return (
      <div className="mobile-account-workspace mobile-account-workspace--anonymous">
        <span className="mobile-account-hero"><UserRound size={28} /></span>
        <h3>Sign in to your workspace</h3>
        <p>Sync layouts, drawings, indicators, watchlists and private Pine scripts across desktop and mobile.</p>
        <div className="mobile-auth-control"><SignInButton busy={status === "authenticating"} error={error} /></div>
        {error && <p className="mobile-auth-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mobile-account-workspace">
      <div className="mobile-account-profile">
        <span className="mobile-account-photo">{user.photoUrl ? <img src={user.photoUrl} alt="" referrerPolicy="no-referrer" /> : authUserInitials(user)}</span>
        <span><strong>{user.displayName ?? "Signed in"}</strong><small>{user.email}</small></span>
      </div>
      <div className="mobile-account-state">
        <span>{backendSession ? <Cloud size={20} /> : <CloudOff size={20} />}</span>
        <span><strong>{backendSession ? "Cloud workspace connected" : "Local workspace mode"}</strong><small>{backendSession ? "Private resources are synchronized with the backend." : "Firebase is signed in, but the backend session is unavailable."}</small></span>
      </div>
      <div className="mobile-account-state">
        <span><ShieldCheck size={20} /></span>
        <span><strong>Account security</strong><small>Authentication is managed by Google and Firebase.</small></span>
      </div>
      <button type="button" className="mobile-sign-out" onClick={() => void signOutFromTerminal()}><LogOut size={18} />Sign out</button>
    </div>
  );
}
