"use client";
import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  bottomTabAtom,
  setBottomTabAtom,
  logsAtom,
  type BottomTab,
} from "@/store/uiStore";
import { authStatusAtom } from "@/store/authStore";
import {
  fallbackBottomTabForAuth,
  visibleBottomPanelTabs,
} from "@/services/privateWorkspaceAccess";
import { cn } from "@/utils/cn";
import { fmtDateTime } from "@/utils/time";
import { ReplayPanel } from "@/components/replay/ReplayPanel";
import { TradePanel } from "@/components/trade/TradePanel";
import { JournalPanel } from "@/components/journal/JournalPanel";
import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { PineEditor } from "@/components/pine/PineEditor";

const TABS: { key: BottomTab; label: string }[] = [
  { key: "replay", label: "Replay" },
  { key: "trade", label: "Trade" },
  { key: "journal", label: "Journal" },
  { key: "analytics", label: "Analytics" },
  { key: "pine", label: "Pine Editor" },
  { key: "logs", label: "Logs" },
];

/**
 * TradingView-style bottom panel tab strip. Flat tabs with an accent underline
 * on the active tab — no background fill, no rounded pills. Compact 32px bar.
 */
export function BottomPanel() {
  const bottomTab = useAtomValue(bottomTabAtom);
  const authStatus = useAtomValue(authStatusAtom);
  const setRawBottomTab = useSetAtom(bottomTabAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const visibleTabs = visibleBottomPanelTabs(TABS, authStatus);
  const effectiveTab = fallbackBottomTabForAuth(bottomTab, authStatus);

  useEffect(() => {
    if (effectiveTab !== bottomTab) {
      setRawBottomTab(effectiveTab);
    }
  }, [bottomTab, effectiveTab, setRawBottomTab]);

  return (
    <div className="flex h-full flex-col">
      {/* Tab strip */}
      <div className="flex h-8 shrink-0 items-end border-b border-terminal-border px-2">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setBottomTab(t.key)}
            className={cn(
              "relative px-3 pb-1.5 pt-1 text-2xs font-medium transition-colors",
              effectiveTab === t.key
                ? "text-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
            {effectiveTab === t.key && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-t bg-brand" />
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveTab === "replay" && <ReplayPanel />}
        {effectiveTab === "trade" && <TradePanel />}
        {effectiveTab === "journal" && <JournalPanel />}
        {effectiveTab === "analytics" && <AnalyticsPanel />}
        {effectiveTab === "pine" && <PineEditor />}
        {effectiveTab === "logs" && <LogsView />}
      </div>
    </div>
  );
}

function LogsView() {
  const logs = useAtomValue(logsAtom);
  return (
    <div className="h-full overflow-auto p-2 font-mono text-2xs">
      {logs.length === 0 && (
        <div className="p-3 text-ink-faint">No events yet.</div>
      )}
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2 py-0.5">
          <span className="text-ink-faint">{fmtDateTime(l.time)}</span>
          <span
            className={cn(
              "uppercase",
              l.level === "error" && "text-bear",
              l.level === "warn" && "text-choch",
              l.level === "info" && "text-ink-muted",
            )}
          >
            {l.level}
          </span>
          <span className="text-ink">{l.msg}</span>
        </div>
      ))}
    </div>
  );
}
