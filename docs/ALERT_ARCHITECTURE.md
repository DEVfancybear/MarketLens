# ALERT ARCHITECTURE (Phase 2)

_TradingView-style price alert engine. Last updated 2026-06-27._

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
    • ensures ticker + kline subscriptions per alert symbol (refcounted → no new sockets,
      never tears down a watchlist subscription)
    • remembers previous price per symbol (for cross detection)
    • tracks seenAlertIds → new alerts skip stale prev on first eval
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
| Engine runtime | `hooks/useAlertEngine.ts` | Mounted once in `GlobalRuntime`. Subscribes to `marketDataStore`; manages alert-symbol ticker/kline subscriptions; previous-price memory; once-only & re-arm gating. |
| Dispatch | `services/notifications/notify.ts` | `deliverAlert(alert, price, settings)` fans out to channels. The seam for Phase 6 push. |
| Toast | `store/toastStore.ts` + `components/notifications/Toaster.tsx` | Generic transient toasts, top-right, auto-dismiss, capped stack. |
| Sound | `services/notifications/sound.ts` | Web Audio two-tone chime — no asset, lazy AudioContext, failure-safe. |
| Browser | `services/notifications/browser.ts` | Notification API: support check, permission request, show. Permission requested **only** from the Alert Center. |
| Alert Center UI | `components/alerts/AlertCenter.tsx` | Responsive slide-over: settings, create form, active / triggered / history. Toggled from the toolbar bell + `uiStore.alertCenterOpen`. |
| Chart integration | `components/chart/AlertLines.tsx`, `components/chart/AlertOverlay.tsx`, `components/chart/alertLineRegistry.ts`, `AlertContextMenu.tsx`, `alerts/AlertEditDialog.tsx`, `ChartContextMenu.tsx` | **AlertLines** uses native `createPriceLine` for guaranteed visibility. **AlertOverlay** provides interactive dragging. `alertLineRegistry` is a shared `Map<string, IPriceLine>` so drag updates the native line in real-time via `applyOptions`. Background right-click "Create Alert" infers `crossUp`/`crossDown` from current price. |

### Alert lines on chart (dual-layer: AlertLines + AlertOverlay)

**AlertLines** (native, non-interactive) — uses lightweight-charts' built-in `createPriceLine` API.
This is the primary mechanism for drawing alert price lines. Advantages:
- Drawn by the chart engine itself — zero timing issues, zero canvas hacks.
- Automatically scrolls with the price scale.
- Shows a right-axis label with the alert symbol and price.
- Lines are only recreated when the alert set changes (not on zoom/pan —
  native lines reposition automatically with the price scale).

**AlertOverlay** (canvas, interactive) — provides drag-to-move, click-to-select,
right-click context menu, hover styling, and keyboard delete. Hit strips are
rendered OUTSIDE the `pointer-events:none` container with `z-index:10` to ensure
reliable pointer event delivery across browsers. Drag uses native DOM event
listeners (`pointermove`/`pointerup`) with direct `style.top` updates for
lag-free interaction.

- **Canvas** (pointer-events: none) draws each line, a right-side label chip, hover/selection styling
  and drag handles; repaints on `ctx.version` (pan/zoom) and on selection/hover/drag changes.
- **Per-line DOM hit strips** (pointer-events: auto, ~14px tall) handle interaction; the rest of the
  chart stays pannable. Selection is `alertStore.selectedAlertId` (one at a time); click-outside and
  **Esc** deselect, **Delete** removes the selected (unless `locked`).
- **Drag** updates the native line in real-time via `alertLineRegistry`
  (`line.applyOptions({ price })`) so the trendline follows the cursor instantly.
  Hit strip position updates via direct DOM (`style.top`). On release, commits
  `updateAlert({ price, condition })` with recomputed condition.
- **Touch:** strips use `touch-action: none`; drag works with touch and a ~500ms **long-press** opens
  the context menu.
- `Alert.enabled` (engine skips it, renders dimmed) and `Alert.locked` (no drag/delete) extend the
  model; both persist. Selection/edit state does not.

## 4. Alert model

```ts
type AlertCondition = 'above' | 'below' | 'crossUp' | 'crossDown';
type AlertStatus = 'active' | 'triggered';

interface Alert {
  id; symbol; condition; price /* target */; status;
  enabled;              // disabled → engine skips, rendered dimmed (Phase 2.1)
  locked;               // no drag/delete from the chart (Phase 2.1)
  createdAt; updatedAt; triggeredAt?; triggerPrice?; note?;
  recurring;            // re-arm vs once
  sound; browser;       // per-alert channel flags (editable via the edit dialog)
}

interface AlertHistoryEntry {
  id; alertId; symbol; condition;
  targetPrice; triggerPrice; triggerTime;   // ← the required history record
}
```

## 5. Evaluation semantics

| Condition | Fires when |
|---|---|
| `above` | active candle `high >= target` or current price `>= target` |
| `below` | active candle `low <= target` or current price `<= target` |
| `crossUp` | `previous < target` or candle `open < target`, then candle `high >= target` |
| `crossDown` | `previous > target` or candle `open > target`, then candle `low <= target` |

- **Price source:** ticker quote (`quotes[symbol].last`) plus the latest kline OHLC. This lets a
  live wick touching an alert line trigger immediately instead of waiting for candle close/current
  price to remain beyond the level.
- **No duplicate triggers:** a one-time alert leaves `alerts` on fire (can't re-match). A recurring
  alert is gated by `RECURRING_REARM_MS` (60s) so a single cross doesn't fire every tick.
- **Cross detection** uses the engine's per-symbol previous-price memory (in the hook, not the store).
- **First-evaluation gate (`seenAlertIds`):** new alerts skip cross detection on their first
  evaluation (`prev` treated as `undefined`). This prevents a stale `prev` price (recorded before
  the alert existed) from causing an immediate false `crossUp`/`crossDown` trigger. `above`/`below`
  don't depend on `prev` and may trigger on the first evaluation — intentional.

## 6. No new sockets / no polling (how)

- The engine subscribes alert symbols for `ticker` and the active timeframe `kline` through `marketDataStore.subscribe`, which is now
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

Detailed Phase 6A implementation docs: `docs/PHASE6A_PUSH_NOTIFICATIONS.md`.

## 9. Persistence

`alerts`, `triggeredAlerts`, `history`, and `settings` persist to `localStorage` (key `alerts`) and
are hydrated once on the client from `GlobalRuntime`. Prices/cross-memory are intentionally **not**
persisted (they are reconstructed from the live feed).
