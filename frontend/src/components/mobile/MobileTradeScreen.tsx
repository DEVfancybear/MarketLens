"use client";

import { useState } from "react";
import { useAtomValue } from "jotai";
import { OrderTicket } from "@/components/trade/OrderTicket";
import { positionsAtom, equityAtom } from "@/store/tradeStore";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { Position } from "@/types";

export function MobileTradeScreen() {
  const [tab, setTab] = useState<"ticket" | "positions">("ticket");
  const positions = useAtomValue(positionsAtom);
  const equity = useAtomValue(equityAtom);
  const open = positions.filter((item) => item.status === "open" || item.status === "pending");
  const pnl = open.reduce((sum, item) => sum + item.unrealizedPnl, 0);
  return <section className="mobile-screen mobile-trade-screen">
    <header className="mobile-screen-header"><div><small>EXECUTION</small><h1>Trade desk</h1></div><div className="mobile-equity"><small>Equity</small><strong>{fmtMoney(equity)}</strong></div></header>
    <div className="mobile-kpi-row"><div><small>Open positions</small><strong>{open.length}</strong></div><div><small>Open P/L</small><strong className={pnl >= 0 ? "text-bull" : "text-bear"}>{fmtMoney(pnl)}</strong></div></div>
    <div className="mobile-segmented"><button type="button" onClick={() => setTab("ticket")} className={cn(tab === "ticket" && "is-active")}>Order ticket</button><button type="button" onClick={() => setTab("positions")} className={cn(tab === "positions" && "is-active")}>Positions</button></div>
    <div className="mobile-trade-content">{tab === "ticket" ? <OrderTicket variant="mobile" /> : <MobilePositionList positions={open} />}</div>
  </section>;
}

function MobilePositionList({ positions }: { positions: Position[] }) {
  if (!positions.length) return <div className="mobile-empty-state"><strong>No open positions</strong><span>Place an order from the ticket to start tracking risk and P/L.</span></div>;
  return <div className="mobile-position-list">{positions.map((position) => <article key={position.id}>
    <div><span className={cn("mobile-side", position.side === "long" ? "is-long" : "is-short")}>{position.side}</span><strong>{position.symbol}</strong><small>{position.type}</small></div>
    <div><small>Entry</small><strong>{fmtPrice(position.entry, 5)}</strong></div>
    <div><small>Size</small><strong>{position.remaining.toFixed(2)}</strong></div>
    <div><small>P/L</small><strong className={position.unrealizedPnl >= 0 ? "text-bull" : "text-bear"}>{fmtMoney(position.unrealizedPnl)}</strong></div>
  </article>)}</div>;
}
