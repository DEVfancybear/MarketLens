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

function finiteBounds(bounds: { x: number; y: number; w: number; h: number }): boolean {
  return (
    [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) &&
    bounds.w >= 0 &&
    bounds.h >= 0
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
    barIntervalSeconds: 60,
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
      try {
        context.strokeStyle = fixture.color;
        context.fillStyle = fixture.color;
        context.lineWidth = fixture.lineWidth;
        adapter.render(context, fixture, projector, true);
      } finally {
        context.restore();
      }

      const bounds = adapter.boundingBox(
        fixture,
        projector.toX,
        projector.toY,
      );
      if (!bounds) {
        throw new Error("finite fixture did not expose spatial bounds");
      }
      if (!finiteBounds(bounds)) {
        throw new Error("boundingBox returned invalid geometry");
      }

      const anchors = adapter.getAnchors(
        fixture,
        projector.toX,
        projector.toY,
      );
      if (new Set(anchors.map((anchor) => anchor.index)).size !== anchors.length) {
        throw new Error("getAnchors returned duplicate anchor ids");
      }
      if (anchors.some((anchor) => !Number.isInteger(anchor.index))) {
        throw new Error("getAnchors returned an invalid anchor index");
      }
      if (
        anchors.some(
          (anchor) =>
            !(
              (anchor.x == null && anchor.y == null) ||
              (Number.isFinite(anchor.x) && Number.isFinite(anchor.y))
            ),
        )
      ) {
        throw new Error("getAnchors returned partially projected or non-finite geometry");
      }

      const moved = adapter.move(
        fixture.points,
        { time: 150, price: 150 },
        { time: 100, price: 100 },
      );
      if (moved.length !== fixture.points.length || !finitePoints(moved)) {
        throw new Error("move returned invalid points");
      }

      const firstVisibleAnchor = anchors.find(
        (anchor) => anchor.x != null && anchor.y != null,
      );
      const resized = adapter.moveAnchor(
        fixture.points,
        firstVisibleAnchor?.index ?? 0,
        {
          time: fixture.points[0].time + 11,
          price: fixture.points[0].price + 7,
        },
      );
      if (resized.length !== fixture.points.length || !finitePoints(resized)) {
        throw new Error("moveAnchor returned invalid points");
      }

      const visibleAnchors = anchors.filter(
        (anchor): anchor is typeof anchor & { x: number; y: number } =>
          anchor.x != null && anchor.y != null,
      );
      const hitPoints = visibleAnchors.length > 0
        ? visibleAnchors
        : [{
            index: -1,
            x: fixture.points[0].time,
            y: fixture.points[0].price,
            target: "body" as const,
          }];

      for (const anchor of hitPoints) {
        const hits = adapter.hitTest(
          fixture,
          anchor.x,
          anchor.y,
          projector.toX,
          projector.toY,
        );
        if (hits.length === 0) {
          throw new Error(
            anchor.index >= 0
              ? `projected anchor ${anchor.index} is not selectable`
              : "visible drawing body is not selectable",
          );
        }
        if (
          hits.some(
            (hit) =>
              hit.drawing.id !== fixture.id ||
              !Number.isFinite(hit.distance) ||
              (hit.target !== "body" && !Number.isInteger(hit.anchorIndex)),
          )
        ) {
          throw new Error("hitTest returned an invalid hit result");
        }
        if (
          anchor.index >= 0 &&
          !hits.some(
            (hit) => hit.target !== "body" && hit.anchorIndex === anchor.index,
          )
        ) {
          throw new Error(
            `projected anchor ${anchor.index} did not preserve its hit identity`,
          );
        }
      }
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
