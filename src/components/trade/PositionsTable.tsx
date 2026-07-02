"use client";
import {
  positionsAtom,
  closePositionAtom,
  cancelPendingAtom,
  getTradeState,
} from "@/store/tradeStore";
import {
  closeMt5PositionAtom,
  executionModeAtom,
  mt5PendingOrdersAtom,
  mt5PositionsAtom,
} from "@/store/mt5Store";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { makeClientOrderId } from "@/services/mt5/protocol";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { useAtomValue, useSetAtom } from "jotai";
import { cn } from "@/utils/cn";
import { X } from "lucide-react";

/** Open & pending positions with mark-to-market P/L and close controls. */
export function PositionsTable() {
  const positions = useAtomValue(positionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const mt5PendingOrders = useAtomValue(mt5PendingOrdersAtom);
  const closePosition = useSetAtom(closePositionAtom);
  const cancelPending = useSetAtom(cancelPendingAtom);
  const closeMt5Position = useSetAtom(closeMt5PositionAtom);

  const live = positions.filter(
    (p) => p.status === "open" || p.status === "pending",
  );

  if (executionMode === "mt5") {
    const rows = [
      ...mt5Positions.map((position) => ({ kind: "position" as const, position })),
      ...mt5PendingOrders.map((order) => ({ kind: "order" as const, order })),
    ];
    return (
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 bg-terminal-panel text-ink-faint">
            <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-medium">
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th>Volume</th>
              <th>Entry</th>
              <th>Current</th>
              <th>SL</th>
              <th>TP</th>
              <th className="text-right">P/L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-ink-faint">
                  No MT5 positions. Connect the bridge and send a live order from the ticket.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              if (row.kind === "order") {
                const order = row.order;
                const prec = getMarketSymbol(order.symbol)?.pricePrecision ?? 2;
                return (
                  <tr
                    key={`order-${order.ticket}`}
                    className="border-t border-terminal-border [&>td]:px-2 [&>td]:py-1.5"
                  >
                    <td className="font-semibold text-ink">{order.symbol}</td>
                    <td className={order.side === "buy" ? "text-bull" : "text-bear"}>
                      {order.side.toUpperCase()}
                    </td>
                    <td className="capitalize text-ink-muted">{order.type}</td>
                    <td className="tabular">{order.volume.toFixed(4)}</td>
                    <td className="tabular">{fmtPrice(order.price, prec)}</td>
                    <td className="text-ink-faint">pending</td>
                    <td className="tabular text-ink-muted">
                      {order.sl ? fmtPrice(order.sl, prec) : "â€”"}
                    </td>
                    <td className="tabular text-ink-muted">
                      {order.tp ? fmtPrice(order.tp, prec) : "â€”"}
                    </td>
                    <td className="text-right text-ink-faint">â€”</td>
                    <td />
                  </tr>
                );
              }
              const position = row.position;
              const prec = getMarketSymbol(position.symbol)?.pricePrecision ?? 2;
              return (
                <tr
                  key={`pos-${position.ticket}`}
                  className="border-t border-terminal-border [&>td]:px-2 [&>td]:py-1.5"
                >
                  <td className="font-semibold text-ink">{position.symbol}</td>
                  <td>
                    <span
                      style={{
                        color:
                          position.side === "long" ? "var(--bull)" : "var(--bear)",
                      }}
                    >
                      {position.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="text-ink-muted">market</td>
                  <td className="tabular">{position.volume.toFixed(4)}</td>
                  <td className="tabular">{fmtPrice(position.openPrice, prec)}</td>
                  <td className="tabular">{fmtPrice(position.currentPrice, prec)}</td>
                  <td className="tabular text-ink-muted">
                    {position.sl ? fmtPrice(position.sl, prec) : "â€”"}
                  </td>
                  <td className="tabular text-ink-muted">
                    {position.tp ? fmtPrice(position.tp, prec) : "â€”"}
                  </td>
                  <td
                    className="tabular text-right"
                    style={{
                      color: position.profit >= 0 ? "var(--bull)" : "var(--bear)",
                    }}
                  >
                    {fmtMoney(position.profit)}
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => {
                        if (!window.confirm(`Close MT5 ticket ${position.ticket}?`)) {
                          return;
                        }
                        closeMt5Position({
                          clientOrderId: makeClientOrderId("mt5_close"),
                          ticket: position.ticket,
                        });
                      }}
                      className="rounded bg-terminal-hover px-1.5 py-0.5 text-[9px] text-ink hover:bg-bear hover:text-white"
                    >
                      Ã—
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-2xs">
        <thead className="sticky top-0 bg-terminal-panel text-ink-faint">
          <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-medium">
            <th>Symbol</th>
            <th>Side</th>
            <th>Type</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>SL</th>
            <th>TP</th>
            <th className="text-right">P/L</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {live.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-6 text-center text-ink-faint">
                No open positions. Place an order or press B / S.
              </td>
            </tr>
          )}
          {live.map((p) => {
            const prec = getMarketSymbol(p.symbol)?.pricePrecision ?? 2;
            const pnl = p.status === "open" ? p.unrealizedPnl : 0;
            return (
              <tr
                key={p.id}
                className="border-t border-terminal-border [&>td]:px-2 [&>td]:py-1.5"
              >
                <td className="font-semibold text-ink">{p.symbol}</td>
                <td>
                  <span
                    style={{
                      color: p.side === "long" ? "var(--bull)" : "var(--bear)",
                    }}
                  >
                    {p.side.toUpperCase()}
                  </span>
                </td>
                <td className="capitalize text-ink-muted">{p.type}</td>
                <td className="tabular">{p.remaining.toFixed(4)}</td>
                <td className="tabular">{fmtPrice(p.entry, prec)}</td>
                <td className="tabular text-ink-muted">
                  {p.stopLoss ? fmtPrice(p.stopLoss, prec) : "—"}
                </td>
                <td className="tabular text-ink-muted">
                  {p.takeProfit ? fmtPrice(p.takeProfit, prec) : "—"}
                </td>
                <td
                  className="tabular text-right"
                  style={{ color: pnl >= 0 ? "var(--bull)" : "var(--bear)" }}
                >
                  {p.status === "open" ? fmtMoney(pnl) : "—"}
                </td>
                <td>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] uppercase",
                      p.status === "open"
                        ? "bg-bull/15 text-bull"
                        : "bg-choch/15 text-choch",
                    )}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {p.status === "open" && (
                      <>
                        <button
                          onClick={() =>
                            closePosition({ id: p.id, fraction: 0.5 })
                          }
                          className="rounded bg-terminal-hover px-1.5 py-0.5 text-[9px] text-ink hover:bg-brand hover:text-white"
                          title="Close 50%"
                        >
                          ½
                        </button>
                        <button
                          onClick={() =>
                            closePosition({ id: p.id, fraction: 1 })
                          }
                          className="rounded bg-terminal-hover px-1.5 py-0.5 text-[9px] text-ink hover:bg-bear hover:text-white"
                          title="Close 100%"
                        >
                          ×
                        </button>
                      </>
                    )}
                    {p.status === "pending" && (
                      <button
                        onClick={() => cancelPending(p.id)}
                        title="Cancel"
                      >
                        <X
                          size={12}
                          className="text-ink-faint hover:text-bear"
                        />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {live.some((p) => p.status === "pending") && (
        <div className="px-2 py-1 text-[9px] text-ink-faint">
          Pending orders fill as replay reveals price —{" "}
          {fmtDateTime(getTradeState().time)}
        </div>
      )}
    </div>
  );
}
