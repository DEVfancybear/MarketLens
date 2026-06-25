# PHASE 2 GAPS

_Audit date: 2026-06-25. Gaps, bugs, and missing TradingView-parity functionality found while
auditing the alert engine._

**None block the Phase 2 requirements.** Severity: 🔴 correctness · 🟡 UX/robustness · ⚪ polish.

## A. Bugs / correctness

| # | 🟥 | Gap | Detail | Recommendation |
|---|---|---|---|---|
| G1 | 🟡 | **Notification flags double-gated & stale** | `deliverAlert` fires sound/browser only if **both** the per-alert flag (`alert.sound`/`alert.browser`) **and** the global `settings` flag are true. The per-alert flags are snapshotted from `settings` at `createAlert` time and there is **no UI to edit them**. So enabling the global "Browser" toggle **after** creating alerts won't make existing alerts browser-notify; toggling sound between creations yields inconsistent behaviour. | Pick one model: gate on global `settings` only (drop the per-alert flags), **or** expose per-alert sound/browser toggles in the Alert Center and stop double-gating. |
| G2 | 🟡 | **Stale previous-price can false-fire a cross** | `useAlertEngine.prevPriceRef` is never cleared when a symbol is unsubscribed. If all alerts on a symbol are deleted and later a `crossUp`/`crossDown` is re-created, the first evaluation may use a stale `prev` on the wrong side of the target and fire without a real-time cross. | Clear `prevPriceRef` for a symbol when it leaves the desired set (in the subscription-management effect). |
| G3 | ⚪ | **Level alert created while already-satisfied fires on the next tick, not instantly** | The immediate `evaluate()` runs at mount, before the new alert exists; subsequent evaluation only runs on the next `marketDataStore` change (~1s for crypto). | Trigger an `evaluate()` on alert creation (e.g. subscribe the engine to `alertStore` changes, or call a one-shot evaluate after `createAlert`). |
| G4 | ⚪ | **Sound may be blocked on auto-fire** | `AudioContext` is created lazily and `resume()`d, but if a persisted alert fires right after page load (no user gesture yet) the browser autoplay policy may suppress the chime. | Prime/resume the `AudioContext` on the first user interaction (e.g. opening the Alert Center). |

## B. UX / robustness

| # | 🟥 | Gap | Recommendation |
|---|---|---|---|
| G5 | 🟡 | **No edit UI** — `alertStore.updateAlert` exists but is unused; you can only delete + recreate. TradingView lets you edit target/condition/message. | Add an edit affordance (inline price edit or an edit form) calling `updateAlert`. |
| G6 | 🟡 | **Alert Center backdrop blocks chart interaction on desktop.** The full-screen `inset-0` backdrop (transparent on ≥640px) intercepts clicks, so the chart isn't usable while the drawer is open. | On desktop, drop the click-catching backdrop (close on outside-click via a listener) or dock the panel like the watchlist. |
| G7 | ⚪ | **`note` field unused in the form.** The model + `deliverAlert` support an alert message, but the create form has no input for it. | Add an optional "Message" input to the form. |
| G8 | ⚪ | **No live price for non-streaming form symbols.** `useLivePrice` shows a live value only for watch-listed / charted symbols; other registry symbols show none until an alert exists. | Subscribe the selected form symbol's ticker while the drawer is open. |
| G9 | ⚪ | **`selectActiveAlerts` selector exported but unused.** Minor dead code. | Remove or use it. |

## C. Missing TradingView-like functionality

Price alerts are covered; these are the parity items TradingView offers that we do not (candidates
for a Phase 2.x / later):

- **Edit an existing alert** (G5) and **drag the alert line on the chart** to change its price.
- **"Once per bar close" vs intrabar** firing option. We fire **intrabar** (on every tick) only.
- **Expiration / "open-ended" duration** and **alert name/label**.
- **Custom alert message** surfaced in the toast/notification (model supports it; UI does not — G7).
- **Alerts on more than price:** indicator crossings, drawing (trendline) crossings, % change,
  volume. We support price only.
- **Delivery channels beyond local:** email / SMS / **webhook** / mobile push (push is the planned
  Phase 6 Firebase seam in `notify.ts`).
- **Per-alert sound choice**, **snooze / mute-all**, and a **restart-all** for triggered
  alerts (we have per-alert re-arm via `resetAlert`, but no bulk restart).
- **Alerts manager parity:** columns for status/created/last-trigger, sorting/filtering, and a
  dedicated full-height panel rather than a drawer.

## D. Performance note (not a gap)

`evaluate()` runs on **every** `marketDataStore` mutation and is O(active alerts) per run. Fine for
the expected scale (tens of alerts); if alert counts grow large, index alerts by symbol and evaluate
only the symbol(s) whose price changed.

## E. Explicitly verified working

- Creation (form + context menu), deletion, history record shape, once-only + recurring duplicate
  prevention, toast rendering/auto-dismiss, browser permission flow, persistence across reload,
  responsive drawer + toast, single-socket / refcounted subscriptions, no polling.
