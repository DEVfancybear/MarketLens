"use client";

import { useAtom, useAtomValue } from "jotai";
import { ListTree, Star } from "lucide-react";
import { rightPanelTabAtom } from "@/store/uiStore";
import { drawingsAtom } from "@/store/chartStore";
import { Watchlist } from "@/components/watchlist/Watchlist";
import { ObjectTreePanel } from "@/components/chart/drawing/objectTree/ObjectTreePanel";
import { cn } from "@/utils/cn";

export function RightSidebar() {
  const [tab, setTab] = useAtom(rightPanelTabAtom);
  const drawingCount = useAtomValue(drawingsAtom).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 gap-1 border-b border-terminal-border bg-terminal-panel-2/35 p-1.5" role="tablist" aria-label="Right panel">
        <Tab active={tab === "watchlist"} label="Watchlist" onClick={() => setTab("watchlist")}><Star size={13} /></Tab>
        <Tab active={tab === "objects"} label={`Object Tree (${drawingCount})`} onClick={() => setTab("objects")}><ListTree size={14} /></Tab>
      </div>
      <div className="min-h-0 flex-1">{tab === "watchlist" ? <Watchlist /> : <ObjectTreePanel />}</div>
    </div>
  );
}

function Tab({ active, label, children, onClick }: { active: boolean; label: string; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} aria-label={label} title={label} onClick={onClick} className={cn("flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-semibold text-ink-muted transition-all", active ? "border-terminal-border-strong bg-terminal-elevated text-ink shadow-[0_4px_14px_var(--shadow-color)]" : "border-transparent hover:bg-terminal-hover hover:text-ink")}>{children}<span>{label.replace(/ \(\d+\)$/, "")}</span></button>;
}
