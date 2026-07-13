/** Phase 8 Wave B Fibonacci radial geometry (arcs, circles, and wedge). */
import type { Drawing, DrawingTool } from "@/types";
import { DEFAULT_FIB_LEVELS } from "../../../../../types/drawing";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  HANDLE_RADIUS,
  TOL,
  defaultMovePoints,
  distToSegment,
  registerTool,
  type Anchor,
  type DrawingToolPlugin,
} from "../ToolRegistry";
import { canvasFont, handle, line } from "./shared";
import { projectPoint } from "./lineGeometry";

const RADIAL_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

function ratios(d: Drawing) {
  const configured = d.fibLevels?.filter((level) => level.enabled && level.value > 0 && level.value <= 1);
  return configured?.length ? configured : RADIAL_RATIOS.map((value,index)=>({value,enabled:true,color:DEFAULT_FIB_LEVELS[index+1]?.color||d.color}));
}

function projected(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
  const center=d.points[0]?projectPoint(d.points[0],toX,toY):null;
  const edge=d.points[1]?projectPoint(d.points[1],toX,toY):null;
  return center&&edge?{center,edge,rx:Math.max(1,Math.abs(edge.x-center.x)),ry:Math.max(1,Math.abs(edge.y-center.y))}:null;
}

function radialHit(d:Drawing,px:number,py:number,toX:HitTestProjector,toY:HitTestProjector,circular=false):HitResult[]{
  const geometry=projected(d,toX,toY);if(!geometry)return[];const anchors=d.points.flatMap((point,index)=>{const p=projectPoint(point,toX,toY);if(!p)return[];const distance=Math.hypot(px-p.x,py-p.y);return distance<=24?[{drawing:d,target:(index===0?"p1":index===1?"p2":"p3") as HitResult["target"],anchorIndex:index,distance}]:[];});
  const rx=circular?Math.hypot(geometry.edge.x-geometry.center.x,geometry.edge.y-geometry.center.y):geometry.rx;
  const ry=circular?rx:geometry.ry;
  const normalized=Math.hypot((px-geometry.center.x)/rx,(py-geometry.center.y)/ry);
  const distance=Math.min(...ratios(d).map((level)=>Math.abs(normalized-level.value)*Math.min(rx,ry)));
  return distance<TOL?[...anchors,{drawing:d,target:"body",distance}]:anchors;
}

function radialBounds(d:Drawing,toX:HitTestProjector,toY:HitTestProjector,circular=false){const geometry=projected(d,toX,toY);if(!geometry)return null;const max=Math.max(...ratios(d).map((level)=>level.value));const rx=circular?Math.hypot(geometry.edge.x-geometry.center.x,geometry.edge.y-geometry.center.y):geometry.rx;const ry=circular?rx:geometry.ry;return{x:geometry.center.x-rx*max-TOL,y:geometry.center.y-ry*max-TOL,w:rx*max*2+TOL*2,h:ry*max*2+TOL*2};}

function createRadial(tool:DrawingTool,circular:boolean):DrawingToolPlugin{return{tool,minPoints:2,
  render(g,d,proj,selected){const geometry=projected(d,proj.toX,proj.toY);if(!geometry)return;const rx=circular?Math.hypot(geometry.edge.x-geometry.center.x,geometry.edge.y-geometry.center.y):geometry.rx;const ry=circular?rx:geometry.ry;g.save();g.font=canvasFont(d.fontSize??10);for(const level of ratios(d)){g.strokeStyle=d.fibUseOneColor?d.fibLevelLineColor||d.color:level.color||d.color;g.beginPath();g.ellipse(geometry.center.x,geometry.center.y,rx*level.value,ry*level.value,0,0,Math.PI*2);g.stroke();if(d.fibShowLevels!==false)g.fillText(String(level.value),geometry.center.x+rx*level.value+3,geometry.center.y-3);}line(g,geometry.center.x,geometry.center.y,geometry.edge.x,geometry.edge.y);if(selected){handle(g,geometry.center.x,geometry.center.y,d.color);handle(g,geometry.edge.x,geometry.edge.y,d.color);}g.restore();},
  hitTest(d,px,py,toX,toY){return radialHit(d,px,py,toX,toY,circular);},movePoints:defaultMovePoints,boundingBox(d,toX,toY){return radialBounds(d,toX,toY,circular);}};}

type XY = { x: number; y: number };
type FibWedgeArc = { radius: number; value: number; color?: string };
type FibWedgeBody = {
  center: XY;
  radiusAnchor: XY;
  angleAnchor: XY;
  startAngle: number;
  endAngle: number;
  arcs: readonly FibWedgeArc[];
  extrema: readonly XY[];
};
type FibWedgeGeometry = {
  anchors: readonly (XY | null)[];
  body: FibWedgeBody | null;
};

const TAU = Math.PI * 2;
const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5] as const;

function normalizePositive(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function angleIsOnPositiveSweep(angle: number, start: number, end: number): boolean {
  const sweep = end - start;
  if (sweep >= TAU - 1e-8) return true;
  return normalizePositive(angle - start) <= sweep + 1e-8;
}

function circlePoint(center: XY, radius: number, angle: number): XY {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function wedgeArcExtrema(
  center: XY,
  radius: number,
  startAngle: number,
  endAngle: number,
): XY[] {
  return [
    circlePoint(center, radius, startAngle),
    circlePoint(center, radius, endAngle),
    ...CARDINAL_ANGLES.filter((angle) =>
      angleIsOnPositiveSweep(angle, startAngle, endAngle),
    ).map((angle) => circlePoint(center, radius, angle)),
  ];
}

function projectFibWedgeGeometry(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): FibWedgeGeometry {
  const anchors = d.points.map((point) => projectPoint(point, toX, toY));
  const center = anchors[0];
  const radiusAnchor = anchors[1];
  const angleAnchor = anchors[2];
  if (!center || !radiusAnchor || !angleAnchor) return { anchors, body: null };

  const baseRadius = Math.hypot(
    radiusAnchor.x - center.x,
    radiusAnchor.y - center.y,
  );
  const startAngle = Math.atan2(
    radiusAnchor.y - center.y,
    radiusAnchor.x - center.x,
  );
  let endAngle = Math.atan2(
    angleAnchor.y - center.y,
    angleAnchor.x - center.x,
  );
  if (endAngle < startAngle) endAngle += TAU;
  const arcs = ratios(d).map((level) => ({
    radius: baseRadius * level.value,
    value: level.value,
    color: level.color,
  }));
  return {
    anchors,
    body: {
      center,
      radiusAnchor,
      angleAnchor,
      startAngle,
      endAngle,
      arcs,
      extrema: [
        center,
        radiusAnchor,
        angleAnchor,
        ...arcs.flatMap((arc) =>
          wedgeArcExtrema(center, arc.radius, startAngle, endAngle),
        ),
      ],
    },
  };
}

function wedgeTarget(index: number): HitResult["target"] {
  return index === 0 ? "p1" : index === 1 ? "p2" : index === 2 ? "p3" : "body";
}

function fibWedgeAnchors(geometry: FibWedgeGeometry): Anchor[] {
  return geometry.anchors.map((point, index) => ({
    index,
    x: point?.x ?? null,
    y: point?.y ?? null,
    target: wedgeTarget(index),
  }));
}

function fibWedgeAnchorHits(
  d: Drawing,
  px: number,
  py: number,
  geometry: FibWedgeGeometry,
): HitResult[] {
  return fibWedgeAnchors(geometry).flatMap((anchor) => {
    if (anchor.x == null || anchor.y == null) return [];
    const distance = Math.hypot(px - anchor.x, py - anchor.y);
    return distance <= HANDLE_RADIUS
      ? [{ drawing: d, target: anchor.target, anchorIndex: anchor.index, distance }]
      : [];
  });
}

function fibWedgeBodyHits(
  d: Drawing,
  px: number,
  py: number,
  body: FibWedgeBody | null,
): HitResult[] {
  if (!body) return [];
  const dx = px - body.center.x;
  const dy = py - body.center.y;
  const radialDistance = Math.hypot(dx, dy);
  const angleInWedge = radialDistance < 1e-8 || angleIsOnPositiveSweep(
    Math.atan2(dy, dx),
    body.startAngle,
    body.endAngle,
  );
  let distance = Math.min(
    distToSegment(
      px,
      py,
      body.center.x,
      body.center.y,
      body.radiusAnchor.x,
      body.radiusAnchor.y,
    ),
    distToSegment(
      px,
      py,
      body.center.x,
      body.center.y,
      body.angleAnchor.x,
      body.angleAnchor.y,
    ),
  );
  if (angleInWedge) {
    for (const arc of body.arcs) {
      distance = Math.min(distance, Math.abs(radialDistance - arc.radius));
    }
  }
  return distance < TOL
    ? [{ drawing: d, target: "body", distance }]
    : [];
}

function fibWedgeBounds(geometry: FibWedgeGeometry) {
  const points = geometry.body?.extrema ?? geometry.anchors.filter((point): point is XY => point != null);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX - TOL,
    y: minY - TOL,
    w: maxX - minX + TOL * 2,
    h: maxY - minY + TOL * 2,
  };
}

const fibWedge:DrawingToolPlugin={tool:"fibWedge",minPoints:3,maxPoints:3,
  render(g,d,proj,selected){const geometry=projectFibWedgeGeometry(d,proj.toX,proj.toY);if(!geometry.body)return;g.save();g.font=canvasFont(d.fontSize??10);for(const arc of geometry.body.arcs){g.strokeStyle=d.fibUseOneColor?d.fibLevelLineColor||d.color:arc.color||d.color;g.beginPath();g.arc(geometry.body.center.x,geometry.body.center.y,arc.radius,geometry.body.startAngle,geometry.body.endAngle);g.stroke();}line(g,geometry.body.center.x,geometry.body.center.y,geometry.body.radiusAnchor.x,geometry.body.radiusAnchor.y);line(g,geometry.body.center.x,geometry.body.center.y,geometry.body.angleAnchor.x,geometry.body.angleAnchor.y);if(selected)geometry.anchors.forEach((point)=>{if(point)handle(g,point.x,point.y,d.color);});g.restore();},
  hitTest(d,px,py,toX,toY){const geometry=projectFibWedgeGeometry(d,toX,toY);return[...fibWedgeAnchorHits(d,px,py,geometry),...fibWedgeBodyHits(d,px,py,geometry.body)];},getAnchors(d,toX,toY){return fibWedgeAnchors(projectFibWedgeGeometry(d,toX,toY));},movePoints:defaultMovePoints,boundingBox(d,toX,toY){return fibWedgeBounds(projectFibWedgeGeometry(d,toX,toY));}};

registerTool(createRadial("fibSpeedArcs",false));
registerTool(createRadial("fibCircles",true));
registerTool(fibWedge);
