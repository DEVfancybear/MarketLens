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
      trigger={(open) => (
        <button
          className={cn(
            "flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-ink transition-colors hover:bg-terminal-hover",
            open && "bg-brand/10 text-brand",
          )}
        >
          <Search size={14} className="shrink-0 text-ink-muted" />
          <span className="max-w-24 truncate text-[13px] font-bold leading-none tracking-[-0.02em] text-ink 2xl:max-w-32">
            {symbol || "Symbol"}
          </span>
          {meta && (
            <span className="hidden rounded-md border border-terminal-border bg-terminal-panel-3 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-muted 2xl:inline-flex">
              {contractTagOf(meta.assetClass)}
            </span>
          )}
          <span className="hidden text-[10px] font-medium uppercase tracking-wide text-ink-faint 2xl:inline">
            {meta?.exchange ?? ""}
          </span>
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="border-b border-terminal-border px-2.5 pb-2.5 pt-1">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol…"
              className="h-9 w-full rounded-lg border border-terminal-border-strong bg-terminal-panel px-3 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
          <div className="max-h-72 overflow-auto">
            {results.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSymbol(s.id);
                  setQ("");
                  close();
                }}
                className={cn(
                  "flex min-h-10 w-full items-center justify-between px-3 text-left transition-colors hover:bg-terminal-hover",
                  s.id === symbol && "bg-brand/10",
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
