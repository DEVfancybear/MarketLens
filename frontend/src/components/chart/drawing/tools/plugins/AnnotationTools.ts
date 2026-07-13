/** Phase 8 Wave A compact annotation family. */
import type { Drawing, DrawingTool } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import { TOL, defaultMovePoints, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { canvasFont, handle, line } from "./shared";
import { projectOnePoint, projectTwoPoints, twoPointAnchorHits } from "./lineGeometry";

type OnePointAnnotation = "note" | "comment" | "priceLabel" | "signpost" | "flag";

function label(d: Drawing, fallback: string) {
  return d.text?.trim() || fallback;
}

function textWidth(d: Drawing, text: string) {
  return Math.max(36, text.length * (d.fontSize ?? 13) * 0.58 + 16);
}

function onePointBox(d: Drawing, x: number, y: number, kind: OnePointAnnotation) {
  const text = label(d, kind === "priceLabel" ? d.points[0].price.toFixed(2) : kind === "flag" ? "Flag" : kind === "signpost" ? "1" : kind === "comment" ? "Comment" : "Note");
  const w = textWidth(d, text);
  const h = Math.max(22, (d.fontSize ?? 13) + 10);
  if (kind === "priceLabel") return { x: x + 8, y: y - h / 2, w, h, text };
  if (kind === "signpost") return { x: x - w / 2, y: y - h - 14, w, h, text };
  if (kind === "flag") return { x: x + 2, y: y - h - 22, w, h, text };
  return { x: x + 10, y: y - h - 10, w, h, text };
}

function onePointConnectorEnd(
  box: ReturnType<typeof onePointBox>,
  anchor: { x: number; y: number },
  kind: OnePointAnnotation,
) {
  if (kind === "flag") return { x: anchor.x, y: box.y };
  if (kind === "signpost") return { x: anchor.x, y: box.y + box.h };
  if (kind === "priceLabel") return { x: box.x, y: anchor.y };
  return { x: box.x, y: box.y + box.h };
}

function roundedBox(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius = 4) {
  g.beginPath();
  g.moveTo(x + radius, y); g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius); g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius); g.closePath();
}

function createOnePointAnnotation(tool: DrawingTool, kind: OnePointAnnotation): DrawingToolPlugin {
  return {
    tool, minPoints: 1,
    render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
      const p = projectOnePoint(d, proj.toX, proj.toY); if (!p) return;
      const box = onePointBox(d, p.x, p.y, kind);
      g.save(); g.font = canvasFont(d.fontSize ?? 13, { bold: d.bold, italic: d.italic });
      g.lineWidth = d.lineWidth; g.strokeStyle = d.color;
      if (kind === "flag") {
        line(g, p.x, p.y, p.x, box.y);
        g.fillStyle = d.fillColor || d.color; g.globalAlpha = d.opacity ?? 0.9;
        g.beginPath(); g.moveTo(p.x, box.y); g.lineTo(box.x + box.w, box.y + 5); g.lineTo(p.x, box.y + box.h); g.closePath(); g.fill();
      } else {
        if (kind === "priceLabel") { g.fillStyle = d.fillColor || d.color; g.beginPath(); g.moveTo(p.x,p.y); g.lineTo(box.x,box.y); g.lineTo(box.x,box.y+box.h); g.closePath(); g.fill(); }
        else if (kind === "signpost") { line(g,p.x,p.y,p.x,box.y+box.h); g.beginPath(); g.arc(p.x,p.y,4,0,Math.PI*2); g.fillStyle=d.color; g.fill(); }
        else line(g, p.x, p.y, box.x, box.y + box.h);
        roundedBox(g,box.x,box.y,box.w,box.h,kind === "comment" ? 8 : 4);
        g.fillStyle=d.fillColor||"#2a2e39";g.globalAlpha=d.opacity??0.92;g.fill();g.globalAlpha=1;g.stroke();
      }
      g.fillStyle=d.textColor||"#fff";g.textAlign="center";g.textBaseline="middle";g.fillText(box.text,box.x+box.w/2,box.y+box.h/2,box.w-8);
      if(selected)handle(g,p.x,p.y,d.color); g.restore();
    },
    hitTest(d,px,py,toX,toY): HitResult[]{const p=projectOnePoint(d,toX,toY);if(!p)return[];const box=onePointBox(d,p.x,p.y,kind);const anchor=Math.hypot(px-p.x,py-p.y);if(anchor<=24)return[{drawing:d,target:"p1",anchorIndex:0,distance:anchor}];if(px>=box.x-TOL&&px<=box.x+box.w+TOL&&py>=box.y-TOL&&py<=box.y+box.h+TOL)return[{drawing:d,target:"body",distance:1}];const end=onePointConnectorEnd(box,p,kind);const distance=distToSegment(px,py,p.x,p.y,end.x,end.y);return distance<=TOL?[{drawing:d,target:"body",distance}]:[];},
    movePoints:defaultMovePoints,
    boundingBox(d,toX,toY){const p=projectOnePoint(d,toX,toY);if(!p)return null;const box=onePointBox(d,p.x,p.y,kind);return{x:Math.min(p.x,box.x)-TOL,y:Math.min(p.y,box.y)-TOL,w:Math.max(p.x,box.x+box.w)-Math.min(p.x,box.x)+TOL*2,h:Math.max(p.y,box.y+box.h)-Math.min(p.y,box.y)+TOL*2};},
  };
}

const callout: DrawingToolPlugin = {
  tool:"callout",minPoints:2,
  render(g,d,proj,selected){const s=projectTwoPoints(d,proj.toX,proj.toY);if(!s)return;const text=label(d,"Callout");const w=textWidth(d,text),h=Math.max(26,(d.fontSize??13)+12);const x=s.b.x-w/2,y=s.b.y-h/2;g.save();g.strokeStyle=d.color;g.lineWidth=d.lineWidth;line(g,s.a.x,s.a.y,s.b.x,s.b.y);roundedBox(g,x,y,w,h,6);g.fillStyle=d.fillColor||"#2a2e39";g.globalAlpha=d.opacity??0.92;g.fill();g.globalAlpha=1;g.stroke();g.font=canvasFont(d.fontSize??13,{bold:d.bold,italic:d.italic});g.fillStyle=d.textColor||"#fff";g.textAlign="center";g.textBaseline="middle";g.fillText(text,s.b.x,s.b.y,w-8);if(selected){handle(g,s.a.x,s.a.y,d.color);handle(g,s.b.x,s.b.y,d.color);}g.restore();},
  hitTest(d,px,py,toX,toY){const s=projectTwoPoints(d,toX,toY);if(!s)return[];const hits=twoPointAnchorHits(d,s,px,py);const w=textWidth(d,label(d,"Callout")),h=Math.max(26,(d.fontSize??13)+12);if(px>=s.b.x-w/2-TOL&&px<=s.b.x+w/2+TOL&&py>=s.b.y-h/2-TOL&&py<=s.b.y+h/2+TOL)return[...hits,{drawing:d,target:"body",distance:1}];const distance=distToSegment(px,py,s.a.x,s.a.y,s.b.x,s.b.y);return distance<=TOL?[...hits,{drawing:d,target:"body",distance}]:hits;},
  movePoints:defaultMovePoints,
  boundingBox(d,toX,toY){const s=projectTwoPoints(d,toX,toY);if(!s)return null;const w=textWidth(d,label(d,"Callout")),h=Math.max(26,(d.fontSize??13)+12);const left=Math.min(s.a.x,s.b.x-w/2),right=Math.max(s.a.x,s.b.x+w/2),top=Math.min(s.a.y,s.b.y-h/2),bottom=Math.max(s.a.y,s.b.y+h/2);return{x:left-TOL,y:top-TOL,w:right-left+TOL*2,h:bottom-top+TOL*2};},
};

registerTool(createOnePointAnnotation("note","note"));
registerTool(callout);
registerTool(createOnePointAnnotation("comment","comment"));
registerTool(createOnePointAnnotation("priceLabel","priceLabel"));
registerTool(createOnePointAnnotation("signpost","signpost"));
registerTool(createOnePointAnnotation("flag","flag"));
