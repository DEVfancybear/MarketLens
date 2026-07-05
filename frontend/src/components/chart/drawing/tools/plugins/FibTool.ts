/**
 * Legacy `fib` tool kept for saved drawings and old hot paths.
 * It mirrors the modern Fib Retracement renderer and settings contract.
 */
import type { Drawing, FibAlignH, FibAlignV, FibLevelConfig } from "@/types";
import { DEFAULT_FIB_LEVELS } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToRect,
  distToSegment,
} from "../ToolRegistry";
import { applyStyle, canvasFont, line, handle } from "./shared";

const LEVEL_OPACITY = 0.82;
const FILL_OPACITY = 0.12;
const LABEL_PAD = 6;
const FIB_RIGHT_PRICE_SCALE_GUARD = 112;
const FIB_EDGE_PAD = 4;
const DEFAULT_TREND_LINE_COLOR = "#787b86";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function fibLevels(d: Drawing): FibLevelConfig[] {
  const custom = d.fibLevels;
  return DEFAULT_FIB_LEVELS.map((base, i) => ({
    ...base,
    ...(custom?.[i] ?? {}),
    value: Number.isFinite(custom?.[i]?.value) ? custom![i].value : base.value,
    color: custom?.[i]?.color || base.color,
    enabled: custom?.[i]?.enabled ?? base.enabled,
  }));
}

function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 6;
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: priceDecimals(price),
    maximumFractionDigits: priceDecimals(price),
  });
}

function formatLevel(level: number, mode: Drawing["fibLevelsFormat"]): string {
  if (mode === "percent") {
    const pct = level * 100;
    return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
  }
  return Number.isInteger(level)
    ? String(level)
    : level.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function levelPrice(d: Drawing, level: number): number {
  const start = d.fibReverse ? d.points[1].price : d.points[0].price;
  const end = d.fibReverse ? d.points[0].price : d.points[1].price;
  if (d.fibLogScale && start > 0 && end > 0) {
    return Math.exp(Math.log(start) + (Math.log(end) - Math.log(start)) * level);
  }
  return start + (end - start) * level;
}

function labelXFor(
  g: CanvasRenderingContext2D,
  label: string,
  left: number,
  right: number,
  width: number,
  align: FibAlignH,
) {
  const textW = g.measureText(label).width;
  const maxX = Math.max(FIB_EDGE_PAD, width - textW - 8);
  const preferred =
    align === "center"
      ? (left + right) / 2 - textW / 2
      : align === "right"
        ? right - textW - LABEL_PAD
        : left - textW - LABEL_PAD;
  if (align === "left") {
    return Math.min(preferred, maxX);
  }
  return clamp(preferred, FIB_EDGE_PAD, maxX);
}

function labelBaseline(align: FibAlignV): CanvasTextBaseline {
  if (align === "top") return "top";
  if (align === "bottom") return "bottom";
  return "middle";
}

function labelText(d: Drawing, level: FibLevelConfig, price: number): string {
  const parts: string[] = [];
  const levelLabel =
    d.fibShowLevels !== false ? formatLevel(level.value, d.fibLevelsFormat ?? "values") : "";
  const priceLabel = d.fibShowPrices !== false ? formatPrice(price) : "";
  if (levelLabel && priceLabel) parts.push(`${levelLabel} (${priceLabel})`);
  else if (levelLabel) parts.push(levelLabel);
  else if (priceLabel) parts.push(priceLabel);
  if (d.fibShowText !== false && level.text?.trim()) parts.push(level.text.trim());
  return parts.join("  ");
}

function projectedLevels(
  d: Drawing,
  toY: HitTestProjector,
): Array<{ level: FibLevelConfig; price: number; y: number; color: string }> {
  const levels: Array<{ level: FibLevelConfig; price: number; y: number; color: string }> = [];
  for (const level of fibLevels(d)) {
    if (!level.enabled) continue;
    const price = levelPrice(d, level.value);
    const y = toY(price);
    if (y != null) {
      const color = d.fibUseOneColor
        ? d.fibLevelLineColor || d.color
        : level.color || d.color;
      levels.push({ level, price, y, color });
    }
  }
  return levels;
}

function xRange(d: Drawing, x1: number, x2: number, width: number) {
  const usableRight = usableFibRight(width);
  const baseLeft = Math.min(x1, x2);
  const baseRight = Math.min(Math.max(x1, x2), usableRight);
  const extend = d.extend ?? "none";
  return {
    left: extend === "left" || extend === "both" ? 0 : baseLeft,
    right: extend === "right" || extend === "both" ? usableRight : baseRight,
  };
}

function usableFibRight(width: number): number {
  return Math.max(96, width - FIB_RIGHT_PRICE_SCALE_GUARD);
}

const plugin: DrawingToolPlugin = {
  tool: "fib",
  minPoints: 2,

  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    if (d.points.length < 2) return;
    const x1 = proj.toX(d.points[0].time);
    const y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time);
    const y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;

    const usableRight = usableFibRight(proj.width);
    const { left, right } = xRange(d, x1, x2, proj.width);
    const levels = projectedLevels(d, proj.toY);

    g.save();
    g.beginPath();
    g.rect(0, 0, usableRight, proj.height);
    g.clip();
    if (levels.length > 1 && d.fibBackground !== false && d.opacity !== 0) {
      const sorted = [...levels].sort((a, b) => a.y - b.y);
      for (let i = 0; i < sorted.length - 1; i++) {
        const top = sorted[i].y;
        const bottom = sorted[i + 1].y;
        g.fillStyle = sorted[i].color;
        g.globalAlpha = (d.opacity ?? FILL_OPACITY) * (i % 2 === 0 ? 1 : 0.62);
        g.fillRect(left, top, right - left, Math.max(1, bottom - top));
      }
    }

    if (d.fibTrendLine !== false) {
      g.globalAlpha = 0.68;
      g.strokeStyle = d.fibTrendLineColor || DEFAULT_TREND_LINE_COLOR;
      g.lineWidth = Math.max(1, d.fibTrendLineWidth ?? d.lineWidth ?? 1.5);
      applyStyle(g, d.fibTrendLineStyle ?? "dashed");
      line(g, x1, y1, x2, y2);
      g.setLineDash([]);
    }

    g.font = canvasFont(d.fontSize ?? 12, { weight: 500 });
    g.textBaseline = labelBaseline(d.fibLabelsVAlign ?? "middle");
    g.textAlign = "left";
    for (const { level, price, y, color } of levels) {
      g.strokeStyle = d.fibUseOneColor ? d.fibLevelLineColor || d.color : color;
      g.lineWidth = Math.max(1, d.fibLevelLineWidth ?? d.lineWidth ?? 1.5);
      applyStyle(g, d.fibLevelLineStyle ?? d.lineStyle ?? "solid");
      if (d.fibLevelsLine !== false) {
        g.globalAlpha = LEVEL_OPACITY;
        line(g, left, y, right, y);
      }
      const label = labelText(d, level, price);
      if (!label) continue;
      g.globalAlpha = 1;
      g.fillStyle = d.fibUseOneColor ? d.fibLevelLineColor || d.color : color;
      g.fillText(
        label,
        labelXFor(g, label, left, right, usableRight, d.fibLabelsHAlign ?? "left"),
        y,
      );
    }
    g.restore();

    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },

  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const results: HitResult[] = [];
    if (d.points.length < 2) return results;
    const x1 = toX(d.points[0].time);
    const y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time);
    const y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;

    const p1Dist = pointDist(px, py, x1, y1);
    const p2Dist = pointDist(px, py, x2, y2);
    if (p1Dist <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p1", anchorIndex: 0, distance: p1Dist });
    if (p2Dist <= HANDLE_RADIUS)
      results.push({ drawing: d, target: "p2", anchorIndex: 1, distance: p2Dist });

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const levels = projectedLevels(d, toY);
    for (const { y } of levels) {
      const dist = distToSegment(px, py, left, y, right, y);
      if (dist < TOL) results.push({ drawing: d, target: "body", distance: dist });
    }
    const trendDist = distToSegment(px, py, x1, y1, x2, y2);
    if (trendDist < TOL) results.push({ drawing: d, target: "body", distance: trendDist });
    if (levels.length > 0) {
      const ys = levels.map((l) => l.y);
      const bodyDist = distToRect(px, py, left, Math.min(...ys), right, Math.max(...ys));
      if (bodyDist < TOL)
        results.push({ drawing: d, target: "body", distance: bodyDist + 0.5 });
    }
    return results;
  },

  movePoints: defaultMovePoints,

  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    if (d.points.length < 2) return null;
    const x1 = toX(d.points[0].time);
    const x2 = toX(d.points[1].time);
    if (x1 == null || x2 == null) return null;
    const ys = projectedLevels(d, toY).map((l) => l.y);
    if (ys.length === 0) return null;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    return {
      x: left,
      y: Math.min(...ys),
      w: right - left,
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
};

registerTool(plugin);
