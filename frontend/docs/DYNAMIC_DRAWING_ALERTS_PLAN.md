# Dynamic Drawing Alerts Implementation Contract

_Date: 2026-07-12; implemented/hardened 2026-07-16_
_Status: implemented; immutable targets, open/push parity, server verification, re-arm revisions, and expiration landed_
_Scope: sloped lines, rays, extended lines, parallel channels, and Fib Channel projections_

## 1. Purpose

Phase 6.8 originally supported drawing-created alerts only when geometry
resolved to a fixed price. The 2026-07-16 follow-up delivered the time-indexed
target contract for sloped lines, channels, and Fib Channel levels, while
preserving fixed-price compatibility.

This document now records the shipped semantics and hardening gates. Dynamic
capabilities must continue to use the shared data-coordinate evaluator and the
versioned immutable target; viewport-derived or ad-hoc evaluators are not valid
extensions.

TradingView reference behavior:

- [Getting started with technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/)
- [Learn how to configure alerts](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/)

## 2. Implemented scope

First release:

| Tool | Geometry target | Active time domain |
| --- | --- | --- |
| Trendline | One sloped boundary | Between its two anchors |
| Info line | One sloped boundary | Between its two anchors |
| Trend angle | One sloped boundary | Between its two anchors |
| Ray | One sloped boundary | From anchor 1 through anchor 2 and onward |
| Extended line | One sloped boundary | All representable times |
| Parallel channel | Upper boundary, lower boundary, or channel region | Stored segment/ray/infinite domain |
| Fib Channel | Enabled dynamic level plus channel boundary/region operators | Baseline anchor interval or configured extension |

Possible later extensions include rotated rectangles and other tools that can
project deterministic time-varying boundaries. Vertical lines remain time-event
alerts and require a separate condition model; they are not part of this plan.

## 3. Product decisions

### 3.1 Immutable geometry snapshot

Creating an alert copies the drawing geometry into the alert. Later drawing
moves, edits, synchronization changes, or deletion do not change the armed
alert. This matches the fixed drawing-alert behavior already delivered in Phase
6.8 and makes trigger history reproducible.

If linked/live geometry is desired later, it must be a separate explicit mode
with revision conflict handling. It must not silently replace snapshot behavior.

### 3.2 Conditions

Line targets reuse the existing four conditions against a time-varying target:

- `above`: current price is at or above the current line value.
- `below`: current price is at or below the current line value.
- `crossUp`: signed distance changes from negative to zero/positive.
- `crossDown`: signed distance changes from positive to zero/negative.

Channel targets add explicit operators:

- crosses upper boundary up/down;
- crosses lower boundary up/down;
- enters channel;
- exits channel;
- inside channel;
- outside channel.

`Touch` is excluded from the first release because tick sampling and minimum-tick
tolerance must be defined first. A jump from below the lower boundary to above
the upper boundary may cross both boundaries, but it does not count as `enter`
when neither sampled observation is inside. The evaluator never invents an
intra-tick path.

### 3.3 Domain expiration

Finite segments and finite channels become inactive after their last anchor
time. They do not extrapolate invisibly. The UI must show the expiration time
before creation. When the domain ends, the backend marks the alert `expired`;
it must not leave a permanently active alert that can no longer trigger.

Rays follow their stored anchor direction. A ray pointing backward in time
expires once market time passes its origin. Extended lines do not expire from
geometry alone.

## 4. Canonical geometry contract

Evaluation operates in data coordinates, never canvas pixels. For anchors
`A=(t1,p1)` and `B=(t2,p2)`, a linear line target is:

```text
u(t) = (t - t1) / (t2 - t1)
target(t) = p1 + u(t) * (p2 - p1)
```

The domain policy decides whether `u` must be within `[0,1]`, at or beyond the
ray origin, or unrestricted. Equal anchor times are invalid for dynamic price
alerts.

For a parallel channel, the snapshot stores two complete data-coordinate
boundaries. It never persists a screen-space normal offset: screen pixels vary
with viewport and scale. `channelDataGeometry.ts` is the canonical source used
by both rendering and alert projection. It uses the baseline slope
`m=(p2-p1)/(t2-t1)` and a second line through the third anchor `(t3,p3)`:

```text
boundaryA(t) = p1 + m * (t - t1)
boundaryB(t) = p3 + m * (t - t3)
```

The renderer must first adopt this same canonical model, or creation must
perform an explicit geometry migration with a visual confirmation. Shipping an
alert whose data-space boundary differs from the visible pixel-space channel is
not allowed. After that prerequisite, normalize boundaries at each time:

```text
upper(t) = max(boundaryA(t), boundaryB(t))
lower(t) = min(boundaryA(t), boundaryB(t))
inside(t, price) = lower(t) <= price <= upper(t)
```

Legacy two-point channels use a historical pixel offset and therefore are
rejected as alert sources. A real third data-coordinate anchor is required.

### Scale prerequisite

The DTO and evaluator persist `interpolation: "linear" | "log"`; log mode
interpolates `log(price)` and requires positive anchors. Current channel and Fib
Channel projection is explicitly linear because it shares the renderer's
data-space model. Browser-only visual scale state never changes an already
armed alert.

### Time prerequisite

The target is evaluated at the candle/market epoch used by drawing anchor
times. `mt5AlertTicks.ts` normalizes broker/chart time separately from
`receivedAt`: receive time remains the replay ordering and freshness cursor,
while market time is the geometry coordinate and the persisted trigger-event
timestamp. Duplicate/out-of-order market timestamps are handled
deterministically without corrupting the receive cursor.

## 5. Alert data model

The implementation does not overload the legacy scalar `price`. It persists a
versioned target union:

```ts
type DynamicLineTarget = {
  version: 1;
  kind: "dynamic-line";
  a: { time: number; price: number };
  b: { time: number; price: number };
  domain: "segment" | "ray" | "infinite";
  interpolation: "linear" | "log";
};

type ChannelAlertOperator =
  | "cross-upper-up"
  | "cross-upper-down"
  | "cross-lower-up"
  | "cross-lower-down"
  | "enter"
  | "exit"
  | "inside"
  | "outside";

type TechnicalAlertTarget =
  | { version: 1; kind: "fixed-price"; price: number }
  | DynamicLineTarget
  | {
      version: 1;
      kind: "dynamic-channel";
      boundaryA: DynamicLineTarget;
      boundaryB: DynamicLineTarget;
      operator: ChannelAlertOperator;
    };
```

Persistence is delivered as follows:

1. Migration `0020_alert_technical_target` adds nullable `technical_target
   jsonb`; migration `0021_alert_expiration_and_arming_revision` adds the
   `expired` lifecycle state and positive `arming_revision`.
2. `price` remains populated for legacy/fixed alerts and migration
   compatibility.
3. Frontend ingestion and the Go boundary fail closed on unknown versions,
   fields, non-finite/non-positive coordinates, invalid domains/interpolation,
   mismatched channel times, non-parallel channel slopes, and unsupported
   operators.
4. Bootstrap, local persistence, push storage, and worker synchronization carry
   the immutable target and arming revision. Malformed dynamic payloads are
   rejected instead of degrading to a fixed alert.
5. `source` is provenance only; evaluation is self-contained and never reloads
   the drawing row.

Changing condition or geometry creates a new arming revision and clears the
previous signed-distance baseline. Note/channel-only notification edits do not.

## 6. Shared evaluator and verified trigger path

`dynamicAlertTargets.ts` provides pure functions with no chart or store
dependencies:

```ts
targetAt(target, marketTime):
  | { active: true; lower: number; upper: number }
  | { active: false; reason: "before-domain" | "expired" | "invalid" }

signedDistance(price, boundaryPrice): number
channelLocation(price, lower, upper): "below" | "inside" | "above"
```

For a line, crossing uses moving-boundary signed distance:

```text
previousDistance = previousPrice - target(previousTime)
currentDistance  = currentPrice  - target(currentTime)
crossUp   = previousDistance < 0 && currentDistance >= 0
crossDown = previousDistance > 0 && currentDistance <= 0
```

This is essential: comparing both observations with only the current target is
incorrect when the line moves materially between ticks.

`useAlertEngine.ts` and `pushAlertEvaluator.ts` both call this evaluator. A
successful result carries the exact evidence pair:

```ts
{
  previous?: { price, timestamp },
  current: { price, timestamp },
}
```

The trigger request also carries `armingRevision`. The Go API does not trust a
client-supplied trigger or target price: it reloads the persisted immutable
target, rejects stale revisions, normalizes and validates the previous/current
evidence, recomputes the geometry and condition, and timestamps the event from
the current market observation. Dynamic crossing conditions require previous
evidence; malformed, time-travelling, non-triggering, or mismatched claims fail
closed.

## 7. UI contract

- Dynamic-capable manifests use `dynamicAlertProjection`, distinct from fixed
  `alertProjection`, with `dynamic-line`, `dynamic-channel`, and
  `dynamic-fib-channel` values.
- The drawing dialog shows the tool, selectable projected target/operator,
  current projected value, condition where applicable, and immutable snapshot
  behavior.
- Alert Center shows `Dynamic line` or `Channel` plus the current evaluated
  target/range. The creation-time preview price is not presented as the fixed
  trigger price.
- Drawing edits/deletion never mutate the frozen geometry. Condition/geometry
  changes re-arm with a new revision, while note/channel-only notification
  changes retain the current baseline.
- Expired alerts have their own bootstrapped/status collection, remain visible
  in Alert Center, and can be reset/recreated; they are not silently deleted.

## 8. Delivered implementation

1. Market time is normalized independently from receive-order/freshness time.
2. Pure dynamic-line/channel target, signed-distance, domain, and replay
   evaluators are shared by the open and closed-browser paths.
3. Versioned target DTOs, strict frontend/Go sanitizers, migrations `0020` and
   `0021`, bootstrap, API mapping, and push persistence are in place.
4. Trendline, Info Line, Trend Angle, Ray, Extended Line, Parallel Channel, and
   Fib Channel expose manifest-owned targets.
5. Channel rendering and alert snapshots share canonical data-space boundaries;
   legacy two-point channels and non-parallel/mismatched boundary payloads are
   rejected.
6. Finite domains transition to `expired` in both open and push evaluation.
   Push reconciliation checks the arming revision before moving an alert, and
   workspace bootstrap carries `expiredAlerts`.
7. Triggering is evidence-backed and revalidated in Go before persistence or
   notification delivery.

## 9. Executable test gates

The regression suites cover, without relying on source-text assertions:

- horizontal dynamic-line/fixed-price equivalence; rising/falling moving
  boundaries; segment/ray/infinite domains; backward-ray expiration; and
  linear/log interpolation;
- sparse, equal, duplicate, decreasing, and cross-poll replay timestamps, plus
  price gaps and channel jumps that must not invent an intratick path;
- channel normalization, all boundary/inside/outside operators, renderer/alert
  geometry identity, Fib Channel levels, and malformed/legacy target rejection;
- immutable target/API/push-store round trips, normalized previous/current
  evidence, expiration lifecycle state, and arming-revision matching;
- Go boundary validation, stale-revision rejection, server recomputation of
  fixed/dynamic/channel triggers, evidence-time event timestamps, expiration
  listing, and repository integration.

The manifest-derived browser matrix supplements these semantic gates with
reviewed drawing paint baselines. It does not replace evaluator/API tests, and
this document does not claim a final aggregate test count.

## 10. Non-goals for the first release

- Indicator/strategy series as moving boundaries.
- Alerts that follow live drawing edits automatically.
- Intrabar path reconstruction from OHLC.
- Touch tolerance without symbol tick-size metadata.
- Vertical/time alerts or multi-symbol conditions.
- Dynamic geometry based on viewport pixels or current zoom.
