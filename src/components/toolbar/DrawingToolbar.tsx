"use client";
import {
  MousePointer2,
  TrendingUp,
  Minus,
  MoveVertical,
  ArrowUpRight,
  GitBranch,
  Crosshair,
  Ruler,
  Square,
  Type,
  GitFork,
  Trash2,
  Palette,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { useChartStore } from "@/store/chartStore";
import type { DrawingTool } from "@/types";

/** Toolbar tools with visual category separators. */
const TOOL_CATEGORIES: {
  category?: string;
  items: { tool: DrawingTool; icon: React.ReactNode; label: string }[];
}[] = [
  {
    category: "MODES",
    items: [
      { tool: "cursor", icon: <MousePointer2 size={18} />, label: "Cursor" },
    ],
  },
  {
    category: "LINES",
    items: [
      {
        tool: "trendline",
        icon: <TrendingUp size={18} />,
        label: "Trend line",
      },
      { tool: "ray", icon: <ArrowUpRight size={18} />, label: "Ray" },
      {
        tool: "extendedLine",
        icon: <GitBranch size={18} />,
        label: "Extended line",
      },
      {
        tool: "horizontal",
        icon: <Minus size={18} />,
        label: "Horizontal line",
      },
      { tool: "horizRay", icon: <Minus size={18} />, label: "Horizontal ray" },
      {
        tool: "vertical",
        icon: <MoveVertical size={18} />,
        label: "Vertical line",
      },
      { tool: "crossLine", icon: <Crosshair size={18} />, label: "Cross line" },
      { tool: "infoLine", icon: <Ruler size={18} />, label: "Info line" },
    ],
  },
  {
    category: "SHAPES",
    items: [
      { tool: "rectangle", icon: <Square size={18} />, label: "Rectangle" },
      { tool: "fib", icon: <GitFork size={18} />, label: "Fibonacci" },
      { tool: "text", icon: <Type size={18} />, label: "Text" },
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

export function DrawingToolbar() {
  const activeTool = useChartStore((s) => s.activeTool);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const drawColor = useChartStore((s) => s.drawColor);
  const setDrawColor = useChartStore((s) => s.setDrawColor);
  const clearDrawings = useChartStore((s) => s.clearDrawings);

  return (
    <div className="flex h-full flex-col items-center gap-0.5 overflow-y-auto py-2">
      {TOOL_CATEGORIES.map((cat, ci) => (
        <div
          key={cat.category ?? ci}
          className="flex w-full flex-col items-center"
        >
          {ci > 0 && <div className="my-1 h-px w-6 bg-terminal-border" />}
          {cat.items.map((t) => (
            <IconButton
              key={t.tool}
              label={t.label}
              active={activeTool === t.tool}
              onClick={() => setActiveTool(t.tool)}
            >
              {t.icon}
            </IconButton>
          ))}
        </div>
      ))}

      <div className="my-1 h-px w-6 bg-terminal-border" />

      {/* Colour picker */}
      <div className="group relative">
        <IconButton label="Colour">
          <Palette size={18} style={{ color: drawColor }} />
        </IconButton>
        <div className="absolute left-full top-0 z-50 ml-1 hidden grid-cols-3 gap-1 rounded-md border border-terminal-border bg-terminal-panel-2 p-1.5 group-hover:grid">
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
