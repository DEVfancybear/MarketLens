/**
 * ChannelTool — parallel trend channel.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, handle } from "./shared";
import {
  channelAnchorHits,
  channelBodyHits,
  channelBounds,
  projectChannel,
} from "./channelGeometry";
const plugin: DrawingToolPlugin = {
  tool: "channel",
  minPoints: 2,
  maxPoints: 3,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const geometry = projectChannel(d, proj.toX, proj.toY);
    if (!geometry) return;
    line(g, geometry.baseline.a.x, geometry.baseline.a.y, geometry.baseline.b.x, geometry.baseline.b.y);
    line(g, geometry.parallel.a.x, geometry.parallel.a.y, geometry.parallel.b.x, geometry.parallel.b.y);
    if (selected) {
      handle(g, geometry.baseline.a.x, geometry.baseline.a.y, d.color);
      handle(g, geometry.baseline.b.x, geometry.baseline.b.y, d.color);
      if (geometry.offsetAnchor) {
        handle(g, geometry.offsetAnchor.x, geometry.offsetAnchor.y, d.color);
      }
    }
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const geometry = projectChannel(d, toX, toY);
    return [
      ...channelAnchorHits(d, geometry, px, py),
      ...channelBodyHits(d, geometry, px, py),
    ];
  },
  movePoints: defaultMovePoints,
  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const geometry = projectChannel(d, toX, toY);
    if (!geometry) return [];
    return [
      { index: 0, x: geometry.baseline.a.x, y: geometry.baseline.a.y, target: "p1" },
      { index: 1, x: geometry.baseline.b.x, y: geometry.baseline.b.y, target: "p2" },
      ...(geometry.offsetAnchor
        ? [{ index: 2, x: geometry.offsetAnchor.x, y: geometry.offsetAnchor.y, target: "p3" as const }]
        : []),
    ];
  },
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return channelBounds(projectChannel(d, toX, toY));
  },
};
registerTool(plugin);
