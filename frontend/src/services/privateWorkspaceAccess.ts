import type { AuthStatus } from "@/store/authStore";
import type { BottomTab } from "@/store/uiStore";

export type IndicatorBrowserTab = "favorites" | "myScripts" | "store";

const PUBLIC_BOTTOM_TABS = new Set<BottomTab>(["replay"]);

export function canUsePrivatePineWorkspace(authStatus: AuthStatus): boolean {
  return authStatus === "authed";
}

export function visibleIndicatorBrowserTabs(
  authStatus: AuthStatus,
): IndicatorBrowserTab[] {
  return canUsePrivatePineWorkspace(authStatus)
    ? ["favorites", "myScripts", "store"]
    : ["store"];
}

export function visibleBottomPanelTabs(
  tabs: readonly { key: BottomTab; label: string }[],
  authStatus: AuthStatus,
): { key: BottomTab; label: string }[] {
  if (canUsePrivatePineWorkspace(authStatus)) return [...tabs];
  return tabs.filter((tab) => PUBLIC_BOTTOM_TABS.has(tab.key));
}

export function fallbackBottomTabForAuth(
  tab: BottomTab,
  authStatus: AuthStatus,
): BottomTab {
  if (canUsePrivatePineWorkspace(authStatus)) return tab;
  return PUBLIC_BOTTOM_TABS.has(tab) ? tab : "replay";
}
