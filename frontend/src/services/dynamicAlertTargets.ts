import type { PriceAlertCondition } from "./alertConditions";
import type {
  ChannelAlertOperator,
  DynamicChannelTarget,
  DynamicLineDomain,
  DynamicLineInterpolation,
  DynamicLineTarget,
  TechnicalAlertEvidence,
  TechnicalAlertEvidencePoint,
  TechnicalAlertPoint,
  TechnicalAlertTarget,
} from "../types/technicalAlerts";

export type InactiveTechnicalTargetReason =
  | "before-domain"
  | "expired"
  | "invalid";

export type TechnicalTargetAt =
  | { active: true; lower: number; upper: number }
  | { active: false; reason: InactiveTechnicalTargetReason };

export interface TechnicalPricePoint {
  price: number;
  /** UTC epoch milliseconds or seconds. Both feeds are normalized here. */
  timestamp: number;
}

export interface TechnicalAlertMatch {
  point: TechnicalPricePoint;
  targetPrice: number;
  evidence: TechnicalAlertEvidence;
}

export interface TechnicalAlertEvaluation {
  triggered: boolean;
  targetPrice?: number;
  active: boolean;
  inactiveReason?: InactiveTechnicalTargetReason;
  evidence?: TechnicalAlertEvidence;
}

const DOMAINS = new Set<DynamicLineDomain>(["segment", "ray", "infinite"]);
const INTERPOLATIONS = new Set<DynamicLineInterpolation>(["linear", "log"]);
const CHANNEL_OPERATORS = new Set<ChannelAlertOperator>([
  "cross-upper-up",
  "cross-upper-down",
  "cross-lower-up",
  "cross-lower-down",
  "enter",
  "exit",
  "inside",
  "outside",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeEpochSeconds(value: number): number {
  return value >= 100_000_000_000 ? value / 1000 : value;
}

function sanitizeEvidencePoint(value: unknown): TechnicalAlertEvidencePoint | undefined {
  if (!isRecord(value) || !finitePositive(value.price) || !finitePositive(value.timestamp)) {
    return undefined;
  }
  return { price: value.price, timestamp: normalizeEpochSeconds(value.timestamp) };
}

/** Fail-closed evidence sanitizer used for push reconciliation and API payloads. */
export function sanitizeTechnicalAlertEvidence(
  value: unknown,
): TechnicalAlertEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const current = sanitizeEvidencePoint(value.current);
  if (!current) return undefined;
  const previous = value.previous === undefined
    ? undefined
    : sanitizeEvidencePoint(value.previous);
  if (value.previous !== undefined && !previous) return undefined;
  if (previous && previous.timestamp > current.timestamp) return undefined;
  return { ...(previous ? { previous } : {}), current };
}

function evidenceFor(
  previous: TechnicalPricePoint | undefined,
  current: TechnicalPricePoint,
): TechnicalAlertEvidence {
  return {
    ...(previous
      ? { previous: { price: previous.price, timestamp: normalizeEpochSeconds(previous.timestamp) } }
      : {}),
    current: { price: current.price, timestamp: normalizeEpochSeconds(current.timestamp) },
  };
}

function sanitizePoint(value: unknown): TechnicalAlertPoint | undefined {
  if (!isRecord(value) || !finitePositive(value.time) || !finitePositive(value.price)) {
    return undefined;
  }
  return { time: normalizeEpochSeconds(value.time), price: value.price };
}

function sanitizeDynamicLine(value: unknown): DynamicLineTarget | undefined {
  if (!isRecord(value) || value.version !== 1 || value.kind !== "dynamic-line") {
    return undefined;
  }
  const a = sanitizePoint(value.a);
  const b = sanitizePoint(value.b);
  if (
    !a ||
    !b ||
    a.time === b.time ||
    typeof value.domain !== "string" ||
    !DOMAINS.has(value.domain as DynamicLineDomain) ||
    typeof value.interpolation !== "string" ||
    !INTERPOLATIONS.has(value.interpolation as DynamicLineInterpolation)
  ) {
    return undefined;
  }
  return {
    version: 1,
    kind: "dynamic-line",
    a,
    b,
    domain: value.domain as DynamicLineDomain,
    interpolation: value.interpolation as DynamicLineInterpolation,
  };
}

function channelBoundariesAreParallel(
  boundaryA: DynamicLineTarget,
  boundaryB: DynamicLineTarget,
): boolean {
  if (
    boundaryA.a.time !== boundaryB.a.time ||
    boundaryA.b.time !== boundaryB.b.time
  ) return false;
  const value = (price: number) => boundaryA.interpolation === "log"
    ? Math.log(price)
    : price;
  const aSlope = (value(boundaryA.b.price) - value(boundaryA.a.price)) /
    (boundaryA.b.time - boundaryA.a.time);
  const bSlope = (value(boundaryB.b.price) - value(boundaryB.a.price)) /
    (boundaryB.b.time - boundaryB.a.time);
  const scale = Math.max(1, Math.abs(aSlope), Math.abs(bSlope));
  return Number.isFinite(aSlope) && Number.isFinite(bSlope) &&
    Math.abs(aSlope - bSlope) <= Number.EPSILON * 64 * scale;
}

/** Boundary sanitizer used at local storage, push-sync, and API trust boundaries. */
export function sanitizeTechnicalAlertTarget(
  value: unknown,
): TechnicalAlertTarget | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== "string") {
    return undefined;
  }
  if (value.kind === "fixed-price") {
    return finitePositive(value.price)
      ? { version: 1, kind: "fixed-price", price: value.price }
      : undefined;
  }
  if (value.kind === "dynamic-line") return sanitizeDynamicLine(value);
  if (value.kind !== "dynamic-channel") return undefined;
  const boundaryA = sanitizeDynamicLine(value.boundaryA);
  const boundaryB = sanitizeDynamicLine(value.boundaryB);
  if (
    !boundaryA ||
    !boundaryB ||
    boundaryA.domain !== boundaryB.domain ||
    boundaryA.interpolation !== boundaryB.interpolation ||
    !channelBoundariesAreParallel(boundaryA, boundaryB) ||
    typeof value.operator !== "string" ||
    !CHANNEL_OPERATORS.has(value.operator as ChannelAlertOperator)
  ) {
    return undefined;
  }
  return {
    version: 1,
    kind: "dynamic-channel",
    boundaryA,
    boundaryB,
    operator: value.operator as ChannelAlertOperator,
  };
}

function lineTargetAt(
  target: DynamicLineTarget,
  marketTime: number,
): TechnicalTargetAt {
  const time = normalizeEpochSeconds(marketTime);
  const start = target.a.time;
  const end = target.b.time;
  if (![time, start, end, target.a.price, target.b.price].every(Number.isFinite) || start === end) {
    return { active: false, reason: "invalid" };
  }

  const direction = Math.sign(end - start);
  if (target.domain === "segment") {
    if (time < Math.min(start, end)) return { active: false, reason: "before-domain" };
    if (time > Math.max(start, end)) return { active: false, reason: "expired" };
  } else if (target.domain === "ray" && (time - start) * direction < 0) {
    // A forward ray has not started yet; a backward ray has already passed its
    // origin. Keeping those reasons distinct is required by expiration logic.
    return {
      active: false,
      reason: direction > 0 ? "before-domain" : "expired",
    };
  }

  const ratio = (time - start) / (end - start);
  const price = target.interpolation === "log"
    ? Math.exp(Math.log(target.a.price) + (Math.log(target.b.price) - Math.log(target.a.price)) * ratio)
    : target.a.price + (target.b.price - target.a.price) * ratio;
  return Number.isFinite(price) && price > 0
    ? { active: true, lower: price, upper: price }
    : { active: false, reason: "invalid" };
}

export function targetAt(
  target: TechnicalAlertTarget,
  marketTime: number,
): TechnicalTargetAt {
  if (target.kind === "fixed-price") {
    return finitePositive(target.price)
      ? { active: true, lower: target.price, upper: target.price }
      : { active: false, reason: "invalid" };
  }
  if (target.kind === "dynamic-line") return lineTargetAt(target, marketTime);
  const a = lineTargetAt(target.boundaryA, marketTime);
  const b = lineTargetAt(target.boundaryB, marketTime);
  if (!a.active) return a;
  if (!b.active) return b;
  return {
    active: true,
    lower: Math.min(a.lower, b.lower),
    upper: Math.max(a.upper, b.upper),
  };
}

export function signedDistance(price: number, boundaryPrice: number): number {
  return price - boundaryPrice;
}

export function channelLocation(
  price: number,
  lower: number,
  upper: number,
): "below" | "inside" | "above" {
  if (price < lower) return "below";
  if (price > upper) return "above";
  return "inside";
}

function boundaryForChannel(
  target: DynamicChannelTarget,
  range: Extract<TechnicalTargetAt, { active: true }>,
  price: number,
): number {
  if (target.operator.includes("upper")) return range.upper;
  if (target.operator.includes("lower")) return range.lower;
  return Math.abs(price - range.lower) <= Math.abs(price - range.upper)
    ? range.lower
    : range.upper;
}

export function evaluateTechnicalAlert(
  condition: PriceAlertCondition,
  target: TechnicalAlertTarget,
  previous: TechnicalPricePoint | undefined,
  current: TechnicalPricePoint,
): TechnicalAlertEvaluation {
  if (!finitePositive(current.price) || !finitePositive(current.timestamp)) {
    return { triggered: false, active: false, inactiveReason: "invalid" };
  }
  const currentTarget = targetAt(target, current.timestamp);
  if (!currentTarget.active) {
    return {
      triggered: false,
      active: false,
      inactiveReason: currentTarget.reason,
    };
  }

  const evidence = evidenceFor(previous, current);

  if (target.kind !== "dynamic-channel") {
    const targetPrice = currentTarget.lower;
    if (condition === "above") {
      const triggered = current.price >= targetPrice;
      return { triggered, targetPrice, active: true, ...(triggered ? { evidence } : {}) };
    }
    if (condition === "below") {
      const triggered = current.price <= targetPrice;
      return { triggered, targetPrice, active: true, ...(triggered ? { evidence } : {}) };
    }
    if (!previous) return { triggered: false, targetPrice, active: true };
    const previousTarget = targetAt(target, previous.timestamp);
    if (!previousTarget.active) return { triggered: false, targetPrice, active: true };
    const previousDistance = signedDistance(previous.price, previousTarget.lower);
    const currentDistance = signedDistance(current.price, targetPrice);
    const triggered = condition === "crossUp"
      ? previousDistance < 0 && currentDistance >= 0
      : previousDistance > 0 && currentDistance <= 0;
    return {
      triggered,
      targetPrice,
      active: true,
      ...(triggered ? { evidence } : {}),
    };
  }

  const targetPrice = boundaryForChannel(target, currentTarget, current.price);
  const currentLocation = channelLocation(
    current.price,
    currentTarget.lower,
    currentTarget.upper,
  );
  if (target.operator === "inside") {
    const triggered = currentLocation === "inside";
    return { triggered, targetPrice, active: true, ...(triggered ? { evidence } : {}) };
  }
  if (target.operator === "outside") {
    const triggered = currentLocation !== "inside";
    return { triggered, targetPrice, active: true, ...(triggered ? { evidence } : {}) };
  }
  if (!previous) return { triggered: false, targetPrice, active: true };
  const previousTarget = targetAt(target, previous.timestamp);
  if (!previousTarget.active) return { triggered: false, targetPrice, active: true };
  const previousLocation = channelLocation(
    previous.price,
    previousTarget.lower,
    previousTarget.upper,
  );
  if (target.operator === "enter" || target.operator === "exit") {
    const triggered = target.operator === "enter"
      ? previousLocation !== "inside" && currentLocation === "inside"
      : previousLocation === "inside" && currentLocation !== "inside";
    return {
      triggered,
      targetPrice,
      active: true,
      ...(triggered ? { evidence } : {}),
    };
  }
  const upper = target.operator.includes("upper");
  const boundaryBefore = upper ? previousTarget.upper : previousTarget.lower;
  const boundaryNow = upper ? currentTarget.upper : currentTarget.lower;
  const before = signedDistance(previous.price, boundaryBefore);
  const now = signedDistance(current.price, boundaryNow);
  const triggered = target.operator.endsWith("-up")
      ? before < 0 && now >= 0
      : before > 0 && now <= 0;
  return {
    triggered,
    targetPrice: boundaryNow,
    active: true,
    ...(triggered ? { evidence } : {}),
  };
}

export function findTechnicalAlertTrigger(
  condition: PriceAlertCondition,
  target: TechnicalAlertTarget,
  previous: TechnicalPricePoint | undefined,
  points: TechnicalPricePoint[],
): TechnicalAlertMatch | undefined {
  let before = previous;
  for (const point of orderedTechnicalPricePoints(previous?.timestamp, points)) {
    const result = evaluateTechnicalAlert(condition, target, before, point);
    if (result.triggered && result.targetPrice !== undefined) {
      return {
        point,
        targetPrice: result.targetPrice,
        evidence: result.evidence ?? evidenceFor(before, point),
      };
    }
    before = point;
  }
  return undefined;
}

/**
 * Match the realtime MT5 provider: retain receive order, accept duplicate
 * market epochs, and discard only decreasing broker/chart timestamps.
 */
export function orderedTechnicalPricePoints<T extends TechnicalPricePoint>(
  previousTimestamp: number | undefined,
  points: readonly T[],
): T[] {
  let beforeTime = previousTimestamp !== undefined && finitePositive(previousTimestamp)
    ? normalizeEpochSeconds(previousTimestamp)
    : undefined;
  const ordered: T[] = [];
  for (const point of points) {
    if (!finitePositive(point.price) || !finitePositive(point.timestamp)) continue;
    const pointTime = normalizeEpochSeconds(point.timestamp);
    if (beforeTime !== undefined && pointTime < beforeTime) continue;
    ordered.push(point);
    beforeTime = pointTime;
  }
  return ordered;
}

/** Stable arming key: geometry changes reset the signed-distance baseline. */
export function technicalTargetSignature(target: TechnicalAlertTarget | undefined): string {
  if (!target) return "legacy-fixed";
  return JSON.stringify(target);
}
