/**
 * LongPositionTool — renders and hit-tests a long position risk/reward box.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  TOL,
} from "../ToolRegistry";
import { line, handle } from "./shared";

const BULL = "#26a69a";
const BEAR = "#ef5350";

const plugin: DrawingToolPlugin = {
  tool: "long",
  minPoints: 1,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const entry = d.points[0].price,
      stop = d.stop ?? entry,
      target = d.target ?? entry;
    const xL = proj.toX(d.points[0].time);
    const xR = d.points[1] ? proj.toX(d.points[1].time) : null;
    const yE = proj.toY(entry),
      yS = proj.toY(stop),
      yT = proj.toY(target);
    if (xL == null || yE == null || yS == null || yT == null) return;
    const right = xR ?? xL + 130;
    g.save();
    g.globalAlpha = 0.14;
    g.fillStyle = BULL;
    g.fillRect(
      Math.min(xL, right),
      Math.min(yE, yT),
      Math.abs(right - xL),
      Math.abs(yT - yE),
    );
    g.globalAlpha = 0.14;
    g.fillStyle = BEAR;
    g.fillRect(
      Math.min(xL, right),
      Math.min(yE, yS),
      Math.abs(right - xL),
      Math.abs(yS - yE),
    );
    g.restore();
    g.strokeStyle = BULL;
    line(g, xL, yE, right, yE);
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = BEAR;
    line(g, xL, yS, right, yS);
    g.restore();
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = BULL;
    line(g, xL, yT, right, yT);
    g.restore();
    if (selected) {
      handle(g, xL, yE, d.color);
    }
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const results: HitResult[] = [];
    const xL = toX(d.points[0].time),
      yE = toY(d.points[0].price);
    if (yE != null && Math.abs(yE - py) < TOL)
      results.push({ drawing: d, target: "body", distance: Math.abs(yE - py) });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const xL = toX(d.points[0].time),
      yE = toY(d.points[0].price);
    if (xL == null || yE == null) return null;
    const xR = d.points[1] ? toX(d.points[1].time) : xL + 130;
    const right = xR ?? xL + 130;
    return {
      x: Math.min(xL, right),
      y: Math.min(yE, yE) - 50,
      w: Math.abs(right - xL),
      h: 100,
    };
  },
};

registerTool(plugin);
