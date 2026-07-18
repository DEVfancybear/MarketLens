# Alert Architecture

TradingView-style price and technical drawing alert runtime. This document reflects the current
frontend code, including browser notifications, sound, Firebase push, external Telegram/Discord
dispatch paths, immutable drawing targets, and the closed-browser push evaluator.

_Updated: 2026-07-18_

## Goals

- Conditions: price above, price below, crosses above, crosses below.
- `marketDataStore` is the single price source of truth.
- The alert engine does not poll and does not create a separate market-data socket.
- One-time alerts trigger once; recurring alerts are re-armed through a cooldown.
- Delivery channels are independent from evaluation logic.
- Dynamic drawing alerts persist a versioned data-coordinate target rather than a viewport price.
- Open-browser and push evaluation share the same target/evidence contract; the Go API verifies
  trigger evidence before persistence and notification delivery.
- Finite dynamic domains transition to an explicit `expired` lifecycle and can be re-armed.

## TradingView Compatibility Contract

The current runtime implements **fixed-price alerts** and a bounded set of
**time-indexed drawing alerts**. It does not claim indicator, strategy, watchlist,
or multi-condition alert parity. The compatibility baseline was checked against
TradingView's official alert documentation on 2026-07-15/16:

- [Introduction to TradingView alerts](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/)
- [Learn how to configure alerts](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/)
- [How to use price alerts](https://www.tradingview.com/support/solutions/43000763313-how-to-use-price-alerts/)
- [Getting started with technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/)
- [How to enable/disable the alert line on the chart](https://www.tradingview.com/support/solutions/43000645260-how-to-enable-disable-the-alert-line-on-the-chart/)
- [Manage alerts](https://www.tradingview.com/support/solutions/43000595311-manage-alerts/)
- [Trend Line drawing tool](https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/)
- [Pine Script alert FAQ](https://www.tradingview.com/pine-script-docs/faq/alerts/)

These are maintenance invariants for the existing implementation:

| TradingView behavior | Current contract |
| --- | --- |
| Price alerts are independent of the chart interval. | Evaluate the alert's stored symbol from the shared live MT5 ticker; never read the selected chart timeframe. |
| Crossing up/down must reach the level from the requested side. | Require two consecutive post-arm prices: `previous < target && current >= target` or `previous > target && current <= target`. |
| A newly created alert must not infer a historical crossing. | The first live evaluation has no previous price. Closed-browser evaluation only replays MT5 ticks newer than the alert revision. |
| Running script alerts use a snapshot of their symbol, timeframe, script, and inputs. | Price alerts store their own symbol, condition, target, recurrence, and channel flags. Chart navigation and global notification-setting changes do not mutate an existing alert. Editing an alert creates a new arming revision. |
| Triggering and notification delivery are separate concerns. | Persist the trigger/history independently; dispatch toast, sound, browser, push, Telegram, and Discord as best-effort channels. |
| Alerts can be one-time or repeat. | One-time alerts leave the active set after firing. Recurring alerts remain active and use the existing 60-second re-arm guard. |
| A drawing and its alert are separate objects; alert-line visibility is also a chart display setting. | Keep the source trendline after its alert fires. `AlertLines`/`AlertOverlay` render only active alert records, so a committed one-time trigger removes the orange alert overlay without deleting the drawing. |
| Technical alerts evaluate a referenced series/geometry at market time. | Dynamic drawing alerts freeze a versioned target at creation; drawing edits never mutate the alert. Both browser paths evaluate the same target and evidence pair. |
| Technical alerts can expire when their referenced domain ends. | Segment/ray/infinite domains are explicit; finite targets become `expired`, remain visible in bootstrap/history, and require a new arming revision to resume. |

### Drawing alert snapshots

The drawing manifest declares an optional alert-projection capability. Horizontal
levels, horizontal rays, cross lines, rectangle boundaries, enabled Fibonacci
levels, and Long/Short Position entry/target/stop levels project one or more fixed
price targets. The shared drawing action registry exposes **Add alert** only when
that projection returns at least one valid positive price.

Creation copies a selected fixed target into the ordinary price-alert contract and
stores immutable provenance in `source`: drawing id/tool, target id/label, and the
snapshot timestamp. The alert therefore continues to evaluate the same price if
the source drawing is moved, edited, hidden, synchronized elsewhere, or deleted.
The provenance is persisted locally and in PostgreSQL and is visible in Alert
Center, but it does not participate in evaluation or re-arming.

Trendline, Info Line, Trend Angle, Ray, Extended Line, Parallel Channel, and Fib
Channel advertise `dynamicAlertProjection`. Creation stores a versioned
data-coordinate target, active domain, interpolation mode, selected boundary or
operator, and `armingRevision`. `dynamicAlertTargets.ts` evaluates the target at
market time in both the open-browser engine and the closed-browser push worker.
The Go trigger endpoint reloads the immutable target, validates the normalized
previous/current evidence, recomputes the condition, and rejects stale or forged
claims. See [`DYNAMIC_DRAWING_ALERTS_PLAN.md`](./DYNAMIC_DRAWING_ALERTS_PLAN.md)
for the full contract and boundaries.

Two naming differences are deliberate and must not be silently changed:

- Local `above` means **at or above** (`>=`) and local `below` means **at or
  below** (`<=`). TradingView's “Greater than” and “Less than” operators require
  one minimum tick beyond the threshold. The local UI displays `>=`/`<=`, so
  changing these comparisons would be a breaking behavior change.
- The local recurrence guard is a product rule. It is not an implementation of
  TradingView's full trigger-frequency matrix (`Every time`, `Once per bar
  close`, and `Once per minute`). Adding that matrix requires an explicit model
  and migration rather than overloading the existing `recurring` boolean.

Still outside this drawing-alert contract: minimum-tick metadata, alert
names/message placeholders, webhooks, TradingView's complete frequency-by-bar
matrix, indicator/strategy snapshots, vertical/time-event alerts, multi-condition
alerts, watchlist alerts, and automatic retargeting after a drawing edit.

Swing pivot-formation alerts are deliberately deferred. Their required
backend-owned event registry, immutable indicator snapshot, closed-browser
evaluator, persistence/deduplication contract, Replay boundary, and frontend
constraints are specified in
[`../../docs/PIVOT_FORMATION_ALERT_PLAN.md`](../../docs/PIVOT_FORMATION_ALERT_PLAN.md).
Do not implement them by scanning candles or indicator series in the browser.

## Runtime Flow

```text
MarketDataService/provider stream
  -> marketDataStore quotes/candles
  -> useAlertEngine()
  -> services/alertEngine.ts
  -> POST /api/v1/alerts/:id/trigger (canonical PostgreSQL transaction)
  -> retain exact crossing evidence and back off on transient API failure
  -> alertStore.triggerAlert() applies local lifecycle
  -> services/notifications/notify.ts makes one live-tab delivery attempt
     after either a new commit or an idempotent acknowledgement
  -> bootstrap / legacy reconciliation converge silently

Closed-browser worker
  -> replay ordered MT5 ticks and freeze trigger evidence
  -> POST /api/v1/alerts/worker-trigger (worker secret + signed user token)
  -> retain the frozen candidate after transient/ambiguous canonical failure
  -> drain FCM per device and Telegram/Discord per event/channel in-run
  -> retain failed channels for retry without reactivating the alert
```

`useAlertEngine()` mounts from `GlobalRuntime` but does not evaluate until
`workspaceReady` confirms local reset or authenticated bootstrap is complete.
This prevents stale local cache from firing before the server snapshot can classify
a previously triggered one-time alert. It subscribes alert symbols through the
shared market-data subscription store, so watchlist and alert subscriptions can
coexist without clobbering each other.

## Modules

| Concern | File | Notes |
| --- | --- | --- |
| Alert state | `src/store/alertStore.ts` | Alerts, triggered/expired alerts, history, settings, selected/editing ids. Authenticated browser triggers wait for the per-alert backend queue before applying local lifecycle. |
| Fixed evaluation | `src/services/alertEngine.ts` | Level/cross condition helpers with no React or I/O dependency. |
| Dynamic evaluation | `src/services/dynamicAlertTargets.ts` | Data-coordinate target interpolation, domain checks, signed-distance conditions, and evidence normalization. |
| Runtime hook | `src/hooks/useAlertEngine.ts` | Connects market ticks to pure evaluation and alert store actions. |
| Push evaluator | `src/server/pushAlertEvaluator.ts`, `src/server/canonicalAlertTrigger.ts`, `src/server/pushAlertLifecycle.ts` | Ordered MT5 replay, transient/ambiguous canonical retries, alert-specific rejection quarantine, FCM retries per device, and Telegram/Discord grouping per canonical event/channel within one evaluator run. |
| Server verification | `backend/internal/alerts/technical_evaluator.go`, `backend/internal/alerts/handler.go` | Recomputes technical targets and validates trigger evidence before persistence. |
| Dispatch | `src/services/notifications/notify.ts` | Fans a trigger out to enabled channels. |
| Toast | `src/store/toastStore.ts`, `src/components/notifications/Toaster.tsx` | In-app notification stack. |
| Sound | `src/services/notifications/sound.ts` | Web Audio chime. |
| Browser | `src/services/notifications/browser.ts` | Notification API, permission gated. |
| Push | `src/services/notifications/push.ts`, `src/store/notificationStore.ts` | Firebase messaging registration and push send path. |
| External | `src/services/notifications/external.ts` | Telegram/Discord bridge path. |
| UI | `src/components/alerts/AlertCenter.tsx`, `src/components/alerts/AlertEditDialog.tsx` | Alert list, create/edit/settings UI. |
| Chart | `src/components/chart/AlertLines.tsx`, `src/components/chart/AlertOverlay.tsx`, `src/components/chart/AlertContextMenu.tsx` | Native price lines plus interactive overlay. |

## Alert Model

Core fields:

```ts
type AlertCondition = "above" | "below" | "crossUp" | "crossDown";
type AlertStatus = "active" | "triggered" | "expired";

interface Alert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  status: AlertStatus;
  enabled: boolean;
  locked: boolean;
  recurring: boolean;
  sound: boolean;
  browser: boolean;
  push?: boolean;
  telegram?: boolean;
  discord?: boolean;
  createdAt: number;
  updatedAt: number;
  armingRevision: number;
  technicalTarget?: TechnicalAlertTarget;
  triggeredAt?: number;
  triggerPrice?: number;
  note?: string;
}
```

`AlertHistoryEntry` stores target price, trigger price, trigger time, symbol, condition, and alert id.

## Evaluation Rules

| Condition | Fires when |
| --- | --- |
| `above` | current price is `>= target` |
| `below` | current price is `<= target` |
| `crossUp` | consecutive prices satisfy `previous < target && current >= target` |
| `crossDown` | consecutive prices satisfy `previous > target && current <= target` |

The price source is the live MT5 ticker quote. Cross detection uses per-symbol
previous-price memory in the runtime hook, not persisted state. The server push
worker persists its own per-device cursor and replays recent MT5 ticks so a
cross between worker polls is not lost.

New alerts skip cross detection on their first evaluation so stale previous prices cannot trigger an
immediate false cross. Above/below alerts can trigger immediately if the current price already meets
the condition.

### Dynamic drawing evaluation

For a dynamic target, the evaluator first resolves `targetAt(marketTime)` and
then compares signed distances for the previous and current observations. A
crossing, channel-enter/exit, or directional boundary condition requires the
consecutive evidence pair; a level condition may use the current observation
alone. Segment, ray, and infinite domains are enforced before evaluation, and
finite domains return `expired` rather than a guessed fixed price. The push path
replays ordered MT5 market timestamps, while `receivedAt` remains a separate
freshness/order cursor.

The browser sends normalized evidence and `armingRevision` with a trigger. The
Go API recomputes the target/condition from the persisted immutable payload and
uses the accepted market timestamp for `triggeredAt`.

## Chart Integration

The chart uses two layers:

- `AlertLines` creates native Lightweight Charts price lines for reliable scale attachment and
  right-axis labels.
- `AlertOverlay` adds hover/select/drag/delete/context-menu interaction. During drag it updates the
  native price line immediately through the shared alert-line registry, then commits the store change
  on release.

Selection state is `selectedAlertIdAtom`. Locked alerts render but cannot be dragged or deleted.
Disabled alerts render dimmed and are skipped by evaluation.

## Notification Channels

- Toast is controlled by global alert settings.
- Sound requires the alert and global settings to enable sound.
- Browser notifications require permission and are requested only from explicit UI.
- Firebase push requires a valid registration token in `notificationStore`.
- Telegram/Discord dispatch is best-effort after canonical trigger persistence and logs delivery failures.

Dispatch failures do not change an already committed alert trigger state; they are surfaced through
the app log. Conversely, a canonical persistence failure blocks remote notification delivery so the
system cannot report a trigger while PostgreSQL still considers the one-time alert active.
Retained worker delivery attempts use at-least-once retry semantics rather than
claiming provider-visible exactly-once. A lost canonical response can drain the
retained candidate and failed channels retry independently. There is no
transactional provider outbox: a crash after canonical commit but before worker
state is updated can lose a provider attempt, while a crash after provider
acceptance, concurrent workers, or simultaneous browser resync can duplicate or
drop non-atomic work. PostgreSQL lifecycle/history remain idempotent and cannot
re-arm or redraw the one-time alert.

## Persistence

`alerts`, `triggeredAlerts`, `history`, and `settings` persist under localStorage key `alerts`.
Push registration state persists separately under `pushNotifications`.

For anonymous users, localStorage remains the durable cache. For an authenticated
session, the Go API/PostgreSQL alert record and event history are authoritative.
Browser-open triggers commit through the per-alert API queue before local lifecycle
and notification dispatch. Closed-browser triggers commit through the worker-only
endpoint before FCM/Telegram/Discord dispatch. A failed acknowledgement is
retained as `pendingTrigger` for transient, ambiguous, and invalid/truncated
protocol responses and retried even when the market later closes. Only
alert-specific permanent 4xx failures quarantine that signature until a
successful browser sync supplies corrected state. Bootstrap
therefore already classifies a one-time fired alert as
`triggered`; token-keyed `usePushTriggerReconcile` remains a fallback for legacy
worker state and open-tab cache convergence, not the lifecycle writer.

Migration `0022_alert_event_idempotency` stores `arming_revision` on events and
uniquely identifies an attempt by `(alert_id, arming_revision, triggered_at)`.
Exact HTTP retries return success without inserting another history row, including
recurring alerts.
