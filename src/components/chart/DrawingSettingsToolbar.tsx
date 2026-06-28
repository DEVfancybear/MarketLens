"use client";
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import {
  Copy,
  Lock,
  Unlock,
  Trash2,
  Pencil,
  PaintBucket,
  Type,
  Check,
  Settings,
  GripVertical,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  drawingsAtom,
  selectedDrawingIdAtom,
  updateDrawingAtom,
  removeDrawingAtom,
  duplicateDrawingAtom,
  lockDrawingAtom,
  setEditingDrawingAtom,
} from "@/store/chartStore";
import { useChartCtx } from "./ChartContext";
import type { Drawing, LineStyle } from "@/types";
import { cn } from "@/utils/cn";

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
const WIDTHS = [1, 2, 3, 4];
const STYLES: { value: LineStyle; label: string; dash: string }[] = [
  { value: "solid", label: "Solid", dash: "" },
  { value: "dashed", label: "Dashed", dash: "6 4" },
  { value: "dotted", label: "Dotted", dash: "2 4" },
];

/** Tools that carry a fill (shapes). */
const FILL_TOOLS = new Set<Drawing["tool"]>([
  "rectangle",
  "rotatedRect",
  "circle",
  "ellipse",
  "triangle",
]);
/** Tools that have no stroke width / style controls. */
const NO_LINE_TOOLS = new Set<Drawing["tool"]>(["text", "emoji"]);

type Menu = "color" | "fill" | "width" | "style" | null;

/**
 * TradingView-style floating toolbar that appears above the selected drawing,
 * letting the user change its colour, line width, line style, fill, and run
 * clone / lock / delete — without opening a separate dialog.
 */
export function DrawingSettingsToolbar() {
  const ctx = useChartCtx();
  const drawings = useAtomValue(drawingsAtom);
  const selectedId = useAtomValue(selectedDrawingIdAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const removeDrawing = useSetAtom(removeDrawingAtom);
  const duplicateDrawing = useSetAtom(duplicateDrawingAtom);
  const lockDrawing = useSetAtom(lockDrawingAtom);
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);

  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  // Once the user has dragged the toolbar we stop auto-positioning it and only
  // keep it clamped inside the chart — TradingView keeps it where you put it.
  const draggedRef = useRef(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
  } | null>(null);

  const drawing = drawings.find((d) => d.id === selectedId) ?? null;
  // Re-clamp on pan/zoom/resize: the provider hands a new ctx (and version) then.
  const ctxVersion = ctx?.version;

  // Default placement: pinned to the TOP-CENTRE of the chart (TradingView's
  // floating object toolbar), independent of where the drawing sits. After the
  // user drags it we keep their position and only clamp it into view.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el == null || drawing == null) {
      setPos(null);
      return;
    }
    const parent = el.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? window.innerWidth;
    const ph = parent?.clientHeight ?? window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    setPos((prev) => {
      if (!draggedRef.current || !prev) return { left: pw / 2, top: pad };
      const left = Math.max(pad + w / 2, Math.min(pw - pad - w / 2, prev.left));
      const top = Math.max(pad, Math.min(ph - pad - h, prev.top));
      return prev.left === left && prev.top === top ? prev : { left, top };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ctxVersion, drawing == null]);

  // Close any open popover when the selection changes / clears.
  useEffect(() => {
    setMenu(null);
  }, [selectedId]);

  // --- Drag the toolbar by its grip handle ---
  const onGripDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!pos) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: pos.left,
      baseTop: pos.top,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    draggedRef.current = true;
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? window.innerWidth;
    const ph = parent?.clientHeight ?? window.innerHeight;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const pad = 6;
    const left = Math.max(
      pad + w / 2,
      Math.min(pw - pad - w / 2, d.baseLeft + (e.clientX - d.startX)),
    );
    const top = Math.max(
      pad,
      Math.min(ph - pad - h, d.baseTop + (e.clientY - d.startY)),
    );
    setPos({ left, top });
  };
  const onGripUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
  };

  if (!drawing) return null;

  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const showLine = !NO_LINE_TOOLS.has(drawing.tool);
  const showFill = FILL_TOOLS.has(drawing.tool);
  const isTextTool = drawing.tool === "text" || drawing.tool === "emoji";
  const hasSettings = drawing.tool === "long" || drawing.tool === "short";

  const Sep = () => <div className="mx-0.5 h-5 w-px bg-terminal-border" />;

  return (
    <div
      ref={rootRef}
      data-drawing-toolbar
      className="absolute z-20 flex items-center gap-0.5 rounded-lg border border-terminal-border bg-terminal-panel-2 px-1.5 py-1 shadow-2xl shadow-black/50"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        transform: "translateX(-50%)",
        visibility: pos ? "visible" : "hidden",
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Drag handle — move the toolbar anywhere on the chart */}
      <button
        aria-label="Move toolbar"
        title="Drag to move"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        className="flex h-7 cursor-move items-center justify-center px-0.5 text-ink-muted hover:text-ink"
      >
        <GripVertical size={15} />
      </button>
      <Sep />

      {/* Stroke / text colour — pencil for line & shape tools, "T" for text */}
      <ToolbarButton
        label={isTextTool ? "Text color" : "Line color"}
        active={menu === "color"}
        onClick={() => setMenu(menu === "color" ? null : "color")}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          {isTextTool ? <Type size={15} /> : <Pencil size={15} />}
          <span
            className="absolute -bottom-1 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full"
            style={{ background: drawing.color }}
          />
        </span>
      </ToolbarButton>
      {menu === "color" && (
        <ColorPopover
          value={drawing.color}
          onPick={(c) => {
            if (c) patch({ color: c });
            setMenu(null);
          }}
        />
      )}

      {/* Fill colour (shapes only) */}
      {showFill && (
        <>
          <ToolbarButton
            label="Background color"
            active={menu === "fill"}
            onClick={() => setMenu(menu === "fill" ? null : "fill")}
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <PaintBucket size={15} />
              <span
                className="absolute -bottom-1 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full"
                style={{ background: drawing.fillColor ?? "transparent" }}
              />
            </span>
          </ToolbarButton>
          {menu === "fill" && (
            <ColorPopover
              value={drawing.fillColor ?? "#2962ff"}
              allowNone
              onPick={(c) => {
                patch({ fillColor: c ?? undefined });
                setMenu(null);
              }}
            />
          )}
        </>
      )}

      {showLine && (
        <>
          <Sep />
          {/* Line width */}
          <ToolbarButton
            label="Line width"
            active={menu === "width"}
            onClick={() => setMenu(menu === "width" ? null : "width")}
          >
            <span className="flex items-center gap-1.5 text-[11px] text-ink">
              <svg width="20" height="12" className="text-ink">
                <line
                  x1="1"
                  y1="6"
                  x2="19"
                  y2="6"
                  stroke="currentColor"
                  strokeWidth={drawing.lineWidth ?? 2}
                  strokeLinecap="round"
                />
              </svg>
              {drawing.lineWidth ?? 2}px
            </span>
          </ToolbarButton>
          {menu === "width" && (
            <Popover>
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => {
                    patch({ lineWidth: w });
                    setMenu(null);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                >
                  <span
                    className="w-16 rounded bg-ink"
                    style={{ height: w }}
                  />
                  <span className="text-ink-muted">{w}px</span>
                  {(drawing.lineWidth ?? 2) === w && (
                    <Check size={13} className="text-brand" />
                  )}
                </button>
              ))}
            </Popover>
          )}

          {/* Line style */}
          <ToolbarButton
            label="Line style"
            active={menu === "style"}
            onClick={() => setMenu(menu === "style" ? null : "style")}
          >
            <svg width="22" height="10" className="text-ink">
              <line
                x1="1"
                y1="5"
                x2="21"
                y2="5"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={
                  STYLES.find((s) => s.value === (drawing.lineStyle ?? "solid"))
                    ?.dash || undefined
                }
              />
            </svg>
          </ToolbarButton>
          {menu === "style" && (
            <Popover>
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    patch({ lineStyle: s.value });
                    setMenu(null);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                >
                  <svg width="40" height="10">
                    <line
                      x1="1"
                      y1="5"
                      x2="39"
                      y2="5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={s.dash || undefined}
                    />
                  </svg>
                  <span className="text-ink-muted">{s.label}</span>
                  {(drawing.lineStyle ?? "solid") === s.value && (
                    <Check size={13} className="text-brand" />
                  )}
                </button>
              ))}
            </Popover>
          )}
        </>
      )}

      <Sep />
      {/* Settings (position tools) */}
      {hasSettings && (
        <ToolbarButton
          label="Settings"
          onClick={() => setEditingDrawing(drawing.id)}
        >
          <Settings size={15} />
        </ToolbarButton>
      )}
      {/* Clone */}
      <ToolbarButton
        label="Clone"
        onClick={() => duplicateDrawing(drawing.id)}
      >
        <Copy size={15} />
      </ToolbarButton>
      {/* Lock */}
      <ToolbarButton
        label={drawing.locked ? "Unlock" : "Lock"}
        active={!!drawing.locked}
        onClick={() => lockDrawing(drawing.id)}
      >
        {drawing.locked ? <Unlock size={15} /> : <Lock size={15} />}
      </ToolbarButton>
      {/* Delete */}
      <ToolbarButton
        label="Delete"
        danger
        onClick={() => removeDrawing(drawing.id)}
      >
        <Trash2 size={15} />
      </ToolbarButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers (kept local to this toolbar)
// ---------------------------------------------------------------------------

function ToolbarButton({
  children,
  label,
  active,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center justify-center rounded px-1.5 transition-colors hover:bg-terminal-hover",
        active && "bg-terminal-hover text-brand",
        danger ? "text-bear" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** A popover anchored below the toolbar. */
function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-1/2 top-full mt-1.5 z-30 min-w-[140px] -translate-x-1/2 rounded-md border border-terminal-border bg-terminal-panel-2 p-1 shadow-2xl">
      {children}
    </div>
  );
}

function ColorPopover({
  value,
  onPick,
  allowNone,
}: {
  value: string;
  onPick: (c: string | null) => void;
  allowNone?: boolean;
}) {
  return (
    <Popover>
      <div className="grid grid-cols-4 gap-1.5 p-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onPick(c)}
            className="relative h-5 w-5 rounded-full border border-terminal-border"
            style={{ background: c }}
          >
            {value?.toLowerCase() === c.toLowerCase() && (
              <Check
                size={12}
                className="absolute inset-0 m-auto text-black/70"
              />
            )}
          </button>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2 border-t border-terminal-border px-1 pt-1.5">
        <label className="flex items-center gap-1.5 text-[10px] text-ink-muted">
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#2962ff"}
            onChange={(e) => onPick(e.target.value)}
            className="h-5 w-6 cursor-pointer rounded border border-terminal-border bg-transparent p-0"
          />
          Custom
        </label>
        {allowNone && (
          <button
            onClick={() => onPick(null)}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-ink-muted hover:bg-terminal-hover"
          >
            No fill
          </button>
        )}
      </div>
    </Popover>
  );
}
