"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  MousePointer2,
  Target,
  Eraser,
  TrendingUp,
  Minus,
  MoveVertical,
  ArrowUpRight,
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
  Trash2,
  Palette,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { useChartStore } from "@/store/chartStore";
import type { DrawingTool } from "@/types";

// ---- Tool groups (TradingView pattern) ----

interface ToolGroup {
  id: string;
  icon: React.ReactNode;
  label: string;
  defaultTool: DrawingTool;
  tools: { tool: DrawingTool; icon: React.ReactNode; label: string }[];
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
  // --- Trend lines ---
  {
    id: "lines",
    icon: <TrendingUp size={18} />,
    label: "Trend line",
    defaultTool: "trendline",
    tools: [
      {
        tool: "trendline",
        icon: <TrendingUp size={14} />,
        label: "Trend line",
      },
      { tool: "ray", icon: <ArrowUpRight size={14} />, label: "Ray" },
      {
        tool: "extendedLine",
        icon: <GitBranch size={14} />,
        label: "Extended line",
      },
      { tool: "channel", icon: <GitBranch size={14} />, label: "Channel" },
    ],
  },
  // --- Horizontal / vertical ---
  {
    id: "horizontals",
    icon: <Minus size={18} />,
    label: "Horizontal line",
    defaultTool: "horizontal",
    tools: [
      {
        tool: "horizontal",
        icon: <Minus size={14} />,
        label: "Horizontal line",
      },
      { tool: "horizRay", icon: <Minus size={14} />, label: "Horizontal ray" },
      {
        tool: "vertical",
        icon: <MoveVertical size={14} />,
        label: "Vertical line",
      },
      { tool: "crossLine", icon: <Crosshair size={14} />, label: "Cross line" },
      { tool: "infoLine", icon: <Ruler size={14} />, label: "Info line" },
    ],
  },
  // --- Shapes ---
  {
    id: "shapes",
    icon: <Square size={18} />,
    label: "Rectangle",
    defaultTool: "rectangle",
    tools: [
      { tool: "rectangle", icon: <Square size={14} />, label: "Rectangle" },
      {
        tool: "rotatedRect",
        icon: <Square size={14} />,
        label: "Rotated rect",
      },
      { tool: "circle", icon: <Circle size={14} />, label: "Circle" },
      { tool: "ellipse", icon: <Circle size={14} />, label: "Ellipse" },
      { tool: "triangle", icon: <Triangle size={14} />, label: "Triangle" },
    ],
  },
  // --- Freeform ---
  {
    id: "freeform",
    icon: <PenTool size={18} />,
    label: "Polyline",
    defaultTool: "polyline",
    tools: [
      { tool: "polyline", icon: <PenTool size={14} />, label: "Polyline" },
      { tool: "curve", icon: <Spline size={14} />, label: "Curve" },
      { tool: "path", icon: <PenTool size={14} />, label: "Path" },
      { tool: "brush", icon: <Paintbrush size={14} />, label: "Brush" },
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
        label: "Fib Extension",
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
  const activeTool = useChartStore((s) => s.activeTool);
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({});

  // When activeTool changes, update the last-used record for its group.
  // useEffect runs after render — no render-loop or cross-component warning.
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
    // We intentionally only depend on activeTool — the group lookup is
    // stable and lastUsed is a stale-closure-safe functional updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  return lastUsed;
}

export function DrawingToolbar() {
  const activeTool = useChartStore((s) => s.activeTool);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const drawColor = useChartStore((s) => s.drawColor);
  const setDrawColor = useChartStore((s) => s.setDrawColor);
  const clearDrawings = useChartStore((s) => s.clearDrawings);
  const lastUsed = useLastUsed();

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const btnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isActive = (group: ToolGroup) => {
    if (group.tools.length === 0) return activeTool === group.defaultTool;
    return (
      group.tools.some((t) => t.tool === activeTool) ||
      activeTool === group.defaultTool
    );
  };

  return (
    <div className="flex h-full flex-col items-center gap-0.5 overflow-y-auto py-2">
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

            {/* Flyout menu — portal to body to escape overflow:hidden */}
            {hasFlyout &&
              isOpen &&
              typeof document !== "undefined" &&
              (() => {
                const btn = btnRefs.current[group.id];
                if (!btn) return null;
                const rect = btn.getBoundingClientRect();
                return createPortal(
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setOpenGroup(null)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setOpenGroup(null);
                      }}
                    />
                    <div
                      className="fixed z-50 w-44 rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl shadow-black/50"
                      style={{ left: rect.right + 4, top: rect.top }}
                    >
                      {group.tools.map((t) => (
                        <button
                          key={t.tool}
                          onClick={() => {
                            setActiveTool(t.tool);
                            setOpenGroup(null);
                          }}
                          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-terminal-hover ${activeTool === t.tool ? "text-brand" : "text-ink"}`}
                        >
                          <span className="shrink-0 text-ink-muted">
                            {t.icon}
                          </span>
                          <span>{t.label}</span>
                        </button>
                      ))}
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
