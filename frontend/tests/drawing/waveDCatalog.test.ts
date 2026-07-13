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

test("Regression hit testing and bounds include both deviation channels",()=>{
  const regressionSamples:DrawingDataSample[]=[
    {time:100,open:0,high:1,low:-1,close:0,volume:1},
    {time:160,open:100,high:101,low:99,close:100,volume:1},
    {time:220,open:0,high:1,low:-1,close:0,volume:1},
  ];
  const drawing:Drawing={...fixture("regressionTrend"),points:[{time:100,price:0},{time:220,price:0}],dataSnapshot:{version:1,symbol:"TEST",capturedAt:1,samples:regressionSamples}};
  const regression=regressionChannel(regressionSamples);
  const upperMiddle=regression.values[1]+regression.deviation*2;
  const adapter=getTool("regressionTrend")!;
  assert.ok(adapter.hitTest(drawing,160,upperMiddle,projector.toX,projector.toY).some((hit)=>hit.target==="body"),"rendered upper channel must be selectable");
  const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY)!;
  assert.ok(bounds.y<=Math.min(...regression.values.map((value)=>value-regression.deviation*2)),"bounds must contain lower channel");
  assert.ok(bounds.y+bounds.h>=Math.max(...regression.values.map((value)=>value+regression.deviation*2)),"bounds must contain upper channel");
});

test("Bars Pattern hit testing follows rendered wicks and bodies, not an invisible close path",()=>{
  const barSamples:DrawingDataSample[]=[
    {time:100,open:2,high:10,low:0,close:8,volume:1},
    {time:160,open:8,high:10,low:0,close:2,volume:1},
  ];
  const drawing:Drawing={...fixture("barsPattern"),points:[{time:100,price:100},{time:200,price:200}],dataSnapshot:{version:1,symbol:"TEST",capturedAt:1,samples:barSamples}};
  const adapter=getTool("barsPattern")!;
  assert.ok(adapter.hitTest(drawing,100,150,projector.toX,projector.toY).some((hit)=>hit.target==="body"),"visible wick must be selectable");
  assert.equal(adapter.hitTest(drawing,150,150,projector.toX,projector.toY).some((hit)=>hit.target==="body"),false,"invisible close-to-close diagonal must not be selectable");
});

test("Forecast hit-testing and bounds use the rendered projection triangle",()=>{
  const adapter=getTool("forecast")!;
  const drawing=fixture("forecast");
  drawing.points=[
    {time:100,price:100},
    {time:300,price:100},
    {time:300,price:180},
  ];

  assert.ok(
    adapter.hitTest(drawing,240,100,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    "a visible point inside the forecast triangle must hit",
  );
  assert.equal(
    adapter.hitTest(drawing,140,180,projector.toX,projector.toY).length,
    0,
    "an invisible point inside the old anchor box but outside the triangle must miss",
  );
  const transparent={...drawing,fillColor:"transparent"};
  assert.equal(
    adapter.hitTest(transparent,240,120,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    false,
    "a transparent forecast interior must not create invisible body geometry",
  );

  const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY)!;
  for(const point of [{x:100,y:100},{x:300,y:20},{x:300,y:180}]){
    assert.ok(
      point.x>=bounds.x&&point.x<=bounds.x+bounds.w
        &&point.y>=bounds.y&&point.y<=bounds.y+bounds.h,
      `bounds contain rendered forecast extremum ${JSON.stringify(point)}`,
    );
  }
  assert.deepEqual(
    adapter.getAnchors(drawing,projector.toX,projector.toY)[2],
    {index:2,x:300,y:180,target:"p3"},
  );
});

test("Sector hit-testing and bounds follow its rendered angular sweep",()=>{
  const adapter=getTool("sector")!;
  const drawing=fixture("sector");
  drawing.points=[
    {time:300,price:300},
    {time:400,price:300},
    {time:280,price:320},
  ];

  assert.ok(
    adapter.hitTest(drawing,300,350,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    "a visible point in the filled sector must hit",
  );
  const opposite={x:300,y:250};
  assert.equal(
    adapter.hitTest(drawing,opposite.x,opposite.y,projector.toX,projector.toY).length,
    0,
    "a same-radius point outside the angular sweep must miss",
  );
  const transparent={...drawing,fillColor:"transparent"};
  assert.equal(
    adapter.hitTest(transparent,300,350,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    false,
    "a transparent sector interior must not be selectable away from its outline",
  );

  const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY)!;
  const renderedExtrema=[
    {x:400,y:300},
    {x:300,y:400},
    {x:300-Math.SQRT1_2*100,y:300+Math.SQRT1_2*100},
    {x:280,y:320},
  ];
  for(const point of renderedExtrema){
    assert.ok(
      point.x>=bounds.x&&point.x<=bounds.x+bounds.w
        &&point.y>=bounds.y&&point.y<=bounds.y+bounds.h,
      `bounds contain rendered sector extremum ${JSON.stringify(point)}`,
    );
  }
  assert.ok(opposite.y<bounds.y,"sector bounds must exclude the opposite arc");
  assert.deepEqual(
    adapter.getAnchors(drawing,projector.toX,projector.toY)[2],
    {index:2,x:280,y:320,target:"p3"},
  );
});

test("Social Embed hit testing and bounds follow the rendered card width",()=>{
  const adapter=getTool("socialEmbed")!;
  const drawing:Drawing={...fixture("socialEmbed"),text:"x",points:[{time:100,price:100}]};
  assert.ok(
    adapter.hitTest(drawing,200,100,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    "the visible card interior must be selectable",
  );
  assert.equal(
    adapter.hitTest(drawing,320,100,projector.toX,projector.toY)
      .some((hit)=>hit.target==="body"),
    false,
    "space beyond the rendered minimum-width card must not be selectable",
  );
  const bounds=adapter.boundingBox(drawing,projector.toX,projector.toY)!;
  assert.ok(bounds.x<=100&&bounds.x+bounds.w>=288,"bounds contain anchor and 180px card");
  assert.ok(bounds.x+bounds.w<320,"bounds do not retain the old hard-coded 360px hit width");
});
