/** Phase 8 Wave B median-line geometry for all Pitchfork variants. */
import type { Drawing, DrawingTool } from "@/types";
import { DEFAULT_CHANNEL_LEVELS } from "../../../../../types/drawing";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import { TOL, defaultMovePoints, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { canvasFont, handle, line } from "./shared";
import { fullViewportBounds, projectPoint, rayRenderSegment, raySegment, type Segment, type XY } from "./lineGeometry";

type ForkVariant = "standard" | "inside" | "schiff" | "modified-schiff";

interface ForkGeometry { anchors: [XY,XY,XY]; lines: Array<{segment:Segment;label:string}>; }

function interpolate(a:XY,b:XY,ratio:number):XY{return{x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio};}

function geometry(d:Drawing,toX:HitTestProjector,toY:HitTestProjector,variant:ForkVariant):ForkGeometry|null{
  const points=d.points.slice(0,3).map((point)=>projectPoint(point,toX,toY));if(points.some((point)=>!point))return null;
  const [a,b,c]=points as [XY,XY,XY];const midpoint=interpolate(b,c,0.5);
  const medianOrigin=variant==="schiff"?interpolate(a,b,0.5):variant==="modified-schiff"?{x:(a.x+b.x)/2,y:a.y}:a;
  const dx=midpoint.x-medianOrigin.x,dy=midpoint.y-medianOrigin.y;
  const levels=d.channelLevels?.length?d.channelLevels:DEFAULT_CHANNEL_LEVELS;
  const sideA=variant==="inside"?interpolate(b,midpoint,0.5):b;
  const sideB=variant==="inside"?interpolate(c,midpoint,0.5):c;
  const lines=levels.filter((level)=>level.enabled&&Number.isFinite(level.value)).map((level)=>{const origin=interpolate(sideA,sideB,level.value);return{segment:{a:origin,b:{x:origin.x+dx,y:origin.y+dy}},label:String(level.value)};});
  lines.splice(Math.floor(lines.length/2),0,{segment:{a:medianOrigin,b:midpoint},label:"median"});
  return{anchors:[a,b,c],lines};
}

function createPitchfork(tool:DrawingTool,variant:ForkVariant):DrawingToolPlugin{return{tool,minPoints:3,maxPoints:3,
  render(g,d,proj:Projector,selected){const fork=geometry(d,proj.toX,proj.toY,variant);if(!fork)return;const rendered=fork.lines.map((item)=>({...item,segment:rayRenderSegment(item.segment,proj)}));g.save();if(d.fillColor!=="transparent"&&rendered.length>=3){const first=rendered[0].segment,last=rendered[rendered.length-1].segment;g.fillStyle=d.fillColor||d.color;g.globalAlpha=d.opacity??0.06;g.beginPath();g.moveTo(first.a.x,first.a.y);g.lineTo(first.b.x,first.b.y);g.lineTo(last.b.x,last.b.y);g.lineTo(last.a.x,last.a.y);g.closePath();g.fill();g.globalAlpha=1;}g.strokeStyle=d.color;g.font=canvasFont(d.fontSize??10);for(const item of rendered){line(g,item.segment.a.x,item.segment.a.y,item.segment.b.x,item.segment.b.y);if(d.showPriceLabels)g.fillText(item.label,item.segment.a.x+4,item.segment.a.y-4);}if(selected)fork.anchors.forEach((point)=>handle(g,point.x,point.y,d.color));g.restore();},
  hitTest(d,px,py,toX,toY):HitResult[]{const fork=geometry(d,toX,toY,variant);if(!fork)return[];const anchors:HitResult[]=fork.anchors.flatMap((point,index)=>{const distance=Math.hypot(px-point.x,py-point.y);return distance<=24?[{drawing:d,target:index===0?"p1":index===1?"p2":"p3",anchorIndex:index,distance}]:[];});const distance=Math.min(...fork.lines.map((item)=>{const segment=raySegment(item.segment);return distToSegment(px,py,segment.a.x,segment.a.y,segment.b.x,segment.b.y);}));return distance<TOL?[...anchors,{drawing:d,target:"body",distance}]:anchors;},
  movePoints:defaultMovePoints,boundingBox(){return fullViewportBounds();}};}

registerTool(createPitchfork("pitchfork","standard"));
registerTool(createPitchfork("insidePitchfork","inside"));
registerTool(createPitchfork("schiffPitchfork","schiff"));
registerTool(createPitchfork("modifiedSchiffPitchfork","modified-schiff"));
