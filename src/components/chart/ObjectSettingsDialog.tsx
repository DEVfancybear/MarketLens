"use client";
/**
 * ObjectSettingsDialog — TradingView-style settings dialog for every drawing
 * EXCEPT the Long/Short position tool (that keeps its own richer
 * `PositionSettingsDialog`). Both read `editingDrawingIdAtom`; this one bails
 * out for position tools so the two never render at once.
 *
 * Layout mirrors TradingView's object dialog:
 *   • Tabs: Style · Text · Coordinates · Visibility (Text hidden for plain lines)
 *   • Style (shape): Extend · Border · Middle line · Background
 *   • Style (line):  Line color + width/style
 *   • Text: colour + font size + Bold/Italic, a text area, and alignment
 *   • Footer: Template ▼ (save/apply/delete) · Cancel · Ok
 * Edits apply live for preview; Cancel reverts to the snapshot taken on open.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Bold, Italic, ChevronDown, Pencil, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingDrawingIdAtom,
  candlesAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  updateDrawingAtom,
  drawingTemplatesAtom,
  saveTemplateAtom,
  applyTemplateAtom,
  deleteTemplateAtom,
} from "@/store/chartStore";
import {
  DEFAULT_FIB_LEVELS,
  styleFamily,
  type Drawing,
  type FibAlignH,
  type FibAlignV,
  type FibLevelConfig,
  type FibTextMode,
  type LineStyle,
} from "@/types";
import { cn } from "@/utils/cn";
import { NumberField, Row, SectionTitle } from "./PositionSettingsDialog";
import { SaveDrawingTemplateDialog } from "./SaveDrawingTemplateDialog";

// A TradingView-like colour palette (two rows of brand-ish swatches).
const COLORS = [
  "#ffffff", "#d1d4dc", "#9598a1", "#5d606b", "#363a45", "#000000",
  "#f23645", "#ff9800", "#ffeb3b", "#26a69a", "#2962ff", "#ab47bc",
  "#e91e63", "#ff5722", "#cddc39", "#089981", "#0c3299", "#673ab7",
];
const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40];
const LINE_STYLES: { value: LineStyle; dash: string }[] = [
  { value: "solid", dash: "" },
  { value: "dashed", dash: "6 4" },
  { value: "dotted", dash: "2 4" },
];
const EXTEND_OPTS: { value: NonNullable<Drawing["extend"]>; label: string }[] = [
  { value: "none", label: "Don't extend" },
  { value: "left", label: "Extend left" },
  { value: "right", label: "Extend right" },
  { value: "both", label: "Extend both" },
];
const V_ALIGN: { value: NonNullable<Drawing["textVAlign"]>; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];
const H_ALIGN: { value: NonNullable<Drawing["textHAlign"]>; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const FIB_LEVEL_MODES: { value: FibTextMode; label: string }[] = [
  { value: "values", label: "Values" },
  { value: "percent", label: "Percents" },
];
const FIB_H_ALIGN: { value: FibAlignH; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const FIB_V_ALIGN: { value: FibAlignV; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

type Tab = "style" | "text" | "coordinates" | "visibility";

function toLocalInput(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string): number | null {
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

function isFibTool(tool: Drawing["tool"]): boolean {
  return tool === "fib" || tool === "fibRetracement" || tool === "fibExtension";
}

function fibTitle(tool: Drawing["tool"]): string {
  if (tool === "fibExtension") return "Trend-Based Fib Extension";
  return "Fib retracement";
}

function normalizedFibLevels(d: Drawing): FibLevelConfig[] {
  return DEFAULT_FIB_LEVELS.map((base, i) => {
    const custom = d.fibLevels?.[i];
    return {
      ...base,
      ...(custom ?? {}),
      value: Number.isFinite(custom?.value) ? custom!.value : base.value,
      color: custom?.color || base.color,
      enabled: custom?.enabled ?? base.enabled,
    };
  });
}

// ---- small presentational helpers --------------------------------------

/** Checkbox that matches the dialog look. */
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
        "flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors",
        checked
          ? "border-white bg-white text-[#1e1e1e]"
          : "border-[#8a8d93] bg-transparent hover:border-ink",
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

/** A colour swatch button. Shows a checkerboard behind translucent fills. */
function Swatch({
  color,
  opacity,
  onClick,
}: {
  color: string | undefined;
  opacity?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="relative h-7 w-9 shrink-0 overflow-hidden rounded border border-terminal-border"
      style={{
        backgroundImage:
          "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%,#555),linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%,#555)",
        backgroundSize: "8px 8px",
        backgroundPosition: "0 0,4px 4px",
      }}
    >
      <span
        className="absolute inset-0"
        style={{
          background: color && color !== "none" ? color : "transparent",
          opacity: opacity ?? 1,
        }}
      />
    </button>
  );
}

/** Popover with a colour grid, custom picker, optional opacity + "No color". */
function ColorPopover({
  value,
  opacity,
  onPick,
  onOpacity,
  allowNone,
  onClose,
}: {
  value: string | undefined;
  opacity?: number;
  onPick: (c: string | null) => void;
  onOpacity?: (o: number) => void;
  allowNone?: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-0 top-full z-30 mt-1 w-[184px] rounded-md border border-terminal-border bg-terminal-panel-2 p-2 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-6 gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => {
              onPick(c);
              onClose();
            }}
            className="relative h-5 w-5 rounded border border-terminal-border"
            style={{ background: c }}
          >
            {value?.toLowerCase() === c.toLowerCase() && (
              <Check size={11} className="absolute inset-0 m-auto text-black/70" />
            )}
          </button>
        ))}
      </div>
      {onOpacity && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-2xs text-ink-muted">Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((opacity ?? 1) * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            className="flex-1 accent-brand"
          />
          <span className="w-8 text-right text-2xs text-ink">
            {Math.round((opacity ?? 1) * 100)}%
          </span>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 border-t border-terminal-border pt-2">
        <label className="flex items-center gap-1.5 text-2xs text-ink-muted">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#2962ff"}
            onChange={(e) => onPick(e.target.value)}
            className="h-5 w-6 cursor-pointer rounded border border-terminal-border bg-transparent p-0"
          />
          Custom
        </label>
        {allowNone && (
          <button
            onClick={() => {
              onPick(null);
              onClose();
            }}
            className="ml-auto rounded px-1.5 py-0.5 text-2xs text-ink-muted hover:bg-terminal-hover"
          >
            No color
          </button>
        )}
      </div>
    </div>
  );
}

/** A line preview button (shows current width + style) that opens a popover. */
function LineWidget({
  color,
  width,
  style,
  open,
  onToggle,
  onWidth,
  onStyle,
  onClose,
}: {
  color: string;
  width: number;
  style: LineStyle;
  open: boolean;
  onToggle: () => void;
  onWidth: (w: number) => void;
  onStyle: (s: LineStyle) => void;
  onClose: () => void;
}) {
  const dash = LINE_STYLES.find((s) => s.value === style)?.dash || undefined;
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex h-7 items-center gap-1.5 rounded border border-terminal-border px-2 hover:bg-terminal-hover"
      >
        <svg width="32" height="12" className="text-ink" style={{ color }}>
          <line x1="1" y1="6" x2="31" y2="6" stroke="currentColor" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
        </svg>
        <ChevronDown size={12} className="text-ink-muted" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-[160px] rounded-md border border-terminal-border bg-terminal-panel-2 p-2 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-2xs text-ink-muted">Width</span>
            <input
              type="range"
              min={1}
              max={10}
              value={width}
              onChange={(e) => onWidth(Number(e.target.value))}
              className="flex-1 accent-brand"
            />
            <span className="w-7 text-right text-2xs text-ink">{width}px</span>
          </div>
          {LINE_STYLES.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                onStyle(s.value);
                onClose();
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-terminal-hover"
            >
              <svg width="80" height="10" className="text-ink">
                <line x1="1" y1="5" x2="79" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={s.dash || undefined} />
              </svg>
              {style === s.value && <Check size={12} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        const match = options.find((o) => String(o.value) === v);
        if (match) onChange(match.value);
      }}
      className="rounded-md border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---- dialog -------------------------------------------------------------

export function ObjectSettingsDialog() {
  const editingId = useAtomValue(editingDrawingIdAtom);
  const candles = useAtomValue(candlesAtom);
  const drawings = useAtomValue(drawingsAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const templates = useAtomValue(drawingTemplatesAtom);
  const saveTemplate = useSetAtom(saveTemplateAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
  const deleteTemplate = useSetAtom(deleteTemplateAtom);

  const [tab, setTab] = useState<Tab>("style");
  const [pop, setPop] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  // Snapshot of the object as it was when the dialog opened (for Cancel).
  const snapshot = useRef<Drawing | null>(null);
  // Latest cancel handler, so the keydown effect can call it without TDZ.
  const cancelRef = useRef<() => void>(() => {});
  const templateDialogOpenRef = useRef(false);
  templateDialogOpenRef.current = templateDialogOpen;

  const drawing = drawings.find((d) => d.id === editingId) ?? null;
  const isPosition = drawing?.tool === "long" || drawing?.tool === "short";

  // Capture the original style once per opened object.
  useEffect(() => {
    if (editingId && drawing && snapshot.current?.id !== editingId) {
      snapshot.current = JSON.parse(JSON.stringify(drawing));
    }
    if (!editingId) snapshot.current = null;
    setTab("style");
    setPop(null);
    setTplOpen(false);
    setTemplateDialogOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId && !templateDialogOpenRef.current) {
        cancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId]);

  if (typeof document === "undefined" || !drawing || isPosition) return null;

  const family = styleFamily(drawing.tool);
  const isFib = isFibTool(drawing.tool);
  const isText = family === "text";
  const isShape = family === "shape";
  // Extend / Middle line / inner text are wired only for the plain rectangle.
  const isRect = drawing.tool === "rectangle";
  const hasTextTab = !isFib && (isRect || isText);

  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const cancel = () => {
    const snap = snapshot.current;
    if (snap && snap.id === drawing.id) {
      // Full revert: cover every key in either the current or the snapshot
      // object so fields ADDED during editing (e.g. bold) are cleared too —
      // a plain `{...d, ...snap}` merge would keep them (JSON drops undefined).
      const revert: Record<string, unknown> = {};
      for (const k of new Set([
        ...Object.keys(drawing),
        ...Object.keys(snap),
      ]))
        revert[k] = (snap as unknown as Record<string, unknown>)[k];
      updateDrawing({ id: drawing.id, patch: revert as Partial<Drawing> });
    }
    setEditing(null);
  };
  const ok = () => setEditing(null);
  cancelRef.current = cancel;

  const setPoint = (idx: number, p: Partial<{ time: number; price: number }>) => {
    const pts = drawing.points.map((q) => ({ ...q }));
    if (pts[idx]) {
      pts[idx] = { ...pts[idx], ...p };
      patch({ points: pts });
    }
  };
  const barForTime = (time: number): number => {
    if (candles.length === 0) return 0;
    let best = 0;
    let bestDist = Math.abs(candles[0].time - time);
    for (let i = 1; i < candles.length; i++) {
      const dist = Math.abs(candles[i].time - time);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    return best;
  };
  const setPointBar = (idx: number, bar: number) => {
    if (candles.length === 0) return;
    const safe = Math.max(0, Math.min(candles.length - 1, Math.round(bar)));
    setPoint(idx, { time: candles[safe].time });
  };
  const fibLevels = normalizedFibLevels(drawing);
  const patchFibLevel = (idx: number, p: Partial<FibLevelConfig>) => {
    const next = normalizedFibLevels(drawing);
    if (!next[idx]) return;
    next[idx] = { ...next[idx], ...p };
    patch({ fibLevels: next });
  };

  const onSaveTemplate = () => {
    setTplOpen(false);
    setPop(null);
    setTemplateDialogOpen(true);
  };
  const familyTemplates = templates.filter((t) => t.family === family);

  const tabs: Tab[] = isFib
    ? ["style", "coordinates", "visibility"]
    : [
        "style",
        ...(hasTextTab ? (["text"] as Tab[]) : []),
        "coordinates",
        "visibility",
      ];

  const tabBtn = (id: Tab) => (
    <button
      key={id}
      onClick={() => {
        setTab(id);
        setPop(null);
      }}
      className={cn(
        isFib
          ? "border-b-[3px] px-0 pb-[9px] text-[16px] font-semibold capitalize transition-colors"
          : "border-b-2 px-1 pb-2 text-sm capitalize transition-colors",
        tab === id
          ? isFib
            ? "border-[#f0f0f0] text-[#f0f0f0]"
            : "border-brand text-ink"
          : isFib
            ? "border-transparent text-[#d1d4dc] hover:text-[#f0f0f0]"
            : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {id}
    </button>
  );

  return createPortal(
    <>
      <div
      data-chart-ui
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 pt-16"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className={cn(
          isFib
            ? "flex max-h-[calc(100vh-32px)] w-[456px] flex-col overflow-hidden border border-[#3a3a3a] bg-[#1f1f1f] shadow-2xl shadow-black/70"
            : "w-[360px] overflow-visible rounded-xl border border-terminal-border bg-terminal-panel-2 shadow-2xl shadow-black/60",
        )}
        onClick={() => {
          setPop(null);
          setTplOpen(false);
        }}
      >
        {isFib && (
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-[20px] font-semibold leading-7 text-[#f0f0f0]">
                {fibTitle(drawing.tool)}
              </span>
              <Pencil size={16} className="text-[#d1d4dc]" />
            </div>
            <button
              onClick={cancel}
              className="rounded-sm p-1 text-[#d1d4dc] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]"
            >
              <X size={24} strokeWidth={1.5} />
            </button>
          </div>
        )}
        {/* Tabs */}
        <div
          className={cn(
            isFib
              ? "mx-5 flex items-center gap-6 border-b border-[#5a5a5a] pt-3"
              : "flex items-center gap-5 border-b border-terminal-border px-4 pt-3",
          )}
        >
          {tabs.map(tabBtn)}
        </div>

        <div
          className={cn(
            isFib
              ? "flex-1 overflow-y-auto px-5 py-4"
              : "min-h-[180px] px-4 py-3",
          )}
        >
          {/* -------------------------------------------------- STYLE */}
          {tab === "style" && (
            <>
              {isFib && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 py-[7px]">
                      <CheckBox
                        checked={drawing.fibTrendLine !== false}
                        onChange={(v) => patch({ fibTrendLine: v })}
                      />
                      <span className="w-[88px] shrink-0 text-[14px] font-medium text-[#d1d4dc]">
                        Trend line
                      </span>
                      <div className="relative">
                        <Swatch
                          color={drawing.fibTrendLineColor ?? drawing.color}
                          onClick={() =>
                            setPop(pop === "fib-trend-color" ? null : "fib-trend-color")
                          }
                        />
                        {pop === "fib-trend-color" && (
                          <ColorPopover
                            value={drawing.fibTrendLineColor ?? drawing.color}
                            onPick={(c) => c && patch({ fibTrendLineColor: c })}
                            onClose={() => setPop(null)}
                          />
                        )}
                      </div>
                      <LineWidget
                        color={drawing.fibTrendLineColor ?? drawing.color}
                        width={drawing.fibTrendLineWidth ?? drawing.lineWidth ?? 1}
                        style={drawing.fibTrendLineStyle ?? "dashed"}
                        open={pop === "fib-trend-line"}
                        onToggle={() =>
                          setPop(pop === "fib-trend-line" ? null : "fib-trend-line")
                        }
                        onWidth={(w) => patch({ fibTrendLineWidth: w })}
                        onStyle={(s) => patch({ fibTrendLineStyle: s })}
                        onClose={() => setPop(null)}
                      />
                    </div>
                    <Row label="Levels line">
                      <LineWidget
                        color={drawing.fibLevelLineColor ?? drawing.color}
                        width={drawing.fibLevelLineWidth ?? drawing.lineWidth ?? 1}
                        style={drawing.fibLevelLineStyle ?? drawing.lineStyle ?? "solid"}
                        open={pop === "fib-level-line"}
                        onToggle={() =>
                          setPop(pop === "fib-level-line" ? null : "fib-level-line")
                        }
                        onWidth={(w) => patch({ fibLevelLineWidth: w })}
                        onStyle={(s) => patch({ fibLevelLineStyle: s })}
                        onClose={() => setPop(null)}
                      />
                    </Row>
                    <Row label="Extend">
                      <Select
                        value={drawing.extend ?? "none"}
                        options={EXTEND_OPTS}
                        onChange={(v) => patch({ extend: v })}
                      />
                    </Row>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 py-2">
                      {fibLevels.map((level, index) => (
                        <div key={`${index}-${level.value}`} className="flex items-center gap-2">
                          <CheckBox
                            checked={level.enabled}
                            onChange={(v) => patchFibLevel(index, { enabled: v })}
                          />
                          <NumberField
                            value={Number(level.value)}
                            onCommit={(v) => patchFibLevel(index, { value: v })}
                            className={cn(
                              "h-[34px] w-[98px]",
                              !level.enabled && "opacity-45",
                            )}
                          />
                          <div className="relative">
                            <Swatch
                              color={level.color}
                              onClick={() =>
                                setPop(pop === `fib-level-${index}` ? null : `fib-level-${index}`)
                              }
                            />
                            {pop === `fib-level-${index}` && (
                              <ColorPopover
                                value={level.color}
                                onPick={(c) => c && patchFibLevel(index, { color: c })}
                                onClose={() => setPop(null)}
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 h-px bg-[#3a3a3a]" />

                    <Row label="Use one color">
                      <CheckBox
                        checked={!!drawing.fibUseOneColor}
                        onChange={(v) => patch({ fibUseOneColor: v })}
                      />
                      <div className="relative">
                        <Swatch
                          color={drawing.fibLevelLineColor ?? drawing.color}
                          onClick={() =>
                            setPop(pop === "fib-one-color" ? null : "fib-one-color")
                          }
                        />
                        {pop === "fib-one-color" && (
                          <ColorPopover
                            value={drawing.fibLevelLineColor ?? drawing.color}
                            onPick={(c) =>
                              c && patch({ fibUseOneColor: true, fibLevelLineColor: c })
                            }
                            onClose={() => setPop(null)}
                          />
                        )}
                      </div>
                    </Row>
                    <div className="flex items-center gap-3 py-[7px]">
                      <CheckBox
                        checked={drawing.fibBackground !== false}
                        onChange={(v) => patch({ fibBackground: v })}
                      />
                      <span className="w-[88px] shrink-0 text-[14px] font-medium text-[#d1d4dc]">
                        Background
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((drawing.opacity ?? 0.12) * 100)}
                        onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
                        className="w-[150px] accent-[#2962ff]"
                      />
                    </div>
                    <Row label="Reverse">
                      <CheckBox
                        checked={!!drawing.fibReverse}
                        onChange={(v) => patch({ fibReverse: v })}
                      />
                    </Row>
                    <Row label="Prices">
                      <CheckBox
                        checked={drawing.fibShowPrices !== false}
                        onChange={(v) => patch({ fibShowPrices: v })}
                      />
                    </Row>
                    <Row label="Levels">
                      <CheckBox
                        checked={drawing.fibShowLevels !== false}
                        onChange={(v) => patch({ fibShowLevels: v })}
                      />
                      <Select
                        value={drawing.fibLevelsFormat ?? "values"}
                        options={FIB_LEVEL_MODES}
                        onChange={(v) => patch({ fibLevelsFormat: v })}
                      />
                    </Row>
                    <Row label="Labels">
                      <Select
                        value={drawing.fibLabelsHAlign ?? "left"}
                        options={FIB_H_ALIGN}
                        onChange={(v) => patch({ fibLabelsHAlign: v })}
                      />
                      <Select
                        value={drawing.fibLabelsVAlign ?? "middle"}
                        options={FIB_V_ALIGN}
                        onChange={(v) => patch({ fibLabelsVAlign: v })}
                      />
                    </Row>
                    <Row label="Text">
                      <CheckBox
                        checked={drawing.fibShowText !== false}
                        onChange={(v) => patch({ fibShowText: v })}
                      />
                      <Select
                        value={drawing.fibTextHAlign ?? "center"}
                        options={FIB_H_ALIGN}
                        onChange={(v) => patch({ fibTextHAlign: v })}
                      />
                      <Select
                        value={drawing.fibTextVAlign ?? "middle"}
                        options={FIB_V_ALIGN}
                        onChange={(v) => patch({ fibTextVAlign: v })}
                      />
                    </Row>
                    <Row label="Font size">
                      <Select
                        value={drawing.fontSize ?? 12}
                        options={FONT_SIZES.map((s) => ({ value: s, label: String(s) }))}
                        onChange={(v) => patch({ fontSize: v })}
                      />
                    </Row>
                    <Row label="Fib levels based on log scale">
                      <CheckBox
                        checked={!!drawing.fibLogScale}
                        onChange={(v) => patch({ fibLogScale: v })}
                      />
                    </Row>
                  </div>
                </>
              )}

              {!isFib && isShape && (
                <>
                  {isRect && (
                    <Row label="Extend">
                      <Select
                        value={drawing.extend ?? "none"}
                        options={EXTEND_OPTS}
                        onChange={(v) => patch({ extend: v })}
                      />
                    </Row>
                  )}
                  <Row label="Border">
                    <div className="relative flex items-center gap-2">
                      <Swatch
                        color={drawing.color}
                        onClick={() =>
                          setPop(pop === "border-c" ? null : "border-c")
                        }
                      />
                      {pop === "border-c" && (
                        <ColorPopover
                          value={drawing.color}
                          onPick={(c) => c && patch({ color: c })}
                          onClose={() => setPop(null)}
                        />
                      )}
                      <LineWidget
                        color={drawing.color}
                        width={drawing.lineWidth ?? 2}
                        style={drawing.lineStyle ?? "solid"}
                        open={pop === "border-l"}
                        onToggle={() =>
                          setPop(pop === "border-l" ? null : "border-l")
                        }
                        onWidth={(w) => patch({ lineWidth: w })}
                        onStyle={(s) => patch({ lineStyle: s })}
                        onClose={() => setPop(null)}
                      />
                    </div>
                  </Row>
                  {isRect && (
                    <Row label="Middle line">
                      <CheckBox
                        checked={!!drawing.showMiddleLine}
                        onChange={(v) => patch({ showMiddleLine: v })}
                      />
                      <div className="relative flex items-center gap-2">
                        <Swatch
                          color={drawing.middleLineColor ?? drawing.color}
                          onClick={() =>
                            setPop(pop === "mid-c" ? null : "mid-c")
                          }
                        />
                        {pop === "mid-c" && (
                          <ColorPopover
                            value={drawing.middleLineColor ?? drawing.color}
                            onPick={(c) => c && patch({ middleLineColor: c })}
                            onClose={() => setPop(null)}
                          />
                        )}
                        <LineWidget
                          color={drawing.middleLineColor ?? drawing.color}
                          width={drawing.lineWidth ?? 2}
                          style={drawing.middleLineStyle ?? "dashed"}
                          open={pop === "mid-l"}
                          onToggle={() =>
                            setPop(pop === "mid-l" ? null : "mid-l")
                          }
                          onWidth={(w) => patch({ lineWidth: w })}
                          onStyle={(s) => patch({ middleLineStyle: s })}
                          onClose={() => setPop(null)}
                        />
                      </div>
                    </Row>
                  )}
                  <Row label="Background">
                    <CheckBox
                      checked={!!drawing.fillColor && drawing.fillColor !== "none"}
                      onChange={(v) =>
                        patch({ fillColor: v ? drawing.fillColor ?? drawing.color : undefined })
                      }
                    />
                    <div className="relative flex items-center gap-2">
                      <Swatch
                        color={drawing.fillColor ?? drawing.color}
                        opacity={drawing.opacity ?? 0.3}
                        onClick={() => setPop(pop === "bg-c" ? null : "bg-c")}
                      />
                      {pop === "bg-c" && (
                        <ColorPopover
                          value={drawing.fillColor ?? drawing.color}
                          opacity={drawing.opacity ?? 0.3}
                          onPick={(c) => patch({ fillColor: c ?? undefined })}
                          onOpacity={(o) => patch({ opacity: o })}
                          allowNone
                          onClose={() => setPop(null)}
                        />
                      )}
                    </div>
                  </Row>
                </>
              )}

              {!isFib && !isShape && !isText && (
                <Row label="Line">
                  <div className="relative flex items-center gap-2">
                    <Swatch
                      color={drawing.color}
                      onClick={() =>
                        setPop(pop === "border-c" ? null : "border-c")
                      }
                    />
                    {pop === "border-c" && (
                      <ColorPopover
                        value={drawing.color}
                        onPick={(c) => c && patch({ color: c })}
                        onClose={() => setPop(null)}
                      />
                    )}
                    <LineWidget
                      color={drawing.color}
                      width={drawing.lineWidth ?? 2}
                      style={drawing.lineStyle ?? "solid"}
                      open={pop === "border-l"}
                      onToggle={() =>
                        setPop(pop === "border-l" ? null : "border-l")
                      }
                      onWidth={(w) => patch({ lineWidth: w })}
                      onStyle={(s) => patch({ lineStyle: s })}
                      onClose={() => setPop(null)}
                    />
                  </div>
                </Row>
              )}

              {!isFib && isText && (
                <p className="py-6 text-center text-xs text-ink-muted">
                  Edit text and font on the <b className="text-ink">Text</b> tab.
                </p>
              )}
            </>
          )}

          {/* --------------------------------------------------- TEXT */}
          {tab === "text" && hasTextTab && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative">
                  <Swatch
                    color={drawing.textColor ?? drawing.color}
                    onClick={() => setPop(pop === "text-c" ? null : "text-c")}
                  />
                  {pop === "text-c" && (
                    <ColorPopover
                      value={drawing.textColor ?? drawing.color}
                      onPick={(c) => c && patch({ textColor: c })}
                      onClose={() => setPop(null)}
                    />
                  )}
                </div>
                <Select
                  value={drawing.fontSize ?? (isShape ? 14 : 13)}
                  options={FONT_SIZES.map((s) => ({ value: s, label: String(s) }))}
                  onChange={(v) => patch({ fontSize: v })}
                />
                <button
                  onClick={() => patch({ bold: !drawing.bold })}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded border transition-colors",
                    drawing.bold
                      ? "border-brand bg-brand/15 text-brand"
                      : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                  )}
                >
                  <Bold size={14} />
                </button>
                <button
                  onClick={() => patch({ italic: !drawing.italic })}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded border transition-colors",
                    drawing.italic
                      ? "border-brand bg-brand/15 text-brand"
                      : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                  )}
                >
                  <Italic size={14} />
                </button>
              </div>
              <textarea
                value={drawing.text ?? ""}
                onChange={(e) => patch({ text: e.target.value })}
                placeholder="Add text"
                rows={isShape ? 4 : 3}
                className="w-full resize-none rounded-md border border-brand bg-terminal-bg px-2.5 py-2 text-xs text-ink outline-none placeholder:text-ink-faint"
              />
              {isShape && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs text-ink-muted">Text alignment</span>
                  <Select
                    value={drawing.textVAlign ?? "middle"}
                    options={V_ALIGN}
                    onChange={(v) => patch({ textVAlign: v })}
                  />
                  <Select
                    value={drawing.textHAlign ?? "center"}
                    options={H_ALIGN}
                    onChange={(v) => patch({ textHAlign: v })}
                  />
                </div>
              )}
            </>
          )}

          {/* -------------------------------------------- COORDINATES */}
          {tab === "coordinates" && (
            <>
              {isFib ? (
                <div className="space-y-4 py-2">
                  {drawing.points.map((pt, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-[100px] shrink-0 text-[14px] font-medium text-[#d1d4dc]">
                        #{i + 1} (price, bar)
                      </span>
                      <NumberField
                        value={Number(pt.price.toFixed(6))}
                        onCommit={(v) => setPoint(i, { price: v })}
                        className="w-[100px]"
                      />
                      <NumberField
                        value={barForTime(pt.time)}
                        onCommit={(v) => setPointBar(i, v)}
                        className="w-[100px]"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                drawing.points.map((pt, i) => (
                  <div key={i}>
                    <SectionTitle>Point {i + 1}</SectionTitle>
                    <Row label="Price">
                      <NumberField
                        value={Number(pt.price.toFixed(6))}
                        onCommit={(v) => setPoint(i, { price: v })}
                        className="flex-1"
                      />
                    </Row>
                    <Row label="Date / time">
                      <input
                        type="datetime-local"
                        value={toLocalInput(pt.time)}
                        onChange={(e) => {
                          const t = fromLocalInput(e.target.value);
                          if (t != null) setPoint(i, { time: t });
                        }}
                        className="flex-1 rounded-md border border-terminal-border bg-terminal-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand"
                      />
                    </Row>
                  </div>
                ))
              )}
            </>
          )}

          {/* --------------------------------------------- VISIBILITY */}
          {tab === "visibility" && (
            <Row label="On chart">
              <button
                onClick={() => patch({ visible: drawing.visible === false })}
                className={cn(
                  "rounded border px-2.5 py-1 text-xs transition-colors",
                  drawing.visible !== false
                    ? "border-brand/40 bg-brand/15 text-brand"
                    : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                )}
              >
                {drawing.visible !== false ? "Shown" : "Hidden"}
              </button>
            </Row>
          )}
        </div>

        {/* Footer: Template ▼ · Cancel · Ok */}
        <div
          className={cn(
            "flex items-center justify-between border-t",
            isFib
              ? "h-[58px] shrink-0 border-[#3a3a3a] px-5"
              : "border-terminal-border px-4 py-3",
          )}
        >
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTplOpen((o) => !o);
                setPop(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-terminal-hover",
                isFib
                  ? "h-[34px] min-w-[104px] border-[#50535a] bg-[#1f1f1f] text-[13px] font-medium text-[#f0f0f0]"
                  : "border-terminal-border text-ink",
              )}
            >
              Template
              <ChevronDown size={13} className="text-ink-muted" />
            </button>
            {tplOpen && (
              <div
                className="absolute bottom-full left-0 z-30 mb-1 w-[180px] rounded-md border border-terminal-border bg-terminal-panel-2 p-1 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={onSaveTemplate}
                  className="w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                >
                  Save as template…
                </button>
                {familyTemplates.length > 0 && (
                  <div className="my-1 h-px bg-terminal-border" />
                )}
                {familyTemplates.map((t) => (
                  <div
                    key={t.name}
                    className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-ink hover:bg-terminal-hover"
                  >
                    <button
                      onClick={() => {
                        applyTemplate({ id: drawing.id, template: t });
                        setTplOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-terminal-border"
                        style={{ background: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </button>
                    <button
                      title="Delete template"
                      onClick={() =>
                        deleteTemplate({ name: t.name, family: t.family })
                      }
                      className="rounded px-1 text-ink-faint opacity-0 hover:text-bear group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancel}
              className={cn(
                "rounded-md border px-4 py-1.5 text-xs hover:bg-terminal-hover",
                isFib
                  ? "h-[34px] border-[#f0f0f0] bg-transparent px-3.5 text-[14px] font-semibold text-[#f0f0f0] hover:bg-[#2a2a2a]"
                  : "border-terminal-border text-ink",
              )}
            >
              Cancel
            </button>
            <button
              onClick={ok}
              className={cn(
                "rounded-md px-5 py-1.5 text-xs font-medium",
                isFib
                  ? "h-[34px] border border-[#f0f0f0] bg-[#f0f0f0] px-4 text-[14px] font-semibold text-[#1f1f1f] hover:bg-white"
                  : "bg-brand text-white hover:bg-brand/90",
              )}
            >
              Ok
            </button>
          </div>
        </div>
      </div>
      </div>
      <SaveDrawingTemplateDialog
        open={templateDialogOpen}
        templates={familyTemplates}
        onCloseAction={() => setTemplateDialogOpen(false)}
        onSaveAction={(name) => saveTemplate({ id: drawing.id, name })}
      />
    </>,
    document.body,
  );
}
