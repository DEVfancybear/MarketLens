import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing, DynamicChannelTarget, DynamicLineTarget } from "../../src/types";
import {
  channelLocation,
  evaluateTechnicalAlert,
  findTechnicalAlertTrigger,
  orderedTechnicalPricePoints,
  sanitizeTechnicalAlertTarget,
  signedDistance,
  targetAt,
} from "../../src/services/dynamicAlertTargets";
import { drawingAlertTargets } from "../../src/components/chart/drawing/alerts/drawingAlertCapabilities";

const line: DynamicLineTarget = {
  version: 1,
  kind: "dynamic-line",
  a: { time: 100, price: 100 },
  b: { time: 200, price: 200 },
  domain: "segment",
  interpolation: "linear",
};

test("dynamic lines honor segment/ray/infinite domains and interpolation", () => {
  assert.deepEqual(targetAt(line, 150), { active: true, lower: 150, upper: 150 });
  assert.equal(targetAt(line, 99).active, false);
  assert.equal(targetAt(line, 201).active, false);

  const ray: DynamicLineTarget = { ...line, domain: "ray" };
  assert.equal(targetAt(ray, 99).active, false);
  assert.deepEqual(targetAt(ray, 250), { active: true, lower: 250, upper: 250 });

  const log: DynamicLineTarget = {
    ...line,
    domain: "infinite",
    interpolation: "log",
    a: { time: 100, price: 100 },
    b: { time: 200, price: 400 },
  };
  const midpoint = targetAt(log, 150);
  assert.ok(midpoint.active);
  assert.ok(Math.abs(midpoint.lower - 200) < 1e-9);
});

test("horizontal dynamic-line evaluation is identical to fixed-price evaluation", () => {
  const horizontal: DynamicLineTarget = {
    ...line,
    domain: "infinite",
    a: { time: 100, price: 120 },
    b: { time: 200, price: 120 },
  };
  const fixed = { version: 1, kind: "fixed-price", price: 120 } as const;
  const cases = [
    { condition: "above" as const, previous: 119, current: 120 },
    { condition: "below" as const, previous: 121, current: 120 },
    { condition: "crossUp" as const, previous: 119, current: 120 },
    { condition: "crossDown" as const, previous: 121, current: 120 },
  ];
  for (const fixture of cases) {
    const previous = { timestamp: 150, price: fixture.previous };
    const current = { timestamp: 160, price: fixture.current };
    assert.deepEqual(
      evaluateTechnicalAlert(fixture.condition, horizontal, previous, current),
      evaluateTechnicalAlert(fixture.condition, fixed, previous, current),
    );
  }
});

test("backward rays report expiration after their origin", () => {
  const backward: DynamicLineTarget = {
    ...line,
    domain: "ray",
    a: { time: 200, price: 200 },
    b: { time: 100, price: 100 },
  };
  assert.deepEqual(targetAt(backward, 150), { active: true, lower: 150, upper: 150 });
  assert.deepEqual(targetAt(backward, 201), { active: false, reason: "expired" });
});

test("crossing uses signed distance to the moving boundary", () => {
  const target: DynamicLineTarget = { ...line, domain: "infinite" };
  const crossed = evaluateTechnicalAlert(
    "crossDown",
    target,
    { timestamp: 150, price: 160 },
    { timestamp: 160, price: 155 },
  );
  assert.equal(signedDistance(160, 150), 10);
  assert.equal(signedDistance(155, 160), -5);
  assert.equal(crossed.triggered, true);
  assert.equal(crossed.targetPrice, 160);
});

test("channel enter/exit and boundary crossings share one evaluator", () => {
  const lower: DynamicLineTarget = {
    ...line,
    domain: "infinite",
    a: { time: 100, price: 100 },
    b: { time: 200, price: 110 },
  };
  const upper: DynamicLineTarget = {
    ...lower,
    a: { time: 100, price: 120 },
    b: { time: 200, price: 130 },
  };
  const target: DynamicChannelTarget = {
    version: 1,
    kind: "dynamic-channel",
    boundaryA: lower,
    boundaryB: upper,
    operator: "enter",
  };
  assert.equal(channelLocation(105, 101, 121), "inside");
  assert.equal(
    evaluateTechnicalAlert(
      "crossUp",
      target,
      { timestamp: 100, price: 90 },
      { timestamp: 110, price: 110 },
    ).triggered,
    true,
  );
  assert.equal(
    evaluateTechnicalAlert(
      "crossUp",
      { ...target, operator: "exit" },
      { timestamp: 110, price: 110 },
      { timestamp: 120, price: 140 },
    ).triggered,
    true,
  );
});

test("tick replay normalizes milliseconds and returns evaluated target evidence", () => {
  const target: DynamicLineTarget = {
    ...line,
    domain: "infinite",
    a: { time: 1_700_000_100, price: 100 },
    b: { time: 1_700_000_200, price: 200 },
  };
  const match = findTechnicalAlertTrigger(
    "crossUp",
    target,
    { timestamp: 1_700_000_150_000, price: 145 },
    [
      { timestamp: 1_700_000_155_000, price: 154 },
      { timestamp: 1_700_000_160_000, price: 165 },
    ],
  );
  assert.equal(match?.point.timestamp, 1_700_000_160_000);
  assert.equal(match?.targetPrice, 160);
});

test("tick replay handles sparse, equality, duplicate, and out-of-order samples deterministically", () => {
  const horizontal: DynamicLineTarget = {
    ...line,
    domain: "infinite",
    a: { time: 100, price: 100 },
    b: { time: 200, price: 100 },
  };

  const sparse = findTechnicalAlertTrigger(
    "crossUp",
    horizontal,
    { timestamp: 100, price: 90 },
    [{ timestamp: 1_000, price: 110 }],
  );
  assert.equal(sparse?.point.timestamp, 1_000);

  const equality = findTechnicalAlertTrigger(
    "crossUp",
    horizontal,
    { timestamp: 100, price: 90 },
    [{ timestamp: 110, price: 100 }],
  );
  assert.equal(equality?.point.price, 100);

  const duplicateTimestamp = findTechnicalAlertTrigger(
    "crossUp",
    horizontal,
    { timestamp: 100, price: 90 },
    [
      { timestamp: 110, price: 95 },
      { timestamp: 110, price: 105 },
    ],
  );
  assert.equal(duplicateTimestamp?.point.price, 105);

  const outOfOrder = findTechnicalAlertTrigger(
    "crossUp",
    horizontal,
    { timestamp: 100, price: 90 },
    [
      { timestamp: 120, price: 95 },
      { timestamp: 110, price: 105 },
      { timestamp: 130, price: 95 },
    ],
  );
  assert.equal(outOfOrder, undefined);
});

test("market-time ordering preserves the accepted baseline across polling cycles", () => {
  const firstPoll = orderedTechnicalPricePoints(undefined, [
    { timestamp: 200, price: 120 },
    { timestamp: 100, price: 110 },
  ]);
  assert.deepEqual(firstPoll, [{ timestamp: 200, price: 120 }]);
  const secondPoll = orderedTechnicalPricePoints(firstPoll[0].timestamp, [
    { timestamp: 100, price: 110 },
    { timestamp: 210, price: 121 },
  ]);
  assert.deepEqual(secondPoll, [{ timestamp: 210, price: 121 }]);
});

test("channel jumps never invent enter or exit paths", () => {
  const lower: DynamicLineTarget = {
    ...line,
    domain: "infinite",
    a: { time: 100, price: 100 },
    b: { time: 200, price: 100 },
  };
  const upper: DynamicLineTarget = {
    ...lower,
    a: { time: 100, price: 120 },
    b: { time: 200, price: 120 },
  };
  const previous = { timestamp: 150, price: 90 };
  const current = { timestamp: 160, price: 130 };
  const triggered = (operator: DynamicChannelTarget["operator"], swapped = false) =>
    evaluateTechnicalAlert(
      "crossUp",
      {
        version: 1,
        kind: "dynamic-channel",
        boundaryA: swapped ? upper : lower,
        boundaryB: swapped ? lower : upper,
        operator,
      },
      previous,
      current,
    ).triggered;

  assert.equal(triggered("enter"), false);
  assert.equal(triggered("exit"), false);
  assert.equal(triggered("inside"), false);
  assert.equal(triggered("outside"), true);
  assert.equal(triggered("cross-lower-up"), true);
  assert.equal(triggered("cross-upper-up"), true);
  assert.equal(triggered("cross-lower-down"), false);
  assert.equal(triggered("cross-upper-down"), false);
  assert.equal(triggered("cross-upper-up", true), true);
});

test("technical target sanitizer rejects malformed and ambiguous geometry", () => {
  assert.deepEqual(sanitizeTechnicalAlertTarget(line), line);
  assert.equal(sanitizeTechnicalAlertTarget({ ...line, b: line.a }), undefined);
  assert.equal(sanitizeTechnicalAlertTarget({ ...line, interpolation: "screen" }), undefined);
  assert.equal(sanitizeTechnicalAlertTarget({ version: 2, kind: "fixed-price", price: 1 }), undefined);

  const channel: DynamicChannelTarget = {
    version: 1,
    kind: "dynamic-channel",
    boundaryA: line,
    boundaryB: { ...line },
    operator: "inside",
  };
  assert.equal(
    sanitizeTechnicalAlertTarget({
      ...channel,
      boundaryB: { ...channel.boundaryB, domain: "ray" },
    }),
    undefined,
  );
  assert.equal(
    sanitizeTechnicalAlertTarget({
      ...channel,
      boundaryB: { ...channel.boundaryB, interpolation: "log" },
    }),
    undefined,
  );
  assert.equal(
    sanitizeTechnicalAlertTarget({
      ...channel,
      boundaryB: {
        ...channel.boundaryB,
        b: { ...channel.boundaryB.b, price: channel.boundaryB.b.price + 1 },
      },
    }),
    undefined,
  );
});

function drawing(tool: Drawing["tool"], points: Drawing["points"]): Drawing {
  return { id: `dynamic-${tool}`, tool, color: "#2962ff", lineWidth: 1.5, points };
}

test("manifest capabilities project frozen line, channel, and Fib-channel targets", () => {
  const trend = drawing("trendline", [
    { time: 100, price: 100 },
    { time: 200, price: 200 },
  ]);
  const trendTargets = drawingAlertTargets(trend, 150);
  assert.equal(trendTargets.length, 1);
  assert.equal(trendTargets[0].technicalTarget?.kind, "dynamic-line");
  assert.equal(trendTargets[0].price, 150);

  for (const tool of ["infoLine", "trendAngle"] as const) {
    const targets = drawingAlertTargets({ ...trend, id: `dynamic-${tool}`, tool }, 150);
    assert.equal(targets[0]?.technicalTarget?.kind, "dynamic-line");
    assert.equal(targets[0]?.price, 150);
  }

  const channel = drawing("channel", [
    { time: 100, price: 100 },
    { time: 200, price: 110 },
    { time: 100, price: 120 },
  ]);
  const channelTargets = drawingAlertTargets(channel, 150);
  assert.equal(channelTargets.length, 8);
  assert.ok(channelTargets.every((target) => target.technicalTarget?.kind === "dynamic-channel"));

  const fibChannel = { ...channel, id: "dynamic-fib", tool: "fibChannel" as const };
  const fibTargets = drawingAlertTargets(fibChannel, 150);
  assert.ok(fibTargets.some((target) => target.id.startsWith("dynamic:fib-channel:")));
  assert.ok(fibTargets.some((target) => target.technicalTarget?.kind === "dynamic-channel"));
});

test("channel renderer and alert snapshot share canonical data-space boundaries", () => {
  const channel = drawing("channel", [
    { time: 100, price: 100 },
    { time: 200, price: 110 },
    { time: 150, price: 130 },
  ]);
  const targets = drawingAlertTargets(channel, 175);
  const technical = targets.find((target) => target.id === "dynamic:channel:inside")
    ?.technicalTarget;
  assert.equal(technical?.kind, "dynamic-channel");
  if (technical?.kind !== "dynamic-channel") return;
  assert.deepEqual(technical.boundaryA, {
    version: 1,
    kind: "dynamic-line",
    a: { time: 100, price: 100 },
    b: { time: 200, price: 110 },
    domain: "segment",
    interpolation: "linear",
  });
  assert.deepEqual(technical.boundaryB.a, { time: 100, price: 125 });
  assert.deepEqual(technical.boundaryB.b, { time: 200, price: 135 });
});
