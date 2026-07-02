/**
 * FibExtensionTool - TradingView-style trend-based Fibonacci extension.
 *
 * New drawings use three clicks:
 *   A -> B defines the impulse length.
 *   C defines the projection origin after the pullback.
 * Level price = C + ratio * (B - A).
 *
 * Existing two-point objects are still rendered by treating B as C.
 */
import type { Drawing, FibAlignH, FibAlignV, FibLevelConfig } from "@/types";
import { DEFAULT_FIB_LEVELS, FIB_EXT_LEVELS } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type Anchor,
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

const LEVEL_OPACITY = 0.74;
const FILL_OPACITY = 0.07;
const LABEL_PAD = 6;
const LABEL_CULL_PAD = 150;
const FIB_RIGHT_PRICE_SCALE_GUARD = 112;
const FIB_EDGE_PAD = 4;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function fibLevels(d: Drawing): FibLevelConfig[] {
  if (d.fibLevels?.length) {
    return DEFAULT_FIB_LEVELS.map((base, i) => {
      const custom = d.fibLevels?.[i];
      return {
        ...base,
        ...(custom ?? {}),
        value: Number.isFinite(custom?.value) ? custom!.value : base.value,
        color: custom?.color || base.color,
        enabled: custom?.enabled ?? base.enabled,
      };
    });
  }
  return FIB_EXT_LEVELS.map((value, i) => ({
    value,
    enabled: true,
    color: DEFAULT_FIB_LEVELS[i]?.color ?? d.color,
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

function projectionOrigin(d: Drawing) {
  return d.points[2] ?? d.points[1];
}

function levelPrice(d: Drawing, level: number): number {
  const a = d.points[0];
  const b = d.points[1];
  const c = projectionOrigin(d);
  return c.price + (b.price - a.price) * level;
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

function labelXFor(
  g: CanvasRenderingContext2D,
  label: string,
  left: number,
  right: number,
  width: number,
  align: FibAlignH,
) {
  const textW = g.measureText(label).width;
  const preferred =
    align === "center"
      ? (left + right) / 2 - textW / 2
      : align === "right"
        ? right - textW - LABEL_PAD
        : left + LABEL_PAD;
  return clamp(preferred, FIB_EDGE_PAD, Math.max(FIB_EDGE_PAD, width - textW - 8));
}

function usableFibRight(width: number): number {
  return Math.max(96, width - FIB_RIGHT_PRICE_SCALE_GUARD);
}

function labelBaseline(align: FibAlignV): CanvasTextBaseline {
  if (align === "top") return "top";
  if (align === "bottom") return "bottom";
  return "middle";
}

function labelText(d: Drawing, level: FibLevelConfig, price: number): string {
  const parts: string[] = [];
  if (d.fibShowLevels !== false)
    parts.push(formatLevel(level.value, d.fibLevelsFormat ?? "values"));
  if (d.fibShowPrices !== false) parts.push(formatPrice(price));
  if (d.fibShowText !== false && level.text?.trim()) parts.push(level.text.trim());
  return parts.join("  ");
}

const plugin: DrawingToolPlugin = {
  tool: "fibExtension",
  minPoints: 2,
  maxPoints: 3,

  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    if (d.points.length < 2) return;
    const a = d.points[0];
    const b = d.points[1];
    const c = projectionOrigin(d);
    const x1 = proj.toX(a.time);
    const y1 = proj.toY(a.price);
    const x2 = proj.toX(b.time);
    const y2 = proj.toY(b.price);
    const x3 = proj.toX(c.time);
    const y3 = proj.toY(c.price);
    if (x1 == null || y1 == null || x2 == null || y2 == null || x3 == null || y3 == null) {
      return;
    }

    const usableRight = usableFibRight(proj.width);
    const left = Math.max(0, Math.min(x3, usableRight));
    const right = usableRight;
    const levels = projectedLevels(d, proj.toY);

    g.save();
    g.beginPath();
    g.rect(0, 0, usableRight, proj.height);
    g.clip();

    if (levels.length > 1 && d.fibBackground !== false && d.opacity !== 0) {
      const sorted = [...levels].sort((m, n) => m.y - n.y);
      for (let i = 0; i < sorted.length - 1; i++) {
        const top = sorted[i].y;
        const bottom = sorted[i + 1].y;
        g.fillStyle = sorted[i].color;
        g.globalAlpha = (d.opacity ?? 1) * FILL_OPACITY * (i % 2 === 0 ? 1 : 0.6);
        g.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
      }
    }

    // A-B impulse guide and B-C pullback/projection-origin guide.
    if (d.fibTrendLine !== false) {
      g.globalAlpha = 0.58;
      g.strokeStyle = d.fibTrendLineColor || d.color;
      g.lineWidth = Math.max(1, d.fibTrendLineWidth ?? d.lineWidth ?? 1.5);
      applyStyle(g, d.fibTrendLineStyle ?? "dashed");
      line(g, x1, y1, x2, y2);
      if (d.points[2]) line(g, x2, y2, x3, y3);
      g.setLineDash([]);
    }

    g.font = canvasFont(d.fontSize ?? 12, { weight: 500 });
    g.textBaseline = labelBaseline(d.fibLabelsVAlign ?? "middle");
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
        labelXFor(g, label, left, right, usableRight, d.fibLabelsHAlign ?? "right"),
        y,
      );
    }
    g.restore();

    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
      if (d.points[2]) handle(g, x3, y3, d.color);
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
    const projected = d.points.slice(0, 3).map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));

    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      if (p.x == null || p.y == null) continue;
      const dist = pointDist(px, py, p.x, p.y);
      if (dist <= HANDLE_RADIUS) {
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === 1 ? "p2" : "p3",
          anchorIndex: i,
          distance: dist,
        });
      }
    }

    const a = projected[0];
    const b = projected[1];
    const c = projected[2] ?? projected[1];
    if (a.x == null || a.y == null || b.x == null || b.y == null || c.x == null || c.y == null) {
      return results;
    }

    const impulseDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
    if (impulseDist < TOL) {
      results.push({ drawing: d, target: "body", distance: impulseDist });
    }
    if (d.points[2]) {
      const originDist = distToSegment(px, py, b.x, b.y, c.x, c.y);
      if (originDist < TOL) {
        results.push({ drawing: d, target: "body", distance: originDist });
      }
    }

    const left = c.x;
    const right = Math.max(c.x, c.x + 9999);
    const levels = projectedLevels(d, toY);
    for (const { y } of levels) {
      const dist = distToSegment(px, py, left, y, right, y);
      if (dist < TOL) results.push({ drawing: d, target: "body", distance: dist });
    }
    if (levels.length > 0) {
      const ys = levels.map((l) => l.y);
      const bodyDist = distToRect(px, py, left, Math.min(...ys), right, Math.max(...ys));
      if (bodyDist < TOL) results.push({ drawing: d, target: "body", distance: bodyDist + 0.5 });
    }

    return results;
  },

  movePoints: defaultMovePoints,

  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    if (d.points.length < 2) return null;
    const xs = d.points
      .slice(0, 3)
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = projectedLevels(d, toY).map((l) => l.y);
    if (xs.length === 0 || ys.length === 0) return null;
    const left = Math.min(...xs);
    return {
      x: left,
      y: Math.min(...ys),
      w: 9999 + LABEL_CULL_PAD,
      h: Math.max(...ys) - Math.min(...ys),
    };
  },

  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector): Anchor[] {
    return d.points.slice(0, 3).map((pt, i) => ({
      index: i,
      x: toX(pt.time),
      y: toY(pt.price),
      target: i === 0 ? "p1" : i === 1 ? "p2" : "p3",
    }));
  },
};

registerTool(plugin);
