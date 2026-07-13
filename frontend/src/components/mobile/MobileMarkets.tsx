"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { ChevronRight, Search, Star } from "lucide-react";
import { activeWatchlistAtom } from "@/store/watchlistStore";
import { quotesAtom } from "@/store/marketDataStore";
import { setSymbolAtom, symbolAtom } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice } from "@/utils/format";
import { cn } from "@/utils/cn";

export function MobileMarkets({ onOpenChart }: { onOpenChart: () => void }) {
  const list = useAtomValue(activeWatchlistAtom);
  const quotes = useAtomValue(quotesAtom);
  const active = useAtomValue(symbolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const symbols = list.symbols.length ? list.symbols : ["EURUSD", "GBPUSD", "XAUUSD", "BTCUSD"];
  return (
    <section className="mobile-screen">
      <header className="mobile-screen-header"><div><small>MARKETS</small><h1>{list.name}</h1></div><button type="button" className="mobile-icon-button" aria-label="Search markets"><Search size={20} /></button></header>
      <div className="mobile-market-summary"><Star size={16} /><span>{symbols.length} instruments</span><span className="ml-auto text-bull">Live</span></div>
      <div className="mobile-market-list">
        {symbols.map((ticker) => {
          const quote = quotes[ticker];
          const meta = getMarketSymbol(ticker);
          const positive = (quote?.changePct ?? 0) >= 0;
          return <button type="button" key={ticker} className={cn(active === ticker && "is-active")} onClick={() => { setSymbol(ticker); onOpenChart(); }}>
            <span className="mobile-symbol-avatar">{ticker.slice(0, 2)}</span>
            <span className="mobile-symbol-copy"><strong>{ticker}</strong><small>{meta?.name ?? meta?.exchange ?? "Market"}</small></span>
            <span className="mobile-quote"><strong>{quote ? fmtPrice(quote.last, meta?.pricePrecision ?? 2) : "—"}</strong><small className={positive ? "text-bull" : "text-bear"}>{quote ? `${positive ? "+" : ""}${quote.changePct.toFixed(2)}%` : "Waiting"}</small></span>
            <ChevronRight size={17} className="text-ink-faint" />
          </button>;
        })}
      </div>
    </section>
  );
}
