# Dynamic Drawing Alerts Plan

_Date: 2026-07-12_  
_Status: deferred design; not implemented_  
_Scope: sloped lines, rays, extended lines, and parallel channels_

## 1. Purpose

Phase 6.8 supports drawing-created alerts only when geometry resolves to a fixed
price. Sloped lines and channels are deliberately excluded because their target
price changes with time and must produce the same result in the open browser and
the closed-browser evaluator.

This document freezes the intended semantics and implementation gates for that
future work. Do not add `alertProjection` to a dynamic tool until the shared
time/geometry evaluator described here exists.

TradingView reference behavior:

- [Getting started with technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/)
- [Learn how to configure alerts](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/)

## 2. Proposed scope

First release:

| Tool | Geometry target | Active time domain |
| --- | --- | --- |
| Trendline | One sloped boundary | Between its two anchors |
| Info line | One sloped boundary | Between its two anchors |
| Trend angle | One sloped boundary | Between its two anchors |
| Ray | One sloped boundary | From anchor 1 through anchor 2 and onward |
| Extended line | One sloped boundary | All representable times |
| Parallel channel | Upper boundary, lower boundary, or channel region | Baseline anchor interval |

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

For a parallel channel, store two complete data-coordinate boundaries in the
snapshot. Do not persist the current screen-space normal offset produced by
`channelGeometry.ts`: screen pixels vary with viewport and scale. The future
canonical data-space model uses the baseline slope `m=(p2-p1)/(t2-t1)` and a
second line through the third anchor `(t3,p3)`:

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

Legacy two-point channels use a historical pixel offset and therefore cannot be
alert sources. They must first be upgraded to a real third data-coordinate
anchor by an explicit migration/user action.

### Scale prerequisite

Linear interpolation above is the initial canonical contract. If chart-wide
logarithmic price scale is introduced, the snapshot must persist
`interpolation: "linear" | "log"`; log mode interpolates `log(price)` and
requires positive anchors. Browser-only visual scale state must never change an
already armed alert.

### Time prerequisite

The target must be evaluated at the candle/market epoch used by drawing anchor
times. Existing backend receive timestamps remain the replay ordering and
freshness cursor, but they are not automatically valid chart-time coordinates.
Implementation is blocked until MT5 tick time is normalized to the same UTC
epoch contract as drawing points and covered by skew tests.

## 5. Alert data model

Do not overload the legacy scalar `price`. Add a versioned target union, for
example:

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

Recommended persistence path:

1. Add nullable `technical_target jsonb` and an `expired` lifecycle state.
2. Keep `price` populated for legacy/fixed alerts and migration compatibility.
3. Validate target version, finite coordinates, positive prices, time domain,
   interpolation mode, and allowed operator at the Go boundary.
4. Include the immutable target in bootstrap and push-worker synchronization.
5. Keep `source` as provenance only; evaluation must be self-contained without
   loading the drawing row.

Changing condition or geometry creates a new arming revision and clears the
previous signed-distance baseline. Note/channel-only notification edits do not.

## 6. Shared evaluator

Introduce pure functions with no chart or store dependencies:

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

The same fixtures must execute in:

- `useAlertEngine.ts` for open-browser evaluation;
- `pushAlertEvaluator.ts` for closed-browser evaluation;
- persistence/trigger validation, either by sharing the target evaluator or by
  sending enough evaluated evidence for the Go API to verify safely.

The Go scheduler only invokes the Next evaluator today. It must not gain an
independent geometry formula unless cross-language golden vectors prove exact
parity.

## 7. UI contract

- Dynamic-capable manifests use a new capability distinct from fixed
  `alertProjection`; suggested names are `dynamic-line` and `dynamic-channel`.
- The dialog shows tool name, selected boundary/operator, current projected
  value, active time domain, and snapshot behavior.
- Alert Center shows `Dynamic line` or `Channel` plus the current evaluated
  target/range. The creation-time preview price is not presented as the fixed
  trigger price.
- Editing an alert opens its frozen geometry. An explicit **Replace from
  drawing** action may create a new arming revision if the source still exists.
- Expired alerts are visible in history/status and can be recreated; they are
  not silently deleted.

## 8. Delivery phases

1. Normalize market time and add golden timestamp/skew fixtures.
2. Build pure dynamic-line geometry and signed-distance tests.
3. Add versioned target DTO, database migration, Go validation, and bootstrap.
4. Update browser and closed-browser evaluators with shared fixtures.
5. Enable Trendline, Ray, and Extended Line capabilities and UI.
6. Define data-coordinate channel offset, reject legacy channels, and add
   channel operators.
7. Add lifecycle expiration, notification text, observability, and recovery.
8. Run shadow evaluation against recorded tick sequences before enabling user
   notifications.

## 9. Required test gates

- Horizontal dynamic line degenerates exactly to fixed-price behavior.
- Rising/falling line cross-up and cross-down evaluate previous and current
  targets separately.
- Segment/ray/infinite domains, including backward rays, expire correctly.
- Sparse ticks, equality, duplicate timestamps, out-of-order ticks, clock skew,
  and price gaps are deterministic.
- Channel upper/lower normalization works for both anchor orientations and
  never swaps operator identity unexpectedly.
- Enter/exit/inside/outside truth tables cover jumps across both boundaries.
- Linear/log interpolation golden vectors match browser and worker execution.
- Drawing edits/deletion do not mutate the snapshot; alert edits re-arm once.
- API retries, bootstrap, push sync, reload, and closed-browser replay preserve
  the exact versioned target.
- Legacy two-point channels are rejected with an actionable UI message.
- Browser tests cover creation, projected-value display, drawing deletion,
  expiration, and notification deep-link behavior.

## 10. Non-goals for the first release

- Indicator/strategy series as moving boundaries.
- Alerts that follow live drawing edits automatically.
- Intrabar path reconstruction from OHLC.
- Touch tolerance without symbol tick-size metadata.
- Vertical/time alerts or multi-symbol conditions.
- Dynamic geometry based on viewport pixels or current zoom.
