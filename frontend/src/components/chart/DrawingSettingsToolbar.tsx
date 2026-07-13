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
  Hexagon,
  LayoutTemplate,
  GripVertical,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  drawingsAtom,
  selectedDrawingIdAtom,
  updateDrawingAtom,
  duplicateDrawingAtom,
  setEditingDrawingAtom,
  drawingTemplatesAtom,
  saveTemplateAtom,
  applyTemplateAtom,
  deleteTemplateAtom,
} from "@/store/chartStore";
import { useChartCtx } from "./ChartContext";
import { useDrawingActions } from "./drawing/useDrawingActions";
import { SaveDrawingTemplateDialog } from "./SaveDrawingTemplateDialog";
import { type Drawing, type LineStyle } from "@/types";
import { getDrawingSettingsSchema } from "./drawing/settings/drawingSettingsSchema";
import { cn } from "@/utils/cn";
import { useDrawingBulkActions } from "./drawing/bulk/useDrawingBulkActions";

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
const FONT_SIZES = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];
const STYLES: { value: LineStyle; label: string; dash: string }[] = [
  { value: "solid", label: "Solid", dash: "" },
  { value: "dashed", label: "Dashed", dash: "6 4" },
  { value: "dotted", label: "Dotted", dash: "2 4" },
];

type Menu =
  | "color"
  | "fill"
  | "width"
  | "style"
  | "fontSize"
  | "templates"
  | "more"
  | null;

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
  const duplicateDrawing = useSetAtom(duplicateDrawingAtom);
  const bulk = useDrawingBulkActions();
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);
  const templates = useAtomValue(drawingTemplatesAtom);
  const saveTemplate = useSetAtom(saveTemplateAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
  const deleteTemplate = useSetAtom(deleteTemplateAtom);

  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
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
    setTemplateDialogOpen(false);
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

  const moreItems = useDrawingActions(drawing, () => setMenu(null));

  if (!drawing) return null;

  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const settings = getDrawingSettingsSchema(drawing.tool);
  const showLine = settings.hasFeature("line");
  const showFill = settings.hasFeature("fill");
  const isTextTool = settings.profile === "text";
  // Templates are scoped to the selected object's style family (TradingView
  // won't offer a text preset for a trendline).
  const family = settings.templateFamily;
  const familyTemplates = templates.filter((t) => t.family === family);
  const onSaveTemplate = () => {
    setMenu(null);
    setTemplateDialogOpen(true);
  };

  const Sep = () => <div className="mx-0.5 h-5 w-px bg-terminal-border" />;

  return (
    <>
      <div
      ref={rootRef}
      data-drawing-toolbar
      className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-terminal-border-strong bg-terminal-raised/95 px-1.5 py-1 shadow-floating backdrop-blur-xl"
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

      {/* Font size (text / emoji) */}
      {isTextTool && (
        <>
          <ToolbarButton
            label="Font size"
            active={menu === "fontSize"}
            onClick={() => setMenu(menu === "fontSize" ? null : "fontSize")}
          >
            <span className="text-[12px] tabular-nums text-ink">
              {drawing.fontSize ?? 13}
            </span>
          </ToolbarButton>
          {menu === "fontSize" && (
            <Popover>
              {FONT_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    patch({ fontSize: s });
                    setMenu(null);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                >
                  <span>{s}px</span>
                  {(drawing.fontSize ?? 13) === s && (
                    <Check size={13} className="text-brand" />
                  )}
                </button>
              ))}
            </Popover>
          )}
        </>
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
      {/* Settings — opens the object's full settings dialog (every tool). */}
      <ToolbarButton
        label="Settings"
        onClick={() => setEditingDrawing(drawing.id)}
      >
        <Hexagon size={15} />
      </ToolbarButton>

      {/* Templates — save / apply a reusable style preset for this family. */}
      <ToolbarButton
        label="Templates"
        active={menu === "templates"}
        onClick={() => setMenu(menu === "templates" ? null : "templates")}
      >
        <LayoutTemplate size={15} />
      </ToolbarButton>
      {menu === "templates" && (
        <Popover>
          <button
            onClick={onSaveTemplate}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
          >
            <Plus size={13} className="text-ink-muted" />
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
                  setMenu(null);
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
                aria-label={`Delete ${t.name}`}
                title="Delete template"
                onClick={() =>
                  deleteTemplate({ name: t.name, family: t.family })
                }
                className="rounded p-0.5 text-ink-faint opacity-0 hover:text-bear group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {familyTemplates.length === 0 && (
            <div className="px-2 py-1.5 text-[10px] text-ink-faint">
              No saved templates
            </div>
          )}
        </Popover>
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
        onClick={() => bulk.toggleLock({ kind: "object", drawingId: drawing.id })}
      >
        {drawing.locked ? <Unlock size={15} /> : <Lock size={15} />}
      </ToolbarButton>
      {/* Delete */}
      <ToolbarButton
        label="Delete"
        danger
        onClick={() => bulk.remove({ kind: "object", drawingId: drawing.id })}
      >
        <Trash2 size={15} />
      </ToolbarButton>

      {/* More — overflow menu (same actions as right-click) */}
      <ToolbarButton
        label="More"
        active={menu === "more"}
        onClick={() => setMenu(menu === "more" ? null : "more")}
      >
        <MoreHorizontal size={15} />
      </ToolbarButton>
      {menu === "more" && (
        <Popover>
          {moreItems.map((it, i) =>
            "divider" in it && it.divider ? (
              <div key={i} className="my-1 h-px bg-terminal-border" />
            ) : (
              <button
                key={i}
                onClick={it.onClick}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-terminal-hover",
                  "danger" in it && it.danger ? "text-bear" : "text-ink",
                )}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </Popover>
      )}
      </div>
      <SaveDrawingTemplateDialog
        open={templateDialogOpen}
        templates={familyTemplates}
        onCloseAction={() => setTemplateDialogOpen(false)}
        onSaveAction={(name) => saveTemplate({ id: drawing.id, name })}
      />
    </>
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
