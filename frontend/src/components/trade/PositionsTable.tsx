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
import { Ban, Pencil, X } from "lucide-react";
import { useReplayTrading } from "@/store/replayTradingClientStore";
import { usePlatformDialog } from "@/components/ui/PlatformDialog";

/** Open & pending positions with mark-to-market P/L and close controls. */
export function PositionsTable() {
  const positions = useAtomValue(positionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const mt5PendingOrders = useAtomValue(mt5PendingOrdersAtom);
  const closePosition = useSetAtom(closePositionAtom);
  const cancelPending = useSetAtom(cancelPendingAtom);
  const closeMt5Position = useSetAtom(closeMt5PositionAtom);
  const replayTrading = useReplayTrading();
  const { requestPrompt, requestConfirm, dialog } = usePlatformDialog();

  const live = positions.filter(
    (p) => p.status === "open" || p.status === "pending",
  );

  if (executionMode === "mt5") {
    const rows = [
      ...mt5Positions.map((position) => ({ kind: "position" as const, position })),
      ...mt5PendingOrders.map((order) => ({ kind: "order" as const, order })),
    ];
    return (
      <>
      <div className="min-w-0 flex-1 overflow-auto bg-terminal-panel">
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 bg-terminal-panel-2 text-ink-faint">
            <tr className="border-b border-terminal-border [&>th]:h-7 [&>th]:px-2 [&>th]:text-left [&>th]:font-medium">
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
                <td colSpan={10} className="px-3 py-8 text-center text-ink-faint">
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
                    className="border-b border-terminal-border hover:bg-terminal-hover [&>td]:h-8 [&>td]:px-2"
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
                      {order.sl ? fmtPrice(order.sl, prec) : "-"}
                    </td>
                    <td className="tabular text-ink-muted">
                      {order.tp ? fmtPrice(order.tp, prec) : "-"}
                    </td>
                    <td className="text-right text-ink-faint">-</td>
                    <td />
                  </tr>
                );
              }
              const position = row.position;
              const prec = getMarketSymbol(position.symbol)?.pricePrecision ?? 2;
              return (
                <tr
                  key={`pos-${position.ticket}`}
                  className="border-b border-terminal-border hover:bg-terminal-hover [&>td]:h-8 [&>td]:px-2"
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
                    {position.sl ? fmtPrice(position.sl, prec) : "-"}
                  </td>
                  <td className="tabular text-ink-muted">
                    {position.tp ? fmtPrice(position.tp, prec) : "-"}
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
                        void requestConfirm({
                          title: `Close MT5 ticket ${position.ticket}?`,
                          description: "The live position will be closed at the broker.",
                          confirmLabel: "Close position",
                          tone: "danger",
                        }).then((accepted) => {
                          if (!accepted) return;
                          closeMt5Position({
                            clientOrderId: makeClientOrderId("mt5_close"),
                            ticket: position.ticket,
                          });
                        });
                      }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-terminal-hover text-ink hover:bg-bear hover:text-white"
                      title="Close position"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialog}
      </>
    );
  }

  if (replayTrading.active) {
    const replayPositions = replayTrading.positions.filter(
      (position) => Math.abs(position.netQuantity) > 1e-12,
    );
    const pending = replayTrading.orders.filter(
      (order) => order.status === "pending" || order.status === "partially_filled",
    );
    return (
      <>
      <div className="min-w-0 flex-1 overflow-auto bg-terminal-panel">
        <table className="w-full border-collapse text-2xs">
          <thead className="sticky top-0 bg-terminal-panel-2 text-ink-faint">
            <tr className="border-b border-terminal-border [&>th]:h-7 [&>th]:px-2 [&>th]:text-left [&>th]:font-medium">
              <th>Symbol</th><th>Side</th><th>Type</th><th>Qty</th><th>Entry</th>
              <th>SL</th><th>TP</th><th className="text-right">P/L</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {replayPositions.length === 0 && pending.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-faint">
                No replay positions. Orders and fills are isolated to this replay session.
              </td></tr>
            )}
            {replayPositions.map((position) => {
              const side = position.netQuantity > 0 ? "long" : "short";
              const prec = getMarketSymbol(position.symbol)?.pricePrecision ?? 2;
              const entryOrder = [...replayTrading.orders].reverse().find(
                (order) => order.trackId === position.trackId && order.status === "filled" &&
                  ((position.netQuantity > 0 && order.side === "buy") ||
                    (position.netQuantity < 0 && order.side === "sell")),
              );
              const editBracket = () => {
                if (!entryOrder) return;
                void requestPrompt({
                  title: "Replay stop loss",
                  description: "Leave blank to remove the stop loss.",
                  label: "Stop loss",
                  defaultValue: position.stopLoss?.toString() ?? "",
                  placeholder: "Optional price",
                  confirmLabel: "Next",
                }).then((stopText) => {
                  if (stopText == null) return;
                  void requestPrompt({
                    title: "Replay take profit",
                    description: "Leave blank to remove the take profit.",
                    label: "Take profit",
                    defaultValue: position.takeProfit?.toString() ?? "",
                    placeholder: "Optional price",
                    confirmLabel: "Save bracket",
                  }).then((targetText) => {
                    if (targetText == null) return;
                    const stopLoss = stopText.trim() ? Number(stopText) : undefined;
                    const takeProfit = targetText.trim() ? Number(targetText) : undefined;
                    if ((stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) ||
                      (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0))) return;
                    void replayTrading.updateBracket(entryOrder.id, stopLoss, takeProfit);
                  });
                });
              };
              return (
                <tr key={position.id} className="border-b border-terminal-border hover:bg-terminal-hover [&>td]:h-8 [&>td]:px-2">
                  <td className="font-semibold text-ink">{position.symbol}</td>
                  <td className={side === "long" ? "text-bull" : "text-bear"}>{side.toUpperCase()}</td>
                  <td className="text-ink-muted">market</td>
                  <td className="tabular">{Math.abs(position.netQuantity).toFixed(4)}</td>
                  <td className="tabular">{fmtPrice(position.averagePrice, prec)}</td>
                  <td className="tabular text-ink-muted">{position.stopLoss ? fmtPrice(position.stopLoss, prec) : "-"}</td>
                  <td className="tabular text-ink-muted">{position.takeProfit ? fmtPrice(position.takeProfit, prec) : "-"}</td>
                  <td className="tabular text-right" style={{ color: position.unrealizedPnl >= 0 ? "var(--bull)" : "var(--bear)" }}>{fmtMoney(position.unrealizedPnl)}</td>
                  <td><span className="rounded-sm bg-bull/15 px-1.5 py-0.5 text-[9px] uppercase text-bull">open</span></td>
                  <td className="text-right"><div className="flex items-center justify-end gap-1">
                    <button disabled={!entryOrder} onClick={editBracket} title="Edit replay bracket" className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-terminal-hover text-ink hover:bg-brand hover:text-white disabled:opacity-40"><Pencil size={11} /></button>
                    <button onClick={() => void replayTrading.close(position.id, 0.5)} className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-terminal-hover px-1 text-[9px] text-ink hover:bg-brand hover:text-white">1/2</button>
                    <button onClick={() => void replayTrading.close(position.id)} className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-terminal-hover text-ink hover:bg-bear hover:text-white"><X size={12} /></button>
                  </div></td>
                </tr>
              );
            })}
            {pending.map((order) => {
              const symbol = replayTrading.symbol ?? "Replay";
              const price = order.limitPrice ?? order.stopPrice ?? 0;
              const prec = getMarketSymbol(symbol)?.pricePrecision ?? 5;
              return (
                <tr key={order.id} className="border-b border-terminal-border hover:bg-terminal-hover [&>td]:h-8 [&>td]:px-2">
                  <td className="font-semibold text-ink">{symbol}</td>
                  <td className={order.side === "buy" ? "text-bull" : "text-bear"}>{order.side.toUpperCase()}</td>
                  <td className="capitalize text-ink-muted">{order.orderType}</td>
                  <td className="tabular">{(order.quantity - order.filledQuantity).toFixed(4)}</td>
                  <td className="tabular">{fmtPrice(price, prec)}</td>
                  <td className="tabular text-ink-muted">{order.stopLoss ? fmtPrice(order.stopLoss, prec) : "-"}</td>
                  <td className="tabular text-ink-muted">{order.takeProfit ? fmtPrice(order.takeProfit, prec) : "-"}</td>
                  <td className="text-right text-ink-faint">-</td>
                  <td><span className="rounded-sm bg-choch/15 px-1.5 py-0.5 text-[9px] uppercase text-choch">pending</span></td>
                  <td className="text-right"><button onClick={() => void replayTrading.cancel(order.id)} className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-terminal-hover text-ink-faint hover:text-bear"><Ban size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialog}
      </>
    );
  }

  return (
    <>
    <div className="min-w-0 flex-1 overflow-auto bg-terminal-panel">
      <table className="w-full border-collapse text-2xs">
        <thead className="sticky top-0 bg-terminal-panel-2 text-ink-faint">
          <tr className="border-b border-terminal-border [&>th]:h-7 [&>th]:px-2 [&>th]:text-left [&>th]:font-medium">
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
              <td colSpan={10} className="px-3 py-8 text-center text-ink-faint">
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
                className="border-b border-terminal-border hover:bg-terminal-hover [&>td]:h-8 [&>td]:px-2"
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
                  {p.stopLoss ? fmtPrice(p.stopLoss, prec) : "-"}
                </td>
                <td className="tabular text-ink-muted">
                  {p.takeProfit ? fmtPrice(p.takeProfit, prec) : "-"}
                </td>
                <td
                  className="tabular text-right"
                  style={{ color: pnl >= 0 ? "var(--bull)" : "var(--bear)" }}
                >
                  {p.status === "open" ? fmtMoney(pnl) : "-"}
                </td>
                <td>
                  <span
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 text-[9px] uppercase",
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
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-terminal-hover px-1 text-[9px] text-ink hover:bg-brand hover:text-white"
                          title="Close 50%"
                        >
                          1/2
                        </button>
                        <button
                          onClick={() =>
                            closePosition({ id: p.id, fraction: 1 })
                          }
                          className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-terminal-hover text-ink hover:bg-bear hover:text-white"
                          title="Close 100%"
                        >
                          <X size={12} />
                        </button>
                      </>
                    )}
                    {p.status === "pending" && (
                      <button
                        onClick={() => cancelPending(p.id)}
                        title="Cancel"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-terminal-hover text-ink-faint hover:text-bear"
                      >
                        <Ban size={12} />
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
          Pending orders fill as replay reveals price -{" "}
          {fmtDateTime(getTradeState().time)}
        </div>
      )}
    </div>
    {dialog}
    </>
  );
}
