# ALERT ARCHITECTURE (Phase 2)

_TradingView-style price alert engine. Last updated 2026-06-25._

## 1. Goals & constraints

- Alert conditions: **Price above**, **Price below**, **Crosses above**, **Crosses below**.
- **`marketDataStore` is the single source of truth** for prices. The engine **does not poll** and
  **does not open any websocket** — it rides the existing realtime feed.
- Trigger **once** per arming; **no duplicate triggers**.
- Notifications: **toast**, **browser (system)**, **sound**.
- **Responsive** Alert Center; architecture **ready for Firebase push (Phase 6)**.

## 2. Data flow

```
Binance / TwelveData WS  (one socket per provider — Phase 1)
        │
        ▼
  marketDataStore  ── quotes{} / candles{} (single source of truth)
        │  (vanilla store .subscribe — no polling)
        ▼
  useAlertEngine (GlobalRuntime)
    • ensures a ticker subscription per alert symbol (refcounted → no new sockets,
      never tears down a watchlist subscription)
    • remembers previous price per symbol (for cross detection)
    • on each price change → pure evaluation
        │
        ├─ services/alertEngine.ts  (pure: conditionMet / isAlertTriggered / inferCondition)
        │
        ▼ (condition met, once-only / re-arm gating)
  alertStore.triggerAlert(id, price)
    • one-time  : alerts → triggeredAlerts, append history
    • recurring : stays armed, append history, stamp triggeredAt (re-arm after 60s)
        │
        ▼
  services/notifications/notify.ts  (deliverAlert)
    ├─ toastStore.push       → <Toaster/>            (in-app)
    ├─ notifications/sound    → Web Audio chime
    ├─ notifications/browser  → Notification API     (system, permission-gated)
    └─ [Phase 6] notifications/push → Firebase FCM    (one more channel here)
```

## 3. Modules

| Concern | File | Notes |
|---|---|---|
| Alert state (SSOT) | `store/alertStore.ts` | `alerts`, `triggeredAlerts`, `history`, `settings`. Actions: `createAlert`, `updateAlert`, `deleteAlert`, `triggerAlert`, `resetAlert`, `clearTriggered`, `clearHistory`, `setSettings`, `hydrate`. Backward-compat `add/remove/clear`. Persisted to `localStorage` key `alerts`. |
| Pure evaluation | `services/alertEngine.ts` | `conditionMet` / `isAlertTriggered` / `inferCondition`. No state, no I/O — unit-testable. |
| Engine runtime | `hooks/useAlertEngine.ts` | Mounted once in `GlobalRuntime`. Subscribes to `marketDataStore`; manages alert-symbol ticker subscriptions; previous-price memory; once-only & re-arm gating. |
| Dispatch | `services/notifications/notify.ts` | `deliverAlert(alert, price, settings)` fans out to channels. The seam for Phase 6 push. |
| Toast | `store/toastStore.ts` + `components/notifications/Toaster.tsx` | Generic transient toasts, top-right, auto-dismiss, capped stack. |
| Sound | `services/notifications/sound.ts` | Web Audio two-tone chime — no asset, lazy AudioContext, failure-safe. |
| Browser | `services/notifications/browser.ts` | Notification API: support check, permission request, show. Permission requested **only** from the Alert Center. |
| Alert Center UI | `components/alerts/AlertCenter.tsx` | Responsive slide-over: settings, create form, active / triggered / history. Toggled from the toolbar bell + `uiStore.alertCenterOpen`. |
| Chart integration | `components/chart/AlertLines.tsx`, `ChartContextMenu.tsx` | Renders active-alert price lines; right-click "Create Alert" infers `crossUp`/`crossDown` from current price. |

## 4. Alert model

```ts
type AlertCondition = 'above' | 'below' | 'crossUp' | 'crossDown';
type AlertStatus = 'active' | 'triggered';

interface Alert {
  id; symbol; condition; price /* target */; status;
  createdAt; triggeredAt?; triggerPrice?; note?;
  recurring;            // re-arm vs once
  sound; browser;       // per-alert channel flags
}

interface AlertHistoryEntry {
  id; alertId; symbol; condition;
  targetPrice; triggerPrice; triggerTime;   // ← the required history record
}
```

## 5. Evaluation semantics

| Condition | Fires when |
|---|---|
| `above` | `current ≥ target` (level — fires as soon as it is first true, incl. on create) |
| `below` | `current ≤ target` |
| `crossUp` | `previous < target` **and** `current ≥ target` (edge — needs a previous tick) |
| `crossDown` | `previous > target` **and** `current ≤ target` |

- **Price source:** ticker quote (`quotes[symbol].last`); falls back to the latest candle close.
- **No duplicate triggers:** a one-time alert leaves `alerts` on fire (can't re-match). A recurring
  alert is gated by `RECURRING_REARM_MS` (60s) so a single cross doesn't fire every tick.
- **Cross detection** uses the engine's per-symbol previous-price memory (in the hook, not the store).

## 6. No new sockets / no polling (how)

- The engine subscribes alert symbols for `ticker` through `marketDataStore.subscribe`, which is now
  **reference-counted** (Phase 2 added `subRefs`): the provider stream is opened on the first
  subscriber and torn down only when the last unsubscribes. The watchlist and the alert engine can
  both hold the same symbol's ticker without clobbering each other, and Binance/TwelveData still use
  exactly **one socket per provider**.
- Evaluation is driven by the store's `subscribe` callback (push), never a timer.

## 7. Notifications & permissions

- **Toast** (default on): always available, no permission.
- **Sound** (default on): Web Audio; the context is created lazily after user interaction.
- **Browser** (default off): requires explicit permission, requested from the Alert Center's
  "Browser" toggle. If unsupported or denied, the channel is simply skipped.

## 8. Mobile & Phase 6 readiness

- The Alert Center is a responsive drawer (full-width < 640px, 380px panel ≥ 640px) with a mobile
  backdrop; the toast stack is width-clamped to the viewport.
- **Firebase push (Phase 6)** plugs in as one more channel inside `deliverAlert`: add
  `notifications/push.ts` (token registration + send) and a `settings.push` flag. No change to the
  engine, store, or evaluation is required — that is the reason dispatch is isolated from evaluation.

## 9. Persistence

`alerts`, `triggeredAlerts`, `history`, and `settings` persist to `localStorage` (key `alerts`) and
are hydrated once on the client from `GlobalRuntime`. Prices/cross-memory are intentionally **not**
persisted (they are reconstructed from the live feed).
