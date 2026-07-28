"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import {
  Trash2,
  Palette,
  Star,
  GripVertical,
  Repeat2,
  Magnet,
  ChevronDown,
  Globe2,
  Lock,
  EyeOff,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { useAtomValue, useSetAtom } from "jotai";
import {
  activeToolAtom,
  drawColorAtom,
  setActiveToolAtom,
  setDrawColorAtom,
  keepDrawingModeAtom,
  setKeepDrawingModeAtom,
  drawingToolPreferencesAtom,
  setDrawingMagnetEnabledAtom,
  setDrawingMagnetModeAtom,
  setDrawingSnapToIndicatorsAtom,
  newDrawingSyncModeAtom,
  setNewDrawingSyncModeAtom,
} from "@/store/chartStore";
import type { DrawingTool } from "@/types";
import { DRAWING_SYNC_MODE_OPTIONS } from "@/components/chart/drawing/persistence/drawingSyncScope";
import { useDrawingBulkActions } from "@/components/chart/drawing/bulk/useDrawingBulkActions";
import { DrawingToolIcon } from "@/components/chart/drawing/DrawingToolIcon";
import { useChartCtx } from "@/components/chart/ChartContext";
import { useDrawingToolFavorites } from "@/hooks/useDrawingToolFavorites";
import {
  DRAWING_TOOL_GROUPS,
  DRAWING_TOOL_MANIFEST,
  formatDrawingToolShortcut,
  isDrawingToolCreationEnabled,
} from "@/types/drawingToolManifest";
import { ColorPickerPopover } from "@/components/ui/ColorPicker";
import { useI18n } from "@/hooks/useI18n";

// ---- Tool groups (TradingView pattern) ----

interface ToolItem {
  tool: DrawingTool;
  icon: React.ReactNode;
  label: string;
  hotkey?: string;
  /** Optional section header shown above this item in the flyout. */
  section?: string;
}

interface ToolGroup {
  id: string;
  icon: React.ReactNode;
  label: string;
  defaultTool: DrawingTool;
  tools: ToolItem[];
}

const GROUPS: ToolGroup[] = DRAWING_TOOL_GROUPS.map((group) => ({
  ...group,
  icon: <DrawingToolIcon iconKey={group.iconKey} size={18} />,
  tools: DRAWING_TOOL_MANIFEST.filter(
    (entry) =>
      // Mode tools (Cursor/Crosshair/Eraser) are intentionally non-persistent
      // but still belong in the toolbar so users can leave a drawing mode.
      (entry.preferredForCreation || entry.group === "cursor") &&
      entry.group === group.id &&
      isDrawingToolCreationEnabled(entry.id),
  ).map(
    (entry) => ({
      tool: entry.id,
      icon: <DrawingToolIcon iconKey={entry.iconKey} size={14} />,
      label: entry.displayName,
      hotkey: entry.shortcuts.length > 0
        ? formatDrawingToolShortcut(
            entry.shortcuts.find((shortcut) => shortcut.altKey) ?? entry.shortcuts[0],
          )
        : undefined,
      section: entry.section,
    }),
  ),
})).filter((group) => group.tools.length > 0);

/** Flat tool lookup (first occurrence wins) for the floating favorites toolbar. */
const TOOL_BY_ID = new Map<DrawingTool, ToolItem>();
for (const g of GROUPS)
  for (const t of g.tools) if (!TOOL_BY_ID.has(t.tool)) TOOL_BY_ID.set(t.tool, t);

/** Track which tool is "last used" per group for the visible icon. */
function useLastUsed(): Record<string, DrawingTool> {
  const activeTool = useAtomValue(activeToolAtom);
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({});

  // When activeTool changes, update the last-used record for its group.
  // useEffect runs after render, avoiding render-loop or cross-component warnings.
  useEffect(() => {
    for (const g of GROUPS) {
      const inGroup =
        g.tools.some((t) => t.tool === activeTool) ||
        g.defaultTool === activeTool;
      if (inGroup && lastUsed[g.id] !== activeTool) {
        setLastUsed((prev) => ({ ...prev, [g.id]: activeTool }));
        break;
      }
    }
    // We intentionally only depend on activeTool. The group lookup is
    // stable and lastUsed is a stale-closure-safe functional updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  return lastUsed;
}

export function DrawingToolbar() {
  const {
    t: tr,
    drawingToolName,
    drawingGroupName,
    drawingSectionName,
    drawingSyncModeText,
  } = useI18n();
  const chartCtx = useChartCtx();
  const activeTool = useAtomValue(activeToolAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const drawColor = useAtomValue(drawColorAtom);
  const setDrawColor = useSetAtom(setDrawColorAtom);
  const bulk = useDrawingBulkActions();
  const keepDrawing = useAtomValue(keepDrawingModeAtom);
  const setKeepDrawing = useSetAtom(setKeepDrawingModeAtom);
  const drawingPreferences = useAtomValue(drawingToolPreferencesAtom);
  const setMagnetEnabled = useSetAtom(setDrawingMagnetEnabledAtom);
  const setMagnetMode = useSetAtom(setDrawingMagnetModeAtom);
  const setSnapToIndicators = useSetAtom(setDrawingSnapToIndicatorsAtom);
  const newDrawingSyncMode = useAtomValue(newDrawingSyncModeAtom);
  const setNewDrawingSyncMode = useSetAtom(setNewDrawingSyncModeAtom);
  const hasIndicatorMagnets = (chartCtx?.indicatorPoints?.length ?? 0) > 0;
  const lastUsed = useLastUsed();
  const [favorites, toggleFavorite] = useDrawingToolFavorites();

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [magnetMenuOpen, setMagnetMenuOpen] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const btnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const localizedGroups = GROUPS.map((group) => ({
    ...group,
    label: drawingGroupName(group.id as Parameters<typeof drawingGroupName>[0], group.label),
    tools: group.tools.map((item) => ({
      ...item,
      label: drawingToolName(item.tool, item.label),
      section: drawingSectionName(item.section),
    })),
  }));
  const localizedToolById = new Map<DrawingTool, ToolItem>();
  for (const group of localizedGroups) {
    for (const tool of group.tools) localizedToolById.set(tool.tool, tool);
  }
  const localizedSyncOptions = DRAWING_SYNC_MODE_OPTIONS.map((option) => ({
    ...option,
    ...drawingSyncModeText(option.id, option),
  }));

  // Favorited tools (in the order they were starred) for the floating chart
  // toolbar. TradingView does not insert favorited tools into the left rail.
  const favList = [...favorites].filter((t) =>
    TOOL_BY_ID.has(t as DrawingTool),
  ) as DrawingTool[];

  const isActive = (group: ToolGroup) => {
    if (group.tools.length === 0) return activeTool === group.defaultTool;
    return (
      group.tools.some((t) => t.tool === activeTool) ||
      activeTool === group.defaultTool
    );
  };

  return (
    <div data-drawing-toolbar className="flex h-full flex-col items-center gap-1 overflow-y-auto bg-terminal-panel px-1.5 py-2">
      <FavoriteToolsPopup
        tools={favList.map((tool) => localizedToolById.get(tool)!)}
        activeTool={activeTool}
        onSelect={(tool) => {
          setActiveTool(tool);
          setOpenGroup(null);
        }}
        onRemove={toggleFavorite}
      />
      {localizedGroups.map((group, gi) => {
        const visibleTool = lastUsed[group.id] ?? group.defaultTool;
        const visibleIcon =
          group.tools.find((t) => t.tool === visibleTool)?.icon ?? group.icon;
        const isGroupActive = isActive(group);
        const hasFlyout = group.tools.length > 0;
        const isOpen = openGroup === group.id;

        return (
          <div key={group.id} className="relative">
            {/* Separator between groups */}
            {gi > 0 && <div className="my-1.5 h-px w-7 bg-terminal-border" />}

            {/* Group button */}
            <div
              ref={(el) => {
                btnRefs.current[group.id] = el;
              }}
            >
              <IconButton
                label={group.label}
                active={isGroupActive}
                onClick={() => {
                  if (hasFlyout) {
                    setOpenGroup(isOpen ? null : group.id);
                  } else {
                    setActiveTool(group.defaultTool);
                    setOpenGroup(null);
                  }
                }}
              >
                {visibleIcon}
              </IconButton>
            </div>

            {/* Flyout menu: portal to body to escape overflow:hidden */}
            {hasFlyout &&
              isOpen &&
              typeof document !== "undefined" &&
              (() => {
                const btn = btnRefs.current[group.id];
                if (!btn) return null;
                const rect = btn.getBoundingClientRect();
                const top = Math.max(
                  8,
                  Math.min(rect.top, window.innerHeight - 248),
                );
                const maxHeight = Math.max(240, window.innerHeight - top - 8);
                return createPortal(
                  <>
                    <div
                      data-chart-ui
                      className="fixed inset-0 z-40"
                      onClick={() => setOpenGroup(null)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setOpenGroup(null);
                      }}
                    />
                    <div
                      data-chart-ui
                       className="fixed z-50 w-52 overflow-y-auto rounded-xl border border-terminal-border-strong bg-terminal-raised py-1.5 shadow-terminal backdrop-blur-xl"
                      style={{ left: rect.right + 4, top, maxHeight }}
                    >
                      {group.tools.map((t, ti) => {
                        const showHeader =
                          t.section &&
                          t.section !== group.tools[ti - 1]?.section;
                        const fav = favorites.has(t.tool);
                        return (
                          <div key={t.tool}>
                            {showHeader && (
                              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                                {t.section}
                              </div>
                            )}
                            <button
                              data-drawing-tool-id={t.tool}
                              onClick={() => {
                                setActiveTool(t.tool);
                                setOpenGroup(null);
                              }}
                              className={cn(
                                 "group/item flex min-h-9 w-full items-center gap-2.5 px-3 text-left text-xs font-medium transition-colors hover:bg-terminal-hover",
                                 activeTool === t.tool ? "bg-brand/10 text-brand" : "text-ink-muted hover:text-ink",
                              )}
                            >
                              <span className="shrink-0 text-ink-muted">
                                {t.icon}
                              </span>
                              <span className="flex-1">{t.label}</span>
                              {t.hotkey && (
                                <span className="shrink-0 text-[10px] text-ink-muted">
                                  {t.hotkey}
                                </span>
                              )}
                              <span
                                role="button"
                                aria-label={
                                  fav
                                    ? tr("drawing.removeFavorite", { tool: t.label })
                                    : tr("drawing.addFavorite", { tool: t.label })
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFavorite(t.tool);
                                }}
                                className={cn(
                                  "shrink-0 transition-opacity",
                                  fav
                                    ? "text-yellow-400"
                                    : "text-ink-faint opacity-0 hover:text-ink group-hover/item:opacity-100",
                                )}
                              >
                                <Star
                                  size={13}
                                  fill={fav ? "currentColor" : "none"}
                                />
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>,
                  document.body,
                );
              })()}
          </div>
        );
      })}

      <div className="my-1.5 h-px w-7 bg-terminal-border" />

      {/* Colour picker */}
      <div className="relative">
        <IconButton
          label={tr("drawing.color")}
          active={colorPickerOpen}
          onClick={() => setColorPickerOpen((current) => !current)}
        >
          <Palette size={18} style={{ color: drawColor }} />
        </IconButton>
        {colorPickerOpen && (
          <ColorPickerPopover
            value={drawColor}
            side="right"
            onChange={setDrawColor}
            onClose={() => setColorPickerOpen(false)}
          />
        )}
      </div>

      <IconButton
        label={tr("drawing.keepDrawing")}
        active={keepDrawing}
        onClick={() => setKeepDrawing(!keepDrawing)}
      >
        <Repeat2 size={18} />
      </IconButton>

      <div className="relative">
        <IconButton
          label={`${tr("drawing.magnet")}: ${drawingPreferences.magnetEnabled ? `${tr(`drawing.magnet.${drawingPreferences.magnetMode}`)}${drawingPreferences.snapToIndicators ? ` + ${tr("drawing.indicators").toLowerCase()}` : ""}` : tr("drawing.magnet.off")}`}
          active={drawingPreferences.magnetEnabled}
          onClick={() => setMagnetEnabled(!drawingPreferences.magnetEnabled)}
        >
          <Magnet size={18} />
        </IconButton>
        <button
          type="button"
          aria-label={tr("drawing.magnetMode")}
          onClick={() => setMagnetMenuOpen((open) => !open)}
          className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-full border border-terminal-border bg-terminal-panel-2 text-ink-faint hover:bg-terminal-hover hover:text-ink"
        >
          <ChevronDown size={10} />
        </button>
        {magnetMenuOpen && (
          <div
            data-chart-ui
            className="absolute left-full top-0 z-50 ml-2 w-40 rounded-xl border border-terminal-border-strong bg-terminal-raised p-1.5 shadow-terminal"
          >
            {(["weak", "strong"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setMagnetMode(mode);
                  setMagnetMenuOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] capitalize hover:bg-terminal-hover",
                  drawingPreferences.magnetEnabled && drawingPreferences.magnetMode === mode
                    ? "text-brand"
                    : "text-ink",
                )}
              >
                {tr(`drawing.magnet.${mode}`)} {tr("drawing.magnet").toLowerCase()}
              </button>
            ))}
            <div className="my-1 h-px bg-terminal-border" />
            <button
              type="button"
              disabled={!hasIndicatorMagnets}
              aria-pressed={drawingPreferences.snapToIndicators}
              onClick={() => setSnapToIndicators(!drawingPreferences.snapToIndicators)}
              className={cn(
                "flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] hover:bg-terminal-hover",
                drawingPreferences.snapToIndicators ? "text-brand" : "text-ink",
                !hasIndicatorMagnets && "cursor-not-allowed opacity-40",
              )}
            >
              {tr("drawing.snapIndicators")}
            </button>
            <div className="px-2 pb-1 pt-1.5 text-[9px] text-ink-faint">
              {tr("drawing.ctrlToggle")}
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <IconButton
          label={`${tr("drawing.newDrawings")}: ${localizedSyncOptions.find((option) => option.id === newDrawingSyncMode)?.label}`}
          active={newDrawingSyncMode !== "chart-only"}
          onClick={() => setSyncMenuOpen((open) => !open)}
        >
          <Globe2 size={18} />
        </IconButton>
        {syncMenuOpen && (
          <div data-chart-ui className="absolute left-full top-0 z-50 ml-2 w-52 rounded-xl border border-terminal-border-strong bg-terminal-raised p-1.5 shadow-terminal">
            <div className="px-2 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{tr("drawing.newDrawings")}</div>
            {localizedSyncOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-label={option.label}
                onClick={() => {
                  setNewDrawingSyncMode(option.id);
                  setSyncMenuOpen(false);
                }}
                className={cn("flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-terminal-hover", newDrawingSyncMode === option.id ? "text-brand" : "text-ink")}
              >
                <span className="text-[11px] font-semibold">{option.label}</span>
                <span className="text-[9px] text-ink-faint">{option.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <IconButton
        label={tr("drawing.lockAllFull")}
        active={bulk.drawings.length > 0 && bulk.drawings.every((drawing) => drawing.locked)}
        disabled={bulk.drawings.length === 0}
        onClick={() => bulk.toggleLock({ kind: "all" })}
      >
        <Lock size={18} />
      </IconButton>

      <IconButton
        label={tr("drawing.hideAllFull")}
        active={bulk.drawings.length > 0 && bulk.drawings.every((drawing) => drawing.visible === false)}
        disabled={bulk.drawings.length === 0}
        onClick={() => bulk.toggleVisibility({ kind: "all" })}
      >
        <EyeOff size={18} />
      </IconButton>

      <IconButton label={tr("drawing.removeAllFull")} disabled={bulk.drawings.length === 0} onClick={() => bulk.remove({ kind: "all" })}>
        <Trash2 size={18} />
      </IconButton>
    </div>
  );
}

function FavoriteToolsPopup({
  tools,
  activeTool,
  onSelect,
  onRemove,
}: {
  tools: ToolItem[];
  activeTool: DrawingTool;
  onSelect: (tool: DrawingTool) => void;
  onRemove: (tool: DrawingTool) => void;
}) {
  const { t } = useI18n();
  // Keep this callback stable. `useDraggableDialog` remeasures when
  // `initialPosition` changes; an inline function here causes a render/effect
  // loop as soon as the first favorite makes the portal mount.
  const initialPosition = useCallback(() => ({ left: 64, top: 76 }), []);
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog({
      initialPosition,
      boundsMargin: 8,
    });

  if (tools.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dialogRef}
      data-chart-ui
      data-drawing-toolbar
      style={{ left: 64, top: 76, ...dialogStyle }}
      className="fixed z-[45] flex max-w-[calc(100vw-80px)] items-center gap-1 rounded-xl border border-terminal-border-strong bg-terminal-raised/95 px-1.5 py-1 shadow-floating backdrop-blur-xl"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        {...dragHandleProps}
        className={cn(
          "flex h-7 w-4 shrink-0 items-center justify-center rounded-sm text-ink-faint hover:bg-terminal-hover hover:text-ink",
          dragHandleClassName,
        )}
        title={t("drawing.moveFavorites")}
        aria-label={t("drawing.moveFavorites")}
      >
        <GripVertical size={14} />
      </div>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {tools.map((tool) => (
          <button
            key={`floating-fav-${tool.tool}`}
            type="button"
            title={`${tool.label} (${t("drawing.rightClickRemove")})`}
            aria-label={tool.label}
            onClick={() => onSelect(tool.tool)}
            onContextMenu={(event) => {
              event.preventDefault();
              onRemove(tool.tool);
            }}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink",
              activeTool === tool.tool && "bg-brand/15 text-brand",
            )}
          >
            <span className="[&_svg]:h-[17px] [&_svg]:w-[17px]">
              {tool.icon}
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
