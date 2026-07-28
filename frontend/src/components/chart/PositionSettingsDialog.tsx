"use client";
/**
 * PositionSettingsDialog — TradingView-style settings for the Long/Short
 * position tool. Tabs: Inputs (account / risk / entry / profit / stop),
 * Style (line width, zone opacity), Visibility (labels). Changes apply live.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Pencil, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  editingDrawingIdAtom,
  candlesAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  symbolAtom,
  timeframeAtom,
  updateDrawingAtom,
  saveDrawingToolDefaultsAtom,
} from "@/store/chartStore";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import {
  DEFAULT_POSITION_STATS,
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
import { getDrawingSettingsSchema } from "./drawing/settings/drawingSettingsSchema";
import {
  drawingCommandManager,
  PreviewedPropertyChangeCommand,
} from "./drawing/history/CommandManager";
import {
  buildDrawingSettingsCommit,
  buildDrawingSettingsRevert,
} from "./drawing/settings/drawingSettingsTransaction";
import { DrawingIntervalVisibilityFields } from "./drawing/settings/DrawingIntervalVisibilityFields";
import { DrawingCoordinatesFields } from "./drawing/settings/DrawingCoordinatesFields";
import {
  ColorPickerPopover,
  ColorSwatchButton,
} from "@/components/ui/ColorPicker";

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

type Tab = "inputs" | "style" | "coordinates" | "visibility";

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
        "h-[34px] rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[13px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand",
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
    <div className="dialog-field-row flex items-center gap-3 py-[7px]">
      <span className="w-[110px] shrink-0 text-[14px] font-medium text-ink-muted">
        {label}
      </span>
      <div className="dialog-field-controls flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 text-[10px] font-medium uppercase tracking-normal text-ink-faint">
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
          ? "border-brand bg-brand text-[var(--accent-contrast)]"
          : "border-terminal-border-strong bg-transparent hover:border-brand",
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
        "h-[34px] rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[13px] text-ink-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand",
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
    <>
      <ColorSwatchButton color={color} onClick={onToggle} />
      {open && (
        <ColorPickerPopover
          value={color}
          onChange={onPick}
          onClose={onToggle}
        />
      )}
    </>
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
        aria-label="Line style"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex h-[34px] items-center gap-2 rounded-md border border-terminal-border-strong bg-terminal-raised px-2 hover:border-brand"
      >
        <span className="h-6 w-6 rounded bg-terminal-border-strong" />
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
          className="mobile-popover absolute left-0 top-full z-30 mt-1 w-[170px] rounded-md border border-terminal-border-strong bg-terminal-panel-2 p-2 shadow-floating"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] text-ink-faint">Width</span>
            <input
              type="range"
              min={1}
              max={5}
              value={width}
              onChange={(e) => onWidth(Number(e.target.value))}
              className="flex-1 accent-brand"
            />
            <span className="w-6 text-right text-[11px] text-ink-muted">{width}</span>
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
        className="flex h-[34px] w-[180px] items-center justify-between rounded-md border border-terminal-border-strong bg-terminal-raised px-2.5 text-left text-[13px] text-ink-muted hover:border-brand"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="text-ink-faint" />
      </button>
      {open && (
        <div
          className="mobile-popover absolute left-0 top-full z-30 mt-1 w-[230px] rounded-md border border-terminal-border-strong bg-terminal-panel-2 p-1 shadow-floating"
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
                    ? "border-brand bg-brand text-[var(--accent-contrast)]"
                    : "border-terminal-border-strong bg-transparent",
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
  const candles = useAtomValue(candlesAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const saveToolDefaults = useSetAtom(saveDrawingToolDefaultsAtom);
  const [tab, setTab] = useState<Tab>("inputs");
  const [pop, setPop] = useState<string | null>(null);
  const snapshot = useRef<Drawing | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  const drawing = drawings.find((d) => d.id === editingId) ?? null;
  const settings = drawing ? getDrawingSettingsSchema(drawing.tool) : null;
  const isPosition = settings?.profile === "position";

  useEffect(() => {
    if (editingId && drawing && snapshot.current?.id !== editingId) {
      snapshot.current = structuredClone(drawing);
      returnFocus.current = document.activeElement as HTMLElement | null;
      setTab("inputs");
    }
    if (!editingId) {
      snapshot.current = null;
      returnFocus.current?.focus();
    }
    // The immutable snapshot is intentionally captured only when the id opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  useEffect(() => {
    if (editingId && isPosition) dialogRef.current?.focus();
  }, [dialogRef, editingId, isPosition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId) cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, setEditing]);

  if (typeof document === "undefined" || !drawing || !settings || !isPosition) return null;

  const cancel = () => {
    const snap = snapshot.current;
    if (snap?.id === drawing.id) {
      updateDrawing({ id: drawing.id, patch: buildDrawingSettingsRevert(drawing, snap) });
    }
    setEditing(null);
  };
  const ok = () => {
    const snap = snapshot.current;
    if (snap?.id === drawing.id) {
      const change = buildDrawingSettingsCommit(drawing, snap);
      if (change) {
        drawingCommandManager.execute(new PreviewedPropertyChangeCommand(
          updateDrawing, drawing.id,
          change.after, change.before,
        ));
      }
    }
    saveToolDefaults(drawing);
    setEditing(null);
  };
  cancelRef.current = cancel;
  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const isLong = settings.positionSide === "long";
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

  const accountSize = drawing.accountSize ?? 1000;
  const riskValue = drawing.riskValue ?? 25;
  const riskUnit = drawing.riskUnit ?? "%";
  const lotSize = drawing.lotSize ?? 1;
  const leverage = drawing.leverage ?? 1;
  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn(
        "border-b-[3px] px-0 pb-[9px] text-[16px] font-semibold transition-colors",
        tab === id
          ? "border-terminal-border-strong text-ink"
          : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
  return createPortal(
    <div
      data-chart-ui
      className="platform-dialog-overlay fixed inset-0 z-[110] flex items-start justify-center bg-[var(--scrim)] backdrop-blur-sm pt-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${settings.title} settings`}
        tabIndex={-1}
        style={dialogStyle}
        className="platform-dialog flex max-h-[calc(100dvh-32px)] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
      >
        {/* Header */}
        <div
          data-dialog-header
          {...dragHandleProps}
          className={cn(
            "flex items-center justify-between px-5 pb-2 pt-4",
            dragHandleClassName,
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-[20px] font-semibold leading-7 text-ink">
              {settings.title}
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
            <Pencil size={16} className="text-ink-muted" />
          </div>
          <button
            onClick={cancel}
            aria-label="Close settings"
            className="rounded-sm p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        {/* Tabs */}
        <div data-dialog-tabs role="tablist" aria-label="Drawing settings sections" className="mx-5 flex items-center gap-6 border-b border-terminal-border pt-3">
          {(settings.tabs as readonly Tab[]).map((id) => tabBtn(id, id[0].toUpperCase() + id.slice(1)))}
        </div>

        <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                  value={drawing.positionStats ?? DEFAULT_POSITION_STATS}
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
                  checked={drawing.alwaysShowStats !== false}
                  onChange={(v) => patch({ alwaysShowStats: v })}
                />
              </Row>
            </>
          )}

          {tab === "coordinates" && (
            <DrawingCoordinatesFields
              points={drawing.points}
              candles={candles}
              labels={settings.coordinateLabels}
              onChange={(points) => patch({ points })}
            />
          )}

          {tab === "visibility" && (
            <>
              <Row label="Labels">
                <button
                  onClick={() => patch({ showLabels: drawing.showLabels === false })}
                  className={cn(
                    "rounded border px-2.5 py-1 text-xs transition-colors",
                    drawing.showLabels !== false
                      ? "border-terminal-border-strong bg-brand text-[var(--accent-contrast)]"
                      : "border-terminal-border-strong text-ink-muted hover:bg-terminal-hover hover:text-ink",
                  )}
                >
                  {drawing.showLabels !== false ? "Shown" : "Hidden"}
                </button>
              </Row>
              <DrawingIntervalVisibilityFields
                value={drawing.intervalVisibility}
                currentTimeframe={timeframe}
                onChange={(intervalVisibility) => patch({ intervalVisibility })}
              />
            </>
          )}
        </div>
        <div data-dialog-footer className="flex h-[58px] shrink-0 items-center justify-between border-t border-terminal-border px-5">
          <button
            type="button"
            className="flex h-[34px] min-w-[104px] items-center justify-between rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[13px] font-medium text-ink hover:border-brand"
          >
            <span>Template</span>
            <ChevronDown size={15} className="text-ink-faint" />
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={cancel}
              className="h-[34px] rounded-[5px] border border-terminal-border-strong bg-transparent px-3.5 text-[14px] font-semibold text-ink hover:bg-terminal-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={ok}
              className="h-[34px] rounded-[5px] border border-terminal-border-strong bg-brand px-4 text-[14px] font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover"
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
