"use client";
import {
  positionsAtom,
  closePositionAtom,
  cancelPendingAtom,
  getTradeState,
} from "@/store/tradeStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { useAtomValue, useSetAtom } from "jotai";
import { cn } from "@/utils/cn";
import { X } from "lucide-react";

/** Open & pending positions with mark-to-market P/L and close controls. */
export function PositionsTable() {
  const positions = useAtomValue(positionsAtom);
  const closePosition = useSetAtom(closePositionAtom);
  const cancelPending = useSetAtom(cancelPendingAtom);

  const live = positions.filter(
    (p) => p.status === "open" || p.status === "pending",
  );

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
