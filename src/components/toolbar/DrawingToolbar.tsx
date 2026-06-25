"use client";
import {
  MousePointer2,
  TrendingUp,
  Minus,
  MoveVertical,
  Square,
  Type,
  GitFork,
  Trash2,
  Palette,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { useChartStore } from "@/store/chartStore";
import type { DrawingTool } from "@/types";

const TOOLS: { tool: DrawingTool; icon: React.ReactNode; label: string }[] = [
  { tool: "cursor", icon: <MousePointer2 size={18} />, label: "Cursor" },
  { tool: "trendline", icon: <TrendingUp size={18} />, label: "Trend line" },
  { tool: "horizontal", icon: <Minus size={18} />, label: "Horizontal line" },
  {
    tool: "vertical",
    icon: <MoveVertical size={18} />,
    label: "Vertical line",
  },
  { tool: "rectangle", icon: <Square size={18} />, label: "Rectangle" },
  { tool: "text", icon: <Type size={18} />, label: "Text" },
  { tool: "fib", icon: <GitFork size={18} />, label: "Fibonacci retracement" },
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
  // Atomic selectors — a whole-store subscription would re-render this toolbar on
  // every realtime candle tick (chartStore.candles mutates per tick). These fields
  // and actions only change on user interaction.
  const activeTool = useChartStore((s) => s.activeTool);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const drawColor = useChartStore((s) => s.drawColor);
  const setDrawColor = useChartStore((s) => s.setDrawColor);
  const clearDrawings = useChartStore((s) => s.clearDrawings);

  return (
    <div className="flex h-full flex-col items-center gap-0.5 py-2">
      {TOOLS.map((t) => (
        <IconButton
          key={t.tool}
          label={t.label}
          active={activeTool === t.tool}
          onClick={() => setActiveTool(t.tool)}
        >
          {t.icon}
        </IconButton>
      ))}

      <div className="my-1 h-px w-6 bg-terminal-border" />

      {/* Colour picker */}
      <div className="group relative">
        <IconButton label="Colour">
          <Palette size={16} style={{ color: drawColor }} />
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
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}
