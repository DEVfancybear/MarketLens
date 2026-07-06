# Alert Architecture

TradingView-style price alert runtime. This document reflects the current frontend code, including
browser notifications, sound, Firebase push, and external Telegram/Discord dispatch paths.

## Goals

- Conditions: price above, price below, crosses above, crosses below.
- `marketDataStore` is the single price source of truth.
- The alert engine does not poll and does not create a separate market-data socket.
- One-time alerts trigger once; recurring alerts are re-armed through a cooldown.
- Delivery channels are independent from evaluation logic.

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
| `above` | current price or post-arm observed high is `>= target` |
| `below` | current price or post-arm observed low is `<= target` |
| `crossUp` | observed range touches/crosses upward: `low <= target && high >= target` |
| `crossDown` | observed range touches/crosses downward: `high >= target && low <= target` |

The price source is the live ticker quote, with latest candle close as fallback. Cross detection uses
per-symbol previous-price memory in the runtime hook, not persisted state.

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
