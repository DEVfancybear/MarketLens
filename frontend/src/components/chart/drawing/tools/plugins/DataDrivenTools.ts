/** Phase 8 Wave D candle-snapshot-backed tools. */
import type { Drawing, DrawingDataSample } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  anchoredVwap,
  calculateVolumeProfile,
  regressionChannel,
  type VolumeProfileBin,
  type VolumeProfileMetadata,
} from "../../data/dataDrivenGeometry";
import {
  resolveVolumeProfileConfig,
  type ResolvedVolumeProfileConfig,
} from "../../../../../types/volumeProfile";
import { TOL, defaultMovePoints, distToRect, distToSegment, registerTool, type DrawingToolPlugin } from "../ToolRegistry";
import { canvasFont, handle } from "./shared";
import {
  projectTwoPoints,
  raySegment,
  type Segment,
} from "./lineGeometry";

export type XY = { x: number; y: number };
const snapshot = (d: Drawing) => d.dataSnapshot?.samples ?? [];
const boxOf = (points: readonly XY[]) => points.length ? { x: Math.min(...points.map(p=>p.x))-TOL, y: Math.min(...points.map(p=>p.y))-TOL, w: Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x))+TOL*2, h: Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))+TOL*2 } : null;
const bodyHits = (d:Drawing, points:readonly XY[], px:number, py:number):HitResult[] => {
  let distance=Infinity; for(let i=1;i<points.length;i++) distance=Math.min(distance,distToSegment(px,py,points[i-1].x,points[i-1].y,points[i].x,points[i].y));
  return distance<=TOL?[{drawing:d,target:"body",distance}]:[];
};
const anchorHits=(d:Drawing,px:number,py:number,toX:HitTestProjector,toY:HitTestProjector):HitResult[]=>d.points.flatMap((point,index)=>{const x=toX(point.time),y=toY(point.price);if(x==null||y==null)return[];const distance=Math.hypot(px-x,py-y);return distance<=24?[{drawing:d,target:index===0?"p1":index===1?"p2":"body",anchorIndex:index,distance} as HitResult]:[];});
function mappedSeries(
  d: Drawing,
  values: readonly number[],
  toX: HitTestProjector,
  toY: HitTestProjector,
  onePoint = false,
  timeDomain: "snapshot" | "current-anchor-range" = "snapshot",
): XY[] {
  const data = snapshot(d);
  if (!data.length || !d.points[0]) return [];
  const start = d.points[0].time;
  const end = onePoint
    ? start + Math.max(1, data[data.length - 1].time - data[0].time)
    : (d.points[1]?.time ?? start);
  return values.flatMap((value, index) => {
    const ratio = values.length === 1 ? 0 : index / (values.length - 1);
    const time = timeDomain === "current-anchor-range" && d.points[1]
      // Regression values are ordered chronologically, while anchors retain
      // creation order. Project the values over the *current* chronological
      // anchor range so coordinate edits and handle drags move/resize the
      // rendered channel without reversing its source-series slope when the
      // drawing was created right-to-left.
      ? Math.min(start, end) + Math.abs(end - start) * ratio
      // Anchored data tools keep their sample epochs (with interpolation only
      // as a compatibility fallback for historical mismatched payloads).
      : (data[index]?.time ?? start + (end - start) * ratio);
    const x = toX(time);
    const y = toY(value);
    return x == null || y == null ? [] : [{ x, y }];
  });
}

function drawPath(g: CanvasRenderingContext2D, points: readonly XY[]) {
  if (!points.length) return;
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) g.lineTo(point.x, point.y);
  g.stroke();
}

function anchors(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  selected: boolean,
) {
  if (!selected) return;
  for (const point of d.points) {
    const x = proj.toX(point.time);
    const y = proj.toY(point.price);
    if (x != null && y != null) handle(g, x, y, d.color);
  }
}

function segmentFrom(points: readonly XY[]): Segment | null {
  if (points.length < 2) return null;
  return { a: points[0], b: points[points.length - 1] };
}

function projectedAnchoredVwap(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): XY[] {
  const data = snapshot(d);
  return mappedSeries(
    d,
    anchoredVwap(data).map((point) => point.value),
    toX,
    toY,
    true,
  );
}

export interface RegressionTrendProjectedGeometry {
  base: Segment | null;
  upper: Segment | null;
  lower: Segment | null;
  pearson: {
    text: string;
    x: number;
    y: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null;
  anchorPoints: XY[];
}

/** One projection is consumed by Regression Trend render, hit-test, and bounds. */
export function projectRegressionTrendGeometry(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): RegressionTrendProjectedGeometry {
  const data = snapshot(d);
  const regression = regressionChannel(data, d);
  const rawBase = segmentFrom(
    mappedSeries(
      d,
      regression.values,
      toX,
      toY,
      false,
      "current-anchor-range",
    ),
  );
  const rawUpper = segmentFrom(
    mappedSeries(
      d,
      regression.upperValues,
      toX,
      toY,
      false,
      "current-anchor-range",
    ),
  );
  const rawLower = segmentFrom(
    mappedSeries(
      d,
      regression.lowerValues,
      toX,
      toY,
      false,
      "current-anchor-range",
    ),
  );
  const extend = (segment: Segment | null) =>
    segment && regression.config.regressionExtendLines
      // TradingView's Regression Trend "Extend lines" extends from the last
      // chronological sample to the right, not in both directions.
      ? raySegment(segment)
      : segment;
  const labelText = `R ${regression.correlation.toFixed(2)}`;
  const labelWidth = labelText.length * 7;
  const labelX = rawBase?.a.x ?? 0;
  const labelY = (rawBase?.a.y ?? 0) - 8;
  // Regression handles are time-only. Their vertical position follows the
  // calculated base line instead of the arbitrary pointer price captured when
  // the two time anchors were placed.
  const anchorPoints = rawBase
    ? d.points[1]?.time < d.points[0].time
      // Keep hit target p1 attached to point[0] even though the source values
      // are always rendered in chronological order.
      ? [rawBase.b, rawBase.a]
      : [rawBase.a, rawBase.b]
    : [];
  return {
    base: regression.config.regressionShowBaseLine ? extend(rawBase) : null,
    upper:
      regression.config.regressionUseUpperDeviation &&
      regression.config.regressionShowUpperLine
        ? extend(rawUpper)
        : null,
    lower:
      regression.config.regressionUseLowerDeviation &&
      regression.config.regressionShowLowerLine
        ? extend(rawLower)
        : null,
    pearson:
      regression.config.regressionShowPearsonR && rawBase
        ? {
            text: labelText,
            x: labelX,
            y: labelY,
            left: labelX,
            top: labelY - 12,
            right: labelX + labelWidth,
            bottom: labelY + 2,
          }
        : null,
    anchorPoints,
  };
}

const anchoredVwapTool: DrawingToolPlugin = {
  tool: "anchoredVWAP",
  minPoints: 1,
  render(g, d, proj, selected) {
    const path = projectedAnchoredVwap(d, proj.toX, proj.toY);
    if (!path.length) return;
    g.save();
    g.strokeStyle = d.color;
    g.lineWidth = d.lineWidth;
    drawPath(g, path);
    anchors(g, d, proj, selected);
    g.restore();
  },
  hitTest(d, px, py, toX, toY) {
    const path = projectedAnchoredVwap(d, toX, toY);
    return [
      ...anchorHits(d, px, py, toX, toY),
      ...bodyHits(d, path, px, py),
    ];
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    return boxOf(projectedAnchoredVwap(d, toX, toY));
  },
};

const regressionTrendTool: DrawingToolPlugin = {
  tool: "regressionTrend",
  minPoints: 2,
  render(g, d, proj, selected) {
    const geometry = projectRegressionTrendGeometry(d, proj.toX, proj.toY);
    g.save();
    g.strokeStyle = d.color;
    g.lineWidth = d.lineWidth;
    if (geometry.base) drawPath(g, [geometry.base.a, geometry.base.b]);
    g.globalAlpha = 0.55;
    if (geometry.upper) drawPath(g, [geometry.upper.a, geometry.upper.b]);
    if (geometry.lower) drawPath(g, [geometry.lower.a, geometry.lower.b]);
    g.globalAlpha = 1;
    if (geometry.pearson) {
      g.font = canvasFont(11);
      g.fillStyle = d.textColor || d.color;
      g.fillText(
        geometry.pearson.text,
        geometry.pearson.x,
        geometry.pearson.y,
      );
    }
    if (selected) {
      for (const point of geometry.anchorPoints) {
        handle(g, point.x, point.y, d.color);
      }
    }
    g.restore();
  },
  hitTest(d, px, py, toX, toY) {
    const geometry = projectRegressionTrendGeometry(d, toX, toY);
    const pearsonDistance = geometry.pearson
      ? distToRect(
          px,
          py,
          geometry.pearson.left,
          geometry.pearson.top,
          geometry.pearson.right,
          geometry.pearson.bottom,
        )
      : Infinity;
    const regressionAnchorHits = geometry.anchorPoints.flatMap((point, index) => {
      const distance = Math.hypot(px - point.x, py - point.y);
      return distance <= 24
        ? [{
            drawing: d,
            target: index === 0 ? "p1" as const : "p2" as const,
            anchorIndex: index,
            distance,
          }]
        : [];
    });
    return [
      ...regressionAnchorHits,
      ...(geometry.base
        ? bodyHits(d, [geometry.base.a, geometry.base.b], px, py)
        : []),
      ...(geometry.upper
        ? bodyHits(d, [geometry.upper.a, geometry.upper.b], px, py)
        : []),
      ...(geometry.lower
        ? bodyHits(d, [geometry.lower.a, geometry.lower.b], px, py)
        : []),
      ...(pearsonDistance <= TOL
        ? [{ drawing: d, target: "body" as const, distance: pearsonDistance }]
        : []),
    ];
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const geometry = projectRegressionTrendGeometry(d, toX, toY);
    const linePoints = [geometry.base, geometry.upper, geometry.lower].flatMap(
      (segment) => (segment ? [segment.a, segment.b] : []),
    );
    const labelPoints = geometry.pearson
      ? [
          { x: geometry.pearson.left, y: geometry.pearson.top },
          { x: geometry.pearson.right, y: geometry.pearson.bottom },
        ]
      : [];
    return boxOf([...linePoints, ...labelPoints, ...geometry.anchorPoints]);
  },
};

export interface VolumeProfileProjectedRow {
  x: number;
  y: number;
  w: number;
  h: number;
  displayVolume: number;
  bin: VolumeProfileBin;
}

export interface VolumeProfileProjectedLine {
  kind: "poc" | "vah" | "val";
  x1: number;
  x2: number;
  y: number;
}

export interface VolumeProfileProjectedGeometry {
  rows: VolumeProfileProjectedRow[];
  lines: VolumeProfileProjectedLine[];
  metadata: VolumeProfileMetadata;
  config: ResolvedVolumeProfileConfig;
  anchorPoints: XY[];
  box: { left: number; right: number; width: number } | null;
}

const EMPTY_VOLUME_PROFILE_METADATA: VolumeProfileMetadata = {
  source: null,
  observationCount: 0,
  profileLow: null,
  profileHigh: null,
  totalVolume: 0,
  valueAreaPercent: 70,
  targetValueAreaVolume: 0,
  valueAreaVolume: 0,
  pointOfControlIndex: null,
  pointOfControlPrice: null,
  valueAreaLowIndex: null,
  valueAreaHighIndex: null,
  valueAreaLow: null,
  valueAreaHigh: null,
};

function projectedProfileLine(
  kind: VolumeProfileProjectedLine["kind"],
  price: number | null,
  left: number,
  right: number,
  toY: HitTestProjector,
): VolumeProfileProjectedLine | null {
  if (price == null) return null;
  const y = toY(price);
  return y == null ? null : { kind, x1: left, x2: right, y };
}

/** Shared volume-profile projection used by render, hit-test, and bounds. */
export function projectVolumeProfileGeometry(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
  anchored = d.tool === "anchoredVolumeProfile",
): VolumeProfileProjectedGeometry {
  const data = snapshot(d);
  const config = resolveVolumeProfileConfig(d);
  const anchorPoints = d.points.flatMap((point) => {
    const x = toX(point.time), y = toY(point.price);
    return x == null || y == null ? [] : [{ x, y }];
  });
  if (!data.length || !d.points[0]) {
    return {
      rows: [],
      lines: [],
      metadata: {
        ...EMPTY_VOLUME_PROFILE_METADATA,
        valueAreaPercent: config.volumeProfileValueAreaPercent,
      },
      config,
      anchorPoints,
      box: null,
    };
  }

  const result = calculateVolumeProfile(
    data,
    config.volumeProfileRows,
    config.volumeProfileValueAreaPercent,
  );
  const start = toX(d.points[0].time);
  const anchoredEndTime = Math.max(
    d.points[0].time + 1,
    data[data.length - 1].time,
  );
  const end = toX(
    anchored
      ? anchoredEndTime
      : (d.points[1]?.time ?? d.points[0].time),
  );
  if (start == null || end == null || !result.bins.length) {
    return {
      rows: [],
      lines: [],
      metadata: result.metadata,
      config,
      anchorPoints,
      box: null,
    };
  }

  const rawWidth = Math.abs(end - start);
  const width = Math.max(24, rawWidth);
  const left = Math.min(start, end);
  const right = left + width;
  const histogramWidth = width * config.volumeProfileWidthPercent / 100;
  const displayedVolume = (bin: VolumeProfileBin) => {
    if (config.volumeProfileVolumeMode === "delta") {
      return Math.abs(bin.upVolume - bin.downVolume);
    }
    return bin.volume;
  };
  const max = Math.max(...result.bins.map(displayedVolume), 1);
  const rows = config.volumeProfileShowHistogram
    ? result.bins.flatMap((bin) => {
        const y1 = toY(bin.low), y2 = toY(bin.high);
        if (y1 == null || y2 == null) return [];
        const displayVolume = displayedVolume(bin);
        const rowWidth = histogramWidth * displayVolume / max;
        return [{
          x: config.volumeProfilePlacement === "right"
            ? right - rowWidth
            : left,
          y: Math.min(y1, y2),
          w: rowWidth,
          h: Math.max(1, Math.abs(y2 - y1)),
          displayVolume,
          bin,
        }];
      })
    : [];

  const lines = [
    config.volumeProfileShowPointOfControl
      ? projectedProfileLine(
          "poc",
          result.metadata.pointOfControlPrice,
          left,
          right,
          toY,
        )
      : null,
    config.volumeProfileShowValueAreaHigh
      ? projectedProfileLine(
          "vah",
          result.metadata.valueAreaHigh,
          left,
          right,
          toY,
        )
      : null,
    config.volumeProfileShowValueAreaLow
      ? projectedProfileLine(
          "val",
          result.metadata.valueAreaLow,
          left,
          right,
          toY,
        )
      : null,
  ].flatMap((line) => line ? [line] : []);

  return {
    rows,
    lines,
    metadata: result.metadata,
    config,
    anchorPoints,
    box: { left, right, width },
  };
}

function renderVolumeProfileRows(
  g: CanvasRenderingContext2D,
  d: Drawing,
  geometry: VolumeProfileProjectedGeometry,
) {
  const opacity = d.opacity ?? 0.6;
  for (const row of geometry.rows) {
    if (row.w <= 0) continue;
    const valueAreaAlpha = row.bin.isValueArea ? 1 : 0.35;
    const color = row.bin.isPointOfControl
      ? d.color
      : (d.fillColor || d.color);
    g.fillStyle = color;
    if (geometry.config.volumeProfileVolumeMode === "up-down") {
      const upRatio = row.bin.volume
        ? row.bin.upVolume / row.bin.volume
        : 0;
      g.globalAlpha = opacity * valueAreaAlpha;
      g.fillRect(row.x, row.y, row.w * upRatio, row.h);
      g.globalAlpha = opacity * valueAreaAlpha * 0.55;
      g.fillRect(
        row.x + row.w * upRatio,
        row.y,
        row.w * (1 - upRatio),
        row.h,
      );
    } else {
      if (
        geometry.config.volumeProfileVolumeMode === "delta" &&
        row.bin.downVolume > row.bin.upVolume
      ) {
        g.fillStyle = "#f23645";
      }
      g.globalAlpha = opacity * valueAreaAlpha;
      g.fillRect(row.x, row.y, row.w, row.h);
    }
  }
}

function renderVolumeProfileLines(
  g: CanvasRenderingContext2D,
  d: Drawing,
  lines: readonly VolumeProfileProjectedLine[],
) {
  g.globalAlpha = 1;
  g.strokeStyle = d.color;
  g.lineWidth = Math.max(1, Math.min(2, d.lineWidth));
  for (const line of lines) {
    g.setLineDash(line.kind === "poc" ? [] : [4, 3]);
    g.beginPath();
    g.moveTo(line.x1, line.y);
    g.lineTo(line.x2, line.y);
    g.stroke();
  }
  g.setLineDash([]);
}

function profileTool(
  tool: "fixedVolumeProfile" | "anchoredVolumeProfile",
): DrawingToolPlugin {
  const anchored = tool === "anchoredVolumeProfile";
  return {
    tool,
    minPoints: anchored ? 1 : 2,
    render(g, d, proj, selected) {
      const geometry = projectVolumeProfileGeometry(
        d,
        proj.toX,
        proj.toY,
        anchored,
      );
      if (!geometry.rows.length && !geometry.lines.length && !selected) return;
      g.save();
      renderVolumeProfileRows(g, d, geometry);
      renderVolumeProfileLines(g, d, geometry.lines);
      anchors(g, d, proj, selected);
      g.restore();
    },
    hitTest(d, px, py, toX, toY) {
      const geometry = projectVolumeProfileGeometry(d, toX, toY, anchored);
      const rowHit = geometry.rows.some((row) =>
        row.w > 0 &&
        px >= row.x - TOL && px <= row.x + row.w + TOL &&
        py >= row.y - TOL && py <= row.y + row.h + TOL,
      );
      const lineDistance = geometry.lines.reduce(
        (distance, line) => Math.min(
          distance,
          distToSegment(px, py, line.x1, line.y, line.x2, line.y),
        ),
        Infinity,
      );
      return [
        ...anchorHits(d, px, py, toX, toY),
        ...(rowHit || lineDistance <= TOL
          ? [{ drawing: d, target: "body" as const, distance: rowHit ? 1 : lineDistance }]
          : []),
      ];
    },
    movePoints: defaultMovePoints,
    boundingBox(d, toX, toY) {
      const geometry = projectVolumeProfileGeometry(d, toX, toY, anchored);
      const rowPoints = geometry.rows.flatMap((row) => [
        { x: row.x, y: row.y },
        { x: row.x + row.w, y: row.y + row.h },
      ]);
      const linePoints = geometry.lines.flatMap((line) => [
        { x: line.x1, y: line.y },
        { x: line.x2, y: line.y },
      ]);
      return boxOf([...rowPoints, ...linePoints, ...geometry.anchorPoints]);
    },
  };
}

function normalizedPattern(d:Drawing,toX:HitTestProjector,toY:HitTestProjector,ghost:boolean){const data=snapshot(d),segment=projectTwoPoints(d,toX,toY);if(!data.length||!segment)return[];const lows=data.map(s=>s.low),highs=data.map(s=>s.high),low=Math.min(...lows),high=Math.max(...highs),span=Math.max(high-low,Number.EPSILON);return data.map((sample,index)=>{const ratio=data.length===1?0:index/(data.length-1),x=segment.a.x+(segment.b.x-segment.a.x)*ratio;const map=(value:number)=>segment.a.y+(segment.b.y-segment.a.y)*(1-(value-low)/span);return ghost?{x,y:map(sample.close),sample}:{x,y:map(sample.close),open:map(sample.open),high:map(sample.high),low:map(sample.low),sample};});}
function barBodyWidth(points: readonly XY[]) { return points.length ? Math.max(1,Math.abs((points.at(-1)!.x-points[0].x)/points.length)*.65) : 1; }
function barsPatternHits(d:Drawing,points:ReturnType<typeof normalizedPattern>,px:number,py:number):HitResult[]{const width=barBodyWidth(points);let distance=Infinity;for(const point of points){if(point.high==null||point.low==null||point.open==null)continue;distance=Math.min(distance,distToSegment(px,py,point.x,point.high,point.x,point.low),distToRect(px,py,point.x-width/2,point.open,point.x+width/2,point.y));}return distance<=TOL?[{drawing:d,target:"body",distance}]:[];}
function patternTool(tool:"barsPattern"|"ghostFeed"):DrawingToolPlugin{const ghost=tool==="ghostFeed";return{tool,minPoints:2,render(g,d,proj,selected){const points=normalizedPattern(d,proj.toX,proj.toY,ghost);if(!points.length)return;g.save();g.strokeStyle=d.color;g.lineWidth=d.lineWidth;if(ghost){g.setLineDash([6,4]);g.globalAlpha=d.opacity??.55;drawPath(g,points);}else{const body=barBodyWidth(points);for(const p of points){g.strokeStyle=p.sample.close>=p.sample.open?d.color:"#f23645";g.beginPath();g.moveTo(p.x,p.high!);g.lineTo(p.x,p.low!);g.stroke();g.strokeRect(p.x-body/2,Math.min(p.open!,p.y),body,Math.max(1,Math.abs(p.y-p.open!)));}}g.globalAlpha=1;anchors(g,d,proj,selected);g.restore();},hitTest(d,px,py,toX,toY){const points=normalizedPattern(d,toX,toY,ghost);return[...anchorHits(d,px,py,toX,toY),...(ghost?bodyHits(d,points,px,py):barsPatternHits(d,points,px,py))];},movePoints:defaultMovePoints,boundingBox(d,toX,toY){const pts=normalizedPattern(d,toX,toY,ghost);if(ghost)return boxOf(pts);const width=barBodyWidth(pts);return boxOf(pts.flatMap(p=>[{x:p.x-width/2,y:p.high!},{x:p.x+width/2,y:p.low!}]));}};}

registerTool(anchoredVwapTool);registerTool(regressionTrendTool);
registerTool(profileTool("fixedVolumeProfile"));registerTool(profileTool("anchoredVolumeProfile"));
registerTool(patternTool("barsPattern"));registerTool(patternTool("ghostFeed"));
