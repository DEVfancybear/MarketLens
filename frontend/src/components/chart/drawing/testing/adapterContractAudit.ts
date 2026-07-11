import { DRAWING_TOOLS, type DrawingTool } from "../../../../types/drawing";
import { allTools } from "../tools/ToolRegistry";
import { drawingFixture } from "./toolFixtures";

export interface DrawingAdapterContractResult {
  expectedToolIds: DrawingTool[];
  registeredToolIds: DrawingTool[];
  fixtureToolIds: DrawingTool[];
  errors: string[];
}

function finitePoints(points: Array<{ time: number; price: number }>): boolean {
  return points.every(
    (point) => Number.isFinite(point.time) && Number.isFinite(point.price),
  );
}

/** Development/test-only executable audit against the adapters used by the app. */
export function runDrawingAdapterContractAudit(
  canvas: HTMLCanvasElement,
): DrawingAdapterContractResult {
  const expectedToolIds = [...DRAWING_TOOLS].sort();
  const adapters = allTools();
  const registeredToolIds = adapters.map((adapter) => adapter.tool).sort();
  const fixtureToolIds: DrawingTool[] = [];
  const errors: string[] = [];
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      expectedToolIds,
      registeredToolIds,
      fixtureToolIds,
      errors: ["Canvas 2D context is unavailable"],
    };
  }

  const projector = {
    toX: (time: number) => time,
    toY: (price: number) => price,
    width: canvas.width,
    height: canvas.height,
  };

  for (const adapter of adapters) {
    try {
      const fixture = drawingFixture(adapter.tool, adapter);
      fixtureToolIds.push(adapter.tool);
      if (fixture.points.length < adapter.minPoints) {
        throw new Error(
          `fixture has ${fixture.points.length} points; minPoints=${adapter.minPoints}`,
        );
      }
      if (!finitePoints(fixture.points)) throw new Error("fixture contains non-finite points");
      const roundTrip = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
      if (
        roundTrip.tool !== fixture.tool ||
        roundTrip.id !== fixture.id ||
        roundTrip.points.length !== fixture.points.length ||
        !finitePoints(roundTrip.points)
      ) {
        throw new Error("fixture failed JSON persistence round-trip");
      }

      context.save();
      context.strokeStyle = fixture.color;
      context.fillStyle = fixture.color;
      context.lineWidth = fixture.lineWidth;
      adapter.render(context, fixture, projector, false);
      context.restore();

      const bounds = adapter.boundingBox(
        fixture,
        projector.toX,
        projector.toY,
      );
      if (
        bounds &&
        ![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)
      ) {
        throw new Error("boundingBox returned non-finite geometry");
      }

      const anchors = adapter.getAnchors(
        fixture,
        projector.toX,
        projector.toY,
      );
      if (anchors.some((anchor) => !Number.isInteger(anchor.index))) {
        throw new Error("getAnchors returned an invalid anchor index");
      }

      const moved = adapter.move(
        fixture.points,
        { time: 150, price: 150 },
        { time: 100, price: 100 },
      );
      if (moved.length !== fixture.points.length || !finitePoints(moved)) {
        throw new Error("move returned invalid points");
      }

      adapter.hitTest(
        fixture,
        fixture.points[0].time,
        fixture.points[0].price,
        projector.toX,
        projector.toY,
      );
    } catch (error) {
      errors.push(
        `${adapter.tool}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (new Set(registeredToolIds).size !== registeredToolIds.length) {
    errors.push("Registry contains duplicate tool ids");
  }
  if (registeredToolIds.join("|") !== expectedToolIds.join("|")) {
    errors.push("Registered tool ids do not match DRAWING_TOOLS");
  }

  fixtureToolIds.sort();
  if (fixtureToolIds.join("|") !== expectedToolIds.join("|")) {
    errors.push("Fixture tool ids do not match DRAWING_TOOLS");
  }

  return { expectedToolIds, registeredToolIds, fixtureToolIds, errors };
}
