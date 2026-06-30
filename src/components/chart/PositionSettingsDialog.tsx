"use client";
/**
 * PositionSettingsDialog — TradingView-style settings for the Long/Short
 * position tool. Tabs: Inputs (account / risk / entry / profit / stop),
 * Style (line width, zone opacity), Visibility (labels). Changes apply live.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pencil, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingDrawingIdAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  updateDrawingAtom,
} from "@/store/chartStore";
import {
  POSITION_STATS,
  type Drawing,
  type LineStyle,
  type PositionStat,
} from "@/types";
import { cn } from "@/utils/cn";

const COLORS = [
  "#ffffff",
  "#d1d4dc",
  "#9598a1",
  "#5d606b",
  "#363a45",
  "#000000",
  "#f23645",
  "#ff9800",
  "#ffeb3b",
  "#26a69a",
  "#2962ff",
  "#ab47bc",
  "#e91e63",
  "#ff5722",
  "#cddc39",
  "#089981",
  "#0c3299",
  "#673ab7",
];
const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

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
    <div className="flex items-center gap-3 py-2">
      <span className="w-[94px] shrink-0 text-[13px] text-ink">{label}</span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-5 text-[10px] font-medium uppercase text-ink-faint">
      {children}
    </div>
  );
}

function CheckBox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-[18px] w-[18px] items-center justify-center rounded-[3px] border transition-colors",
        checked
          ? "border-white bg-white text-[#1e1e1e]"
          : "border-[#8a8d93] bg-transparent hover:border-ink",
      )}
    >
      {checked && <Check size={13} strokeWidth={3} />}
    </button>
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const match = options.find((o) => String(o.value) === e.target.value);
        if (match) onChange(match.value);
      }}
      className={cn(
        "h-[34px] rounded-md border border-[#50535a] bg-[#1f1f1f] px-2.5 text-[13px] text-ink outline-none focus:border-[#6a6d75]",
        className,
      )}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ColorButton({
  color,
  open,
  onToggle,
  onPick,
}: {
  color: string;
  open: boolean;
  onToggle: () => void;
  onPick: (color: string) => void;
}) {
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="relative h-[34px] w-[34px] overflow-hidden rounded-md border border-[#50535a]"
        style={{
          backgroundImage:
            "linear-gradient(45deg,#343434 25%,transparent 25%,transparent 75%,#343434 75%,#343434),linear-gradient(45deg,#343434 25%,transparent 25%,transparent 75%,#343434 75%,#343434)",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0,4px 4px",
        }}
      >
        <span className="absolute inset-[5px] rounded-sm" style={{ background: color }} />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-[184px] rounded-md border border-[#50535a] bg-[#242424] p-2 shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-6 gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => onPick(c)}
                className="relative h-5 w-5 rounded border border-[#50535a]"
                style={{ background: c }}
              >
                {color.toLowerCase() === c.toLowerCase() && (
                  <Check size={11} className="absolute inset-0 m-auto text-black/70" />
                )}
              </button>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 border-t border-[#50535a] pt-2 text-[11px] text-ink-muted">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#089981"}
              onChange={(e) => onPick(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded border border-[#50535a] bg-transparent p-0"
            />
            Custom
          </label>
        </div>
      )}
    </div>
  );
}

function LineButton({
  color,
  width,
  style,
  open,
  onToggle,
  onWidth,
  onStyle,
}: {
  color: string;
  width: number;
  style: LineStyle;
  open: boolean;
  onToggle: () => void;
  onWidth: (width: number) => void;
  onStyle: (style: LineStyle) => void;
}) {
  const dash = style === "dashed" ? "6 4" : style === "dotted" ? "2 4" : "";
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex h-[34px] items-center gap-2 rounded-md border border-[#50535a] bg-[#1f1f1f] px-2 hover:border-[#6a6d75]"
      >
        <span className="h-6 w-6 rounded bg-[#8f9297]" />
        <svg width="31" height="14" className="text-ink" style={{ color }}>
          <line
            x1="1"
            y1="7"
            x2="30"
            y2="7"
            stroke="currentColor"
            strokeDasharray={dash || undefined}
            strokeLinecap="round"
            strokeWidth={width}
          />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-[170px] rounded-md border border-[#50535a] bg-[#242424] p-2 shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">Width</span>
            <input
              type="range"
              min={1}
              max={5}
              value={width}
              onChange={(e) => onWidth(Number(e.target.value))}
              className="flex-1 accent-brand"
            />
            <span className="w-6 text-right text-[11px] text-ink">{width}</span>
          </div>
          {(["solid", "dashed", "dotted"] as LineStyle[]).map((s) => (
            <button
              key={s}
              onClick={() => onStyle(s)}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-terminal-hover"
            >
              <svg width="82" height="12" className="text-ink">
                <line
                  x1="1"
                  y1="6"
                  x2="81"
                  y2="6"
                  stroke="currentColor"
                  strokeDasharray={
                    s === "dashed" ? "6 4" : s === "dotted" ? "2 4" : undefined
                  }
                  strokeWidth="2"
                />
              </svg>
              {style === s && <Check size={13} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatsSelect({
  value,
  onChange,
}: {
  value: PositionStat[];
  onChange: (stats: PositionStat[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const active: PositionStat[] = value.length ? value : ["percent"];
  const label =
    active.length === 1
      ? (POSITION_STATS.find((s) => s.id === active[0])?.label ?? "Stats")
      : `${active.length} stats selected`;
  const toggle = (id: PositionStat) => {
    const next = active.includes(id)
      ? active.filter((s) => s !== id)
      : [...active, id];
    onChange(next.length ? next : ["percent"]);
  };
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-[34px] w-[180px] items-center justify-between rounded-md border border-[#50535a] bg-[#1f1f1f] px-2.5 text-left text-[13px] text-ink"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="text-ink-muted" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-[230px] rounded-md border border-[#50535a] bg-[#242424] p-1 shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
        >
          {POSITION_STATS.map((s) => (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-ink hover:bg-terminal-hover"
            >
              <span
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border",
                  active.includes(s.id)
                    ? "border-white bg-white text-[#1e1e1e]"
                    : "border-[#8a8d93] bg-transparent",
                )}
              >
                {active.includes(s.id) && <Check size={13} strokeWidth={3} />}
              </span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PositionSettingsDialog() {
  const editingId = useAtomValue(editingDrawingIdAtom);
  const drawings = useAtomValue(drawingsAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const [tab, setTab] = useState<Tab>("inputs");
  const [pop, setPop] = useState<string | null>(null);

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
  const currencyLabel =
    drawing.accountCurrency && drawing.accountCurrency !== "Default"
      ? ` ${drawing.accountCurrency}`
      : "";

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

        <div className="max-h-[640px] overflow-y-auto px-[18px] py-[18px]">
          {tab === "inputs" && (
            <>
              <Row label="Account size">
                <NumberField
                  value={accountSize}
                  onCommit={(v) => patch({ accountSize: v })}
                  className="h-[34px] w-[100px]"
                />
                <Select
                  value={drawing.accountCurrency ?? "Default"}
                  onChange={(v) => patch({ accountCurrency: v })}
                  className="w-[100px]"
                  options={["Default", "USD", "EUR", "GBP", "JPY", "AUD"].map(
                    (c) => ({ value: c, label: c }),
                  )}
                />
              </Row>
              <Row label="Lot size">
                <NumberField
                  value={lotSize}
                  onCommit={(v) => patch({ lotSize: v })}
                  className="h-[34px] w-[100px]"
                />
              </Row>
              <Row label="Risk">
                <NumberField
                  value={riskValue}
                  onCommit={(v) => patch({ riskValue: v })}
                  className="h-[34px] w-[100px]"
                />
                <Select
                  value={riskUnit}
                  onChange={(v) => patch({ riskUnit: v })}
                  className="w-[100px]"
                  options={[
                    { value: "%", label: "%" },
                    { value: "amount", label: "Amount" },
                  ]}
                />
              </Row>
              <Row label="Entry price">
                <NumberField
                  value={Number(entry.toFixed(6))}
                  onCommit={(v) => setPointPrice(0, v)}
                  className="h-[34px] w-[100px]"
                />
              </Row>
              <Row label="Leverage">
                <NumberField
                  value={leverage}
                  onCommit={(v) => patch({ leverage: v })}
                  className="h-[34px] w-[100px]"
                />
              </Row>

              <SectionTitle>Profit level</SectionTitle>
              <Row label="Ticks">
                <NumberField
                  value={profitTicks}
                  onCommit={(t) =>
                    setPointPrice(1, entry + profitDir * Math.abs(t) * tick)
                  }
                  className="h-[34px] w-[100px]"
                />
              </Row>
              <Row label="Price">
                <NumberField
                  value={Number(target.toFixed(6))}
                  onCommit={(v) => setPointPrice(1, v)}
                  className="h-[34px] w-[100px]"
                />
              </Row>

              <SectionTitle>Stop level</SectionTitle>
              <Row label="Ticks">
                <NumberField
                  value={stopTicks}
                  onCommit={(t) =>
                    setPointPrice(2, entry + stopDir * Math.abs(t) * tick)
                  }
                  className="h-[34px] w-[100px]"
                />
              </Row>
              <Row label="Price">
                <NumberField
                  value={Number(stop.toFixed(6))}
                  onCommit={(v) => setPointPrice(2, v)}
                  className="h-[34px] w-[100px]"
                />
              </Row>

              <Row label="QTY precision">
                <Select
                  value={drawing.qtyPrecision ?? -1}
                  onChange={(v) =>
                    patch({ qtyPrecision: v === -1 ? undefined : Number(v) })
                  }
                  className="w-[100px]"
                  options={[
                    { value: -1, label: "Default" },
                    ...[0, 1, 2, 3, 4].map((p) => ({
                      value: p,
                      label: String(p),
                    })),
                  ]}
                />
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
                    -{riskAmount.toFixed(2)}
                    {currencyLabel}
                  </span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-muted">Profit</span>
                  <span className="text-bull">
                    +{profitAmount.toFixed(2)}
                    {currencyLabel}
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
              <Row label="Lines">
                <LineButton
                  color={drawing.color || "#089981"}
                  width={drawing.lineWidth ?? 1}
                  style={drawing.lineStyle ?? "solid"}
                  open={pop === "line"}
                  onToggle={() => setPop(pop === "line" ? null : "line")}
                  onWidth={(v) => patch({ lineWidth: v })}
                  onStyle={(v) => patch({ lineStyle: v })}
                />
              </Row>
              <Row label="Stop color">
                <ColorButton
                  color={drawing.stopColor ?? "#f23645"}
                  open={pop === "stop"}
                  onToggle={() => setPop(pop === "stop" ? null : "stop")}
                  onPick={(c) => {
                    patch({ stopColor: c });
                    setPop(null);
                  }}
                />
              </Row>
              <Row label="Target color">
                <ColorButton
                  color={drawing.targetColor ?? "#089981"}
                  open={pop === "target"}
                  onToggle={() => setPop(pop === "target" ? null : "target")}
                  onPick={(c) => {
                    patch({ targetColor: c });
                    setPop(null);
                  }}
                />
              </Row>
              <Row label="Text">
                <ColorButton
                  color={drawing.textColor ?? "#ffffff"}
                  open={pop === "text"}
                  onToggle={() => setPop(pop === "text" ? null : "text")}
                  onPick={(c) => {
                    patch({ textColor: c });
                    setPop(null);
                  }}
                />
                <Select
                  value={drawing.fontSize ?? 12}
                  onChange={(v) => patch({ fontSize: Number(v) })}
                  className="w-[100px]"
                  options={FONT_SIZES.map((s) => ({
                    value: s,
                    label: String(s),
                  }))}
                />
              </Row>
              <Row label="Price labels">
                <CheckBox
                  checked={drawing.showLabels !== false}
                  onChange={(v) => patch({ showLabels: v })}
                />
              </Row>

              <SectionTitle>Info</SectionTitle>
              <Row label="Stats">
                <StatsSelect
                  value={drawing.positionStats ?? ["percent"]}
                  onChange={(v) => patch({ positionStats: v })}
                />
              </Row>
              <Row label="Compact stats mode">
                <CheckBox
                  checked={!!drawing.compactStats}
                  onChange={(v) => patch({ compactStats: v })}
                />
              </Row>
              <Row label="Always show stats">
                <CheckBox
                  checked={!!drawing.alwaysShowStats}
                  onChange={(v) => patch({ alwaysShowStats: v })}
                />
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
