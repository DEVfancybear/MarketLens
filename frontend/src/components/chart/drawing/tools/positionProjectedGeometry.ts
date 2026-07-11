import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../hittest/HitTestEngine";
import type { Projector } from "../drawingRenderer";
import type { Anchor } from "./ToolRegistry";
import { HANDLE_RADIUS, TOL, pointDist } from "./ToolRegistry";
import { POSITION_ANCHORS } from "./positionGeometry";

export const POSITION_LABEL_HIT_PAD = 20;

export interface PositionProjectedGeometry {
  xL: number;
  xR: number;
  yE: number;
  yT: number;
  yS: number;
  entry: number;
  target: number;
  stop: number;
}

export function projectPositionGeometry(
  drawing: Drawing,
  projector: Pick<Projector, "toX" | "toY">,
): PositionProjectedGeometry | null {
  const entryPoint = drawing.points[0];
  if (!entryPoint) return null;
  const entry = entryPoint.price;
  const target = drawing.points[1]?.price ?? drawing.target ?? entry;
  const stop = drawing.points[2]?.price ?? drawing.stop ?? entry;
  const xL = projector.toX(entryPoint.time);
  if (xL == null) return null;
  const xR = drawing.points[1]
    ? projector.toX(drawing.points[1].time)
    : xL + 130;
  const yE = projector.toY(entry);
  const yT = projector.toY(target);
  const yS = projector.toY(stop);
  if (xR == null || yE == null || yT == null || yS == null) return null;
  return { xL, xR, yE, yT, yS, entry, target, stop };
}

export function positionAnchorsFromGeometry(
  geometry: PositionProjectedGeometry,
): Anchor[] {
  return [
    { index: POSITION_ANCHORS.TARGET_LEFT, x: geometry.xL, y: geometry.yT, target: "p0" },
    { index: POSITION_ANCHORS.ENTRY_LEFT, x: geometry.xL, y: geometry.yE, target: "p1" },
    { index: POSITION_ANCHORS.STOP_LEFT, x: geometry.xL, y: geometry.yS, target: "p2" },
    { index: POSITION_ANCHORS.TARGET_RIGHT, x: geometry.xR, y: geometry.yT, target: "p3" },
    { index: POSITION_ANCHORS.ENTRY_RIGHT, x: geometry.xR, y: geometry.yE, target: "p4" },
    { index: POSITION_ANCHORS.STOP_RIGHT, x: geometry.xR, y: geometry.yS, target: "p5" },
  ];
}

export function hitTestPositionGeometry(
  drawing: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult[] {
  const geometry = projectPositionGeometry(drawing, { toX, toY });
  if (!geometry) return [];
  const results: HitResult[] = [];
  for (const anchor of positionAnchorsFromGeometry(geometry)) {
    if (anchor.x == null || anchor.y == null) continue;
    const distance = pointDist(px, py, anchor.x, anchor.y);
    if (distance <= HANDLE_RADIUS + 2) {
      results.push({
        drawing,
        target: anchor.target,
        anchorIndex: anchor.index,
        distance,
      });
    }
  }
  const left = Math.min(geometry.xL, geometry.xR);
  const right = Math.max(geometry.xL, geometry.xR);
  const top = Math.min(geometry.yT, geometry.yS, geometry.yE);
  const bottom = Math.max(geometry.yT, geometry.yS, geometry.yE);
  if (
    px >= left - TOL &&
    px <= right + TOL &&
    py >= top - POSITION_LABEL_HIT_PAD &&
    py <= bottom + POSITION_LABEL_HIT_PAD
  ) {
    results.push({
      drawing,
      target: "body",
      distance: Math.max(2, Math.abs(py - geometry.yE)),
    });
  }
  return results;
}

export function positionGeometryBounds(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
) {
  const geometry = projectPositionGeometry(drawing, { toX, toY });
  if (!geometry) return null;
  const left = Math.min(geometry.xL, geometry.xR);
  const top = Math.min(geometry.yE, geometry.yT, geometry.yS);
  return {
    x: left,
    y: top - POSITION_LABEL_HIT_PAD,
    w: Math.abs(geometry.xR - geometry.xL),
    h:
      Math.max(geometry.yE, geometry.yT, geometry.yS) -
      top +
      POSITION_LABEL_HIT_PAD * 2,
  };
}
