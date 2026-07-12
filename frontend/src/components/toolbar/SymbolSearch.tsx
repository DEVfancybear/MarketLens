"use client";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Dropdown } from "@/components/ui/Dropdown";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useMarketSymbols } from "@/store/marketSymbolStore";
import { contractTagOf } from "@/services/exchange";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom, setSymbolAtom } from "@/store/chartStore";
import { cn } from "@/utils/cn";

export function SymbolSearch() {
  const symbol = useAtomValue(symbolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const marketSymbols = useMarketSymbols();
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return marketSymbols;
    return marketSymbols.filter(
      (s) => s.id.toLowerCase().includes(t) || s.name.toLowerCase().includes(t),
    );
  }, [marketSymbols, q]);

  const meta = getMarketSymbol(symbol);

  return (
    <Dropdown
      width={300}
      scrollMode="content"
      trigger={(open) => (
        <button
          className={cn(
            "flex h-9 min-w-[150px] items-center gap-2 rounded-lg border border-terminal-border bg-terminal-input px-2.5 text-ink shadow-[inset_0_1px_0_var(--panel-highlight)] transition-all hover:border-terminal-border-strong hover:bg-terminal-hover",
            open && "border-brand/45 bg-brand-soft",
          )}
        >
          <Search size={14} className="text-ink-muted" />
          <span className="text-[13px] font-bold leading-none tracking-tight text-ink">
            {symbol || "Symbol"}
          </span>
          {meta && (
            <span className="rounded-md border border-terminal-border bg-terminal-panel-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-muted">
              {contractTagOf(meta.assetClass)}
            </span>
          )}
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            {meta?.exchange ?? ""}
          </span>
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[min(70dvh,640px)] flex-col">
          <div className="px-2.5 pb-2 pt-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol…"
              className="h-9 w-full rounded-lg border border-terminal-border bg-terminal-input px-3 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            {results.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSymbol(s.id);
                  setQ("");
                  close();
                }}
                className={cn(
                  "mx-1 flex min-h-9 w-[calc(100%_-_8px)] items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-terminal-hover",
                  s.id === symbol && "bg-brand-soft",
                )}
              >
                <span className="text-xs font-semibold text-ink">{s.id}</span>
                <span className="ml-2 truncate text-2xs text-ink-muted">
                  {s.name}
                </span>
                <span className="ml-auto rounded bg-terminal-hover px-1.5 py-0.5 text-[9px] uppercase text-ink-faint">
                  {s.exchange}
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">
                No matches
              </div>
            )}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
