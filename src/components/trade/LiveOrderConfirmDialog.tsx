"use client";
import type { Mt5CloseAllRequest, Mt5OrderRequest } from "@/types/mt5";
import { fmtPrice } from "@/utils/format";
import { X } from "lucide-react";

type ConfirmPayload =
  | { kind: "order"; order: Mt5OrderRequest }
  | { kind: "closeAll"; request: Mt5CloseAllRequest };

export function LiveOrderConfirmDialog({
  payload,
  precision,
  onCancel,
  onConfirm,
}: {
  payload: ConfirmPayload | null;
  precision: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!payload) return null;

  const isOrder = payload.kind === "order";
  const title = isOrder ? "Confirm MT5 order" : "Confirm MT5 close all";

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/55">
      <div className="w-[360px] max-w-[calc(100vw-24px)] rounded-md border border-terminal-border bg-terminal-panel shadow-2xl">
        <div className="flex h-10 items-center justify-between border-b border-terminal-border px-3">
          <div className="text-sm font-semibold text-ink">{title}</div>
          <button
            onClick={onCancel}
            className="rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3 p-3 text-xs text-ink-muted">
          {isOrder ? (
            <OrderSummary order={payload.order} precision={precision} />
          ) : (
            <div>
              This will send a live close-all command
              {payload.request.chartSymbol ? ` for ${payload.request.chartSymbol}` : ""}.
            </div>
          )}
          <div className="rounded border border-bear/30 bg-bear/10 px-2 py-1.5 text-[11px] text-bear">
            MT5 bridge state is authoritative. The app will wait for bridge events before updating
            live positions.
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-terminal-border p-3">
          <button
            onClick={onCancel}
            className="rounded border border-terminal-border px-3 py-1.5 text-xs text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-bear px-3 py-1.5 text-xs font-semibold text-white hover:bg-bear/90"
          >
            Send live command
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderSummary({
  order,
  precision,
}: {
  order: Mt5OrderRequest;
  precision: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      <Summary label="Symbol" value={`${order.chartSymbol} -> ${order.brokerSymbol}`} />
      <Summary label="Side" value={order.side.toUpperCase()} />
      <Summary label="Type" value={order.type} />
      <Summary label="Volume" value={order.volume.toFixed(4)} />
      <Summary
        label="Entry"
        value={order.price != null ? fmtPrice(order.price, precision) : "market"}
      />
      <Summary label="SL" value={order.sl != null ? fmtPrice(order.sl, precision) : "-"} />
      <Summary label="TP" value={order.tp != null ? fmtPrice(order.tp, precision) : "-"} />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <span className="truncate text-right font-semibold text-ink">{value}</span>
    </div>
  );
}
