import type {
  Drawing,
  GannBoxConfig,
  GannConfig,
  GannFamily,
  GannLevelConfig,
  GannLineStyle,
  GannSquareConfig,
  Point,
} from "../../../../../types";
import { resolveGannConfig } from "../../../../../types";
import type { HitTestProjector } from "../../hittest/HitTestEngine";
import type { DrawingAdapterInteractionContext } from "../ToolRegistry";
import {
  projectTwoPoints,
  type Segment,
  type XY,
} from "./lineGeometry";

type PixelPoint = XY;

export interface GannStroke {
  segment: Segment;
  color?: string;
  opacity?: number;
  lineWidth?: number;
  lineStyle?: GannLineStyle;
  label?: string;
}

export interface GannArc {
  points: PixelPoint[];
  color?: string;
  opacity?: number;
  lineWidth?: number;
  lineStyle?: GannLineStyle;
  label?: string;
}

export interface GannFanGeometry {
  origin: PixelPoint;
  control: PixelPoint;
  strokes: GannStroke[];
}

export interface GannGridGeometry {
  a: PixelPoint;
  b: PixelPoint;
  left: number;
  right: number;
  top: number;
  bottom: number;
  priceLines: GannStroke[];
  timeLines: GannStroke[];
  angleLines: GannStroke[];
  arcs: GannArc[];
}

function effectiveLevel(value: number, reverse: boolean): number {
  return reverse ? 1 - value : value;
}

function strokeForLevel(
  segment: Segment,
  level: GannLevelConfig,
  label?: string,
): GannStroke {
  return {
    segment,
    color: level.color,
    opacity: level.opacity,
    lineWidth: level.lineWidth,
    lineStyle: level.lineStyle,
    label,
  };
}

function enabledLevels(levels: readonly GannLevelConfig[]): GannLevelConfig[] {
  return levels
    .filter((level) => level.enabled && Number.isFinite(level.value))
    .map((level) => ({ ...level }));
}

function segmentKey(segment: Segment): string {
  const points = [segment.a, segment.b]
    .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
    .sort();
  return points.join("|");
}

function uniqueStrokes(strokes: GannStroke[]): GannStroke[] {
  const seen = new Set<string>();
  return strokes.filter(({ segment }) => {
    const key = segmentKey(segment);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Nine configurable, infinite Gann angles sharing one pivot. */
export function projectGannFan(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): GannFanGeometry | null {
  const source = projectTwoPoints(drawing, toX, toY);
  if (!source) return null;
  const config = resolveGannConfig(drawing.gann, "fan");
  if (config.family !== "fan") return null;
  const origin = config.reverse ? source.b : source.a;
  const control = config.reverse ? source.a : source.b;
  const strokes = config.ratios
    .filter((item) => item.enabled && Number.isFinite(item.ratio) && item.ratio > 0)
    .map((item) => ({
      segment: {
        a: origin,
        b: {
          x: control.x,
          y: origin.y + (control.y - origin.y) * item.ratio,
        },
      },
      color: item.color,
      opacity: item.opacity,
      lineWidth: item.lineWidth,
      lineStyle: item.lineStyle,
      label: item.label,
    }));
  return { origin, control, strokes };
}

function projectGridLevels(
  drawing: Drawing,
  family: "square" | "box",
  toX: HitTestProjector,
  toY: HitTestProjector,
): {
  config: GannSquareConfig | GannBoxConfig;
  a: PixelPoint;
  b: PixelPoint;
  left: number;
  right: number;
  top: number;
  bottom: number;
  priceLines: GannStroke[];
  timeLines: GannStroke[];
} | null {
  const source = projectTwoPoints(drawing, toX, toY);
  if (!source) return null;
  const resolved = resolveGannConfig(drawing.gann, family);
  if (resolved.family !== family) return null;
  const config = resolved as GannSquareConfig | GannBoxConfig;
  const left = Math.min(source.a.x, source.b.x);
  const right = Math.max(source.a.x, source.b.x);
  const top = Math.min(source.a.y, source.b.y);
  const bottom = Math.max(source.a.y, source.b.y);
  const priceLines = enabledLevels(config.priceLevels).map((level) => {
    const value = effectiveLevel(level.value, config.reverse);
    const y = source.a.y + (source.b.y - source.a.y) * value;
    return strokeForLevel(
      { a: { x: left, y }, b: { x: right, y } },
      level,
      String(level.value),
    );
  });
  const timeLines = enabledLevels(config.timeLevels).map((level) => {
    const value = effectiveLevel(level.value, config.reverse);
    const x = source.a.x + (source.b.x - source.a.x) * value;
    return strokeForLevel(
      { a: { x, y: top }, b: { x, y: bottom } },
      level,
      String(level.value),
    );
  });
  return {
    config,
    a: source.a,
    b: source.b,
    left,
    right,
    top,
    bottom,
    priceLines,
    timeLines,
  };
}

function squareFan(
  grid: NonNullable<ReturnType<typeof projectGridLevels>>,
): GannStroke[] {
  const origin = grid.config.reverse ? grid.b : grid.a;
  const opposite = grid.config.reverse ? grid.a : grid.b;
  const farX = opposite.x;
  const farY = opposite.y;
  const strokes = [
    ...grid.priceLines.map((item) => ({
      ...item,
      segment: { a: origin, b: { x: farX, y: item.segment.a.y } },
    })),
    ...grid.timeLines.map((item) => ({
      ...item,
      segment: { a: origin, b: { x: item.segment.a.x, y: farY } },
    })),
  ];
  return uniqueStrokes(strokes);
}

function squareArcs(
  grid: NonNullable<ReturnType<typeof projectGridLevels>>,
): GannArc[] {
  const origin = grid.config.reverse ? grid.b : grid.a;
  const opposite = grid.config.reverse ? grid.a : grid.b;
  const dx = opposite.x - origin.x;
  const dy = opposite.y - origin.y;
  const levels = enabledLevels(grid.config.priceLevels)
    .filter((level) => level.value > 0 && level.value <= 1);
  return levels.map((level) => {
    const points: PixelPoint[] = [];
    for (let index = 0; index <= 24; index++) {
      const angle = (Math.PI / 2) * index / 24;
      points.push({
        x: origin.x + dx * level.value * Math.cos(angle),
        y: origin.y + dy * level.value * Math.sin(angle),
      });
    }
    return {
      points,
      color: level.color,
      opacity: level.opacity,
      lineWidth: level.lineWidth,
      lineStyle: level.lineStyle,
      label: String(level.value),
    };
  });
}

function boxAngles(
  grid: NonNullable<ReturnType<typeof projectGridLevels>>,
): GannStroke[] {
  const { left, right, top, bottom } = grid;
  const topLeft = { x: left, y: top };
  const topRight = { x: right, y: top };
  const bottomLeft = { x: left, y: bottom };
  const bottomRight = { x: right, y: bottom };
  const priceRays = grid.priceLines.flatMap((item) => {
    const y = item.segment.a.y;
    return [
      { ...item, segment: { a: topLeft, b: { x: right, y } } },
      { ...item, segment: { a: bottomLeft, b: { x: right, y } } },
      { ...item, segment: { a: topRight, b: { x: left, y } } },
      { ...item, segment: { a: bottomRight, b: { x: left, y } } },
    ];
  });
  const timeRays = grid.timeLines.flatMap((item) => {
    const x = item.segment.a.x;
    return [
      { ...item, segment: { a: topLeft, b: { x, y: bottom } } },
      { ...item, segment: { a: topRight, b: { x, y: bottom } } },
      { ...item, segment: { a: bottomLeft, b: { x, y: top } } },
      { ...item, segment: { a: bottomRight, b: { x, y: top } } },
    ];
  });
  return uniqueStrokes([...priceRays, ...timeRays]);
}

/** Shared finite grid primitives for Gann Square and Gann Box. */
export function projectGannGrid(
  drawing: Drawing,
  family: "square" | "box",
  toX: HitTestProjector,
  toY: HitTestProjector,
): GannGridGeometry | null {
  const grid = projectGridLevels(drawing, family, toX, toY);
  if (!grid) return null;
  const angleLines = family === "square"
    ? squareFan(grid)
    : boxAngles(grid);
  const arcs = family === "square" ? squareArcs(grid) : [];
  return { ...grid, angleLines, arcs };
}

export interface GannLogicalBarContext {
  candles?: readonly { time: number }[];
  barIntervalSeconds?: number;
}

function logicalIndex(
  time: number,
  context?: GannLogicalBarContext,
): number {
  const candles = context?.candles ?? [];
  const interval = Number.isFinite(context?.barIntervalSeconds) && Number(context?.barIntervalSeconds) > 0
    ? Number(context?.barIntervalSeconds)
    : 1;
  if (candles.length < 2) return time / interval;
  const first = candles[0].time;
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex].time;
  if (time <= first) return (time - first) / interval;
  if (time >= last) return lastIndex + (time - last) / interval;
  let low = 0;
  let high = lastIndex;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (candles[mid].time <= time) low = mid;
    else high = mid;
  }
  const span = candles[high].time - candles[low].time;
  return span > 0 ? low + (time - candles[low].time) / span : low;
}

/** Logical series distance shared by scale locking and rendered range labels. */
export function gannLogicalBars(
  a: Point,
  b: Point,
  context?: GannLogicalBarContext,
): number {
  return Math.abs(logicalIndex(b.time, context) - logicalIndex(a.time, context));
}

/** Price units per logical chart bar, resilient to sessions and data gaps. */
export function gannPriceBarRatio(
  a: Point,
  b: Point,
  context?: GannLogicalBarContext,
): number {
  const bars = gannLogicalBars(a, b, context);
  if (bars <= Number.EPSILON) return 0;
  return Math.abs(b.price - a.price) / bars;
}

/**
 * Toggle scale locking without changing the visible Gann geometry.
 *
 * The persisted ratio is captured from the drawing's current two anchors when
 * locking is enabled. This is deliberately based on logical chart bars (the
 * same session-aware distance used by resize constraints and range labels), so
 * turning the setting on never snaps a weekend-spanning drawing to the legacy
 * fallback ratio of `1` on its next resize.
 */
export function setGannScaleLock(
  config: GannConfig,
  points: readonly Point[],
  enabled: boolean,
  context?: GannLogicalBarContext,
): GannConfig {
  const resolved = resolveGannConfig(config, config.family);
  if (!enabled) return { ...resolved, scaleLock: false } as GannConfig;
  const [first, second] = points;
  const measured = first && second
    ? gannPriceBarRatio(first, second, context)
    : 0;
  return {
    ...resolved,
    scaleLock: true,
    priceBarRatio: measured > Number.EPSILON
      ? measured
      : resolved.priceBarRatio,
  } as GannConfig;
}

/**
 * Preserve a Gann price/bar ratio while an anchor is dragged. Time follows the
 * pointer; price is derived from the logical bar distance to the fixed anchor.
 */
export function constrainGannAnchor(
  fixed: Point,
  pointer: Point,
  priceBarRatio: number,
  context?: DrawingAdapterInteractionContext,
  priceDirection?: number,
): Point {
  if (!Number.isFinite(priceBarRatio) || priceBarRatio <= 0) return { ...pointer };
  const bars = gannLogicalBars(fixed, pointer, context);
  const direction = Math.sign(priceDirection ?? (pointer.price - fixed.price)) || 1;
  return {
    ...pointer,
    price: fixed.price + direction * bars * priceBarRatio,
  };
}

export interface GannResizeConstraintResult {
  point: Point;
  priceBarRatio: number;
  gann: GannConfig;
}

/** One constraint entry point shared by every Gann-family resize gesture. */
export function constrainGannResize(
  drawing: Pick<Drawing, "gann">,
  family: GannFamily,
  originalPoints: readonly Point[],
  anchorIndex: number,
  pointer: Point,
  context?: DrawingAdapterInteractionContext,
  preserveCurrentRatio = false,
): GannResizeConstraintResult | null {
  const config = resolveGannConfig(drawing.gann, family);
  if (!config.scaleLock && !preserveCurrentRatio) return null;
  if (originalPoints.length !== 2 || (anchorIndex !== 0 && anchorIndex !== 1)) {
    return null;
  }
  const fixed = originalPoints[anchorIndex === 0 ? 1 : 0];
  const moving = originalPoints[anchorIndex];
  if (!fixed || !moving) return null;
  const measuredRatio = gannPriceBarRatio(originalPoints[0], originalPoints[1], context);
  const priceBarRatio = config.scaleLock
    ? config.priceBarRatio
    : measuredRatio || config.priceBarRatio;
  return {
    point: constrainGannAnchor(
      fixed,
      pointer,
      priceBarRatio,
      context,
      moving.price - fixed.price,
    ),
    priceBarRatio,
    gann: { ...config, priceBarRatio } as GannConfig,
  };
}

export function familyForGannTool(tool: Drawing["tool"]): GannFamily | null {
  if (tool === "gannFan") return "fan";
  if (tool === "gannSquare") return "square";
  if (tool === "gannBox") return "box";
  return null;
}
