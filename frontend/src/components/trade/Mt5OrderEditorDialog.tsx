"use client";

import { useMemo, useState } from "react";
import { useSetAtom } from "jotai";
import { AlertTriangle, ArrowLeft, X } from "lucide-react";
import { modifyMt5OrderAtom } from "@/store/mt5Store";
import { makeClientCommandId } from "@/services/execution/identifiers";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { fmtPrice } from "@/utils/format";
import type {
  Mt5ModifyRequest,
  Mt5PendingOrder,
  Mt5Position,
} from "@/types/mt5";

export type EditableMt5Trade =
  | { kind: "position"; position: Mt5Position }
  | { kind: "pendingOrder"; order: Mt5PendingOrder };

interface EditorValues {
  entry?: number;
  sl: number;
  tp: number;
}

export function Mt5OrderEditorDialog({
  trade,
  onClose,
}: {
  trade: EditableMt5Trade;
  onClose: () => void;
}) {
  const modify = useSetAtom(modifyMt5OrderAtom);
  const isPending = trade.kind === "pendingOrder";
  const item = isPending ? trade.order : trade.position;
  const precision = getMarketSymbol(item.symbol)?.pricePrecision ?? 2;
  const initialEntry = isPending ? trade.order.price : trade.position.openPrice;
  const [entry, setEntry] = useState(fmtPrice(initialEntry, precision));
  const [sl, setSl] = useState(
    item.sl != null ? fmtPrice(item.sl, precision) : "",
  );
  const [tp, setTp] = useState(
    item.tp != null ? fmtPrice(item.tp, precision) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<EditorValues | null>(null);
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  const title = isPending ? "Edit pending MT5 order" : "Edit MT5 protection";
  const side = isPending ? trade.order.side : trade.position.side;
  const summary = useMemo(
    () => `${item.symbol} · ${side.toUpperCase()} · #${item.ticket}`,
    [item.symbol, item.ticket, side],
  );

  const validate = (): EditorValues | null => {
    const parsedEntry = Number(entry);
    const parsedSl = sl.trim() === "" ? 0 : Number(sl);
    const parsedTp = tp.trim() === "" ? 0 : Number(tp);
    if (isPending && (!Number.isFinite(parsedEntry) || parsedEntry <= 0)) {
      setError("Pending entry must be a positive price.");
      return null;
    }
    if (
      !Number.isFinite(parsedSl) ||
      parsedSl < 0 ||
      !Number.isFinite(parsedTp) ||
      parsedTp < 0
    ) {
      setError("SL and TP must be positive prices, or blank to remove.");
      return null;
    }
    const reference = isPending ? parsedEntry : trade.position.currentPrice;
    const isLong = side === "buy" || side === "long";
    if (
      (parsedSl > 0 && (isLong ? parsedSl >= reference : parsedSl <= reference)) ||
      (parsedTp > 0 && (isLong ? parsedTp <= reference : parsedTp >= reference))
    ) {
      setError(
        `For ${isLong ? "long/buy" : "short/sell"}, SL and TP must stay on opposite sides of ${isPending ? "entry" : "current price"}.`,
      );
      return null;
    }
    setError(null);
    return {
      ...(isPending ? { entry: parsedEntry } : {}),
      sl: parsedSl,
      tp: parsedTp,
    };
  };

  const openReview = () => {
    const values = validate();
    if (values) setReview(values);
  };
  const submit = () => {
    if (!review) return;
    const request: Mt5ModifyRequest = {
      clientOrderId: makeClientCommandId("exec_modify"),
      ticket: item.ticket,
      target: isPending ? "pendingOrder" : "position",
      ...(review.entry != null ? { price: review.entry } : {}),
      sl: review.sl,
      tp: review.tp,
    };
    if (modify(request)) onClose();
  };

  return (
    <div
      className="platform-dialog-overlay fixed inset-0 z-1200 flex items-end justify-center bg-(--scrim) p-3 backdrop-blur-xs sm:items-center"
      data-chart-ui
    >
      <div
        ref={dialogRef}
        style={dialogStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mt5-order-editor-title"
        className="platform-dialog w-full max-w-[430px] rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
      >
        <div
          data-dialog-header
          {...dragHandleProps}
          className={`flex min-h-14 items-center justify-between border-b border-terminal-border px-4 ${dragHandleClassName}`}
        >
          <div className="min-w-0">
            <div
              id="mt5-order-editor-title"
              className="truncate text-base font-semibold tracking-[-0.02em] text-ink"
            >
              {review ? "Review MT5 modification" : title}
            </div>
            <div className="truncate text-xs text-ink-faint">{summary}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink"
            aria-label="Close MT5 order editor"
          >
            <X size={16} />
          </button>
        </div>

        {review ? (
          <div data-dialog-body className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-terminal-border bg-terminal-panel p-3 text-sm">
              <Summary label="Entry" value={isPending ? fmtPrice(review.entry ?? 0, precision) : "Filled · unchanged"} />
              <Summary label="SL" value={review.sl > 0 ? fmtPrice(review.sl, precision) : "Remove"} />
              <Summary label="TP" value={review.tp > 0 ? fmtPrice(review.tp, precision) : "Remove"} />
              <Summary label="Ticket" value={`#${item.ticket}`} />
            </div>
            <div className="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-300">
              <AlertTriangle className="mt-0.5 shrink-0" size={15} />
              This sends a live broker command. The chart updates only after the
              signed MT5 snapshot confirms the change.
            </div>
          </div>
        ) : (
          <div data-dialog-body className="space-y-3 p-4">
            <PriceField
              label="Entry"
              value={entry}
              onChange={setEntry}
              disabled={!isPending}
              hint={
                isPending
                  ? "Pending entry can be modified in place."
                  : "A filled position entry is broker-immutable."
              }
            />
            <PriceField
              label="Stop loss"
              value={sl}
              onChange={setSl}
              placeholder="Blank removes SL"
            />
            <PriceField
              label="Take profit"
              value={tp}
              onChange={setTp}
              placeholder="Blank removes TP"
            />
            {error && (
              <div role="alert" className="rounded-lg bg-bear/10 px-3 py-2 text-xs text-bear">
                {error}
              </div>
            )}
          </div>
        )}

        <div
          data-dialog-footer
          className="flex justify-end gap-2 border-t border-terminal-border p-4 pb-[max(16px,env(safe-area-inset-bottom))]"
        >
          {review ? (
            <button
              type="button"
              onClick={() => setReview(null)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink-muted hover:bg-terminal-hover hover:text-ink"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink-muted hover:bg-terminal-hover hover:text-ink"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={review ? submit : openReview}
            className="min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            {review ? "Send live modification" : "Review changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PriceField({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="min-h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 text-sm tabular-nums text-ink outline-hidden focus:border-brand disabled:cursor-not-allowed disabled:opacity-55"
      />
      {hint && <span className="mt-1 block text-[11px] leading-4 text-ink-faint">{hint}</span>}
    </label>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-2">
      <span className="text-ink-faint">{label}</span>
      <strong className="truncate text-right font-medium text-ink">{value}</strong>
    </div>
  );
}
