"use client";
import { LogOut } from "lucide-react";
import { useSetAtom } from "jotai";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { signOutUser } from "@/services/auth/firebaseAuth";
import { backendLogout } from "@/services/auth/authClient";
import { logAtom } from "@/store/uiStore";
import type { AuthUser } from "@/store/authStore";

function initials(user: AuthUser): string {
  const src = user.displayName || user.email || "?";
  const parts = src.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + second).toUpperCase();
}

/** Avatar dropdown shown when signed in: identity + sign out. */
export function UserMenu({ user }: { user: AuthUser }) {
  const doLog = useSetAtom(logAtom);

  const handleSignOut = async () => {
    try {
      try {
        await backendLogout(); // best-effort backend session revoke
      } catch (err) {
        doLog("error", `Backend sign-out failed: ${(err as Error)?.message ?? ""}`);
      }
      await signOutUser(); // Firebase sign-out (useAuthSession clears state)
    } catch (err) {
      doLog("error", `Sign-out failed: ${(err as Error)?.message ?? ""}`);
    }
  };

  const avatar = (
    <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-brand/20 text-[10px] font-semibold text-brand">
      {user.photoUrl ? (
        <img
          src={user.photoUrl}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        initials(user)
      )}
    </span>
  );

  return (
    <Dropdown
      align="right"
      width={220}
      trigger={() => (
        <button
          className="flex h-7 items-center gap-1.5 rounded px-1.5 text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
          title={user.email ?? user.displayName ?? "Account"}
          aria-label="Account menu"
        >
          {avatar}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            {avatar}
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-ink">
                {user.displayName ?? "Signed in"}
              </div>
              {user.email && (
                <div className="truncate text-[10px] text-ink-muted">
                  {user.email}
                </div>
              )}
            </div>
          </div>
          <div className="my-1 h-px bg-terminal-border" />
          <MenuItem
            onClick={() => {
              close();
              void handleSignOut();
            }}
          >
            <LogOut size={13} />
            Sign out
          </MenuItem>
        </div>
      )}
    </Dropdown>
  );
}
