"use client";

import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Check, ChevronDown, Search } from "lucide-react";
import { symbolAtom, setSymbolAtom } from "@/store/chartStore";
import { useMarketSymbols } from "@/store/marketSymbolStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { contractTagOf } from "@/services/exchange";
import { MobileSheet } from "./MobileSheet";

export function MobileSymbolPicker() {
  const symbol = useAtomValue(symbolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const symbols = useMarketSymbols();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const meta = getMarketSymbol(symbol);
  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? symbols.filter((item) => item.id.toLowerCase().includes(value) || item.name.toLowerCase().includes(value)) : symbols;
  }, [query, symbols]);

  return (
    <>
      <button type="button" className="mobile-symbol-trigger" onClick={() => setOpen(true)} aria-expanded={open}>
        <span><strong>{symbol || "Market"}</strong><small>{meta ? contractTagOf(meta.assetClass) : ""}</small></span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <MobileSheet title="Select market" onClose={() => setOpen(false)} fullscreen>
          <div className="mobile-picker-search"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol or market" inputMode="search" /></div>
          <div className="mobile-symbol-list">
            {results.map((item) => (
              <button key={item.id} type="button" onClick={() => { setSymbol(item.id); setOpen(false); setQuery(""); }}>
                <span className="mobile-symbol-avatar">{item.id.slice(0, 2)}</span>
                <span className="mobile-symbol-copy"><strong>{item.id}</strong><small>{item.name} · {item.exchange}</small></span>
                {item.id === symbol && <Check size={18} className="text-brand" />}
              </button>
            ))}
          </div>
        </MobileSheet>
      )}
    </>
  );
}
