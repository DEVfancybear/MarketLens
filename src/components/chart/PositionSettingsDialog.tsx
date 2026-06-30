"use client";
/**
 * PositionSettingsDialog — TradingView-style settings for the Long/Short
 * position tool. Tabs: Inputs (account / risk / entry / profit / stop),
 * Style (line width, zone opacity), Visibility (labels). Changes apply live.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingDrawingIdAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  updateDrawingAtom,
} from "@/store/chartStore";
import type { Drawing } from "@/types";
import { cn } from "@/utils/cn";

/** Minimum price increment inferred from the price magnitude. */
function inferTick(price: number): number {
  const a = Math.abs(price);
  if (a >= 1000) return 0.001;
  if (a >= 1) return 0.0001;
  return 0.00001;
}

type Tab = "inputs" | "style" | "visibility";

/** A number input that keeps its own text so the user can type freely; it
 *  commits the parsed value on every valid keystroke. */
export function NumberField({
  value,
  onCommit,
  className,
}: {
  value: number;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onCommit(v);
      }}
      className={cn(
        "rounded-md border border-terminal-border bg-terminal-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand",
        className,
      )}
    />
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 text-xs text-ink-muted">{label}</span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}

export function PositionSettingsDialog() {
  const editingId = useAtomValue(editingDrawingIdAtom);
  const drawings = useAtomValue(drawingsAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const [tab, setTab] = useState<Tab>("inputs");

  const drawing = drawings.find((d) => d.id === editingId) ?? null;
  const isPosition = drawing?.tool === "long" || drawing?.tool === "short";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId) setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, setEditing]);

  if (typeof document === "undefined" || !drawing || !isPosition) return null;

  const close = () => setEditing(null);
  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const isLong = drawing.tool === "long";
  const entry = drawing.points[0]?.price ?? 0;
  const target = drawing.points[1]?.price ?? entry;
  const stop = drawing.points[2]?.price ?? entry;
  const tick = inferTick(entry);

  // Patch a single point's price, keeping the others intact.
  const setPointPrice = (idx: number, price: number) => {
    const pts = drawing.points.map((p) => ({ ...p }));
    if (pts[idx]) {
      pts[idx] = { ...pts[idx], price };
      patch({ points: pts });
    }
  };
  // Profit/stop sit on the correct side of entry for the position direction.
  const profitDir = isLong ? 1 : -1;
  const stopDir = isLong ? -1 : 1;
  const profitTicks = Math.round(Math.abs(target - entry) / tick);
  const stopTicks = Math.round(Math.abs(stop - entry) / tick);

  const accountSize = drawing.accountSize ?? 10000;
  const riskValue = drawing.riskValue ?? 1;
  const riskUnit = drawing.riskUnit ?? "%";
  const lotSize = drawing.lotSize ?? 1;
  const leverage = drawing.leverage ?? 1;
  const qtyPrecision = drawing.qtyPrecision ?? 2;

  const riskAmount =
    riskUnit === "%" ? accountSize * (riskValue / 100) : riskValue;
  const priceRisk = Math.abs(entry - stop);
  const qty = priceRisk > 0 ? (riskAmount / priceRisk) * lotSize : 0;
  const profitAmount = qty * Math.abs(target - entry);
  const rr = priceRisk > 0 ? Math.abs(target - entry) / priceRisk : 0;

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        "border-b-2 px-1 pb-2 text-sm transition-colors",
        tab === id
          ? "border-brand text-ink"
          : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 pt-16"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="max-h-[80vh] w-[420px] overflow-hidden rounded-xl border border-terminal-border bg-terminal-panel-2 shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-ink">
              {isLong ? "Long position" : "Short position"}
            </span>
            {drawing.tradeStatus === "tp_hit" && (
              <span className="rounded-full bg-bull/20 px-2 py-0.5 text-xs font-medium text-bull">
                TP Hit
              </span>
            )}
            {drawing.tradeStatus === "sl_hit" && (
              <span className="rounded-full bg-bear/20 px-2 py-0.5 text-xs font-medium text-bear">
                SL Hit
              </span>
            )}
            <Pencil size={14} className="text-ink-muted" />
          </div>
          <button
            onClick={close}
            className="rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-5 border-b border-terminal-border px-5 pt-3">
          {tabBtn("inputs", "Inputs")}
          {tabBtn("style", "Style")}
          {tabBtn("visibility", "Visibility")}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {tab === "inputs" && (
            <>
              <Row label="Account size">
                <NumberField
                  value={accountSize}
                  onCommit={(v) => patch({ accountSize: v })}
                  className="flex-1"
                />
                <select
                  value={drawing.accountCurrency ?? "USD"}
                  onChange={(e) => patch({ accountCurrency: e.target.value })}
                  className="w-24 rounded-md border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-ink outline-none"
                >
                  {["USD", "EUR", "GBP", "JPY", "AUD"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Row>
              <Row label="Lot size">
                <NumberField
                  value={lotSize}
                  onCommit={(v) => patch({ lotSize: v })}
                  className="flex-1"
                />
              </Row>
              <Row label="Risk">
                <NumberField
                  value={riskValue}
                  onCommit={(v) => patch({ riskValue: v })}
                  className="flex-1"
                />
                <select
                  value={riskUnit}
                  onChange={(e) =>
                    patch({ riskUnit: e.target.value as "%" | "amount" })
                  }
                  className="w-24 rounded-md border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-ink outline-none"
                >
                  <option value="%">%</option>
                  <option value="amount">Amount</option>
                </select>
              </Row>
              <Row label="Entry price">
                <NumberField
                  value={Number(entry.toFixed(6))}
                  onCommit={(v) => setPointPrice(0, v)}
                  className="flex-1"
                />
              </Row>
              <Row label="Leverage">
                <NumberField
                  value={leverage}
                  onCommit={(v) => patch({ leverage: v })}
                  className="flex-1"
                />
              </Row>

              <SectionTitle>Profit level</SectionTitle>
              <Row label="Ticks">
                <NumberField
                  value={profitTicks}
                  onCommit={(t) =>
                    setPointPrice(1, entry + profitDir * Math.abs(t) * tick)
                  }
                  className="flex-1"
                />
              </Row>
              <Row label="Price">
                <NumberField
                  value={Number(target.toFixed(6))}
                  onCommit={(v) => setPointPrice(1, v)}
                  className="flex-1"
                />
              </Row>

              <SectionTitle>Stop level</SectionTitle>
              <Row label="Ticks">
                <NumberField
                  value={stopTicks}
                  onCommit={(t) =>
                    setPointPrice(2, entry + stopDir * Math.abs(t) * tick)
                  }
                  className="flex-1"
                />
              </Row>
              <Row label="Price">
                <NumberField
                  value={Number(stop.toFixed(6))}
                  onCommit={(v) => setPointPrice(2, v)}
                  className="flex-1"
                />
              </Row>

              <Row label="QTY precision">
                <select
                  value={qtyPrecision}
                  onChange={(e) =>
                    patch({ qtyPrecision: Number(e.target.value) })
                  }
                  className="flex-1 rounded-md border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-ink outline-none"
                >
                  {[0, 1, 2, 3, 4].map((p) => (
                    <option key={p} value={p}>
                      {p} decimals
                    </option>
                  ))}
                </select>
              </Row>

              {/* Computed summary */}
              <div className="mt-3 rounded-md border border-terminal-border bg-terminal-bg/50 px-3 py-2 text-xs">
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Quantity</span>
                  <span className="text-ink">{qty.toFixed(qtyPrecision)}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Risk</span>
                  <span className="text-bear">
                    −{riskAmount.toFixed(2)} {drawing.accountCurrency ?? "USD"}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Profit</span>
                  <span className="text-bull">
                    +{profitAmount.toFixed(2)}{" "}
                    {drawing.accountCurrency ?? "USD"}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Risk/Reward</span>
                  <span className="text-ink">{rr.toFixed(2)}</span>
                </div>
              </div>
            </>
          )}

          {tab === "style" && (
            <>
              <Row label="Line width">
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={drawing.lineWidth ?? 1}
                  onChange={(e) => patch({ lineWidth: Number(e.target.value) })}
                  className="flex-1 accent-brand"
                />
                <span className="w-10 text-right text-xs text-ink">
                  {drawing.lineWidth ?? 1}px
                </span>
              </Row>
              <Row label="Zone opacity">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((drawing.opacity ?? 0.15) * 100)}
                  onChange={(e) =>
                    patch({ opacity: Number(e.target.value) / 100 })
                  }
                  className="flex-1 accent-brand"
                />
                <span className="w-10 text-right text-xs text-ink">
                  {Math.round((drawing.opacity ?? 0.15) * 100)}%
                </span>
              </Row>
            </>
          )}

          {tab === "visibility" && (
            <Row label="Labels">
              <button
                onClick={() =>
                  patch({ showLabels: drawing.showLabels === false })
                }
                className={cn(
                  "rounded border px-2.5 py-1 text-xs transition-colors",
                  drawing.showLabels !== false
                    ? "border-brand/40 bg-brand/15 text-brand"
                    : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                )}
              >
                {drawing.showLabels !== false ? "Shown" : "Hidden"}
              </button>
            </Row>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
