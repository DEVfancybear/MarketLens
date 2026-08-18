"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
import { useDrawingActions } from "./drawing/useDrawingActions";
import { SaveDrawingTemplateDialog } from "./SaveDrawingTemplateDialog";
import { type Drawing, type LineStyle } from "@/types";
import { getDrawingSettingsSchema } from "./drawing/settings/drawingSettingsSchema";
import { cn } from "@/utils/cn";
import { useDrawingBulkActions } from "./drawing/bulk/useDrawingBulkActions";
import { ChartPopupSurface } from "./ChartPopupSurface";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { ColorPickerPopover } from "@/components/ui/ColorPicker";

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

  const [menu, setMenu] = useState<Menu>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  const selectedDrawings = drawings.filter((item) => bulk.selectedIds.has(item.id));
  const drawing = drawings.find((item) => item.id === selectedId)
    ?? selectedDrawings[0]
    ?? null;
  const multipleSelected = selectedDrawings.length > 1;
  const selectionKey = [...bulk.selectedIds].sort().join("|");

  // Close any open popover when the selection changes / clears.
  useEffect(() => {
    setMenu(null);
    setTemplateDialogOpen(false);
  }, [selectedId, selectionKey]);

  const moreItems = useDrawingActions(drawing, () => setMenu(null));

  if (!drawing) return null;

  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const settings = getDrawingSettingsSchema(drawing.tool);
  const actionScope = multipleSelected
    ? { kind: "selected" } as const
    : { kind: "object", drawingId: drawing.id } as const;
  const actionTargets = multipleSelected ? selectedDrawings : [drawing];
  const targetSettings = actionTargets.map((item) =>
    getDrawingSettingsSchema(item.tool));
  const showLine = !multipleSelected && settings.hasFeature("line");
  const showFill = targetSettings.some((item) => item.hasFeature("fill"));
  const isTextTool = targetSettings.every((item) => item.profile === "text");
  const sharedColor = commonValue(actionTargets.map((item) =>
    getDrawingSettingsSchema(item.tool).profile === "text"
      ? item.textColor ?? item.color
      : item.color));
  const fillTargets = actionTargets.filter((item) =>
    getDrawingSettingsSchema(item.tool).hasFeature("fill"));
  const fillColors = fillTargets.map((item) => item.fillColor);
  const sharedFillColor = commonValue(fillColors);
  const mixedFillColors = fillColors.some((value) =>
    !Object.is(value, fillColors[0]));
  const fillOpacities = fillTargets.map((item) => item.opacity ?? 0.3);
  const sharedFillOpacity = commonValue(fillOpacities);
  const allLocked = actionTargets.every((item) => item.locked === true);
  const applyPrimaryColor = (color: string) => bulk.applyPatch(
    actionScope,
    (item) => getDrawingSettingsSchema(item.tool).profile === "text"
      ? { color, textColor: color }
      : { color },
    actionTargets.length > 1 ? "Change Drawing Colors" : "Change Drawing Color",
  );
  const applyFillColor = (color: string | null) => bulk.applyPatch(
    actionScope,
    (item) => getDrawingSettingsSchema(item.tool).hasFeature("fill")
      ? { fillColor: color ?? undefined }
      : null,
    fillTargets.length > 1 ? "Change Fill Colors" : "Change Fill Color",
  );
  const applyFillOpacity = (opacity: number) => bulk.applyPatch(
    actionScope,
    (item) => getDrawingSettingsSchema(item.tool).hasFeature("fill")
      ? { opacity }
      : null,
    fillTargets.length > 1 ? "Change Fill Opacities" : "Change Fill Opacity",
  );
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
      <ChartPopupSurface
        dragLabel="Move drawing toolbar"
        handleClassName="drawing-toolbar-drag-handle"
        data-drawing-toolbar
        data-popover-open={menu !== null || undefined}
        className="absolute z-20 flex items-center gap-0.5 rounded-xl border border-terminal-border-strong bg-terminal-raised/95 px-1.5 py-1 shadow-floating backdrop-blur-xl"
        style={{
          left: "50%",
          top: 8,
          transform: "translateX(-50%)",
          pointerEvents: "auto",
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Sep />

      {/* Stroke / text colour — pencil for line & shape tools, "T" for text */}
      {multipleSelected && (
        <span
          data-drawing-selection-count
          className="mx-1 whitespace-nowrap rounded-md bg-brand/15 px-2 py-1 text-[11px] font-semibold text-brand"
        >
          {selectedDrawings.length} selected
        </span>
      )}
      <ToolbarButton
        label={multipleSelected ? "Selected drawing color" : isTextTool ? "Text color" : "Line color"}
        active={menu === "color"}
        onClick={() => setMenu(menu === "color" ? null : "color")}
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          {isTextTool ? <Type size={15} /> : <Pencil size={15} />}
          <span
            className="absolute -bottom-1 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full"
            style={{
              background: sharedColor
                ?? "linear-gradient(90deg, #2962ff 0 50%, #ab47bc 50%)",
            }}
          />
        </span>
      </ToolbarButton>
      {menu === "color" && (
        <ColorPickerPopover
          value={sharedColor}
          onChange={applyPrimaryColor}
          onClose={() => setMenu(null)}
          dataDrawingToolbarPopover
        />
      )}

      {/* Font size (text / emoji) */}
      {isTextTool && !multipleSelected && (
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
                  className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
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
                style={{
                  background: mixedFillColors
                    ? "linear-gradient(90deg, #2962ff 0 50%, #ab47bc 50%)"
                    : sharedFillColor ?? "transparent",
                }}
              />
            </span>
          </ToolbarButton>
          {menu === "fill" && (
            <ColorPickerPopover
              value={sharedFillColor}
              opacity={sharedFillOpacity}
              allowNone
              noneLabel="No fill"
              onChange={applyFillColor}
              onOpacityChange={applyFillOpacity}
              onClear={() => applyFillColor(null)}
              onClose={() => setMenu(null)}
              dataDrawingToolbarPopover
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
                  className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                >
                  <span
                    className="w-16 rounded-sm bg-ink"
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
                  className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
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

      {!multipleSelected && (
        <>
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
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
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
              className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] text-ink hover:bg-terminal-hover"
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
                className="rounded-sm p-0.5 text-ink-faint opacity-0 hover:text-bear group-hover:opacity-100"
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
        </>
      )}
      {/* Lock */}
      <ToolbarButton
        label={allLocked ? multipleSelected ? "Unlock selected" : "Unlock" : multipleSelected ? "Lock selected" : "Lock"}
        active={allLocked}
        onClick={() => bulk.toggleLock(actionScope)}
      >
        {allLocked ? <Unlock size={15} /> : <Lock size={15} />}
      </ToolbarButton>
      {/* Delete */}
      <ToolbarButton
        label={multipleSelected ? "Delete selected" : "Delete"}
        danger
        onClick={() => bulk.remove(actionScope)}
      >
        <Trash2 size={15} />
      </ToolbarButton>

      {/* More — overflow menu (same actions as right-click) */}
      {!multipleSelected && <ToolbarButton
        label="More"
        active={menu === "more"}
        onClick={() => setMenu(menu === "more" ? null : "more")}
      >
        <MoreHorizontal size={15} />
      </ToolbarButton>}
      {!multipleSelected && menu === "more" && (
        <Popover>
          {moreItems.map((it, i) =>
            "divider" in it && it.divider ? (
              <div key={i} className="my-1 h-px bg-terminal-border" />
            ) : (
              <button
                key={i}
                onClick={it.onClick}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-terminal-hover",
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
      </ChartPopupSurface>
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
        "flex h-7 items-center justify-center rounded-sm px-1.5 transition-colors hover:bg-terminal-hover",
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
  const mobile = useTerminalPlatform() === "mobile";
  const surface = (
    <ChartPopupSurface
      dragLabel="Move drawing options"
      showDragHandle={mobile}
      data-drawing-toolbar-popover
      className="mobile-popover absolute left-1/2 top-full z-30 mt-1.5 min-w-[140px] -translate-x-1/2 rounded-md border border-terminal-border bg-terminal-panel-2 p-1 shadow-2xl"
    >
      {children}
    </ChartPopupSurface>
  );
  // Mobile popovers use fixed viewport positioning. Portalling them prevents
  // the translated drawing toolbar from becoming their fixed containing block,
  // which otherwise pulls the palette back over the toolbar itself.
  return mobile && typeof document !== "undefined"
    ? createPortal(surface, document.body)
    : surface;
}

function commonValue<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values.every((value) => Object.is(value, values[0])) ? values[0] : undefined;
}
