import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/LevelFanTools";
import "../../src/components/chart/drawing/tools/plugins/RadialLevelTools";
import "../../src/components/chart/drawing/tools/plugins/FibSpiralTool";
import "../../src/components/chart/drawing/tools/plugins/GannGridTools";
import "../../src/components/chart/drawing/tools/plugins/PitchforkTools";

const WAVE_B = [
  "fibChannel", "fibSpeedFan", "fibSpeedArcs", "fibCircles", "fibSpiral", "fibWedge",
  "trendFibTime", "pitchfan", "gannFan", "gannSquare", "gannBox",
  "pitchfork", "insidePitchfork", "schiffPitchfork", "modifiedSchiffPitchfork",
] as const;

function fixture(tool: Drawing["tool"]): Drawing {
  return {
    id:`wave-b-${tool}`,tool,color:"#2962ff",lineWidth:2,fillColor:"#2962ff",opacity:0.12,
    points:[{time:100,price:120},{time:200,price:80},{time:140,price:60}],
  };
}

function context(){const target:Record<string,unknown>={canvas:{width:800,height:600},measureText:(text:string)=>({width:text.length*7})};return new Proxy(target,{get(object,property){if(property in object)return object[property as string];return()=>undefined;},set(object,property,value){object[property as string]=value;return true;}}) as unknown as CanvasRenderingContext2D;}
const projector={toX:(value:number)=>value,toY:(value:number)=>value,width:800,height:600};

test("Phase 8 Wave B adapters satisfy render, bounds, anchors, move, and JSON contracts",()=>{
  for(const tool of WAVE_B){const adapter=getTool(tool);assert.ok(adapter,`${tool} adapter`);const drawing=fixture(tool);drawing.points=drawing.points.slice(0,adapter.minPoints);assert.doesNotThrow(()=>adapter.render(context(),drawing,projector,true),tool);const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY);assert.ok(bounds,`${tool} bounds`);assert.ok([bounds.x,bounds.y,bounds.w,bounds.h].every(Number.isFinite),`${tool} finite bounds`);assert.equal(adapter.getAnchors(drawing,projector.toX,projector.toY).length,drawing.points.length);assert.equal(adapter.move(drawing.points,{time:150,price:150},{time:100,price:100}).length,drawing.points.length);assert.doesNotThrow(()=>JSON.parse(JSON.stringify(drawing)));}
});

test("Wave B level, fan, radial, grid, and pitchfork bodies are selectable",()=>{
  const cases=[
    ["fibChannel",150,100],["fibSpeedFan",150,100],["gannFan",150,100],
    ["fibSpeedArcs",200,120],["gannSquare",150,100],["gannBox",150,100],
    ["pitchfork",135,95],["insidePitchfork",135,95],["schiffPitchfork",150,100],
    ["trendFibTime",140,300],
  ] as const;
  for(const[tool,x,y]of cases){const adapter=getTool(tool)!;const drawing=fixture(tool);drawing.points=drawing.points.slice(0,adapter.minPoints);assert.ok(adapter.hitTest(drawing,x,y,projector.toX,projector.toY).length>0,tool);}
});

test("Fib Channel bounds include enabled external ratios",()=>{
  const adapter=getTool("fibChannel")!;const drawing=fixture("fibChannel");
  drawing.fibLevels=[{value:0,enabled:true,color:"#fff"},{value:2,enabled:true,color:"#fff"}];
  const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY)!;
  assert.ok(bounds.h>100,"external level must expand beyond the base channel");
});

test("Fib Wedge uses the official two-point symmetric angular sector",()=>{
  const adapter=getTool("fibWedge")!;
  const drawing=fixture("fibWedge");
  drawing.points=[
    {time:300,price:300},
    {time:400,price:300},
  ];
  drawing.fibLevels=[{value:1,enabled:true,color:"#fff"}];

  const visibleArc={x:300+Math.SQRT1_2*100,y:300+Math.SQRT1_2*100};
  const oppositeArc={x:200,y:300};
  assert.ok(
    adapter.hitTest(drawing,visibleArc.x,visibleArc.y,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    "the rendered +45-degree point on the outer arc must be selectable",
  );
  assert.equal(
    adapter.hitTest(drawing,oppositeArc.x,oppositeArc.y,projector.toX,projector.toY).length,
    0,
    "the same-radius point on the invisible opposite arc must miss",
  );

  const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY)!;
  const renderedExtrema=[
    {x:400,y:300},
    visibleArc,
    {x:300+Math.SQRT1_2*100,y:300-Math.SQRT1_2*100},
    {x:300,y:300},
  ];
  for(const point of renderedExtrema){
    assert.ok(
      point.x>=bounds.x&&point.x<=bounds.x+bounds.w
        &&point.y>=bounds.y&&point.y<=bounds.y+bounds.h,
      `bounds contain rendered extremum ${JSON.stringify(point)}`,
    );
  }
  assert.ok(
    oppositeArc.x<bounds.x,
    "angular bounds must not retain the discarded opposite sector",
  );
  assert.deepEqual(
    adapter.getAnchors(drawing,projector.toX,projector.toY)[1],
    {index:1,x:400,y:300,target:"p2"},
  );
});
