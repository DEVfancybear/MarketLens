import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChartCandlestick,
  ChartNoAxesColumn,
  Circle,
  Crosshair,
  Eraser,
  GitBranch,
  GitFork,
  Highlighter,
  Minus,
  MousePointer2,
  MoveVertical,
  Paintbrush,
  PenLine,
  PenTool,
  Ruler,
  Smile,
  Spline,
  Square,
  Target,
  Triangle,
  TrendingUp,
  Type,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { DrawingIconKey } from "@/types/drawingToolManifest";

/**
 * One icon map for every drawing-tool presentation. The desktop rail and the
 * touch palette intentionally consume the same manifest icon key so a new tool
 * cannot silently render in one platform only.
 */
const DRAWING_ICONS: Record<DrawingIconKey, LucideIcon> = {
  cursor: MousePointer2,
  target: Target,
  eraser: Eraser,
  ruler: Ruler,
  trend: TrendingUp,
  ray: ArrowUpRight,
  branch: GitBranch,
  triangle: Triangle,
  horizontal: Minus,
  vertical: MoveVertical,
  crosshair: Crosshair,
  square: Square,
  circle: Circle,
  pen: PenTool,
  spline: Spline,
  path: Waypoints,
  doubleCurve: PenLine,
  fib: GitFork,
  fibExtension: ArrowBigUp,
  long: ChartCandlestick,
  short: ChartNoAxesColumn,
  brush: Paintbrush,
  highlighter: Highlighter,
  arrowUpRight: ArrowUpRight,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  text: Type,
  emoji: Smile,
};

export function DrawingToolIcon({
  iconKey,
  size = 18,
}: {
  iconKey: DrawingIconKey;
  size?: number;
}) {
  const Icon = DRAWING_ICONS[iconKey];
  return <Icon size={size} aria-hidden="true" />;
}
