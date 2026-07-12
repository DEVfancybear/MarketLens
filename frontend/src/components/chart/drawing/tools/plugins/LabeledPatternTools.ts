/** Phase 8 Wave C shared labeled-anchor pattern framework. */
import type { Drawing, DrawingTool } from "@/types";
import { getDrawingToolManifestEntry } from "../../../../../types/drawingToolManifest";
import type { HitTestProjector } from "../../hittest/HitTestEngine";
import {
  defaultMovePoints,
  registerTool,
  type DrawingToolPlugin,
} from "../ToolRegistry";
import { canvasFont, handle } from "./shared";
import {
  anchorHits,
  anchorsFromProjected,
  boundsFromPoints,
  polygonBodyHits,
  projectPoints,
  segmentBodyHits,
  visiblePoints,
  type XY,
} from "./shapeGeometry";

type Validation = { text: string; valid: boolean };

const PATTERN_TOOLS = [
  "abcdPattern", "xabcdPattern", "trianglePattern", "threeDrivesPattern",
  "headShouldersPattern", "elliottImpulse", "elliottTriangle",
  "elliottTripleCombo", "elliottCorrection", "elliottDoubleCombo",
] as const satisfies readonly DrawingTool[];

function legLength(d: Drawing, index: number): number {
  return Math.abs(d.points[index + 1].price - d.points[index].price);
}

function alternating(d: Drawing): boolean {
  for (let index = 0; index < d.points.length - 2; index++) {
    const a = d.points[index + 1].price - d.points[index].price;
    const b = d.points[index + 2].price - d.points[index + 1].price;
    if (a === 0 || b === 0 || Math.sign(a) === Math.sign(b)) return false;
  }
  return true;
}

function validate(d: Drawing): Validation {
  if (d.tool === "abcdPattern") {
    const ratio = legLength(d, 2) / Math.max(legLength(d, 0), Number.EPSILON);
    return { text: `AB=CD ${ratio.toFixed(2)}`, valid: ratio >= 0.9 && ratio <= 1.1 };
  }
  if (d.tool === "headShouldersPattern") {
    const [,left,,head,,right]=d.points;
    const inverted = head.price < left.price;
    const headValid = inverted ? head.price < right.price : head.price > right.price;
    const shoulderSpread = Math.abs(left.price-right.price) / Math.max(Math.abs(head.price-left.price),Number.EPSILON);
    return { text: "Head / shoulders", valid: headValid && shoulderSpread <= 0.75 };
  }
  if (d.tool === "elliottImpulse") {
    const w1=legLength(d,0),w2=legLength(d,1),w3=legLength(d,2),w5=legLength(d,4);
    return { text: "Impulse rules", valid: w2<=w1 && w3>=Math.min(w1,w5) };
  }
  if (d.tool === "elliottCorrection") {
    const a=legLength(d,0),b=legLength(d,1),c=legLength(d,2);
    return { text: "ABC correction", valid: b<a && c>0 };
  }
  return { text: "Alternating pivots", valid: alternating(d) };
}

function ratioLabels(d: Drawing, points: XY[]) {
  const labels: Array<{ text: string; x: number; y: number }> = [];
  for (let index=1;index<points.length-1;index++) {
    const previous=legLength(d,index-1),current=legLength(d,index);
    if (previous<=Number.EPSILON) continue;
    labels.push({text:(current/previous).toFixed(3),x:(points[index].x+points[index+1].x)/2,y:(points[index].y+points[index+1].y)/2});
  }
  return labels;
}

function drawValidation(g:CanvasRenderingContext2D,validation:Validation,box:{x:number;y:number;w:number}){
  const text=`${validation.valid?"✓":"!"} ${validation.text}`;const width=g.measureText(text).width+10;const x=box.x+box.w/2-width/2,y=box.y-24;
  g.fillStyle=validation.valid?"rgba(8,153,129,.88)":"rgba(242,54,69,.88)";g.fillRect(x,y,width,18);g.fillStyle="#fff";g.textAlign="center";g.textBaseline="middle";g.fillText(text,x+width/2,y+9);
}

function createPattern(tool:DrawingTool):DrawingToolPlugin{
  const definition=getDrawingToolManifestEntry(tool);const pointCount=definition.maxPoints!;
  const fillBody=tool==="xabcdPattern"||tool==="trianglePattern"||tool==="headShouldersPattern";
  return{tool,minPoints:pointCount,maxPoints:pointCount,
    render(g,d,proj,selected){const projected=projectPoints(d.points.slice(0,pointCount),proj.toX,proj.toY);const points=visiblePoints(projected);if(points.length!==pointCount)return;g.save();g.beginPath();g.moveTo(points[0].x,points[0].y);for(let index=1;index<points.length;index++)g.lineTo(points[index].x,points[index].y);if(fillBody&&d.fillColor&&d.fillColor!=="transparent"){g.save();g.closePath();g.fillStyle=d.fillColor;g.globalAlpha=d.opacity??0.08;g.fill();g.restore();}g.stroke();if(tool==="headShouldersPattern"){g.save();g.setLineDash([5,4]);g.beginPath();g.moveTo(points[2].x,points[2].y);g.lineTo(points[4].x,points[4].y);g.stroke();g.restore();}g.font=canvasFont(d.fontSize??11,{bold:d.bold});g.textAlign="center";g.textBaseline="bottom";g.fillStyle=d.textColor||d.color;const labels=definition.coordinateLabels??[];points.forEach((point,index)=>g.fillText(labels[index]??String(index+1),point.x,point.y-7));g.font=canvasFont(Math.max(9,(d.fontSize??11)-1));for(const ratio of ratioLabels(d,points)){g.fillText(ratio.text,ratio.x,ratio.y-4);}const box=boundsFromPoints(points,28)!;drawValidation(g,validate(d),box);if(selected)points.forEach((point)=>handle(g,point.x,point.y,d.color));g.restore();},
    hitTest(d,px,py,toX:HitTestProjector,toY:HitTestProjector){const projected=projectPoints(d.points.slice(0,pointCount),toX,toY);const points=visiblePoints(projected);return[...anchorHits(d,projected,px,py),...(fillBody&&points.length===pointCount?polygonBodyHits(d,points,px,py):segmentBodyHits(d,projected,px,py))];},
    getAnchors(d,toX,toY){return anchorsFromProjected(projectPoints(d.points.slice(0,pointCount),toX,toY));},
    movePoints:defaultMovePoints,boundingBox(d,toX,toY){return boundsFromPoints(visiblePoints(projectPoints(d.points.slice(0,pointCount),toX,toY)),96);},
  };
}

for(const tool of PATTERN_TOOLS)registerTool(createPattern(tool));
