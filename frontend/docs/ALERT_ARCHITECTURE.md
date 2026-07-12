# Alert Architecture

TradingView-style price alert runtime. This document reflects the current frontend code, including
browser notifications, sound, Firebase push, and external Telegram/Discord dispatch paths.

## Goals

- Conditions: price above, price below, crosses above, crosses below.
- `marketDataStore` is the single price source of truth.
- The alert engine does not poll and does not create a separate market-data socket.
- One-time alerts trigger once; recurring alerts are re-armed through a cooldown.
- Delivery channels are independent from evaluation logic.

## TradingView Compatibility Contract

The current runtime intentionally implements **price alerts**, including fixed-price
snapshots created from eligible drawings, not indicator, strategy, watchlist, or
other technical alerts. The compatibility
baseline was checked against TradingView's official alert documentation on
2026-07-11:

- [Introduction to TradingView alerts](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/)
- [Learn how to configure alerts](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/)
- [How to use price alerts](https://www.tradingview.com/support/solutions/43000763313-how-to-use-price-alerts/)
- [Getting started with technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/)
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

### Drawing alert snapshots

The drawing manifest declares an optional alert-projection capability. Horizontal
levels, horizontal rays, cross lines, rectangle boundaries, enabled Fibonacci
levels, and Long/Short Position entry/target/stop levels project one or more fixed
price targets. The shared drawing action registry exposes **Add alert** only when
that projection returns at least one valid positive price.

Creation copies the selected target into the ordinary price-alert contract and
stores immutable provenance in `source`: drawing id/tool, target id/label, and the
snapshot timestamp. The alert therefore continues to evaluate the same price if
the source drawing is moved, edited, hidden, synchronized elsewhere, or deleted.
The provenance is persisted locally and in PostgreSQL and is visible in Alert
Center, but it does not participate in evaluation or re-arming.

Sloped lines, rays, channels, and other time-varying geometry intentionally do not
declare this capability. Supporting them requires a time-indexed geometry evaluator
in both the browser and closed-browser worker; silently freezing their current
intersection would misrepresent a dynamic technical alert. The deferred contract,
data model, rollout, and test gates are specified in
[`DYNAMIC_DRAWING_ALERTS_PLAN.md`](./DYNAMIC_DRAWING_ALERTS_PLAN.md).

Two naming differences are deliberate and must not be silently changed:

- Local `above` means **at or above** (`>=`) and local `below` means **at or
  below** (`<=`). TradingView's “Greater than” and “Less than” operators require
  one minimum tick beyond the threshold. The local UI displays `>=`/`<=`, so
  changing these comparisons would be a breaking behavior change.
- The local recurrence guard is a product rule. It is not an implementation of
  TradingView's full trigger-frequency matrix (`Every time`, `Once per bar
  close`, and `Once per minute`). Adding that matrix requires an explicit model
  and migration rather than overloading the existing `recurring` boolean.

Out of scope for this price-alert runtime: expiration/open-ended alerts,
minimum-tick metadata, alert names/message placeholders, webhooks, frequency by
bar, indicator/strategy snapshots, dynamic drawing-geometry alerts,
multi-condition alerts, and watchlist alerts.

## Runtime Flow

```text
MarketDataService/provider stream
  -> marketDataStore quotes/candles
  -> useAlertEngine()
  -> services/alertEngine.ts
  -> alertStore.triggerAlert()
  -> services/notifications/notify.ts
  -> toast / sound / browser / Firebase push / Telegram / Discord
```

`useAlertEngine()` mounts once from `GlobalRuntime`. It subscribes alert symbols through the shared
market-data subscription store, so watchlist subscriptions and alert subscriptions can coexist
without clobbering each other.

## Modules

| Concern | File | Notes |
| --- | --- | --- |
| Alert state | `src/store/alertStore.ts` | Alerts, triggered alerts, history, settings, selected/editing ids. Persists to localStorage key `alerts`. |
| Pure evaluation | `src/services/alertEngine.ts` | Condition helpers with no React or I/O dependency. |
| Runtime hook | `src/hooks/useAlertEngine.ts` | Connects market ticks to pure evaluation and alert store actions. |
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
type AlertStatus = "active" | "triggered";

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
- Telegram/Discord dispatch is best-effort and logs failures without blocking local UI.

Dispatch failures do not change alert trigger state; they are surfaced through the app log.

## Persistence

`alerts`, `triggeredAlerts`, `history`, and `settings` persist under localStorage key `alerts`.
Push registration state persists separately under `pushNotifications`.

Remote alert persistence is not yet the source of truth. When the backend alert endpoints are wired,
keep evaluation local/push-driven and move create/update/delete/history synchronization through the
shared `ky` API resource layer described in `BACKEND_API_SYNC_ARCHITECTURE.md`.
