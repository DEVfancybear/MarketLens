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
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  editingDrawingIdAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  symbolAtom,
  updateDrawingAtom,
} from "@/store/chartStore";
import {
  POSITION_STATS,
  type Drawing,
  type LineStyle,
  type PositionStat,
} from "@/types";
import { cn } from "@/utils/cn";
import {
  formatPriceByTick,
  levelFromTicks,
  roundToTick,
  safeTickSize,
  ticksBetween,
} from "./drawing/tools/positionMetrics";
import { parseNumberDraft } from "./drawing/tools/positionInput";

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

type Tab = "inputs" | "style" | "visibility";

/** A number input that keeps its own text so the user can type freely.
 *
 * Most drawing settings can preview live on every valid keystroke.  Position
 * price/tick fields are different: while the user is replacing a value, partial
 * drafts like `6` or `620` are temporarily on the wrong side of entry and would
 * be mirrored/snap-rounded immediately.  `commitMode="blur"` lets those fields
 * behave like TradingView inputs: type the complete number, then commit on blur
 * or Enter.
 */
export function NumberField({
  value,
  onCommit,
  className,
  commitMode = "change",
}: {
  value: number;
  onCommit: (v: number) => void;
  className?: string;
  commitMode?: "change" | "blur";
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const valueText = String(value);
  useEffect(() => {
    if (!editing) setText(valueText);
  }, [editing, valueText]);

  const commitText = () => {
    const parsed = parseNumberDraft(text);
    if (parsed == null) {
      setText(valueText);
      return;
    }
    onCommit(parsed);
    setText(String(parsed));
  };

  return (
    <input
      value={text}
      inputMode="decimal"
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (commitMode === "change") {
          const parsed = parseNumberDraft(next);
          if (parsed != null) onCommit(parsed);
        }
      }}
      onBlur={() => {
        if (commitMode === "blur") commitText();
        else if (parseNumberDraft(text) == null) setText(valueText);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setText(valueText);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-[34px] rounded-[5px] border border-[#50535a] bg-[#1f1f1f] px-2.5 text-[13px] text-[#d1d4dc] outline-none transition-colors focus:border-[#2962ff] focus:ring-1 focus:ring-[#2962ff]",
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
    <div className="flex items-center gap-3 py-[7px]">
      <span className="w-[110px] shrink-0 text-[14px] font-medium text-[#d1d4dc]">
        {label}
      </span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 text-[10px] font-medium uppercase tracking-normal text-[#8a8d93]">
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
        "h-[34px] rounded-[5px] border border-[#50535a] bg-[#1f1f1f] px-2.5 text-[13px] text-[#d1d4dc] outline-none transition-colors focus:border-[#2962ff] focus:ring-1 focus:ring-[#2962ff]",
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
  const symbol = useAtomValue(symbolAtom);
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
  const marketSymbol = getMarketSymbol(symbol);
  const tick = safeTickSize(marketSymbol?.tickSize);
  const entry = roundToTick(drawing.points[0]?.price ?? 0, tick);
  const target = roundToTick(drawing.points[1]?.price ?? entry, tick);
  const stop = roundToTick(drawing.points[2]?.price ?? entry, tick);
  const priceFieldValue = (price: number) =>
    Number(formatPriceByTick(price, tick, marketSymbol?.pricePrecision ?? 2));

  // Patch a single point's price, keeping the others intact.
  const setPointPrice = (idx: number, price: number) => {
    const pts = drawing.points.map((p) => ({ ...p }));
    if (pts[idx]) {
      pts[idx] = { ...pts[idx], price: roundToTick(price, tick) };
      patch({ points: pts });
    }
  };
  // Profit/stop sit on the correct side of entry for the position direction.
  const profitDir = isLong ? 1 : -1;
  const stopDir = isLong ? -1 : 1;
  const profitTicks = ticksBetween(entry, target, tick);
  const stopTicks = ticksBetween(entry, stop, tick);
  const priceOnSide = (price: number, dir: 1 | -1) =>
    entry + dir * Math.abs(roundToTick(price, tick) - entry);
  const setEntryPrice = (price: number) => {
    const pts = drawing.points.map((p) => ({ ...p }));
    if (!pts[0]) return;
    const nextEntry = roundToTick(price, tick);
    pts[0] = { ...pts[0], price: nextEntry };
    if (pts[1])
      pts[1] = {
        ...pts[1],
        price: levelFromTicks(nextEntry, profitTicks, profitDir, tick),
      };
    if (pts[2])
      pts[2] = {
        ...pts[2],
        price: levelFromTicks(nextEntry, stopTicks, stopDir, tick),
      };
    patch({ points: pts });
  };
  const setProfitPrice = (price: number) =>
    setPointPrice(
      1,
      levelFromTicks(
        entry,
        ticksBetween(entry, priceOnSide(price, profitDir), tick),
        profitDir,
        tick,
      ),
    );
  const setStopPrice = (price: number) =>
    setPointPrice(
      2,
      levelFromTicks(
        entry,
        ticksBetween(entry, priceOnSide(price, stopDir), tick),
        stopDir,
        tick,
      ),
    );

  const accountSize = drawing.accountSize ?? 10000;
  const riskValue = drawing.riskValue ?? 1;
  const riskUnit = drawing.riskUnit ?? "%";
  const lotSize = drawing.lotSize ?? 1;
  const leverage = drawing.leverage ?? 1;
  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        "border-b-[3px] px-0 pb-[9px] text-[16px] font-semibold transition-colors",
        tab === id
          ? "border-[#f0f0f0] text-[#f0f0f0]"
          : "border-transparent text-[#d1d4dc] hover:text-[#f0f0f0]",
      )}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      data-chart-ui
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/45 pt-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex max-h-[calc(100vh-32px)] w-[380px] flex-col overflow-hidden border border-[#3a3a3a] bg-[#1f1f1f] shadow-2xl shadow-black/70">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-[20px] font-semibold leading-7 text-[#f0f0f0]">
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
            <Pencil size={16} className="text-[#d1d4dc]" />
          </div>
          <button
            onClick={close}
            className="rounded-sm p-1 text-[#d1d4dc] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]"
          >
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        {/* Tabs */}
        <div className="mx-5 flex items-center gap-6 border-b border-[#5a5a5a] pt-3">
          {tabBtn("inputs", "Inputs")}
          {tabBtn("style", "Style")}
          {tabBtn("visibility", "Visibility")}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "inputs" && (
            <>
              <Row label="Account size">
                <NumberField
                  value={accountSize}
                  onCommit={(v) => patch({ accountSize: v })}
                  className="w-[100px]"
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
                  className="w-[100px]"
                />
              </Row>
              <Row label="Risk">
                <NumberField
                  value={riskValue}
                  onCommit={(v) => patch({ riskValue: v })}
                  className="w-[100px]"
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
                  value={priceFieldValue(entry)}
                  onCommit={setEntryPrice}
                  commitMode="blur"
                  className="w-[100px]"
                />
              </Row>
              <Row label="Leverage">
                <NumberField
                  value={leverage}
                  onCommit={(v) => patch({ leverage: v })}
                  className="w-[100px]"
                />
              </Row>

              <SectionTitle>Profit level</SectionTitle>
              <Row label="Ticks">
                <NumberField
                  value={profitTicks}
                  onCommit={(t) =>
                    setPointPrice(1, levelFromTicks(entry, t, profitDir, tick))
                  }
                  commitMode="blur"
                  className="w-[100px]"
                />
              </Row>
              <Row label="Price">
                <NumberField
                  value={priceFieldValue(target)}
                  onCommit={setProfitPrice}
                  commitMode="blur"
                  className="w-[100px]"
                />
              </Row>

              <SectionTitle>Stop level</SectionTitle>
              <Row label="Ticks">
                <NumberField
                  value={stopTicks}
                  onCommit={(t) =>
                    setPointPrice(2, levelFromTicks(entry, t, stopDir, tick))
                  }
                  commitMode="blur"
                  className="w-[100px]"
                />
              </Row>
              <Row label="Price">
                <NumberField
                  value={priceFieldValue(stop)}
                  onCommit={setStopPrice}
                  commitMode="blur"
                  className="w-[100px]"
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
        <div className="flex h-[58px] shrink-0 items-center justify-between border-t border-[#3a3a3a] px-5">
          <button
            type="button"
            className="flex h-[34px] min-w-[104px] items-center justify-between rounded-[5px] border border-[#50535a] bg-[#1f1f1f] px-2.5 text-[13px] font-medium text-[#f0f0f0] hover:border-[#6a6d75]"
          >
            <span>Template</span>
            <ChevronDown size={15} className="text-[#a0a3aa]" />
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={close}
              className="h-[34px] rounded-[5px] border border-[#f0f0f0] bg-transparent px-3.5 text-[14px] font-semibold text-[#f0f0f0] hover:bg-[#2a2a2a]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={close}
              className="h-[34px] rounded-[5px] border border-[#f0f0f0] bg-[#f0f0f0] px-4 text-[14px] font-semibold text-[#1f1f1f] hover:bg-white"
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
