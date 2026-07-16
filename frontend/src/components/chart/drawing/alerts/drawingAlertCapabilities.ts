import type {
  ChannelAlertOperator,
  Drawing,
  DynamicLineDomain,
  DynamicLineTarget,
  Point,
  TechnicalAlertTarget,
} from "../../../../types";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import { targetAt } from "../../../../services/dynamicAlertTargets";
import {
  fibLevelPrice,
  resolvedFibLevels,
} from "../tools/plugins/fibGeometry";
import { channelDataLine } from "../tools/plugins/channelDataGeometry";

export interface DrawingAlertTarget {
  id: string;
  label: string;
  price: number;
  technicalTarget?: TechnicalAlertTarget;
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

function fixedTarget(id: string, label: string, price: number): DrawingAlertTarget {
  return {
    id,
    label,
    price,
    technicalTarget: { version: 1, kind: "fixed-price", price },
  };
}

function lineTarget(
  a: Point,
  b: Point,
  domain: DynamicLineDomain,
  interpolation: DynamicLineTarget["interpolation"] = "linear",
): DynamicLineTarget {
  return {
    version: 1,
    kind: "dynamic-line",
    a: { time: a.time, price: a.price },
    b: { time: b.time, price: b.price },
    domain,
    interpolation,
  };
}

function extendedDomain(drawing: Drawing): DynamicLineDomain {
  return drawing.extend === "both"
    ? "infinite"
    : drawing.extend === "left" || drawing.extend === "right"
      ? "ray"
      : "segment";
}

function orientedChannelLine(
  drawing: Drawing,
  ratio: number,
): DynamicLineTarget | undefined {
  const projected = channelDataLine(drawing, ratio);
  if (!projected) return undefined;
  const { a, b } = projected;
  if (![a.price, b.price].every(finitePrice)) return undefined;
  const domain = extendedDomain(drawing);
  return drawing.extend === "left"
    ? lineTarget(b, a, domain, "linear")
    : lineTarget(a, b, domain, "linear");
}

function previewTarget(
  id: string,
  label: string,
  target: TechnicalAlertTarget,
  marketTime: number,
): DrawingAlertTarget | undefined {
  const projected = targetAt(target, marketTime);
  if (!projected.active) return undefined;
  let price = projected.lower;
  if (target.kind === "dynamic-channel") {
    price = target.operator.includes("upper")
      ? projected.upper
      : target.operator.includes("lower")
        ? projected.lower
        : (projected.lower + projected.upper) / 2;
  }
  return finitePrice(price)
    ? { id, label, price, technicalTarget: target }
    : undefined;
}

function dynamicLineTargets(drawing: Drawing, marketTime: number): DrawingAlertTarget[] {
  const [a, b] = drawing.points;
  if (!a || !b || a.time === b.time) return [];
  const domain: DynamicLineDomain = drawing.tool === "extendedLine"
    ? "infinite"
    : drawing.tool === "ray"
      ? "ray"
      : "segment";
  const target = lineTarget(a, b, domain);
  const candidate = previewTarget(
    "dynamic:line",
    domain === "infinite" ? "Dynamic infinite line" : domain === "ray" ? "Dynamic ray" : "Dynamic segment",
    target,
    marketTime,
  );
  return candidate ? [candidate] : [];
}

const CHANNEL_OPERATOR_LABELS: ReadonlyArray<[ChannelAlertOperator, string]> = [
  ["cross-upper-up", "Cross upper boundary up"],
  ["cross-upper-down", "Cross upper boundary down"],
  ["cross-lower-up", "Cross lower boundary up"],
  ["cross-lower-down", "Cross lower boundary down"],
  ["enter", "Enter channel"],
  ["exit", "Exit channel"],
  ["inside", "Price inside channel"],
  ["outside", "Price outside channel"],
];

function dynamicChannelTargets(
  drawing: Drawing,
  marketTime: number,
  includeFibLevels: boolean,
): DrawingAlertTarget[] {
  const boundaryA = orientedChannelLine(drawing, 0);
  const boundaryB = orientedChannelLine(drawing, 1);
  if (!boundaryA || !boundaryB) return [];
  const targets: DrawingAlertTarget[] = [];
  for (const [operator, label] of CHANNEL_OPERATOR_LABELS) {
    const target: TechnicalAlertTarget = {
      version: 1,
      kind: "dynamic-channel",
      boundaryA,
      boundaryB,
      operator,
    };
    const candidate = previewTarget(`dynamic:channel:${operator}`, label, target, marketTime);
    if (candidate) targets.push(candidate);
  }
  if (includeFibLevels) {
    resolvedFibLevels(drawing, "retracement")
      .filter((level) => level.enabled)
      .forEach((level, index) => {
        const target = orientedChannelLine(drawing, level.value);
        if (!target) return;
        const candidate = previewTarget(
          `dynamic:fib-channel:${index}:${level.value}`,
          level.text?.trim() || `Fib channel ${level.value}`,
          target,
          marketTime,
        );
        if (candidate) targets.push(candidate);
      });
  }
  return targets;
}

export function drawingAlertTargets(
  drawing: Drawing,
  marketTime = Date.now(),
): DrawingAlertTarget[] {
  const manifest = getDrawingToolManifestEntry(drawing.tool);
  const dynamicTargets = manifest.dynamicAlertProjection === "dynamic-line"
    ? dynamicLineTargets(drawing, marketTime)
    : manifest.dynamicAlertProjection === "dynamic-channel"
      ? dynamicChannelTargets(drawing, marketTime, false)
      : manifest.dynamicAlertProjection === "dynamic-fib-channel"
        ? dynamicChannelTargets(drawing, marketTime, true)
        : [];
  const projection = manifest.alertProjection;
  if (!projection) return uniqueTargets(dynamicTargets);
  if (projection === "point-price") {
    return finitePrice(drawing.points[0]?.price)
      ? [...dynamicTargets, fixedTarget("point:0", "Price level", drawing.points[0].price)]
      : [];
  }
  if (projection === "range-boundaries") {
    const prices = drawing.points.slice(0, 2).map((point) => point.price).filter(finitePrice);
    if (prices.length < 2) return [];
    return uniqueTargets([...dynamicTargets,
      fixedTarget("range:upper", "Upper boundary", Math.max(...prices)),
      fixedTarget("range:lower", "Lower boundary", Math.min(...prices)),
    ]);
  }
  if (projection === "position-levels") {
    const raw = [
      ["position:entry", "Entry", drawing.points[0]?.price],
      ["position:target", "Target", drawing.target ?? drawing.points[1]?.price],
      ["position:stop", "Stop", drawing.stop ?? drawing.points[2]?.price],
    ] as const;
    return uniqueTargets([
      ...dynamicTargets,
      ...raw.flatMap(([id, label, price]) => finitePrice(price) ? [fixedTarget(id, label, price)] : []),
    ]);
  }
  const family = projection === "fib-extension-levels" ? "extension" : "retracement";
  if (drawing.points.length < 2) return [];
  return uniqueTargets([
    ...dynamicTargets,
    ...resolvedFibLevels(drawing, family)
      .filter((level) => level.enabled)
      .map((level, index) => ({
        id: `fib:${index}:${level.value}`,
        label: level.text?.trim() || `Fib ${level.value}`,
        price: fibLevelPrice(drawing, level.value, family),
        technicalTarget: {
          version: 1,
          kind: "fixed-price",
          price: fibLevelPrice(drawing, level.value, family),
        } as const,
      })),
  ]);
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
