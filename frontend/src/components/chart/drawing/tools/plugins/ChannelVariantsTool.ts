/** Phase 8 Wave A channel variants sharing explicit multi-anchor geometry. */
import type { Drawing } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { TOL, defaultMovePoints, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { handle, line, renderLineText } from "./shared";
import { projectPoint, type Segment, twoPointAnchorHits } from "./lineGeometry";

function point(d: Drawing, index: number, toX: HitTestProjector, toY: HitTestProjector) {
  return d.points[index] ? projectPoint(d.points[index], toX, toY) : null;
}

function segmentHit(d: Drawing, segments: Segment[], px: number, py: number): HitResult[] {
  const distance = Math.min(...segments.map((s) => distToSegment(px, py, s.a.x, s.a.y, s.b.x, s.b.y)));
  return distance < TOL ? [{ drawing: d, target: "body", distance }] : [];
}

function boxOf(segments: Segment[]) {
  const points = segments.flatMap((s) => [s.a, s.b]);
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const left = Math.min(...xs); const right = Math.max(...xs);
  const top = Math.min(...ys); const bottom = Math.max(...ys);
  return { x: left - TOL, y: top - TOL, w: right - left + TOL * 2, h: bottom - top + TOL * 2 };
}

const flatTopBottom: DrawingToolPlugin = {
  tool: "flatTopBottom", minPoints: 3, maxPoints: 3,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const a = point(d, 0, proj.toX, proj.toY); const b = point(d, 1, proj.toX, proj.toY); const c = point(d, 2, proj.toX, proj.toY);
    if (!a || !b || !c) return;
    const flat: Segment = { a: { x: a.x, y: c.y }, b: { x: b.x, y: c.y } };
    g.save();
    if (d.fillColor !== "transparent") { g.fillStyle = d.fillColor || d.color; g.globalAlpha = d.opacity ?? 0.12; g.beginPath(); g.moveTo(a.x,a.y); g.lineTo(b.x,b.y); g.lineTo(flat.b.x,flat.b.y); g.lineTo(flat.a.x,flat.a.y); g.closePath(); g.fill(); g.globalAlpha=1; }
    line(g, a.x,a.y,b.x,b.y); line(g, flat.a.x,flat.a.y,flat.b.x,flat.b.y);
    renderLineText(g,d,a.x,a.y,b.x,b.y,selected);
    if(selected){ handle(g,a.x,a.y,d.color); handle(g,b.x,b.y,d.color); handle(g,c.x,c.y,d.color); }
    g.restore();
  },
  hitTest(d,px,py,toX,toY){ const a=point(d,0,toX,toY),b=point(d,1,toX,toY),c=point(d,2,toX,toY); if(!a||!b||!c)return[]; const base={a,b}; const flat={a:{x:a.x,y:c.y},b:{x:b.x,y:c.y}}; const third=Math.hypot(px-c.x,py-c.y); return [...twoPointAnchorHits(d,base,px,py),...(third<=24?[{drawing:d,target:"p3" as const,anchorIndex:2,distance:third}]:[]),...segmentHit(d,[base,flat],px,py)]; },
  movePoints: defaultMovePoints,
  boundingBox(d,toX,toY){ const a=point(d,0,toX,toY),b=point(d,1,toX,toY),c=point(d,2,toX,toY); return a&&b&&c?boxOf([{a,b},{a:{x:a.x,y:c.y},b:{x:b.x,y:c.y}}]):null; },
};

const disjointChannel: DrawingToolPlugin = {
  tool: "disjointChannel", minPoints: 4, maxPoints: 4,
  render(g,d,proj,selected){ const p=d.points.map((_,i)=>point(d,i,proj.toX,proj.toY)); if(p.some((v)=>!v))return; const [a,b,c,e]=p as NonNullable<(typeof p)[number]>[]; g.save(); if(d.fillColor!=="transparent"){g.fillStyle=d.fillColor||d.color;g.globalAlpha=d.opacity??0.12;g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.lineTo(e.x,e.y);g.lineTo(c.x,c.y);g.closePath();g.fill();g.globalAlpha=1;} line(g,a.x,a.y,b.x,b.y);line(g,c.x,c.y,e.x,e.y);renderLineText(g,d,a.x,a.y,b.x,b.y,selected);if(selected)[a,b,c,e].forEach((v)=>handle(g,v.x,v.y,d.color));g.restore(); },
  hitTest(d,px,py,toX,toY){const p=d.points.map((_,i)=>point(d,i,toX,toY));if(p.some((v)=>!v))return[];const [a,b,c,e]=p as NonNullable<(typeof p)[number]>[];const anchors:HitResult[]=d.points.flatMap((_,i)=>{const v=[a,b,c,e][i];const distance=Math.hypot(px-v.x,py-v.y);return distance<=24?[{drawing:d,target:(i===0?"p1":i===1?"p2":"body") as HitResult["target"],anchorIndex:i,distance}]:[];});return [...anchors,...segmentHit(d,[{a,b},{a:c,b:e}],px,py)];},
  movePoints:defaultMovePoints,
  boundingBox(d,toX,toY){const p=d.points.map((_,i)=>point(d,i,toX,toY));return p.some((v)=>!v)?null:boxOf([{a:p[0]!,b:p[1]!},{a:p[2]!,b:p[3]!}]);},
};

registerTool(flatTopBottom);
registerTool(disjointChannel);
