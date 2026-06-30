"use client";
/**
 * ObjectSettingsDialog — TradingView-style settings dialog for every drawing
 * EXCEPT the Long/Short position tool (that keeps its own richer
 * `PositionSettingsDialog`). Both read `editingDrawingIdAtom`; this one bails
 * out for position tools so the two never render at once.
 *
 * Tabs depend on the tool family:
 *   • line / shape  → Style · Coordinates · Visibility
 *   • text / emoji  → Style · Visibility
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingDrawingIdAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  updateDrawingAtom,
} from "@/store/chartStore";
import { styleFamily, type Drawing, type LineStyle } from "@/types";
import { cn } from "@/utils/cn";
import { NumberField, Row, SectionTitle } from "./PositionSettingsDialog";

const COLORS = [
  "#2962ff",
  "#26a69a",
  "#ef5350",
  "#ff9800",
  "#ab47bc",
  "#ffeb3b",
  "#ffffff",
  "#787b86",
];
const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];
const LINE_STYLES: { value: LineStyle; label: string; dash: string }[] = [
  { value: "solid", label: "Solid", dash: "" },
  { value: "dashed", label: "Dashed", dash: "6 4" },
  { value: "dotted", label: "Dotted", dash: "2 4" },
];

type Tab = "style" | "coordinates" | "visibility";

/** UNIX seconds → value for a <input type="datetime-local">. */
function toLocalInput(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
/** datetime-local string → UNIX seconds (returns null if unparseable). */
function fromLocalInput(s: string): number | null {
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** A row of preset colour swatches + a custom picker. */
function ColorRow({
  value,
  onPick,
  allowNone,
}: {
  value: string | undefined;
  onPick: (c: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="relative h-5 w-5 rounded-full border border-terminal-border"
          style={{ background: c }}
        >
          {value?.toLowerCase() === c.toLowerCase() && (
            <Check size={12} className="absolute inset-0 m-auto text-black/70" />
          )}
        </button>
      ))}
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#2962ff"}
        onChange={(e) => onPick(e.target.value)}
        className="h-5 w-6 cursor-pointer rounded border border-terminal-border bg-transparent p-0"
        title="Custom color"
      />
      {allowNone && (
        <button
          onClick={() => onPick(null)}
          className="rounded px-1.5 py-0.5 text-2xs text-ink-muted hover:bg-terminal-hover"
        >
          No fill
        </button>
      )}
    </div>
  );
}

export function ObjectSettingsDialog() {
  const editingId = useAtomValue(editingDrawingIdAtom);
  const drawings = useAtomValue(drawingsAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const [tab, setTab] = useState<Tab>("style");

  const drawing = drawings.find((d) => d.id === editingId) ?? null;
  const isPosition = drawing?.tool === "long" || drawing?.tool === "short";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId) setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, setEditing]);

  // Reset to a valid tab whenever the edited object changes.
  useEffect(() => {
    setTab("style");
  }, [editingId]);

  // The position tool has its own dialog — don't double-render.
  if (typeof document === "undefined" || !drawing || isPosition) return null;

  const family = styleFamily(drawing.tool);
  const isText = family === "text";
  const isShape = family === "shape";
  const close = () => setEditing(null);
  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const setPoint = (idx: number, p: Partial<{ time: number; price: number }>) => {
    const pts = drawing.points.map((q) => ({ ...q }));
    if (pts[idx]) {
      pts[idx] = { ...pts[idx], ...p };
      patch({ points: pts });
    }
  };

  const tabs: Tab[] = isText
    ? ["style", "visibility"]
    : ["style", "coordinates", "visibility"];

  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={cn(
        "border-b-2 px-1 pb-2 text-sm capitalize transition-colors",
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
          <span className="text-base font-semibold capitalize text-ink">
            {drawing.tool} settings
          </span>
          <button
            onClick={close}
            className="rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-5 border-b border-terminal-border px-5 pt-3">
          {tabs.map((t) => tabBtn(t, t))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {tab === "style" && (
            <>
              <Row label={isText ? "Text color" : "Line color"}>
                <ColorRow
                  value={drawing.color}
                  onPick={(c) => c && patch({ color: c })}
                />
              </Row>

              {isText && (
                <>
                  <Row label="Text">
                    <input
                      value={drawing.text ?? ""}
                      onChange={(e) => patch({ text: e.target.value })}
                      className="flex-1 rounded-md border border-terminal-border bg-terminal-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand"
                    />
                  </Row>
                  <Row label="Font size">
                    <select
                      value={drawing.fontSize ?? 13}
                      onChange={(e) =>
                        patch({ fontSize: Number(e.target.value) })
                      }
                      className="flex-1 rounded-md border border-terminal-border bg-terminal-bg px-2 py-1.5 text-xs text-ink outline-none"
                    >
                      {FONT_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}px
                        </option>
                      ))}
                    </select>
                  </Row>
                </>
              )}

              {!isText && (
                <>
                  <Row label="Line width">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={drawing.lineWidth ?? 2}
                      onChange={(e) =>
                        patch({ lineWidth: Number(e.target.value) })
                      }
                      className="flex-1 accent-brand"
                    />
                    <span className="w-10 text-right text-xs text-ink">
                      {drawing.lineWidth ?? 2}px
                    </span>
                  </Row>
                  <Row label="Line style">
                    <div className="flex flex-1 items-center gap-1.5">
                      {LINE_STYLES.map((s) => (
                        <button
                          key={s.value}
                          onClick={() => patch({ lineStyle: s.value })}
                          title={s.label}
                          className={cn(
                            "flex h-7 flex-1 items-center justify-center rounded border transition-colors",
                            (drawing.lineStyle ?? "solid") === s.value
                              ? "border-brand bg-brand/15"
                              : "border-terminal-border hover:bg-terminal-hover",
                          )}
                        >
                          <svg width="34" height="10" className="text-ink">
                            <line
                              x1="1"
                              y1="5"
                              x2="33"
                              y2="5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeDasharray={s.dash || undefined}
                            />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </Row>
                </>
              )}

              {isShape && (
                <>
                  <SectionTitle>Background</SectionTitle>
                  <Row label="Fill color">
                    <ColorRow
                      value={drawing.fillColor}
                      allowNone
                      onPick={(c) => patch({ fillColor: c ?? undefined })}
                    />
                  </Row>
                  <Row label="Opacity">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((drawing.opacity ?? 0.2) * 100)}
                      onChange={(e) =>
                        patch({ opacity: Number(e.target.value) / 100 })
                      }
                      className="flex-1 accent-brand"
                    />
                    <span className="w-10 text-right text-xs text-ink">
                      {Math.round((drawing.opacity ?? 0.2) * 100)}%
                    </span>
                  </Row>
                </>
              )}
            </>
          )}

          {tab === "coordinates" && (
            <>
              {drawing.points.map((pt, i) => (
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
              ))}
            </>
          )}

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
      </div>
    </div>,
    document.body,
  );
}
