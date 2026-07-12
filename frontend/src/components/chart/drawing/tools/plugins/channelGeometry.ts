import { DEFAULT_CHANNEL_LEVELS, type Drawing } from "../../../../../types/drawing";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  TOL,
  distToSegment,
} from "../ToolRegistry";
import {
  projectPoint,
  projectTwoPoints,
  twoPointAnchorHits,
  type Segment,
  type XY,
  extendedLineSegment,
  raySegment,
} from "./lineGeometry";

export interface ChannelGeometry {
  baseline: Segment;
  parallel: Segment;
  /** Real third anchor for current payloads; absent for legacy two-point data. */
  offsetAnchor: XY | null;
  legacy: boolean;
}

export interface ProjectedChannelLevel {
  value: number;
  color: string;
  segment: Segment;
}

function extendChannelSegment(segment: Segment, extend: Drawing["extend"]): Segment {
  if (extend === "both") return extendedLineSegment(segment);
  if (extend === "right") return raySegment(segment);
  if (extend === "left") {
    const reversed = raySegment({ a: segment.b, b: segment.a });
    return { a: reversed.b, b: reversed.a };
  }
  return segment;
}

export function projectChannelLevels(
  drawing: Drawing,
  geometry: ChannelGeometry | null,
): ProjectedChannelLevel[] {
  if (!geometry) return [];
  const levels = drawing.channelLevels?.length
    ? drawing.channelLevels
    : DEFAULT_CHANNEL_LEVELS;
  return levels.flatMap((level) => {
    if (!level.enabled || !Number.isFinite(level.value)) return [];
    const ratio = level.value;
    const segment = {
      a: {
        x: geometry.baseline.a.x + (geometry.parallel.a.x - geometry.baseline.a.x) * ratio,
        y: geometry.baseline.a.y + (geometry.parallel.a.y - geometry.baseline.a.y) * ratio,
      },
      b: {
        x: geometry.baseline.b.x + (geometry.parallel.b.x - geometry.baseline.b.x) * ratio,
        y: geometry.baseline.b.y + (geometry.parallel.b.y - geometry.baseline.b.y) * ratio,
      },
    };
    return [{ value: ratio, color: level.color || drawing.color, segment: extendChannelSegment(segment, drawing.extend) }];
  });
}

/**
 * Project a channel without rewriting stored coordinates.
 *
 * Current channels use three anchors. The third anchor is projected onto the
 * normal of the baseline, making the rendered sides exactly parallel while
 * preserving its signed offset. Historical two-point payloads retain the old
 * secondary-line formula so loading them does not introduce visual drift.
 */
export function projectChannel(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): ChannelGeometry | null {
  const baseline = projectTwoPoints(drawing, toX, toY);
  if (!baseline) return null;

  const third = drawing.points[2]
    ? projectPoint(drawing.points[2], toX, toY)
    : null;
  if (!third) {
    const legacyOffset = 50;
    return {
      baseline,
      parallel: {
        a: { x: baseline.a.x, y: baseline.b.y + legacyOffset },
        b: { x: baseline.b.x, y: baseline.a.y + legacyOffset },
      },
      offsetAnchor: null,
      legacy: true,
    };
  }

  const dx = baseline.b.x - baseline.a.x;
  const dy = baseline.b.y - baseline.a.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) {
    const offset = { x: third.x - baseline.a.x, y: third.y - baseline.a.y };
    return {
      baseline,
      parallel: {
        a: { x: baseline.a.x + offset.x, y: baseline.a.y + offset.y },
        b: { x: baseline.b.x + offset.x, y: baseline.b.y + offset.y },
      },
      offsetAnchor: third,
      legacy: false,
    };
  }

  const normal = { x: -dy / length, y: dx / length };
  const signedOffset =
    (third.x - baseline.a.x) * normal.x +
    (third.y - baseline.a.y) * normal.y;
  const offset = { x: normal.x * signedOffset, y: normal.y * signedOffset };
  return {
    baseline,
    parallel: {
      a: { x: baseline.a.x + offset.x, y: baseline.a.y + offset.y },
      b: { x: baseline.b.x + offset.x, y: baseline.b.y + offset.y },
    },
    offsetAnchor: third,
    legacy: false,
  };
}

export function channelAnchorHits(
  drawing: Drawing,
  geometry: ChannelGeometry | null,
  px: number,
  py: number,
): HitResult[] {
  if (!geometry) return [];
  const hits = twoPointAnchorHits(drawing, geometry.baseline, px, py);
  if (geometry.offsetAnchor) {
    const distance = Math.hypot(
      px - geometry.offsetAnchor.x,
      py - geometry.offsetAnchor.y,
    );
    if (distance <= 24) {
      hits.push({
        drawing,
        target: "p3",
        anchorIndex: 2,
        distance,
      });
    }
  }
  return hits;
}

export function channelBodyHits(
  drawing: Drawing,
  geometry: ChannelGeometry | null,
  px: number,
  py: number,
): HitResult[] {
  if (!geometry) return [];
  const distances = projectChannelLevels(drawing, geometry).map(({ segment }) =>
    distToSegment(
      px,
      py,
      segment.a.x,
      segment.a.y,
      segment.b.x,
      segment.b.y,
    ),
  );
  const distance = Math.min(...distances);
  return distance < TOL ? [{ drawing, target: "body", distance }] : [];
}

export function channelBounds(geometry: ChannelGeometry | null, pad = TOL, drawing?: Drawing) {
  if (!geometry) return null;
  const levelSegments = drawing ? projectChannelLevels(drawing, geometry) : [];
  const points = [
    ...levelSegments.flatMap(({ segment }) => [segment.a, segment.b]),
    ...(!drawing ? [geometry.baseline.a, geometry.baseline.b, geometry.parallel.a, geometry.parallel.b] : []),
    ...(geometry.offsetAnchor ? [geometry.offsetAnchor] : []),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    x: left - pad,
    y: top - pad,
    w: right - left + pad * 2,
    h: bottom - top + pad * 2,
  };
}
