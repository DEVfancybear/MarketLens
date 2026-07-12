/** Phase 8 Wave B Gann square/box grid family. */
import type { Drawing, DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { TOL, defaultMovePoints, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { handle, line } from "./shared";
import { projectTwoPoints, twoPointAnchorHits } from "./lineGeometry";

function createGannGrid(tool:DrawingTool,diagonals:boolean):DrawingToolPlugin{return{tool,minPoints:2,
  render(g,d,proj,selected){const s=projectTwoPoints(d,proj.toX,proj.toY);if(!s)return;const left=Math.min(s.a.x,s.b.x),right=Math.max(s.a.x,s.b.x),top=Math.min(s.a.y,s.b.y),bottom=Math.max(s.a.y,s.b.y);g.save();if(d.fillColor!=="transparent"){g.fillStyle=d.fillColor||d.color;g.globalAlpha=d.opacity??0.06;g.fillRect(left,top,right-left,bottom-top);g.globalAlpha=1;}g.strokeStyle=d.color;g.strokeRect(left,top,right-left,bottom-top);for(let i=1;i<8;i++){const x=left+(right-left)*i/8,y=top+(bottom-top)*i/8;g.globalAlpha=i===4?0.8:0.32;line(g,x,top,x,bottom);line(g,left,y,right,y);}if(diagonals){g.globalAlpha=0.65;line(g,left,top,right,bottom);line(g,left,bottom,right,top);line(g,(left+right)/2,top,right,(top+bottom)/2);line(g,right,(top+bottom)/2,(left+right)/2,bottom);line(g,(left+right)/2,bottom,left,(top+bottom)/2);line(g,left,(top+bottom)/2,(left+right)/2,top);}g.globalAlpha=1;if(selected){handle(g,s.a.x,s.a.y,d.color);handle(g,s.b.x,s.b.y,d.color);}g.restore();},
  hitTest(d,px,py,toX,toY):HitResult[]{const s=projectTwoPoints(d,toX,toY);if(!s)return[];const anchors=twoPointAnchorHits(d,s,px,py);const left=Math.min(s.a.x,s.b.x),right=Math.max(s.a.x,s.b.x),top=Math.min(s.a.y,s.b.y),bottom=Math.max(s.a.y,s.b.y);const segments=[];for(let i=0;i<=8;i++){const x=left+(right-left)*i/8,y=top+(bottom-top)*i/8;segments.push({a:{x,y:top},b:{x,y:bottom}},{a:{x:left,y},b:{x:right,y}});}if(diagonals)segments.push({a:{x:left,y:top},b:{x:right,y:bottom}},{a:{x:left,y:bottom},b:{x:right,y:top}});const distance=Math.min(...segments.map((v)=>distToSegment(px,py,v.a.x,v.a.y,v.b.x,v.b.y)));return distance<TOL?[...anchors,{drawing:d,target:"body",distance}]:anchors;},
  movePoints:defaultMovePoints,boundingBox(d,toX,toY){const s=projectTwoPoints(d,toX,toY);if(!s)return null;const left=Math.min(s.a.x,s.b.x),right=Math.max(s.a.x,s.b.x),top=Math.min(s.a.y,s.b.y),bottom=Math.max(s.a.y,s.b.y);return{x:left-TOL,y:top-TOL,w:right-left+TOL*2,h:bottom-top+TOL*2};}};}

registerTool(createGannGrid("gannSquare",true));
registerTool(createGannGrid("gannBox",false));
