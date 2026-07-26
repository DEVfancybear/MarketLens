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
import { JournalPanel } from "@/components/journal/JournalPanel";
import { AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { PineEditor } from "@/components/pine/PineEditor";
import { Activity, BookOpen, Bot, ChartNoAxesCombined, ScrollText, type LucideIcon } from "lucide-react";

const TABS: { key: BottomTab; label: string; icon: LucideIcon }[] = [
  { key: "replay", label: "Replay", icon: Activity },
  { key: "journal", label: "Journal", icon: BookOpen },
  { key: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { key: "pine", label: "Pine Editor", icon: Bot },
  { key: "logs", label: "Logs", icon: ScrollText },
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
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-terminal-border bg-terminal-panel-2/45 px-2.5">
        {visibleTabs.map((t) => {
          const Icon = TABS.find((item) => item.key === t.key)?.icon ?? Activity;
          return (
          <button
            key={t.key}
            onClick={() => setBottomTab(t.key)}
            aria-current={effectiveTab === t.key ? "page" : undefined}
            className={cn(
              "relative flex h-8 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition-colors",
              effectiveTab === t.key
                ? "bg-terminal-raised text-ink shadow-sm"
                : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
            )}
          >
            <Icon size={14} />
            {t.label}
            {effectiveTab === t.key && (
              <span className="absolute -bottom-[9px] left-3 right-3 h-0.5 rounded-t bg-brand" />
            )}
          </button>
        )})}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveTab === "replay" && <ReplayPanel />}
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
