import type {
  Drawing,
  FibAlignH,
  FibAlignV,
  FibLevelConfig,
} from "@/types";
import { DEFAULT_FIB_LEVELS, FIB_EXT_LEVELS } from "../../../../../types";
import type { HitTestProjector } from "../../hittest/HitTestEngine";

export const FIB_RIGHT_PRICE_SCALE_GUARD = 112;
export const FIB_EDGE_PAD = 4;
export const FIB_LABEL_PAD = 6;
export const FIB_INFINITE_SPAN = 100000;

export type FibFamily = "retracement" | "extension";

export interface ProjectedFibLevel {
  level: FibLevelConfig;
  price: number;
  y: number;
  color: string;
}

export function resolvedFibLevels(
  drawing: Drawing,
  family: FibFamily,
): FibLevelConfig[] {
  if (drawing.fibLevels?.length || family === "retracement") {
    return DEFAULT_FIB_LEVELS.map((base, index) => {
      const custom = drawing.fibLevels?.[index];
      return {
        ...base,
        ...(custom ?? {}),
        value: Number.isFinite(custom?.value) ? custom!.value : base.value,
        color: custom?.color || base.color,
        enabled: custom?.enabled ?? base.enabled,
      };
    });
  }
  return FIB_EXT_LEVELS.map((value, index) => ({
    value,
    enabled: true,
    color: DEFAULT_FIB_LEVELS[index]?.color ?? drawing.color,
  }));
}

export function fibProjectionOrigin(drawing: Drawing) {
  return drawing.points[2] ?? drawing.points[1];
}

export function fibLevelPrice(
  drawing: Drawing,
  level: number,
  family: FibFamily,
): number {
  if (family === "extension") {
    const a = drawing.points[0];
    const b = drawing.points[1];
    const c = fibProjectionOrigin(drawing);
    return c.price + (b.price - a.price) * level;
  }
  const start = drawing.fibReverse
    ? drawing.points[1].price
    : drawing.points[0].price;
  const end = drawing.fibReverse
    ? drawing.points[0].price
    : drawing.points[1].price;
  if (drawing.fibLogScale && start > 0 && end > 0) {
    return Math.exp(Math.log(start) + (Math.log(end) - Math.log(start)) * level);
  }
  return start + (end - start) * level;
}

export function projectFibLevels(
  drawing: Drawing,
  toY: HitTestProjector,
  family: FibFamily,
): ProjectedFibLevel[] {
  const levels: ProjectedFibLevel[] = [];
  for (const level of resolvedFibLevels(drawing, family)) {
    if (!level.enabled) continue;
    const price = fibLevelPrice(drawing, level.value, family);
    const y = toY(price);
    if (y == null || !Number.isFinite(y)) continue;
    levels.push({
      level,
      price,
      y,
      color: drawing.fibUseOneColor
        ? drawing.fibLevelLineColor || drawing.color
        : level.color || drawing.color,
    });
  }
  return levels;
}

export function usableFibRight(width: number): number {
  return Math.max(96, width - FIB_RIGHT_PRICE_SCALE_GUARD);
}

export function retracementXRange(
  drawing: Drawing,
  x1: number,
  x2: number,
  width?: number,
) {
  const rightEdge = width == null ? FIB_INFINITE_SPAN : usableFibRight(width);
  const baseLeft = Math.min(x1, x2);
  const baseRight = Math.min(Math.max(x1, x2), rightEdge);
  const extend = drawing.extend ?? "none";
  return {
    left: extend === "left" || extend === "both" ? 0 : baseLeft,
    right:
      extend === "right" || extend === "both" ? rightEdge : baseRight,
  };
}

function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 6;
}

export function formatFibPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: priceDecimals(price),
    maximumFractionDigits: priceDecimals(price),
  });
}

export function formatFibLevel(
  level: number,
  mode: Drawing["fibLevelsFormat"],
): string {
  if (mode === "percent") {
    const percent = level * 100;
    return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
  }
  return Number.isInteger(level)
    ? String(level)
    : level.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function fibLabelText(
  drawing: Drawing,
  level: FibLevelConfig,
  price: number,
): string {
  const levelLabel =
    drawing.fibShowLevels !== false
      ? formatFibLevel(level.value, drawing.fibLevelsFormat ?? "values")
      : "";
  const priceLabel =
    drawing.fibShowPrices !== false ? formatFibPrice(price) : "";
  const parts: string[] = [];
  if (levelLabel && priceLabel) parts.push(`${levelLabel} (${priceLabel})`);
  else if (levelLabel) parts.push(levelLabel);
  else if (priceLabel) parts.push(priceLabel);
  if (drawing.fibShowText !== false && level.text?.trim()) {
    parts.push(level.text.trim());
  }
  return parts.join("  ");
}

export function fibLabelBaseline(align: FibAlignV): CanvasTextBaseline {
  if (align === "top") return "top";
  if (align === "bottom") return "bottom";
  return "middle";
}

export function fibLabelX(
  textWidth: number,
  left: number,
  right: number,
  width: number,
  align: FibAlignH,
): number {
  const maxX = Math.max(FIB_EDGE_PAD, width - textWidth - 8);
  const preferred =
    align === "center"
      ? (left + right) / 2 - textWidth / 2
      : align === "right"
        ? right - textWidth - FIB_LABEL_PAD
        : left - textWidth - FIB_LABEL_PAD;
  if (align === "left") return Math.min(preferred, maxX);
  return Math.max(FIB_EDGE_PAD, Math.min(maxX, preferred));
}

/**
 * Greedy label layout shared by every Fib adapter. Lines remain rendered, but
 * labels outside the pane or overlapping a previously accepted label are
 * omitted. The source order is preserved for deterministic snapshots.
 */
export function visibleFibLabels<T extends { y: number }>(
  levels: readonly T[],
  height: number,
  fontSize: number,
): T[] {
  const gap = Math.max(8, fontSize + 2);
  const accepted: T[] = [];
  for (const level of levels) {
    if (level.y < -gap || level.y > height + gap) continue;
    if (accepted.some((item) => Math.abs(item.y - level.y) < gap)) continue;
    accepted.push(level);
  }
  return accepted;
}
