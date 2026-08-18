"use client";

import { useAtom, useAtomValue } from "jotai";
import { ListTree, Star, PanelRight } from "lucide-react";
import { rightPanelTabAtom } from "@/store/uiStore";
import { drawingsAtom } from "@/store/chartStore";
import { Watchlist } from "@/components/watchlist/Watchlist";
import { ObjectTreePanel } from "@/components/chart/drawing/objectTree/ObjectTreePanel";
import { cn } from "@/utils/cn";

export function RightSidebar() {
  const [tab, setTab] = useAtom(rightPanelTabAtom);
  const drawingCount = useAtomValue(drawingsAtom).length;
  return (
    <section className="flex h-full min-h-0 flex-col bg-terminal-panel">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-terminal-border px-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand"><PanelRight size={16} /></div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold leading-4 tracking-[-0.02em] text-ink">Market desk</h2>
          <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-ink-faint">Realtime monitor</p>
        </div>
      </header>
      <div className="m-2 flex h-9 shrink-0 rounded-lg bg-terminal-panel-2 p-1">
        <Tab active={tab === "watchlist"} label="Watchlist" onClick={() => setTab("watchlist")}><Star size={13} /></Tab>
        <Tab active={tab === "objects"} label={`Object Tree (${drawingCount})`} onClick={() => setTab("objects")}><ListTree size={14} /></Tab>
      </div>
      <div className="min-h-0 flex-1">{tab === "watchlist" ? <Watchlist /> : <ObjectTreePanel />}</div>
    </section>
  );
}

function Tab({ active, label, children, onClick }: { active: boolean; label: string; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick} className={cn("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold text-ink-muted transition-colors", active ? "bg-terminal-raised text-ink shadow-xs" : "hover:bg-terminal-hover hover:text-ink")}>{children}<span>{label.replace(/ \(\d+\)$/, "")}</span></button>;
}
