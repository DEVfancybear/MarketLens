/** Phase 8 Wave D projection and safe rich-content tools. */
import type { Drawing, DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { HANDLE_RADIUS, TOL, defaultMovePoints, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { canvasFont, handle } from "./shared";
import type { Anchor } from "../ToolRegistry";

type XY={x:number;y:number};
function projected(d:Drawing,toX:HitTestProjector,toY:HitTestProjector){return d.points.flatMap(p=>{const x=toX(p.time),y=toY(p.price);return x==null||y==null?[]:[{x,y}];});}
function bounds(points:readonly XY[]){if(!points.length)return null;const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));return{x:minX-TOL,y:minY-TOL,w:maxX-minX+TOL*2,h:maxY-minY+TOL*2};}
function inside(d:Drawing,px:number,py:number,points:readonly XY[]):HitResult[]{const b=bounds(points);return b&&px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h?[{drawing:d,target:"body",distance:1}]:[];}
function selectedHandles(g:CanvasRenderingContext2D,d:Drawing,p:readonly XY[],selected:boolean){if(selected)p.forEach(a=>handle(g,a.x,a.y,d.color));}
const targetFor=(index:number):HitResult["target"]=>index===0?"p1":index===1?"p2":index===2?"p3":index===3?"p4":index===4?"p5":"body";
function richAnchors(d:Drawing,toX:HitTestProjector,toY:HitTestProjector):Anchor[]{return d.points.map((point,index)=>({index,x:toX(point.time),y:toY(point.price),target:targetFor(index)}));}
function richAnchorHits(d:Drawing,px:number,py:number,toX:HitTestProjector,toY:HitTestProjector):HitResult[]{return richAnchors(d,toX,toY).flatMap(anchor=>{if(anchor.x==null||anchor.y==null)return[];const distance=Math.hypot(px-anchor.x,py-anchor.y);return distance<=24?[{drawing:d,target:anchor.target,anchorIndex:anchor.index,distance}]:[];});}

type ProjectedShape<T> = {
  anchors: readonly (XY | null)[];
  body: T | null;
};

type ForecastBody = {
  triangle: readonly [XY, XY, XY];
  centerLine: readonly [XY, XY];
};

type SectorBody = {
  center: XY;
  radius: number;
  startAngle: number;
  endAngle: number;
  counterclockwise: boolean;
  extrema: readonly XY[];
};

const TAU = Math.PI * 2;
const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5] as const;

function projectShapeAnchors(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): readonly (XY | null)[] {
  return d.points.map((point) => {
    const x = toX(point.time);
    const y = toY(point.price);
    return x == null || y == null ? null : { x, y };
  });
}

function shapeAnchors(points: readonly (XY | null)[]): Anchor[] {
  return points.map((point, index) => ({
    index,
    x: point?.x ?? null,
    y: point?.y ?? null,
    target: targetFor(index),
  }));
}

function shapeAnchorHits(
  d: Drawing,
  px: number,
  py: number,
  points: readonly (XY | null)[],
): HitResult[] {
  return shapeAnchors(points).flatMap((anchor) => {
    if (anchor.x == null || anchor.y == null) return [];
    const distance = Math.hypot(px - anchor.x, py - anchor.y);
    return distance <= HANDLE_RADIUS
      ? [{ drawing: d, target: anchor.target, anchorIndex: anchor.index, distance }]
      : [];
  });
}

function nonNullPoints(points: readonly (XY | null)[]): XY[] {
  return points.filter((point): point is XY => point != null);
}

function projectForecastGeometry(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): ProjectedShape<ForecastBody> {
  const anchors = projectShapeAnchors(d, toX, toY);
  const origin = anchors[0];
  const target = anchors[1];
  const spreadAnchor = anchors[2];
  if (!origin || !target || !spreadAnchor) return { anchors, body: null };

  const spread = Math.max(
    8,
    Math.hypot(spreadAnchor.x - target.x, spreadAnchor.y - target.y),
  );
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const upper = {
    x: target.x + normal.x * spread,
    y: target.y + normal.y * spread,
  };
  const lower = {
    x: target.x - normal.x * spread,
    y: target.y - normal.y * spread,
  };
  return {
    anchors,
    body: {
      triangle: [origin, upper, lower],
      centerLine: [origin, target],
    },
  };
}

function signedTriangleArea(a: XY, b: XY, c: XY): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(point: XY, triangle: readonly [XY, XY, XY]): boolean {
  const [a, b, c] = triangle;
  if (Math.abs(signedTriangleArea(a, b, c)) < 1e-8) return false;
  const d1 = signedTriangleArea(point, a, b);
  const d2 = signedTriangleArea(point, b, c);
  const d3 = signedTriangleArea(point, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function forecastBodyHits(
  d: Drawing,
  px: number,
  py: number,
  body: ForecastBody | null,
): HitResult[] {
  if (!body) return [];
  const point = { x: px, y: py };
  const distance = distToSegment(
    px,
    py,
    body.centerLine[0].x,
    body.centerLine[0].y,
    body.centerLine[1].x,
    body.centerLine[1].y,
  );
  const insideVisibleFill =
    d.fillColor !== "transparent" &&
    (d.opacity ?? 0.14) > 0 &&
    pointInTriangle(point, body.triangle);
  return insideVisibleFill || distance < TOL
    ? [{ drawing: d, target: "body", distance: insideVisibleFill ? 0 : distance }]
    : [];
}

function normalizePositive(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function angleIsOnSweep(angle: number, start: number, sweep: number): boolean {
  if (Math.abs(sweep) >= TAU - 1e-8) return true;
  return sweep >= 0
    ? normalizePositive(angle - start) <= sweep + 1e-8
    : normalizePositive(start - angle) <= -sweep + 1e-8;
}

function circlePoint(center: XY, radius: number, angle: number): XY {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function projectSectorGeometry(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): ProjectedShape<SectorBody> {
  const anchors = projectShapeAnchors(d, toX, toY);
  const center = anchors[0];
  const radiusAnchor = anchors[1];
  const angleAnchor = anchors[2];
  if (!center || !radiusAnchor || !angleAnchor) return { anchors, body: null };

  const radius = Math.hypot(radiusAnchor.x - center.x, radiusAnchor.y - center.y);
  const startAngle = Math.atan2(radiusAnchor.y - center.y, radiusAnchor.x - center.x);
  const endAngle = Math.atan2(angleAnchor.y - center.y, angleAnchor.x - center.x);
  const sweep = endAngle - startAngle;
  const extrema = [
    center,
    circlePoint(center, radius, startAngle),
    circlePoint(center, radius, endAngle),
    ...CARDINAL_ANGLES.filter((angle) => angleIsOnSweep(angle, startAngle, sweep))
      .map((angle) => circlePoint(center, radius, angle)),
  ];
  return {
    anchors,
    body: {
      center,
      radius,
      startAngle,
      endAngle,
      counterclockwise: sweep < 0,
      extrema,
    },
  };
}

function sectorBodyHits(
  d: Drawing,
  px: number,
  py: number,
  body: SectorBody | null,
): HitResult[] {
  if (!body) return [];
  const dx = px - body.center.x;
  const dy = py - body.center.y;
  const radialDistance = Math.hypot(dx, dy);
  const sweep = body.endAngle - body.startAngle;
  const angleInSector = radialDistance < 1e-8
    || angleIsOnSweep(Math.atan2(dy, dx), body.startAngle, sweep);
  const insideSector =
    d.fillColor !== "transparent" &&
    (d.opacity ?? 0.15) > 0 &&
    radialDistance <= body.radius &&
    angleInSector;
  const start = circlePoint(body.center, body.radius, body.startAngle);
  const end = circlePoint(body.center, body.radius, body.endAngle);
  const edgeDistance = Math.min(
    distToSegment(px, py, body.center.x, body.center.y, start.x, start.y),
    distToSegment(px, py, body.center.x, body.center.y, end.x, end.y),
    angleInSector ? Math.abs(radialDistance - body.radius) : Number.POSITIVE_INFINITY,
  );
  return insideSector || edgeDistance < TOL
    ? [{ drawing: d, target: "body", distance: insideSector ? 0 : edgeDistance }]
    : [];
}

const forecast:DrawingToolPlugin={tool:"forecast",minPoints:3,maxPoints:3,render(g,d,proj,selected){const geometry=projectForecastGeometry(d,proj.toX,proj.toY);if(!geometry.body)return;const [origin,upper,lower]=geometry.body.triangle;g.save();g.fillStyle=d.fillColor||d.color;g.globalAlpha=d.opacity??.14;g.beginPath();g.moveTo(origin.x,origin.y);g.lineTo(upper.x,upper.y);g.lineTo(lower.x,lower.y);g.closePath();g.fill();g.globalAlpha=1;g.strokeStyle=d.color;g.lineWidth=d.lineWidth;g.setLineDash([6,4]);g.beginPath();g.moveTo(geometry.body.centerLine[0].x,geometry.body.centerLine[0].y);g.lineTo(geometry.body.centerLine[1].x,geometry.body.centerLine[1].y);g.stroke();selectedHandles(g,d,nonNullPoints(geometry.anchors),selected);g.restore();},hitTest(d,px,py,toX,toY){const geometry=projectForecastGeometry(d,toX,toY);return[...shapeAnchorHits(d,px,py,geometry.anchors),...forecastBodyHits(d,px,py,geometry.body)];},getAnchors(d,toX,toY){return shapeAnchors(projectForecastGeometry(d,toX,toY).anchors);},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const geometry=projectForecastGeometry(d,toX,toY),visibleBody=d.fillColor!=="transparent"&&(d.opacity??.14)>0?geometry.body?.triangle:geometry.body?.centerLine;return bounds([...(visibleBody??[]),...nonNullPoints(geometry.anchors)]);}};
const sector:DrawingToolPlugin={tool:"sector",minPoints:3,maxPoints:3,render(g,d,proj,selected){const geometry=projectSectorGeometry(d,proj.toX,proj.toY);if(!geometry.body)return;g.save();g.fillStyle=d.fillColor||d.color;g.strokeStyle=d.color;g.lineWidth=d.lineWidth;g.globalAlpha=d.opacity??.15;g.beginPath();g.moveTo(geometry.body.center.x,geometry.body.center.y);g.arc(geometry.body.center.x,geometry.body.center.y,geometry.body.radius,geometry.body.startAngle,geometry.body.endAngle,geometry.body.counterclockwise);g.closePath();g.fill();g.globalAlpha=1;g.stroke();selectedHandles(g,d,nonNullPoints(geometry.anchors),selected);g.restore();},hitTest(d,px,py,toX,toY){const geometry=projectSectorGeometry(d,toX,toY);return[...shapeAnchorHits(d,px,py,geometry.anchors),...sectorBodyHits(d,px,py,geometry.body)];},getAnchors(d,toX,toY){return shapeAnchors(projectSectorGeometry(d,toX,toY).anchors);},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const geometry=projectSectorGeometry(d,toX,toY);return bounds([...(geometry.body?.extrema??[]),...nonNullPoints(geometry.anchors)]);}};

function rectTool(tool:"table"|"image"):DrawingToolPlugin{return{tool,minPoints:2,render(g,d,proj,selected){const p=projected(d,proj.toX,proj.toY);if(p.length<2)return;const x=Math.min(p[0].x,p[1].x),y=Math.min(p[0].y,p[1].y),w=Math.abs(p[1].x-p[0].x),h=Math.abs(p[1].y-p[0].y);g.save();g.fillStyle=d.fillColor||"#131722";g.globalAlpha=d.opacity??.92;g.fillRect(x,y,w,h);g.globalAlpha=1;g.strokeStyle=d.color;g.lineWidth=d.lineWidth;g.strokeRect(x,y,w,h);g.font=canvasFont(d.fontSize??12);g.fillStyle=d.textColor||d.color;if(tool==="table"){const cells=d.content?.kind==="table"&&d.content.cells?.length?d.content.cells:[["Header","Value"],["Row","—"]],rows=cells.length,cols=Math.max(1,...cells.map(r=>r.length));for(let row=1;row<rows;row++){const yy=y+h*row/rows;g.beginPath();g.moveTo(x,yy);g.lineTo(x+w,yy);g.stroke();}for(let col=1;col<cols;col++){const xx=x+w*col/cols;g.beginPath();g.moveTo(xx,y);g.lineTo(xx,y+h);g.stroke();}g.textAlign="center";g.textBaseline="middle";cells.forEach((row,ri)=>row.forEach((cell,ci)=>g.fillText(cell,x+w*(ci+.5)/cols,y+h*(ri+.5)/rows,Math.max(1,w/cols-8))));}else{const alt=d.content?.kind==="image"?(d.content.alt||"Image"):"Image";g.textAlign="center";g.textBaseline="middle";g.fillText(`▧ ${alt}`,x+w/2,y+h/2,Math.max(1,w-12));}selectedHandles(g,d,p,selected);g.restore();},hitTest(d,px,py,toX,toY){return[...richAnchorHits(d,px,py,toX,toY),...inside(d,px,py,projected(d,toX,toY))];},movePoints:defaultMovePoints,boundingBox(d,toX,toY){return bounds(projected(d,toX,toY));}};}

function socialCardGeometry(d:Drawing,toX:HitTestProjector,toY:HitTestProjector){const anchor=projected(d,toX,toY)[0];if(!anchor)return null;const text=(d.text||d.content?.alt||"Paste an X post or TradingView idea URL").slice(0,160),w=Math.min(340,Math.max(180,text.length*6+28)),h=62;return{anchor,text,box:{x:anchor.x+8,y:anchor.y-h/2,w,h}};}
const social:DrawingToolPlugin={tool:"socialEmbed",minPoints:1,render(g,d,proj,selected){const geometry=socialCardGeometry(d,proj.toX,proj.toY);if(!geometry)return;const {anchor,text,box}=geometry;g.save();g.fillStyle=d.fillColor||"#131722";g.globalAlpha=d.opacity??.95;g.fillRect(box.x,box.y,box.w,box.h);g.globalAlpha=1;g.strokeStyle=d.color;g.strokeRect(box.x,box.y,box.w,box.h);g.font=canvasFont(d.fontSize??12);g.fillStyle=d.textColor||"#fff";g.textAlign="left";g.textBaseline="middle";g.fillText("X / TradingView",anchor.x+20,anchor.y-14,box.w-24);g.fillText(text,anchor.x+20,anchor.y+12,box.w-24);selectedHandles(g,d,[anchor],selected);g.restore();},hitTest(d,px,py,toX,toY){const geometry=socialCardGeometry(d,toX,toY),body=geometry&&px>=geometry.box.x-TOL&&px<=geometry.box.x+geometry.box.w+TOL&&py>=geometry.box.y-TOL&&py<=geometry.box.y+geometry.box.h+TOL?[{drawing:d,target:"body" as const,distance:1}]:[];return[...richAnchorHits(d,px,py,toX,toY),...body];},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const geometry=socialCardGeometry(d,toX,toY);if(!geometry)return null;const left=Math.min(geometry.anchor.x,geometry.box.x)-TOL,right=Math.max(geometry.anchor.x,geometry.box.x+geometry.box.w)+TOL,top=Math.min(geometry.anchor.y,geometry.box.y)-TOL,bottom=Math.max(geometry.anchor.y,geometry.box.y+geometry.box.h)+TOL;return{x:left,y:top,w:right-left,h:bottom-top};}};

registerTool(forecast);registerTool(sector);registerTool(rectTool("table"));registerTool(rectTool("image"));registerTool(social);
