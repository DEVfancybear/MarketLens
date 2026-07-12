import type { Drawing } from "../../../../types";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import {
  fibLevelPrice,
  resolvedFibLevels,
} from "../tools/plugins/fibGeometry";

export interface DrawingAlertTarget {
  id: string;
  label: string;
  price: number;
}

export interface DrawingAlertSnapshot {
  kind: "drawing";
  drawingId: string;
  drawingTool: Drawing["tool"];
  targetId: string;
  targetLabel: string;
  snapshotAt: number;
}

function finitePrice(price: number | undefined): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

function uniqueTargets(targets: DrawingAlertTarget[]): DrawingAlertTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!finitePrice(target.price)) return false;
    const key = `${target.id}:${target.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function drawingAlertTargets(drawing: Drawing): DrawingAlertTarget[] {
  const projection = getDrawingToolManifestEntry(drawing.tool).alertProjection;
  if (!projection) return [];
  if (projection === "point-price") {
    return finitePrice(drawing.points[0]?.price)
      ? [{ id: "point:0", label: "Price level", price: drawing.points[0].price }]
      : [];
  }
  if (projection === "range-boundaries") {
    const prices = drawing.points.slice(0, 2).map((point) => point.price).filter(finitePrice);
    if (prices.length < 2) return [];
    return uniqueTargets([
      { id: "range:upper", label: "Upper boundary", price: Math.max(...prices) },
      { id: "range:lower", label: "Lower boundary", price: Math.min(...prices) },
    ]);
  }
  if (projection === "position-levels") {
    return uniqueTargets([
      { id: "position:entry", label: "Entry", price: drawing.points[0]?.price },
      { id: "position:target", label: "Target", price: drawing.target ?? drawing.points[1]?.price },
      { id: "position:stop", label: "Stop", price: drawing.stop ?? drawing.points[2]?.price },
    ] as DrawingAlertTarget[]);
  }
  const family = projection === "fib-extension-levels" ? "extension" : "retracement";
  if (drawing.points.length < 2) return [];
  return uniqueTargets(
    resolvedFibLevels(drawing, family)
      .filter((level) => level.enabled)
      .map((level, index) => ({
        id: `fib:${index}:${level.value}`,
        label: level.text?.trim() || `Fib ${level.value}`,
        price: fibLevelPrice(drawing, level.value, family),
      })),
  );
}

export function drawingAlertSnapshot(
  drawing: Drawing,
  target: DrawingAlertTarget,
  snapshotAt = Date.now(),
): DrawingAlertSnapshot {
  return {
    kind: "drawing",
    drawingId: drawing.id,
    drawingTool: drawing.tool,
    targetId: target.id,
    targetLabel: target.label,
    snapshotAt,
  };
}
