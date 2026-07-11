import {
  DEFAULT_FIB_LEVELS,
  DRAWING_TOOLS,
  type Drawing,
  type DrawingTool,
  type Point,
} from "../../../../types/drawing";

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

  return {
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
}

export function expectedPersistentToolIds(): DrawingTool[] {
  return [...DRAWING_TOOLS];
}
