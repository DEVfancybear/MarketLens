"use client";

import { useAtomValue } from "jotai";
import { Activity, Target, TrendingUp } from "lucide-react";
import { equityAtom, positionsAtom, startingEquityAtom } from "@/store/tradeStore";
import { fmtMoney } from "@/utils/format";

export function MobilePortfolioScreen() {
  const equity = useAtomValue(equityAtom);
  const starting = useAtomValue(startingEquityAtom);
  const positions = useAtomValue(positionsAtom);
  const closed = positions.filter((item) => item.status === "closed");
  const wins = closed.filter((item) => item.realizedPnl > 0).length;
  const change = starting ? ((equity - starting) / starting) * 100 : 0;
  return <section className="mobile-screen">
    <header className="mobile-screen-header"><div><small>PORTFOLIO</small><h1>Performance</h1></div></header>
    <div className="mobile-balance-card"><small>Net equity</small><strong>{fmtMoney(equity)}</strong><span className={change >= 0 ? "text-bull" : "text-bear"}>{change >= 0 ? "+" : ""}{change.toFixed(2)}% all time</span></div>
    <div className="mobile-metric-grid"><Metric icon={<Activity />} label="Trades" value={String(closed.length)} /><Metric icon={<Target />} label="Win rate" value={closed.length ? `${((wins / closed.length) * 100).toFixed(0)}%` : "—"} /><Metric icon={<TrendingUp />} label="Realized" value={fmtMoney(closed.reduce((sum, item) => sum + item.realizedPnl, 0))} /></div>
    <div className="mobile-section-title"><h2>Recent activity</h2><span>{closed.length} closed</span></div>
    {closed.length === 0 ? <div className="mobile-empty-state"><strong>No completed trades yet</strong><span>Your execution history and performance insights will appear here.</span></div> : <div className="mobile-position-list">{closed.slice(0, 12).map((item) => <article key={item.id}><div><strong>{item.symbol}</strong><small>{item.side}</small></div><div><small>Realized P/L</small><strong className={item.realizedPnl >= 0 ? "text-bull" : "text-bear"}>{fmtMoney(item.realizedPnl)}</strong></div></article>)}</div>}
  </section>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="mobile-metric"><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>; }
