/** Phase 8 Wave B Fibonacci radial geometry (arcs, circles, and wedge). */
import type { Drawing, DrawingTool } from "@/types";
import { DEFAULT_FIB_LEVELS } from "../../../../../types/drawing";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { TOL, defaultMovePoints, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
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

const fibWedge:DrawingToolPlugin={tool:"fibWedge",minPoints:3,maxPoints:3,
  render(g,d,proj,selected){const center=projectPoint(d.points[0],proj.toX,proj.toY),a=projectPoint(d.points[1],proj.toX,proj.toY),b=projectPoint(d.points[2],proj.toX,proj.toY);if(!center||!a||!b)return;const radius=Math.hypot(a.x-center.x,a.y-center.y);let start=Math.atan2(a.y-center.y,a.x-center.x),end=Math.atan2(b.y-center.y,b.x-center.x);if(end<start)end+=Math.PI*2;g.save();g.font=canvasFont(d.fontSize??10);for(const level of ratios(d)){g.strokeStyle=d.fibUseOneColor?d.fibLevelLineColor||d.color:level.color||d.color;g.beginPath();g.arc(center.x,center.y,radius*level.value,start,end);g.stroke();}line(g,center.x,center.y,a.x,a.y);line(g,center.x,center.y,b.x,b.y);if(selected)[center,a,b].forEach((p)=>handle(g,p.x,p.y,d.color));g.restore();},
  hitTest(d,px,py,toX,toY){return radialHit(d,px,py,toX,toY,true);},movePoints:defaultMovePoints,boundingBox(d,toX,toY){return radialBounds(d,toX,toY,true);}};

registerTool(createRadial("fibSpeedArcs",false));
registerTool(createRadial("fibCircles",true));
registerTool(fibWedge);
