/** Phase 8 Wave A cyclic and Fibonacci time projections. */
import type { Drawing, DrawingTool } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { TOL, defaultMovePoints, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { canvasFont, handle, line } from "./shared";
import { fullViewportBounds, projectTwoPoints, twoPointAnchorHits } from "./lineGeometry";

const FIB_TIME_RATIOS = [0,1,2,3,5,8,13,21,34,55,89] as const;
const MAX_CYCLIC_LINES = 512;

function projectedXs(d: Drawing, toX: HitTestProjector, ratios: readonly number[]) {
  const [a,b]=d.points;if(!a||!b)return[];const step=b.time-a.time;if(!Number.isFinite(step)||step===0)return[];
  return ratios.flatMap((ratio)=>{const x=toX(a.time+step*ratio);return x==null?[]:[{ratio,x}];});
}

function createTimeProjection(tool: DrawingTool, fibonacci: boolean): DrawingToolPlugin {
  return {
    tool,minPoints:2,
    render(g:CanvasRenderingContext2D,d:Drawing,proj:Projector,selected:boolean){const source=projectTwoPoints(d,proj.toX,proj.toY);if(!source)return;let values:{ratio:number;x:number}[];if(fibonacci){values=projectedXs(d,proj.toX,FIB_TIME_RATIOS);}else{const step=source.b.x-source.a.x;if(Math.abs(step)<0.5)return;const available=step>0?proj.width-source.a.x:source.a.x;const count=Math.min(MAX_CYCLIC_LINES,Math.max(2,Math.ceil(Math.max(0,available)/Math.abs(step))+1));values=Array.from({length:count},(_,i)=>({ratio:i,x:source.a.x+step*i}));}g.save();g.strokeStyle=d.color;g.lineWidth=d.lineWidth;g.font=canvasFont(10,{weight:500});for(const value of values){if(value.x<-20||value.x>proj.width+20)continue;line(g,value.x,0,value.x,proj.height);if(fibonacci){g.fillStyle=d.textColor||d.color;g.fillText(String(value.ratio),value.x+3,14);}}if(selected){handle(g,source.a.x,source.a.y,d.color);handle(g,source.b.x,source.b.y,d.color);}g.restore();},
    hitTest(d,px,py,toX,toY):HitResult[]{const source=projectTwoPoints(d,toX,toY);if(!source)return[];const anchors=twoPointAnchorHits(d,source,px,py);let distance=Infinity;if(fibonacci){distance=Math.min(...projectedXs(d,toX,FIB_TIME_RATIOS).map((value)=>Math.abs(px-value.x)));}else{const step=source.b.x-source.a.x;if(Math.abs(step)>=0.5){const raw=(px-source.a.x)/step;const index=Math.round(raw);if(index>=0&&index<MAX_CYCLIC_LINES)distance=Math.abs(px-(source.a.x+step*index));}}return distance<TOL?[...anchors,{drawing:d,target:"body",distance}]:anchors;},
    movePoints:defaultMovePoints,
    boundingBox(){return fullViewportBounds();},
  };
}

registerTool(createTimeProjection("cyclicLines",false));
registerTool(createTimeProjection("fibTimeZone",true));
