/**
 * PathTool - TradingView "Path": a series of connected straight segments with a
 * single arrowhead at the final point. Open (not closed) and never filled.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
} from "../ToolRegistry";
import { handle, arrowHead } from "./shared";
import {
  anchorHits,
  anchorsFromProjected,
  boundsFromPoints,
  projectPoints,
  segmentBodyHits,
  visiblePoints,
} from "./shapeGeometry";

const plugin: DrawingToolPlugin = {
  tool: "path",
  minPoints: 2,
  freeform: true,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const pts = d.points;
    if (pts.length < 2) return;
    const projPts = projectPoints(pts, proj.toX, proj.toY);
    if (projPts.some((p) => !p)) return;
    // Open connected segments (no closePath, no fill).
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++) {
      g.lineTo(projPts[i]!.x, projPts[i]!.y);
    }
    g.stroke();
    // Single arrowhead at the terminal point, aimed along the last segment.
    const tip = projPts[projPts.length - 1]!;
    const prev = projPts[projPts.length - 2]!;
    const size = Math.max(10, (d.lineWidth || 1.5) * 4);
    arrowHead(g, prev.x, prev.y, tip.x, tip.y, d.color, size);
    if (selected)
      projPts.forEach((p) => {
        if (p) handle(g, p.x, p.y, d.color);
      });
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const projected = projectPoints(d.points, toX, toY);
    return [
      ...anchorHits(d, projected, px, py),
      ...segmentBodyHits(d, projected, px, py),
    ];
  },
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return anchorsFromProjected(projectPoints(d.points, toX, toY));
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return boundsFromPoints(visiblePoints(projectPoints(d.points, toX, toY)));
  },
};

registerTool(plugin);
