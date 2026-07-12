"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import {
  MousePointer2,
  Target,
  Eraser,
  TrendingUp,
  Minus,
  MoveVertical,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Crosshair,
  Ruler,
  Square,
  Circle,
  Triangle,
  PenTool,
  Spline,
  Type,
  Smile,
  GitFork,
  ArrowBigUp,
  ChartCandlestick,
  ChartNoAxesColumn,
  Paintbrush,
  Highlighter,
  Trash2,
  Palette,
  Star,
  Waypoints,
  PenLine,
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
  getDrawingToolFavorites,
  replaceDrawingToolFavorites,
} from "@/services/api/resources/drawingsApi";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
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
  newDrawingSyncModeAtom,
  setNewDrawingSyncModeAtom,
} from "@/store/chartStore";
import { authStatusAtom, backendSessionAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import type { DrawingTool } from "@/types";
import { DRAWING_SYNC_MODE_OPTIONS } from "@/components/chart/drawing/persistence/drawingSyncScope";
import { useDrawingBulkActions } from "@/components/chart/drawing/bulk/useDrawingBulkActions";
import {
  DRAWING_TOOL_GROUPS,
  DRAWING_TOOL_MANIFEST,
  isDrawingToolCreationEnabled,
  normalizeFavoriteDrawingTools,
  type DrawingIconKey,
} from "@/types/drawingToolManifest";

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

function toolIcon(key: DrawingIconKey, size: number): React.ReactNode {
  const props = { size };
  switch (key) {
    case "cursor": return <MousePointer2 {...props} />;
    case "target": return <Target {...props} />;
    case "eraser": return <Eraser {...props} />;
    case "ruler": return <Ruler {...props} />;
    case "trend": return <TrendingUp {...props} />;
    case "ray": case "arrowUpRight": return <ArrowUpRight {...props} />;
    case "branch": return <GitBranch {...props} />;
    case "triangle": return <Triangle {...props} />;
    case "horizontal": return <Minus {...props} />;
    case "vertical": return <MoveVertical {...props} />;
    case "crosshair": return <Crosshair {...props} />;
    case "square": return <Square {...props} />;
    case "circle": return <Circle {...props} />;
    case "pen": return <PenTool {...props} />;
    case "spline": return <Spline {...props} />;
    case "path": return <Waypoints {...props} />;
    case "doubleCurve": return <PenLine {...props} />;
    case "fib": return <GitFork {...props} />;
    case "fibExtension": return <ArrowBigUp {...props} />;
    case "long": return <ChartCandlestick {...props} />;
    case "short": return <ChartNoAxesColumn {...props} />;
    case "brush": return <Paintbrush {...props} />;
    case "highlighter": return <Highlighter {...props} />;
    case "arrowUp": return <ArrowUp {...props} />;
    case "arrowDown": return <ArrowDown {...props} />;
    case "arrowLeft": return <ArrowLeft {...props} />;
    case "arrowRight": return <ArrowRight {...props} />;
    case "text": return <Type {...props} />;
    case "emoji": return <Smile {...props} />;
  }
}

const GROUPS: ToolGroup[] = DRAWING_TOOL_GROUPS.map((group) => ({
  ...group,
  icon: toolIcon(group.iconKey, 18),
  tools: DRAWING_TOOL_MANIFEST.filter(
    (entry) => entry.group === group.id && isDrawingToolCreationEnabled(entry.id),
  ).map(
    (entry) => ({
      tool: entry.id,
      icon: toolIcon(entry.iconKey, 14),
      label: entry.displayName,
      hotkey: entry.hotkey,
      section: entry.section,
    }),
  ),
})).filter((group) => group.tools.length > 0);

/** Flat tool lookup (first occurrence wins) for the floating favorites toolbar. */
const TOOL_BY_ID = new Map<DrawingTool, ToolItem>();
for (const g of GROUPS)
  for (const t of g.tools) if (!TOOL_BY_ID.has(t.tool)) TOOL_BY_ID.set(t.tool, t);

const COLORS = [
  "#2962ff",
  "#26a69a",
  "#ef5350",
  "#ff9800",
  "#ab47bc",
  "#ffffff",
];

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

const FAV_KEY = "tv:favTools";

function readLocalFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeLocalFavorites(tools: string[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(tools));
  } catch {
    /* storage unavailable */
  }
}

function clearLocalFavorites() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(FAV_KEY);
  } catch {
    /* storage unavailable */
  }
}

const normalizeFavoriteTools = normalizeFavoriteDrawingTools;

function apiMessage(error: unknown): string {
  return userFacingErrorMessage(error, "unknown error");
}

/** Favorite tools. Remote mode uses Phase 7 API; localStorage is anonymous/cache fallback. */
function useFavorites(): [Set<string>, (tool: string) => void] {
  const backendSession = useAtomValue(backendSessionAtom);
  const authStatus = useAtomValue(authStatusAtom);
  const log = useSetAtom(logAtom);
  const [fav, setFav] = useState<Set<string>>(
    () => new Set(normalizeFavoriteTools(readLocalFavorites())),
  );

  useEffect(() => {
    if (authStatus === "anonymous") {
      clearLocalFavorites();
      setFav(new Set());
      return;
    }
    if (!backendSession) return;
    let cancelled = false;
    void getDrawingToolFavorites()
      .then((result) => {
        if (cancelled) return;
        const tools = normalizeFavoriteTools(result.tools);
        const next = new Set(tools);
        setFav(next);
        writeLocalFavorites(tools);
      })
      .catch((error) => {
        if (cancelled) return;
        log("warn", `Drawing tool favorites loaded from local cache: ${apiMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus, backendSession, log]);

  const persist = useCallback(
    (tools: string[]) => {
      const normalized = normalizeFavoriteTools(tools);
      writeLocalFavorites(normalized);
      if (!backendSession) return;
      void replaceDrawingToolFavorites(normalized).catch((error) => {
        log("error", `Drawing tool favorites sync failed: ${apiMessage(error)}`);
      });
    },
    [backendSession, log],
  );

  const toggle = useCallback(
    (tool: string) => {
      setFav((prev) => {
        const next = new Set(prev);
        if (next.has(tool)) next.delete(tool);
        else next.add(tool);
        const normalized = normalizeFavoriteTools([...next]);
        const normalizedSet = new Set(normalized);
        persist(normalized);
        return normalizedSet;
      });
    },
    [persist],
  );
  return [fav, toggle];
}

export function DrawingToolbar() {
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
  const newDrawingSyncMode = useAtomValue(newDrawingSyncModeAtom);
  const setNewDrawingSyncMode = useSetAtom(setNewDrawingSyncModeAtom);
  const lastUsed = useLastUsed();
  const [favorites, toggleFavorite] = useFavorites();

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [magnetMenuOpen, setMagnetMenuOpen] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);
  const btnRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    <div className="flex h-full flex-col items-center gap-0.5 overflow-y-auto py-2">
      <FavoriteToolsPopup
        tools={favList.map((tool) => TOOL_BY_ID.get(tool)!)}
        activeTool={activeTool}
        onSelect={(tool) => {
          setActiveTool(tool);
          setOpenGroup(null);
        }}
        onRemove={toggleFavorite}
      />
      {GROUPS.map((group, gi) => {
        const visibleTool = lastUsed[group.id] ?? group.defaultTool;
        const visibleIcon =
          group.tools.find((t) => t.tool === visibleTool)?.icon ?? group.icon;
        const isGroupActive = isActive(group);
        const hasFlyout = group.tools.length > 0;
        const isOpen = openGroup === group.id;

        return (
          <div key={group.id} className="relative">
            {/* Separator between groups */}
            {gi > 0 && <div className="my-1 h-px w-6 bg-terminal-border" />}

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
                      className="fixed z-50 w-44 overflow-y-auto rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl shadow-black/50"
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
                              onClick={() => {
                                setActiveTool(t.tool);
                                setOpenGroup(null);
                              }}
                              className={cn(
                                "group/item flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-terminal-hover",
                                activeTool === t.tool ? "text-brand" : "text-ink",
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
                                  fav ? "Remove favorite" : "Add favorite"
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

      <div className="my-1 h-px w-6 bg-terminal-border" />

      {/* Colour picker */}
      <div className="group relative">
        <IconButton label="Colour">
          <Palette size={18} style={{ color: drawColor }} />
        </IconButton>
        <div className="pointer-events-none absolute left-full top-0 z-50 ml-1 hidden grid-cols-3 gap-1 rounded-md border border-terminal-border bg-terminal-panel-2 p-1.5 group-hover:pointer-events-auto group-hover:grid opacity-0 group-hover:opacity-100">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setDrawColor(c)}
              className="h-5 w-5 rounded-full border border-terminal-border"
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <IconButton
        label="Keep drawing"
        active={keepDrawing}
        onClick={() => setKeepDrawing(!keepDrawing)}
      >
        <Repeat2 size={18} />
      </IconButton>

      <div className="relative">
        <IconButton
          label={`Magnet: ${drawingPreferences.magnetEnabled ? drawingPreferences.magnetMode : "off"}`}
          active={drawingPreferences.magnetEnabled}
          onClick={() => setMagnetEnabled(!drawingPreferences.magnetEnabled)}
        >
          <Magnet size={18} />
        </IconButton>
        <button
          type="button"
          aria-label="Magnet mode menu"
          onClick={() => setMagnetMenuOpen((open) => !open)}
          className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center rounded-sm text-ink-faint hover:bg-terminal-hover hover:text-ink"
        >
          <ChevronDown size={10} />
        </button>
        {magnetMenuOpen && (
          <div
            data-chart-ui
            className="absolute left-full top-0 z-50 ml-1 w-36 rounded-md border border-terminal-border bg-terminal-panel-2 p-1 shadow-2xl shadow-black/50"
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
                {mode === "weak" ? "Weak magnet" : "Strong magnet"}
              </button>
            ))}
            <div className="px-2 pb-1 pt-1.5 text-[9px] text-ink-faint">
              Ctrl/Cmd temporarily toggles
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <IconButton
          label={`New drawings: ${DRAWING_SYNC_MODE_OPTIONS.find((option) => option.id === newDrawingSyncMode)?.label}`}
          active={newDrawingSyncMode !== "chart-only"}
          onClick={() => setSyncMenuOpen((open) => !open)}
        >
          <Globe2 size={18} />
        </IconButton>
        {syncMenuOpen && (
          <div data-chart-ui className="absolute left-full top-0 z-50 ml-1 w-48 rounded-md border border-terminal-border bg-terminal-panel-2 p-1 shadow-2xl shadow-black/50">
            <div className="px-2 pb-1 pt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">New drawings</div>
            {DRAWING_SYNC_MODE_OPTIONS.map((option) => (
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
        label="Lock all drawings"
        active={bulk.drawings.length > 0 && bulk.drawings.every((drawing) => drawing.locked)}
        disabled={bulk.drawings.length === 0}
        onClick={() => bulk.toggleLock({ kind: "all" })}
      >
        <Lock size={18} />
      </IconButton>

      <IconButton
        label="Hide all drawings"
        active={bulk.drawings.length > 0 && bulk.drawings.every((drawing) => drawing.visible === false)}
        disabled={bulk.drawings.length === 0}
        onClick={() => bulk.toggleVisibility({ kind: "all" })}
      >
        <EyeOff size={18} />
      </IconButton>

      <IconButton label="Remove all drawings" disabled={bulk.drawings.length === 0} onClick={() => bulk.remove({ kind: "all" })}>
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
      className="fixed z-[45] flex max-w-[calc(100vw-80px)] items-center gap-1 rounded-md border border-terminal-border bg-terminal-panel-2 px-1.5 py-1 shadow-2xl shadow-black/50"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        {...dragHandleProps}
        className={cn(
          "flex h-7 w-4 shrink-0 items-center justify-center rounded-sm text-ink-faint hover:bg-terminal-hover hover:text-ink",
          dragHandleClassName,
        )}
        title="Move favorites toolbar"
        aria-label="Move favorites toolbar"
      >
        <GripVertical size={14} />
      </div>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {tools.map((tool) => (
          <button
            key={`floating-fav-${tool.tool}`}
            type="button"
            title={`${tool.label} (right-click to remove from favorites)`}
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
