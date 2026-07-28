"use client";
import { KeyRound, LogOut } from "lucide-react";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import type { AuthUser } from "@/store/authStore";
import { authUserInitials, signOutFromTerminal } from "@/services/auth/terminalAccount";
import { openTradeSecuritySettings } from "@/services/security/tradePassword";

/** Avatar dropdown shown when signed in: identity + sign out. */
export function UserMenu({ user }: { user: AuthUser }) {
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
        authUserInitials(user)
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
              openTradeSecuritySettings();
            }}
          >
            <KeyRound size={13} />
            Trade security
          </MenuItem>
          <MenuItem
            onClick={() => {
              close();
              void signOutFromTerminal();
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
