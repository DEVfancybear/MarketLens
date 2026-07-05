# PHASE 2 REVIEW — Alert Engine

_Audit date: 2026-06-25 · Branch `master` · Verified at commit `cde6c5b`._

Post-implementation audit of Phase 2 (TradingView-style alert engine) against its requirements
and the eight verification items requested. Conducted before starting Phase 3.

## 1. Verdict

**Phase 2 is functional and meets its core requirements.** All four conditions work, triggering is
once-only with duplicate prevention, the three notification channels are wired, and the Alert Center
is responsive. Build / type-check / lint are green. A set of **non-blocking gaps and missing
TradingView-parity features** is tracked in `PHASE2_GAPS.md` — most notably the redundant
double-gating of per-alert notification flags (G1) and a stale-previous-price edge in cross
detection (G2).

## 2. Verification matrix

| # | Item | Status | Evidence / how it works | Manual test |
|---|---|---|---|---|
| 1 | **Alert creation** | ✅ | `alertStore.createAlert` (Alert Center form) and chart right-click → `ChartContextMenu` (condition inferred from price via `inferCondition`). Persisted to `localStorage`. | Bell → fill form → Create; or right-click chart → Create Alert. |
| 2 | **Alert triggering** | ✅ | `useAlertEngine` subscribes to `marketDataStore` (push, no polling) and evaluates active alerts via pure `alertEngine.conditionMet`. Above/below are level; crossUp/crossDown are edges using a per-symbol previous-price memory. | `BTCUSDT > <below spot>` fires next tick; `crosses above <just above spot>` fires on the next up-tick. |
| 3 | **Alert deletion** | ✅ | `deleteAlert` removes from both `alerts` and `triggeredAlerts`; history rows are intentionally retained. | Trash icon in Active / Triggered lists. |
| 4 | **Alert history** | ✅ | `triggerAlert` appends an `AlertHistoryEntry { symbol, condition, targetPrice, triggerPrice, triggerTime }` (capped 200, persisted). Shown in the History section. | Trigger an alert → row appears with target → trigger price + time. |
| 5 | **Toast notifications** | ✅ | `toastStore.push` → `<Toaster/>` (top-right, auto-dismiss 8s for alerts, stack capped at 5, mobile width-clamped). Gated by `settings.toast`. | Trigger an alert with Toast on. |
| 6 | **Browser notifications** | ✅ (with caveat) | `notifications/browser.ts` (support check + permission request from the Alert Center "Browser" toggle + `showBrowserNotification`). Only sends when permission is `granted`. **Caveat G1:** also gated by the per-alert `browser` flag captured at creation. | Enable Browser (grant permission) **before** creating an alert, then trigger. |
| 7 | **Duplicate prevention** | ✅ | One-time alert is removed from `alerts` on fire (cannot re-match). Recurring alert is gated by `RECURRING_REARM_MS` (60s). Within one evaluation pass each alert is checked once. Persistence keeps fired one-time alerts in `triggeredAlerts` across reload. | Let a recurring "above" sit beyond target — it fires at most once per minute, not every tick. |
| 8 | **Mobile responsiveness** | ✅ (Alert UI) | `AlertCenter` is `w-full` < 640px / `380px` ≥ 640px with a mobile backdrop; `Toaster` is `max-w-[calc(100vw-1.5rem)]`. | Narrow the viewport; the drawer goes full-width, the toast fits. |

## 3. Conformance to `ALERT_ARCHITECTURE.md`

- **Single source of truth:** ✅ prices come only from `marketDataStore`.
- **No polling:** ✅ evaluation is driven by the store's `subscribe` callback, never a timer.
- **No new sockets:** ✅ alert-symbol tickers are subscribed through the now reference-counted
  `marketDataStore.subscribe` (`subRefs`); Binance/TwelveData still use one socket per provider, and
  the watchlist is not torn down when it shares a symbol.
- **Dispatch isolated from evaluation:** ✅ `deliverAlert` is the single fan-out point (the Phase 6
  Firebase-push seam).
- **History shape:** ✅ matches the required `{ symbol, condition, targetPrice, triggerPrice, triggerTime }`.

## 4. Quality gates (verified this audit)

- `npm run type-check` → ✅ pass (0 errors)
- `npm run lint` → ✅ pass (0 warnings)
- `npm run build` → ✅ pass (verified at commit `cde6c5b`)
- No TODO/FIXME markers introduced.

## 5. Code-level correctness notes

- **Cross detection** correctly requires a previous tick (`prev !== undefined`), so a freshly
  tracked symbol won't false-fire on its first quote — **except** the stale-prev edge in G2.
- **Snapshot safety:** `evaluate()` iterates a captured `alerts` array, so triggering (which mutates
  the store) cannot skip or double-process siblings in the same pass.
- **No feedback loop:** triggering writes to `alertStore`/`toastStore`/`uiStore`, not
  `marketDataStore`, so it does not re-enter the evaluation subscription.
- **SSR-safe:** sound (lazy `AudioContext`), browser API, and `localStorage` access are all guarded.

See `PHASE2_GAPS.md` for gaps, severities, and missing TradingView-parity features.
