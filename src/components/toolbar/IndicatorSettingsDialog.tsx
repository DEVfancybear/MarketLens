"use client";
/**
 * IndicatorSettingsDialog — modal for customising indicator parameters.
 * Opened from the gear icon on an indicator pane or from the indicator menu.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingIndicatorIdAtom,
  indicatorsAtom,
  setEditingIndicatorAtom,
  updateIndicatorAtom,
  removeIndicatorAtom,
} from "@/store/chartStore";
import type { IndicatorConfig, IndicatorType } from "@/types";
import { defaultIndicator } from "@/services/indicators";
import { cn } from "@/utils/cn";

const INDICATOR_TYPES: { type: IndicatorType; label: string }[] = [
  { type: "SMA", label: "Simple Moving Average" },
  { type: "EMA", label: "Exponential Moving Average" },
  { type: "VWAP", label: "VWAP (session)" },
  { type: "RSI", label: "Relative Strength Index" },
  { type: "MACD", label: "MACD" },
  { type: "ADR", label: "Average Daily Range" },
];

const PRESET_COLORS = [
  "#2962ff",
  "#26a69a",
  "#ef5350",
  "#ff9800",
  "#ab47bc",
  "#00bcd4",
  "#8bc34a",
  "#ffeb3b",
  "#ffffff",
  "#78909c",
];

function ColorChip({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-5 w-5 rounded-full border border-terminal-border transition-transform",
        selected && "ring-1 ring-white/80 scale-110",
      )}
      style={{ background: color }}
      title={color}
    />
  );
}

function SliderInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-2xs text-ink-muted shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-brand"
      />
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="w-12 rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-center text-2xs text-ink"
      />
    </div>
  );
}

export function IndicatorSettingsDialog() {
  const editingId = useAtomValue(editingIndicatorIdAtom);
  const indicators = useAtomValue(indicatorsAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const updateIndicator = useSetAtom(updateIndicatorAtom);
  const removeIndicator = useSetAtom(removeIndicatorAtom);

  const indicator = indicators.find((i) => i.id === editingId);
  const isNew = indicator == null;

  const [type, setType] = useState<IndicatorType>("SMA");
  const [length, setLength] = useState(50);
  const [length2, setLength2] = useState(9);
  const [length3, setLength3] = useState(26);
  const [color, setColor] = useState("#2962ff");
  const [color2, setColor2] = useState("#ff9800");
  const [separatePane, setSeparatePane] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (indicator) {
      setType(indicator.type);
      setLength(indicator.length);
      setLength2(indicator.length2 ?? 9);
      setLength3(indicator.length3 ?? 26);
      setColor(indicator.color);
      setColor2(indicator.color2 ?? "#ff9800");
      setSeparatePane(indicator.separatePane ?? false);
      setVisible(indicator.visible);
    }
  }, [editingId, indicator]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId) setEditingIndicator(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, setEditingIndicator]);

  if (typeof document === "undefined" || !editingId) return null;

  const close = () => setEditingIndicator(null);

  const save = () => {
    const patch: Partial<IndicatorConfig> = {
      type,
      length,
      length2: type === "MACD" ? length2 : undefined,
      length3: type === "MACD" ? length3 : undefined,
      color,
      color2: type === "MACD" || type === "ADR" ? color2 : undefined,
      separatePane:
        type === "RSI" || type === "MACD" ? separatePane : undefined,
      visible,
    };
    updateIndicator({ id: editingId, patch });
    close();
  };

  const handleRemove = () => {
    removeIndicator(editingId);
    close();
  };

  const handleTypeChange = (t: IndicatorType) => {
    setType(t);
    const def = defaultIndicator(t, editingId);
    setLength(def.length);
    setLength2(def.length2 ?? 9);
    setLength3(def.length3 ?? 26);
    setColor(def.color);
    setColor2(def.color2 ?? "#ff9800");
    setSeparatePane(def.separatePane ?? false);
  };

  const showColor2 = type === "MACD" || type === "ADR";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="w-[340px] rounded-lg border border-terminal-border bg-terminal-panel-2 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between border-b border-terminal-border px-4 py-2.5">
          <span className="text-xs font-semibold text-ink">
            {isNew ? "Add indicator" : `Edit ${indicator?.type}`}
          </span>
          <button
            onClick={close}
            className="rounded p-0.5 text-ink-muted hover:text-ink hover:bg-terminal-hover"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          {/* Type selector */}
          <div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
              Type
            </div>
            <div className="grid grid-cols-2 gap-1">
              {INDICATOR_TYPES.map((it) => (
                <button
                  key={it.type}
                  onClick={() => handleTypeChange(it.type)}
                  className={cn(
                    "rounded border px-2 py-1.5 text-left text-2xs transition-colors",
                    type === it.type
                      ? "border-brand/40 bg-brand/15 text-brand"
                      : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                  )}
                >
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          {/* Length */}
          {(type === "SMA" ||
            type === "EMA" ||
            type === "RSI" ||
            type === "MACD" ||
            type === "ADR") && (
            <SliderInput
              label="Length"
              value={length}
              min={1}
              max={500}
              onChange={setLength}
            />
          )}

          {/* MACD slow */}
          {type === "MACD" && (
            <SliderInput
              label="Slow"
              value={length3}
              min={1}
              max={500}
              onChange={setLength3}
            />
          )}

          {/* MACD signal */}
          {type === "MACD" && (
            <SliderInput
              label="Signal"
              value={length2}
              min={1}
              max={200}
              onChange={setLength2}
            />
          )}

          {/* Color 1 */}
          <div>
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
              Color
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <ColorChip
                  key={c}
                  color={c}
                  selected={color === c}
                  onClick={() => setColor(c)}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-5 w-5 cursor-pointer rounded border border-terminal-border bg-transparent p-0"
              />
            </div>
          </div>

          {/* Color 2 */}
          {showColor2 && (
            <div>
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                {type === "MACD" ? "Signal color" : "Low line color"}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <ColorChip
                    key={c}
                    color={c}
                    selected={color2 === c}
                    onClick={() => setColor2(c)}
                  />
                ))}
                <input
                  type="color"
                  value={color2}
                  onChange={(e) => setColor2(e.target.value)}
                  className="h-5 w-5 cursor-pointer rounded border border-terminal-border bg-transparent p-0"
                />
              </div>
            </div>
          )}

          {/* Pane toggle */}
          {(type === "RSI" || type === "MACD") && (
            <div className="flex items-center gap-3">
              <span className="text-2xs text-ink-muted">Pane</span>
              <button
                onClick={() => setSeparatePane(false)}
                className={cn(
                  "rounded border px-2 py-0.5 text-2xs font-medium transition-colors",
                  !separatePane
                    ? "border-brand/40 bg-brand/15 text-brand"
                    : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                )}
              >
                Overlay
              </button>
              <button
                onClick={() => setSeparatePane(true)}
                className={cn(
                  "rounded border px-2 py-0.5 text-2xs font-medium transition-colors",
                  separatePane
                    ? "border-brand/40 bg-brand/15 text-brand"
                    : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
                )}
              >
                Separate
              </button>
            </div>
          )}

          {/* Visible */}
          <div className="flex items-center gap-3">
            <span className="text-2xs text-ink-muted">Visible</span>
            <button
              onClick={() => setVisible(true)}
              className={cn(
                "rounded border px-2 py-0.5 text-2xs font-medium transition-colors",
                visible
                  ? "border-brand/40 bg-brand/15 text-brand"
                  : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
              )}
            >
              Show
            </button>
            <button
              onClick={() => setVisible(false)}
              className={cn(
                "rounded border px-2 py-0.5 text-2xs font-medium transition-colors",
                !visible
                  ? "border-brand/40 bg-brand/15 text-brand"
                  : "border-terminal-border text-ink-muted hover:bg-terminal-hover",
              )}
            >
              Hide
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-terminal-border px-4 py-2.5">
          <button
            onClick={handleRemove}
            className="flex items-center gap-1 rounded px-2 py-1 text-2xs text-bear transition-colors hover:bg-bear/10"
          >
            <Trash2 size={12} />
            Remove
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={close}
              className="rounded border border-terminal-border px-3 py-1 text-2xs text-ink-muted transition-colors hover:bg-terminal-hover"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded bg-brand px-3 py-1 text-2xs font-semibold text-white transition-colors hover:bg-brand/80"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
