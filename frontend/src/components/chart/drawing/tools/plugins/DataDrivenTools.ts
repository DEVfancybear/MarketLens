/** Phase 8 Wave D candle-snapshot-backed tools. */
import type { Drawing, DrawingDataSample, DrawingTool } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { anchoredVwap, regressionChannel, volumeProfile } from "../../data/dataDrivenGeometry";
import { TOL, defaultMovePoints, distToRect, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { canvasFont, handle } from "./shared";
import { projectOnePoint, projectTwoPoints } from "./lineGeometry";

type XY = { x: number; y: number };
const snapshot = (d: Drawing) => d.dataSnapshot?.samples ?? [];
const boxOf = (points: readonly XY[]) => points.length ? { x: Math.min(...points.map(p=>p.x))-TOL, y: Math.min(...points.map(p=>p.y))-TOL, w: Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+TOL*2, h: Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+TOL*2 } : null;
const bodyHits = (d:Drawing, points:readonly XY[], px:number, py:number):HitResult[] => {
  let distance=Infinity; for(let i=1;i<points.length;i++) distance=Math.min(distance,distToSegment(px,py,points[i-1].x,points[i-1].y,points[i].x,points[i].y));
  return distance<=TOL?[{drawing:d,target:"body",distance}]:[];
};
const anchorHits=(d:Drawing,px:number,py:number,toX:HitTestProjector,toY:HitTestProjector):HitResult[]=>d.points.flatMap((point,index)=>{const x=toX(point.time),y=toY(point.price);if(x==null||y==null)return[];const distance=Math.hypot(px-x,py-y);return distance<=24?[{drawing:d,target:index===0?"p1":index===1?"p2":"body",anchorIndex:index,distance} as HitResult]:[];});
function mappedSeries(d:Drawing, values:readonly number[], toX:HitTestProjector, toY:HitTestProjector, onePoint=false):XY[]{
  const data=snapshot(d); if(!data.length||!d.points[0])return[];
  const start=d.points[0].time, end=onePoint?start+Math.max(1,data[data.length-1].time-data[0].time):(d.points[1]?.time??start);
  const priceOffset=d.points[0].price-data[0].close;
  return values.flatMap((value,index)=>{const ratio=values.length===1?0:index/(values.length-1);const x=toX(start+(end-start)*ratio),y=toY(value+priceOffset);return x==null||y==null?[]:[{x,y}];});
}
function drawPath(g:CanvasRenderingContext2D,points:readonly XY[]){if(!points.length)return;g.beginPath();g.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))g.lineTo(p.x,p.y);g.stroke();}
function anchors(g:CanvasRenderingContext2D,d:Drawing,proj:Projector,selected:boolean){if(!selected)return;for(const p of d.points){const x=proj.toX(p.time),y=proj.toY(p.price);if(x!=null&&y!=null)handle(g,x,y,d.color);}}

function projectedLinePaths(
  d: Drawing,
  tool: "anchoredVWAP" | "regressionTrend",
  toX: HitTestProjector,
  toY: HitTestProjector,
) {
  const data = snapshot(d);
  if (!data.length) return { center: [] as XY[], upper: [] as XY[], lower: [] as XY[] };
  if (tool === "anchoredVWAP") {
    return {
      center: mappedSeries(d, anchoredVwap(data).map((point) => point.value), toX, toY, true),
      upper: [] as XY[],
      lower: [] as XY[],
    };
  }
  const regression = regressionChannel(data);
  return {
    center: mappedSeries(d, regression.values, toX, toY),
    upper: mappedSeries(
      d,
      regression.values.map((value) => value + regression.deviation * 2),
      toX,
      toY,
    ),
    lower: mappedSeries(
      d,
      regression.values.map((value) => value - regression.deviation * 2),
      toX,
      toY,
    ),
  };
}

function lineTool(tool:"anchoredVWAP"|"regressionTrend"):DrawingToolPlugin{return{tool,minPoints:tool==="anchoredVWAP"?1:2,render(g,d,proj,selected){const data=snapshot(d);if(!data.length)return;const reg=regressionChannel(data),geometry=projectedLinePaths(d,tool,proj.toX,proj.toY);g.save();g.strokeStyle=d.color;g.lineWidth=d.lineWidth;drawPath(g,geometry.center);if(tool==="regressionTrend"){g.globalAlpha=.55;drawPath(g,geometry.upper);drawPath(g,geometry.lower);g.globalAlpha=1;g.font=canvasFont(11);g.fillStyle=d.textColor||d.color;g.fillText(`R ${reg.correlation.toFixed(2)}`,geometry.center[0]?.x??0,(geometry.center[0]?.y??0)-8);}anchors(g,d,proj,selected);g.restore();},hitTest(d,px,py,toX,toY){const geometry=projectedLinePaths(d,tool,toX,toY);return [...anchorHits(d,px,py,toX,toY),...bodyHits(d,geometry.center,px,py),...bodyHits(d,geometry.upper,px,py),...bodyHits(d,geometry.lower,px,py)];},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const geometry=projectedLinePaths(d,tool,toX,toY);return boxOf([...geometry.center,...geometry.upper,...geometry.lower]);}};}

function profileGeometry(d:Drawing,toX:HitTestProjector,toY:HitTestProjector,anchored:boolean){const data=snapshot(d),bins=volumeProfile(data);if(!data.length||!bins.length||!d.points[0])return[];const start=toX(d.points[0].time),end=toX(anchored?d.points[0].time+Math.max(1,data[data.length-1].time-data[0].time):(d.points[1]?.time??d.points[0].time));const offset=d.points[0].price-data[0].close;if(start==null||end==null)return[];const width=Math.max(24,Math.abs(end-start)),left=Math.min(start,end),max=Math.max(...bins.map(b=>b.volume),1);return bins.flatMap(bin=>{const y1=toY(bin.low+offset),y2=toY(bin.high+offset);return y1==null||y2==null?[]:[{x:left+width*(1-bin.volume/max),y:Math.min(y1,y2),w:width*bin.volume/max,h:Math.max(1,Math.abs(y2-y1)),bin}];});}
function profileTool(tool:"fixedVolumeProfile"|"anchoredVolumeProfile"):DrawingToolPlugin{const anchored=tool==="anchoredVolumeProfile";return{tool,minPoints:anchored?1:2,render(g,d,proj,selected){const rows=profileGeometry(d,proj.toX,proj.toY,anchored);if(!rows.length)return;const poc=Math.max(...rows.map(r=>r.bin.volume));g.save();for(const row of rows){const upRatio=row.bin.volume?row.bin.upVolume/row.bin.volume:0;g.globalAlpha=d.opacity??.6;g.fillStyle=row.bin.volume===poc?d.color:(d.fillColor||d.color);g.fillRect(row.x,row.y,row.w*upRatio,row.h);g.globalAlpha=(d.opacity??.6)*.55;g.fillRect(row.x+row.w*upRatio,row.y,row.w*(1-upRatio),row.h);}g.globalAlpha=1;anchors(g,d,proj,selected);g.restore();},hitTest(d,px,py,toX,toY){const body=profileGeometry(d,toX,toY,anchored).some(r=>px>=r.x-TOL&&px<=r.x+r.w+TOL&&py>=r.y-TOL&&py<=r.y+r.h+TOL)?[{drawing:d,target:"body" as const,distance:1}]:[];return[...anchorHits(d,px,py,toX,toY),...body];},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const rows=profileGeometry(d,toX,toY,anchored);return boxOf(rows.flatMap(r=>[{x:r.x,y:r.y},{x:r.x+r.w,y:r.y+r.h}]));}};}

function normalizedPattern(d:Drawing,toX:HitTestProjector,toY:HitTestProjector,ghost:boolean){const data=snapshot(d),segment=projectTwoPoints(d,toX,toY);if(!data.length||!segment)return[];const lows=data.map(s=>s.low),highs=data.map(s=>s.high),low=Math.min(...lows),high=Math.max(...highs),span=Math.max(high-low,Number.EPSILON);return data.map((sample,index)=>{const ratio=data.length===1?0:index/(data.length-1),x=segment.a.x+(segment.b.x-segment.a.x)*ratio;const map=(value:number)=>segment.a.y+(segment.b.y-segment.a.y)*(1-(value-low)/span);return ghost?{x,y:map(sample.close),sample}:{x,y:map(sample.close),open:map(sample.open),high:map(sample.high),low:map(sample.low),sample};});}
function barBodyWidth(points: readonly XY[]) { return points.length ? Math.max(1,Math.abs((points.at(-1)!.x-points[0].x)/points.length)*.65) : 1; }
function barsPatternHits(d:Drawing,points:ReturnType<typeof normalizedPattern>,px:number,py:number):HitResult[]{const width=barBodyWidth(points);let distance=Infinity;for(const point of points){if(point.high==null||point.low==null||point.open==null)continue;distance=Math.min(distance,distToSegment(px,py,point.x,point.high,point.x,point.low),distToRect(px,py,point.x-width/2,point.open,point.x+width/2,point.y));}return distance<=TOL?[{drawing:d,target:"body",distance}]:[];}
function patternTool(tool:"barsPattern"|"ghostFeed"):DrawingToolPlugin{const ghost=tool==="ghostFeed";return{tool,minPoints:2,render(g,d,proj,selected){const points=normalizedPattern(d,proj.toX,proj.toY,ghost);if(!points.length)return;g.save();g.strokeStyle=d.color;g.lineWidth=d.lineWidth;if(ghost){g.setLineDash([6,4]);g.globalAlpha=d.opacity??.55;drawPath(g,points);}else{const body=barBodyWidth(points);for(const p of points){g.strokeStyle=p.sample.close>=p.sample.open?d.color:"#f23645";g.beginPath();g.moveTo(p.x,p.high!);g.lineTo(p.x,p.low!);g.stroke();g.strokeRect(p.x-body/2,Math.min(p.open!,p.y),body,Math.max(1,Math.abs(p.y-p.open!)));}}g.globalAlpha=1;anchors(g,d,proj,selected);g.restore();},hitTest(d,px,py,toX,toY){const points=normalizedPattern(d,toX,toY,ghost);return[...anchorHits(d,px,py,toX,toY),...(ghost?bodyHits(d,points,px,py):barsPatternHits(d,points,px,py))];},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const pts=normalizedPattern(d,toX,toY,ghost);if(ghost)return boxOf(pts);const width=barBodyWidth(pts);return boxOf(pts.flatMap(p=>[{x:p.x-width/2,y:p.high!},{x:p.x+width/2,y:p.low!}]));}};}

registerTool(lineTool("anchoredVWAP"));registerTool(lineTool("regressionTrend"));
registerTool(profileTool("fixedVolumeProfile"));registerTool(profileTool("anchoredVolumeProfile"));
registerTool(patternTool("barsPattern"));registerTool(patternTool("ghostFeed"));
