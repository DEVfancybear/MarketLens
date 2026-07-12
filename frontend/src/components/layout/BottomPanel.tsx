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
      <div className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-terminal-border bg-terminal-panel-2/35 px-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Terminal panels">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={effectiveTab === t.key}
            onClick={() => setBottomTab(t.key)}
            className={cn(
              "relative h-8 shrink-0 rounded-lg border px-3 text-[11px] font-semibold transition-all",
              effectiveTab === t.key
                ? "border-terminal-border-strong bg-terminal-elevated text-ink shadow-[0_3px_10px_var(--shadow-color)]"
                : "border-transparent text-ink-muted hover:bg-terminal-hover hover:text-ink",
            )}
          >
            {t.label}
            {effectiveTab === t.key && <span aria-hidden="true" className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-brand" />}
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
