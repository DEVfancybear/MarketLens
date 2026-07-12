import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import { getDrawingToolManifestEntry } from "../../src/types/drawingToolManifest";
import "../../src/components/chart/drawing/tools/plugins/LabeledPatternTools";
import "../../src/components/chart/drawing/tools/plugins/TimeCyclesTool";

const WAVE_C=["abcdPattern","xabcdPattern","trianglePattern","threeDrivesPattern","headShouldersPattern","elliottImpulse","elliottTriangle","elliottTripleCombo","elliottCorrection","elliottDoubleCombo","timeCycles"] as const;
const POINTS=[{time:100,price:120},{time:160,price:80},{time:220,price:110},{time:280,price:60},{time:340,price:100},{time:400,price:70},{time:460,price:115}];
function fixture(tool:Drawing["tool"]):Drawing{const definition=getDrawingToolManifestEntry(tool);return{id:`wave-c-${tool}`,tool,color:"#2962ff",lineWidth:2,fillColor:"#2962ff",opacity:.1,points:POINTS.slice(0,definition.maxPoints??definition.minPoints)};}
function context(){const target:Record<string,unknown>={canvas:{width:800,height:600},measureText:(text:string)=>({width:text.length*7})};return new Proxy(target,{get(object,property){if(property in object)return object[property as string];return()=>undefined;},set(object,property,value){object[property as string]=value;return true;}}) as unknown as CanvasRenderingContext2D;}
const projector={toX:(value:number)=>value,toY:(value:number)=>value,width:800,height:600};

test("Phase 8 Wave C adapters satisfy labeled render, bounds, anchors, move, and JSON contracts",()=>{
  for(const tool of WAVE_C){const adapter=getTool(tool);assert.ok(adapter,`${tool} adapter`);const drawing=fixture(tool);assert.doesNotThrow(()=>adapter.render(context(),drawing,projector,true),tool);const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY);assert.ok(bounds,`${tool} bounds`);assert.ok([bounds.x,bounds.y,bounds.w,bounds.h].every(Number.isFinite),`${tool} finite bounds`);assert.equal(adapter.getAnchors(drawing,projector.toX,projector.toY).length,drawing.points.length);assert.equal(adapter.move(drawing.points,{time:150,price:150},{time:100,price:100}).length,drawing.points.length);assert.doesNotThrow(()=>JSON.parse(JSON.stringify(drawing)));}
});

test("harmonic, Elliott, head-and-shoulders, and cycle bodies are selectable",()=>{
  for(const tool of ["abcdPattern","xabcdPattern","threeDrivesPattern","headShouldersPattern","elliottImpulse","elliottCorrection"] as const){const adapter=getTool(tool)!;const drawing=fixture(tool);assert.ok(adapter.hitTest(drawing,130,100,projector.toX,projector.toY).some((hit)=>hit.target==="body"),tool);}
  const cycles=getTool("timeCycles")!,drawing:Drawing={...fixture("timeCycles"),points:[{time:100,price:120},{time:200,price:120}]};
  assert.ok(cycles.hitTest(drawing,150,70,projector.toX,projector.toY).some((hit)=>hit.target==="body"));
});

test("manifest labels and fixed point counts define every Wave C topology",()=>{
  for(const tool of WAVE_C.filter((item)=>item!=="timeCycles")){const definition=getDrawingToolManifestEntry(tool);assert.equal(definition.creationMode,"fixed-multi-point");assert.equal(definition.coordinateLabels?.length,definition.maxPoints,tool);}
});

test("pattern bounds reserve validation and ratio labels above anchors",()=>{
  const drawing=fixture("abcdPattern"),bounds=getTool("abcdPattern")!.boundingBox(drawing,projector.toX,projector.toY)!;
  assert.ok(bounds.y<=Math.min(...drawing.points.map((point)=>point.price))-90);
});
