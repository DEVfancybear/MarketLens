import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing, DrawingDataSample } from "../../src/types/drawing";
import { anchoredVwap, regressionChannel, volumeProfile } from "../../src/components/chart/drawing/data/dataDrivenGeometry";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import { getDrawingToolManifestEntry } from "../../src/types/drawingToolManifest";
import "../../src/components/chart/drawing/tools/plugins/DataDrivenTools";
import "../../src/components/chart/drawing/tools/plugins/ProjectionRichTools";

const TOOLS=["anchoredVWAP","fixedVolumeProfile","anchoredVolumeProfile","regressionTrend","barsPattern","ghostFeed","forecast","sector","table","image","socialEmbed"] as const;
const samples:DrawingDataSample[]=[{time:100,open:10,high:13,low:9,close:12,volume:10},{time:160,open:12,high:15,low:11,close:14,volume:20},{time:220,open:14,high:15,low:10,close:11,volume:30}];
function fixture(tool:Drawing["tool"]):Drawing{const definition=getDrawingToolManifestEntry(tool);return{id:`wave-d-${tool}`,tool,color:"#2962ff",lineWidth:2,fillColor:"#2962ff",opacity:.2,points:[{time:100,price:12},{time:220,price:20},{time:260,price:8}].slice(0,definition.maxPoints??definition.minPoints),dataSnapshot:{version:1,symbol:"TEST",capturedAt:1,samples},content:tool==="table"?{kind:"table",cells:[["A","B"],["1","2"]]}:tool==="image"?{kind:"image",alt:"Chart"}:tool==="socialEmbed"?{kind:"social",sourceUrl:"https://x.com/test/status/1"}:undefined,text:tool==="socialEmbed"?"https://x.com/test/status/1":undefined};}
function context(){const target:Record<string,unknown>={canvas:{width:800,height:600},measureText:(text:string)=>({width:text.length*7})};return new Proxy(target,{get(o,p){if(p in o)return o[p as string];return()=>undefined;},set(o,p,v){o[p as string]=v;return true;}}) as unknown as CanvasRenderingContext2D;}
const projector={toX:(v:number)=>v,toY:(v:number)=>v,width:800,height:600};

test("Wave D adapters render, bound, anchor, move, hit-test, and serialize",()=>{for(const tool of TOOLS){const adapter=getTool(tool);assert.ok(adapter,tool);const drawing=fixture(tool);assert.doesNotThrow(()=>adapter.render(context(),drawing,projector,true),tool);const b=adapter.boundingBox(drawing,projector.toX,projector.toY);assert.ok(b,`${tool} bounds`);assert.ok([b.x,b.y,b.w,b.h].every(Number.isFinite),tool);assert.equal(adapter.getAnchors(drawing,projector.toX,projector.toY).length,drawing.points.length);assert.equal(adapter.move(drawing.points,{time:2,price:2},{time:1,price:1}).length,drawing.points.length);assert.doesNotThrow(()=>JSON.parse(JSON.stringify(drawing)));}}
);

test("data geometry calculates cumulative VWAP, regression, and volume conservation",()=>{
  const vwap=anchoredVwap(samples);assert.equal(vwap.length,3);assert.ok(vwap[1].value>vwap[0].value);
  const perfect=samples.map((sample,index)=>({...sample,close:10+index*2}));const regression=regressionChannel(perfect);assert.equal(regression.slope,2);assert.ok(Math.abs(regression.correlation-1)<1e-10);assert.ok(regression.deviation<1e-10);
  const profile=volumeProfile(samples,6);assert.equal(profile.reduce((sum,bin)=>sum+bin.volume,0),60);assert.equal(profile.reduce((sum,bin)=>sum+bin.upVolume+bin.downVolume,0),60);
});

test("Wave D manifest distinguishes data snapshots and safe rich content",()=>{
  assert.equal(getDrawingToolManifestEntry("anchoredVWAP").dataSnapshot,"anchor-to-latest");
  assert.equal(getDrawingToolManifestEntry("regressionTrend").dataSnapshot,"between-anchors");
  assert.equal(getDrawingToolManifestEntry("table").contentKind,"table");
  assert.equal(getDrawingToolManifestEntry("socialEmbed").overlayExtension,"text-editor");
});
