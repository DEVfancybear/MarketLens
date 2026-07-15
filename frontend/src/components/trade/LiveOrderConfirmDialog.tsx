"use client";
import type { Mt5CloseAllRequest, Mt5OrderRequest } from "@/types/mt5";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
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
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  if (!payload) return null;

  const isOrder = payload.kind === "order";
  const title = isOrder ? "Confirm MT5 order" : "Confirm MT5 close all";

  return (
    <div className="platform-dialog-overlay fixed inset-0 z-[1200] flex items-end justify-center bg-[var(--scrim)] p-3 backdrop-blur-sm sm:items-center" data-chart-ui>
      <div
        ref={dialogRef}
        style={dialogStyle}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="live-order-confirm-title"
        className="platform-dialog w-full max-w-[400px] rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
      >
        <div
          data-dialog-header
          {...dragHandleProps}
          className={`flex min-h-14 items-center justify-between border-b border-terminal-border px-4 ${dragHandleClassName}`}
        >
          <div id="live-order-confirm-title" className="text-base font-semibold tracking-[-0.02em] text-ink">{title}</div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink"
            aria-label="Cancel live order"
          >
            <X size={15} />
          </button>
        </div>
        <div data-dialog-body className="space-y-4 overflow-y-auto p-4 text-sm leading-6 text-ink-muted">
          {isOrder ? (
            <OrderSummary order={payload.order} precision={precision} />
          ) : (
            <div>
              This will send a live close-all command
              {payload.request.chartSymbol ? ` for ${payload.request.chartSymbol}` : ""}.
            </div>
          )}
          <div className="rounded-xl border border-bear/30 bg-bear/10 px-3 py-2.5 text-xs leading-5 text-bear">
            MT5 bridge state is authoritative. The app will wait for bridge events before updating
            live positions.
          </div>
        </div>
        <div data-dialog-footer className="flex justify-end gap-2 border-t border-terminal-border p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-xl bg-bear px-4 text-sm font-semibold text-white hover:opacity-90"
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
