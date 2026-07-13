import {
  DEFAULT_FIB_LEVELS,
  DRAWING_TOOLS,
  type Drawing,
  type DrawingDataSample,
  type DrawingTool,
  type Point,
} from "../../../../types/drawing";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";

export interface FixtureAdapterShape {
  minPoints: number;
  maxPoints?: number;
  freeform?: boolean;
  continuous?: boolean;
}

const BASE_POINTS: Point[] = [
  { time: 120, price: 180 },
  { time: 260, price: 80 },
  { time: 320, price: 145 },
  { time: 410, price: 105 },
  { time: 500, price: 165 },
  { time: 590, price: 95 },
  { time: 680, price: 150 },
];

const BASE_DATA_SAMPLES: DrawingDataSample[] = [
  { time: 120, open: 176, high: 184, low: 172, close: 180, volume: 120 },
  { time: 180, open: 180, high: 188, low: 176, close: 184, volume: 180 },
  { time: 240, open: 184, high: 190, low: 78, close: 82, volume: 240 },
  { time: 260, open: 82, high: 88, low: 76, close: 80, volume: 160 },
];

export function fixturePointCount(
  tool: DrawingTool,
  adapter: FixtureAdapterShape,
): number {
  if (tool === "long" || tool === "short") return 3;
  if (adapter.maxPoints !== undefined) return adapter.maxPoints;
  if (adapter.freeform || adapter.continuous) {
    return Math.max(adapter.minPoints, 4);
  }
  return adapter.minPoints;
}

export function drawingFixture(
  tool: DrawingTool,
  adapter: FixtureAdapterShape,
): Drawing {
  const definition = getDrawingToolManifestEntry(tool);
  const count = fixturePointCount(tool, adapter);
  const points = BASE_POINTS.slice(0, count).map((point) => ({ ...point }));
  if (tool === "long") {
    points.splice(0, points.length,
      { time: 120, price: 120 },
      { time: 300, price: 160 },
      { time: 300, price: 95 },
    );
  } else if (tool === "short") {
    points.splice(0, points.length,
      { time: 120, price: 120 },
      { time: 300, price: 80 },
      { time: 300, price: 145 },
    );
  }

  const drawing: Drawing = {
    id: `fixture-${tool}`,
    tool,
    color: "#2962ff",
    lineWidth: tool === "highlighter" ? 8 : 2,
    lineStyle: "solid",
    fillColor: "#2962ff",
    opacity: tool === "highlighter" ? 0.35 : 0.2,
    points,
    text: tool === "emoji" ? "★" : "Fixture",
    fontSize: 13,
    visible: true,
    fibLevels: DEFAULT_FIB_LEVELS.map((level) => ({ ...level })),
    accountSize: 10_000,
    riskValue: 1,
    riskUnit: "%",
    leverage: 10,
    lotSize: 1,
    qtyPrecision: 2,
  };

  if (definition.dataSnapshot) {
    drawing.dataSnapshot = {
      version: 1,
      symbol: "FIXTURE",
      capturedAt: 1,
      samples: BASE_DATA_SAMPLES.map((sample) => ({ ...sample })),
    };
  }
  if (definition.contentKind === "table") {
    drawing.content = {
      kind: "table",
      cells: [["Header", "Value"], ["Row", "1"]],
    };
  } else if (definition.contentKind === "image") {
    drawing.content = { kind: "image", alt: "Fixture image" };
  } else if (definition.contentKind === "social") {
    drawing.content = {
      kind: "social",
      sourceUrl: "https://x.com/openai/status/1",
    };
    drawing.text = "https://x.com/openai/status/1";
  }

  return drawing;
}

export function expectedPersistentToolIds(): DrawingTool[] {
  return [...DRAWING_TOOLS];
}
