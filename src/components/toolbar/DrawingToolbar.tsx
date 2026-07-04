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
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { useAtomValue, useSetAtom } from "jotai";
import {
  activeToolAtom,
  drawColorAtom,
  setActiveToolAtom,
  setDrawColorAtom,
  clearDrawingsAtom,
} from "@/store/chartStore";
import type { DrawingTool } from "@/types";

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

const GROUPS: ToolGroup[] = [
  // --- Mode tools ---
  {
    id: "cursor",
    icon: <MousePointer2 size={18} />,
    label: "Cursor",
    defaultTool: "cursor",
    tools: [
      { tool: "cursor", icon: <MousePointer2 size={14} />, label: "Cursor" },
      { tool: "crosshair", icon: <Target size={14} />, label: "Crosshair" },
      { tool: "eraser", icon: <Eraser size={14} />, label: "Eraser" },
    ],
  },
  // --- Lines (matches TradingView "LINES" menu) ---
  {
    id: "lines",
    icon: <TrendingUp size={18} />,
    label: "Trend line",
    defaultTool: "trendline",
    tools: [
      {
        tool: "trendline",
        icon: <TrendingUp size={14} />,
        label: "Trendline",
        hotkey: "Alt + T",
        section: "LINES",
      },
      { tool: "ray", icon: <ArrowUpRight size={14} />, label: "Ray" },
      { tool: "infoLine", icon: <Ruler size={14} />, label: "Info line" },
      {
        tool: "extendedLine",
        icon: <GitBranch size={14} />,
        label: "Extended line",
      },
      {
        tool: "trendAngle",
        icon: <Triangle size={14} />,
        label: "Trend angle",
      },
      {
        tool: "horizontal",
        icon: <Minus size={14} />,
        label: "Horizontal line",
        hotkey: "Alt + H",
      },
      {
        tool: "horizRay",
        icon: <Minus size={14} />,
        label: "Horizontal ray",
        hotkey: "Alt + J",
      },
      {
        tool: "vertical",
        icon: <MoveVertical size={14} />,
        label: "Vertical line",
        hotkey: "Alt + V",
      },
      {
        tool: "crossLine",
        icon: <Crosshair size={14} />,
        label: "Crossline",
        hotkey: "Alt + C",
      },
    ],
  },
  // --- Brushes / arrows / shapes (matches TradingView's combined geometry menu) ---
  {
    id: "shapes",
    icon: <Square size={18} />,
    label: "Rectangle",
    defaultTool: "rectangle",
    tools: [
      {
        tool: "brush",
        icon: <Paintbrush size={14} />,
        label: "Brush",
        section: "BRUSHES",
      },
      {
        tool: "highlighter",
        icon: <Highlighter size={14} />,
        label: "Highlighter",
      },
      {
        tool: "arrowMarker",
        icon: <ArrowUpRight size={14} />,
        label: "Arrow marker",
        section: "ARROWS",
      },
      {
        tool: "arrow",
        icon: <ArrowUpRight size={14} />,
        label: "Arrow",
      },
      {
        tool: "arrowMarkUp",
        icon: <ArrowUp size={14} />,
        label: "Arrow mark up",
      },
      {
        tool: "arrowMarkDown",
        icon: <ArrowDown size={14} />,
        label: "Arrow mark down",
      },
      {
        tool: "arrowMarkLeft",
        icon: <ArrowLeft size={14} />,
        label: "Arrow mark left",
      },
      {
        tool: "arrowMarkRight",
        icon: <ArrowRight size={14} />,
        label: "Arrow mark right",
      },
      {
        tool: "rectangle",
        icon: <Square size={14} />,
        label: "Rectangle",
        hotkey: "Alt+Shift+R",
        section: "SHAPES",
      },
      {
        tool: "rotatedRect",
        icon: <Square size={14} className="rotate-12" />,
        label: "Rotated rectangle",
      },
      { tool: "path", icon: <Waypoints size={14} />, label: "Path" },
      { tool: "circle", icon: <Circle size={14} />, label: "Circle" },
      { tool: "ellipse", icon: <Circle size={14} />, label: "Ellipse" },
      { tool: "polyline", icon: <PenTool size={14} />, label: "Polyline" },
      { tool: "triangle", icon: <Triangle size={14} />, label: "Triangle" },
      { tool: "arc", icon: <Spline size={14} />, label: "Arc" },
      { tool: "curve", icon: <Spline size={14} />, label: "Curve" },
      { tool: "doubleCurve", icon: <PenLine size={14} />, label: "Double curve" },
    ],
  },
  // --- Fibonacci ---
  {
    id: "fibonacci",
    icon: <GitFork size={18} />,
    label: "Fib Retracement",
    defaultTool: "fibRetracement",
    tools: [
      {
        tool: "fibRetracement",
        icon: <GitFork size={14} />,
        label: "Fib Retracement",
      },
      {
        tool: "fibExtension",
        icon: <ArrowBigUp size={14} />,
        label: "Trend-Based Fib Extension",
      },
      { tool: "fib", icon: <GitFork size={14} />, label: "Fib (legacy)" },
    ],
  },
  // --- Positions ---
  {
    id: "positions",
    icon: <ChartCandlestick size={18} />,
    label: "Long position",
    defaultTool: "long",
    tools: [
      {
        tool: "long",
        icon: <ChartCandlestick size={14} />,
        label: "Long position",
      },
      {
        tool: "short",
        icon: <ChartNoAxesColumn size={14} />,
        label: "Short position",
      },
    ],
  },
  // --- Annotations ---
  {
    id: "annotations",
    icon: <Type size={18} />,
    label: "Text",
    defaultTool: "text",
    tools: [
      { tool: "text", icon: <Type size={14} />, label: "Text" },
      { tool: "emoji", icon: <Smile size={14} />, label: "Emoji" },
    ],
  },
];

/** Flat tool lookup (first occurrence wins) for the favorites quick-bar. */
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

/** Favorite tools (persisted). Star toggle in the flyout, TradingView-style. */
function useFavorites(): [Set<string>, (tool: string) => void] {
  const [fav, setFav] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback((tool: string) => {
    setFav((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) next.delete(tool);
      else next.add(tool);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);
  return [fav, toggle];
}

export function DrawingToolbar() {
  const activeTool = useAtomValue(activeToolAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const drawColor = useAtomValue(drawColorAtom);
  const setDrawColor = useSetAtom(setDrawColorAtom);
  const clearDrawings = useSetAtom(clearDrawingsAtom);
  const lastUsed = useLastUsed();
  const [favorites, toggleFavorite] = useFavorites();

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const btnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Favorited tools (in the order they were starred) for the quick-access bar.
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
      {/* Favorites quick-access bar: starred tools, TradingView-style */}
      {favList.length > 0 && (
        <>
          {favList.map((tool) => {
            const meta = TOOL_BY_ID.get(tool);
            if (!meta) return null;
            return (
              <IconButton
                key={`fav-${tool}`}
                label={`${meta.label} (favorite - right-click to remove)`}
                active={activeTool === tool}
                onClick={() => {
                  setActiveTool(tool);
                  setOpenGroup(null);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleFavorite(tool);
                }}
              >
                <span className="[&_svg]:h-[18px] [&_svg]:w-[18px]">
                  {meta.icon}
                </span>
              </IconButton>
            );
          })}
          <div className="my-1 h-0.5 w-6 rounded-full bg-brand/40" />
        </>
      )}
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

      <IconButton label="Clear all drawings" onClick={clearDrawings}>
        <Trash2 size={18} />
      </IconButton>
    </div>
  );
}
