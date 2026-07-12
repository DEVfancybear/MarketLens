/** Phase 8 Wave C repeating semicircular time cycles. */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import { TOL, defaultMovePoints, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { handle } from "./shared";
import { fullViewportBounds, projectTwoPoints, twoPointAnchorHits } from "./lineGeometry";

const MAX_CYCLES=256;

function cycles(d:Drawing,toX:HitTestProjector,toY:HitTestProjector,width:number){const source=projectTwoPoints(d,toX,toY);if(!source)return null;const diameter=Math.abs(source.b.x-source.a.x);if(diameter<1)return null;const direction=source.b.x>=source.a.x?1:-1;const count=Math.min(MAX_CYCLES,Math.max(1,Math.ceil(width/diameter)+2));return{source,diameter,direction,count,baseline:source.a.y};}

const plugin:DrawingToolPlugin={tool:"timeCycles",minPoints:2,
  render(g,d,proj:Projector,selected){const geometry=cycles(d,proj.toX,proj.toY,proj.width);if(!geometry)return;g.save();for(let index=0;index<geometry.count;index++){const start=geometry.source.a.x+geometry.direction*geometry.diameter*index;const center=start+geometry.direction*geometry.diameter/2;g.beginPath();g.arc(center,geometry.baseline,geometry.diameter/2,Math.PI,0,geometry.direction<0);g.stroke();}if(selected){handle(g,geometry.source.a.x,geometry.source.a.y,d.color);handle(g,geometry.source.b.x,geometry.source.b.y,d.color);}g.restore();},
  hitTest(d,px,py,toX,toY):HitResult[]{const geometry=cycles(d,toX,toY,10000);if(!geometry)return[];const anchors=twoPointAnchorHits(d,geometry.source,px,py);let best=Infinity;for(let index=0;index<Math.min(128,geometry.count);index++){const start=geometry.source.a.x+geometry.direction*geometry.diameter*index;const center=start+geometry.direction*geometry.diameter/2;const radius=geometry.diameter/2;const distance=Math.abs(Math.hypot(px-center,py-geometry.baseline)-radius);if(py<=geometry.baseline+TOL)best=Math.min(best,distance);}return best<TOL?[...anchors,{drawing:d,target:"body",distance:best}]:anchors;},
  movePoints:defaultMovePoints,boundingBox(){return fullViewportBounds();},
};
registerTool(plugin);
