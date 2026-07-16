/** Phase 8 Wave B parallel-level, ray-fan, and time-level families. */
import { resolveGannConfig, type Drawing, type DrawingTool, type FibLevelConfig } from "../../../../../types";
import { DEFAULT_FIB_LEVELS } from "../../../../../types/drawing";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  TOL,
  defaultMovePoints,
  distToSegment,
  registerTool,
  type DrawingToolPlugin,
} from "../ToolRegistry";
import { applyStyle, canvasFont, handle, line } from "./shared";
import {
  fullViewportBounds,
  projectPoint,
  projectTwoPoints,
  rayRenderSegment,
  raySegment,
  type Segment,
} from "./lineGeometry";
import { projectChannel, channelAnchorHits } from "./channelGeometry";
import { projectGannFan } from "./gannGeometry";

const CORE_FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const TIME_FIB = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;

function fibLevels(d: Drawing, min = 0, max = 1): FibLevelConfig[] {
  const configured = d.fibLevels?.length ? d.fibLevels : DEFAULT_FIB_LEVELS;
  const levels = configured.filter((level) => level.enabled && Number.isFinite(level.value) && level.value >= min && level.value <= max);
  return levels.length ? levels : CORE_FIB.map((value, index) => ({ value, enabled: true, color: DEFAULT_FIB_LEVELS[index]?.color || d.color }));
}

function timeRatios(d: Drawing): number[] {
  const configured = d.fibLevels?.filter((level) => level.enabled && Number.isFinite(level.value));
  return configured?.length ? configured.map((level) => level.value) : [...TIME_FIB];
}

function bodyHits(d: Drawing, segments: Segment[], px: number, py: number): HitResult[] {
  const distance = Math.min(...segments.map((segment) => distToSegment(px, py, segment.a.x, segment.a.y, segment.b.x, segment.b.y)));
  return distance < TOL ? [{ drawing: d, target: "body", distance }] : [];
}

function renderSegments(g: CanvasRenderingContext2D, d: Drawing, segments: Array<{ segment: Segment; color: string; label?: string }>) {
  g.font = canvasFont(d.fontSize ?? 10, { weight: 500 });
  for (const item of segments) {
    g.strokeStyle = d.fibUseOneColor ? d.fibLevelLineColor || d.color : item.color;
    g.lineWidth = d.fibLevelLineWidth ?? d.lineWidth;
    applyStyle(g, d.fibLevelLineStyle ?? d.lineStyle ?? "solid");
    line(g, item.segment.a.x, item.segment.a.y, item.segment.b.x, item.segment.b.y);
    if (item.label && d.fibShowLevels !== false) {
      g.fillStyle = g.strokeStyle;
      g.fillText(item.label, item.segment.a.x + 5, item.segment.a.y - 4);
    }
  }
}

const fibChannel: DrawingToolPlugin = {
  tool: "fibChannel", minPoints: 3, maxPoints: 3,
  render(g, d, proj, selected) {
    const geometry = projectChannel(d, proj.toX, proj.toY); if (!geometry) return;
    const levels = fibLevels(d, -1, 4.236).map((level) => ({
      level,
      segment: {
        a: { x: geometry.baseline.a.x + (geometry.parallel.a.x - geometry.baseline.a.x) * level.value, y: geometry.baseline.a.y + (geometry.parallel.a.y - geometry.baseline.a.y) * level.value },
        b: { x: geometry.baseline.b.x + (geometry.parallel.b.x - geometry.baseline.b.x) * level.value, y: geometry.baseline.b.y + (geometry.parallel.b.y - geometry.baseline.b.y) * level.value },
      },
    }));
    g.save();
    if (d.fibBackground !== false && levels.length > 1) {
      g.globalAlpha = d.opacity ?? 0.08;
      for (let i = 0; i < levels.length - 1; i++) {
        const a = levels[i].segment, b = levels[i + 1].segment;
        g.fillStyle = levels[i].level.color || d.color; g.beginPath(); g.moveTo(a.a.x,a.a.y); g.lineTo(a.b.x,a.b.y); g.lineTo(b.b.x,b.b.y); g.lineTo(b.a.x,b.a.y); g.closePath(); g.fill();
      }
      g.globalAlpha = 1;
    }
    renderSegments(g,d,levels.map(({level,segment})=>({segment,color:level.color||d.color,label:String(level.value)})));
    if(selected){[geometry.baseline.a,geometry.baseline.b,geometry.offsetAnchor].filter(Boolean).forEach((p)=>handle(g,p!.x,p!.y,d.color));}
    g.restore();
  },
  hitTest(d,px,py,toX,toY){const geometry=projectChannel(d,toX,toY);if(!geometry)return[];const segments=fibLevels(d,-1,4.236).map((level)=>({a:{x:geometry.baseline.a.x+(geometry.parallel.a.x-geometry.baseline.a.x)*level.value,y:geometry.baseline.a.y+(geometry.parallel.a.y-geometry.baseline.a.y)*level.value},b:{x:geometry.baseline.b.x+(geometry.parallel.b.x-geometry.baseline.b.x)*level.value,y:geometry.baseline.b.y+(geometry.parallel.b.y-geometry.baseline.b.y)*level.value}}));return[...channelAnchorHits(d,geometry,px,py),...bodyHits(d,segments,px,py)];},
  movePoints:defaultMovePoints,
  boundingBox(d,toX,toY){const geometry=projectChannel(d,toX,toY);if(!geometry)return null;const points=fibLevels(d,-1,4.236).flatMap((level)=>[{x:geometry.baseline.a.x+(geometry.parallel.a.x-geometry.baseline.a.x)*level.value,y:geometry.baseline.a.y+(geometry.parallel.a.y-geometry.baseline.a.y)*level.value},{x:geometry.baseline.b.x+(geometry.parallel.b.x-geometry.baseline.b.x)*level.value,y:geometry.baseline.b.y+(geometry.parallel.b.y-geometry.baseline.b.y)*level.value}]);if(geometry.offsetAnchor)points.push(geometry.offsetAnchor);const xs=points.map((point)=>point.x),ys=points.map((point)=>point.y);return{x:Math.min(...xs)-TOL,y:Math.min(...ys)-TOL,w:Math.max(...xs)-Math.min(...xs)+TOL*2,h:Math.max(...ys)-Math.min(...ys)+TOL*2};},
};

function fanSegments(d: Drawing, toX: HitTestProjector, toY: HitTestProjector, kind: "fib" | "gann" | "pitch"): Array<{ segment: Segment; color: string; label: string }> {
  if (kind === "gann") {
    const geometry = projectGannFan(d, toX, toY);
    return geometry?.strokes.map((item) => ({
      segment: item.segment,
      color: item.color ?? d.color,
      label: item.label ?? "",
    })) ?? [];
  }
  if (kind === "pitch") {
    const [a,b,c]=d.points.map((point)=>projectPoint(point,toX,toY)); if(!a||!b||!c)return[];
    return CORE_FIB.map((ratio,index)=>{const target={x:b.x+(c.x-b.x)*ratio,y:b.y+(c.y-b.y)*ratio};return{segment:{a,b:target},color:DEFAULT_FIB_LEVELS[index]?.color||d.color,label:String(ratio)};});
  }
  const source=projectTwoPoints(d,toX,toY);if(!source)return[];
  const ratios=fibLevels(d).map((level)=>level.value);
  return ratios.map((ratio,index)=>{const effective=d.fibReverse?1-ratio:ratio;return{segment:{a:source.a,b:{x:source.b.x,y:source.a.y+(source.b.y-source.a.y)*effective}},color:fibLevels(d)[index]?.color||d.color,label:String(ratio)};});
}

function renderGannFan(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
): void {
  const geometry = projectGannFan(d, proj.toX, proj.toY);
  if (!geometry) return;
  const config = resolveGannConfig(d.gann, "fan");
  const rendered = geometry.strokes.map((item) => ({
    ...item,
    rendered: rayRenderSegment(item.segment, proj),
  }));
  if (config.background && rendered.length > 1) {
    g.globalAlpha = d.opacity ?? 0.08;
    for (let index = 0; index < rendered.length - 1; index++) {
      const current = rendered[index];
      const next = rendered[index + 1];
      g.fillStyle = config.useOneColor
        ? d.color
        : current.color ?? d.color;
      g.beginPath();
      g.moveTo(geometry.origin.x, geometry.origin.y);
      g.lineTo(current.rendered.b.x, current.rendered.b.y);
      g.lineTo(next.rendered.b.x, next.rendered.b.y);
      g.closePath();
      g.fill();
    }
  }
  g.font = canvasFont(d.fontSize ?? 10, { weight: 500 });
  for (const item of rendered) {
    g.globalAlpha = item.opacity ?? 1;
    g.strokeStyle = config.useOneColor ? d.color : item.color ?? d.color;
    g.fillStyle = g.strokeStyle;
    g.lineWidth = item.lineWidth ?? d.lineWidth;
    applyStyle(g, item.lineStyle ?? d.lineStyle ?? "solid");
    line(g, item.rendered.a.x, item.rendered.a.y, item.rendered.b.x, item.rendered.b.y);
    if (config.labels && item.label) {
      const x = Math.max(4, Math.min(proj.width - 36, item.segment.b.x + 4));
      const y = Math.max(12, Math.min(proj.height - 4, item.segment.b.y - 4));
      g.fillText(item.label, x, y);
    }
  }
  g.globalAlpha = 1;
}

function createFan(tool: DrawingTool, kind: "fib" | "gann" | "pitch"): DrawingToolPlugin {
  const points=kind==="pitch"?3:2;
  return {tool,minPoints:points,maxPoints:points===3?3:undefined,
    render(g,d,proj,selected){g.save();if(kind==="gann")renderGannFan(g,d,proj);else{const source=fanSegments(d,proj.toX,proj.toY,kind);const rendered=source.map((item)=>({...item,segment:rayRenderSegment(item.segment,proj)}));renderSegments(g,d,rendered);}if(selected)d.points.slice(0,points).forEach((point)=>{const p=projectPoint(point,proj.toX,proj.toY);if(p)handle(g,p.x,p.y,d.color);});g.restore();},
    hitTest(d,px,py,toX,toY){const anchors=d.points.slice(0,points).flatMap((point,index)=>{const p=projectPoint(point,toX,toY);if(!p)return[];const distance=Math.hypot(px-p.x,py-p.y);return distance<=24?[{drawing:d,target:(index===0?"p1":index===1?"p2":"p3") as HitResult["target"],anchorIndex:index,distance}]:[];});return[...anchors,...bodyHits(d,fanSegments(d,toX,toY,kind).map((item)=>raySegment(item.segment)),px,py)];},
    movePoints:defaultMovePoints,boundingBox(){return fullViewportBounds();},
  };
}

const trendFibTime: DrawingToolPlugin = {
  tool:"trendFibTime",minPoints:3,maxPoints:3,
  render(g,d,proj,selected){const [a,b,c]=d.points;const pa=projectPoint(a,proj.toX,proj.toY),pb=projectPoint(b,proj.toX,proj.toY);if(!pa||!pb)return;g.save();g.strokeStyle=d.fibTrendLineColor||d.color;line(g,pa.x,pa.y,pb.x,pb.y);const xs=timeRatios(d).flatMap((ratio)=>{const x=proj.toX(c.time+(b.time-a.time)*ratio);return x==null?[]:[{x,ratio}];});if(d.fibBackground!==false){g.globalAlpha=d.opacity??0.06;for(let i=0;i<xs.length-1;i++){g.fillStyle=d.fillColor||d.color;g.fillRect(Math.min(xs[i].x,xs[i+1].x),0,Math.abs(xs[i+1].x-xs[i].x),proj.height);}g.globalAlpha=1;}g.font=canvasFont(d.fontSize??10);for(const level of xs){line(g,level.x,0,level.x,proj.height);if(d.fibShowLevels!==false)g.fillText(String(level.ratio),level.x+3,14);}if(selected)d.points.forEach((point)=>{const p=projectPoint(point,proj.toX,proj.toY);if(p)handle(g,p.x,p.y,d.color);});g.restore();},
  hitTest(d,px,py,toX,toY){const anchors=d.points.flatMap((point,index)=>{const p=projectPoint(point,toX,toY);if(!p)return[];const distance=Math.hypot(px-p.x,py-p.y);return distance<=24?[{drawing:d,target:(index===0?"p1":index===1?"p2":"p3") as HitResult["target"],anchorIndex:index,distance}]:[];});const[a,b,c]=d.points;const distances=timeRatios(d).flatMap((ratio)=>{const x=toX(c.time+(b.time-a.time)*ratio);return x==null?[]:[Math.abs(px-x)];});const distance=Math.min(...distances);return distance<TOL?[...anchors,{drawing:d,target:"body",distance}]:anchors;},
  movePoints:defaultMovePoints,boundingBox(){return fullViewportBounds();},
};

registerTool(fibChannel);
registerTool(createFan("fibSpeedFan","fib"));
registerTool(createFan("gannFan","gann"));
registerTool(createFan("pitchfan","pitch"));
registerTool(trendFibTime);
