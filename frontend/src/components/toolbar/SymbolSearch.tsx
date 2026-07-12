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
            "flex h-8 items-center gap-2 rounded px-2 text-ink transition-colors hover:bg-terminal-hover",
            open && "bg-terminal-hover",
          )}
        >
          <Search size={14} className="text-ink-muted" />
          <span className="text-sm font-bold leading-none tracking-tight text-ink">
            {symbol || "Symbol"}
          </span>
          {meta && (
            <span className="rounded bg-terminal-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
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
        <div>
          <div className="px-2 pb-2 pt-1">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol…"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
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
                  "flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-terminal-hover",
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
