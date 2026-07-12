# Phase 10 Alert API Sync

_Implemented 2026-07-10. Scope: Go alert/history/push-token persistence and
frontend synchronization._

## Ownership

Phase 10 separates three concerns that previously shared one browser-local flow:

| Concern | Source of truth | Browser role |
| --- | --- | --- |
| Alert definitions and lifecycle | Go API + PostgreSQL `alerts` | Optimistic Jotai state and `localStorage` cache |
| Trigger audit history | PostgreSQL `alert_events` | Immediate optimistic history, then bootstrap hydration |
| Global channel defaults | `user_settings.notifications` | `AlertSettings` atom/cache |
| Authenticated FCM device ownership | PostgreSQL `push_tokens` | Firebase token acquisition and local registration cache |
| Closed-browser evaluation state | Existing Next push worker store | Sync enabled alerts and reconcile confirmed triggers |

The Next push worker remains in place because it evaluates market conditions and
tracks delivery state. The Go `push_tokens` table answers a different question:
which authenticated user owns each FCM device token.

## Backend Contract

Protected routes:

| Method | Route | Frontend action |
| --- | --- | --- |
| `GET` | `/api/v1/alerts?status=` | Explicit list/recovery reads |
| `POST` | `/api/v1/alerts` | Create, duplicate, first-sign-in migration |
| `PATCH` | `/api/v1/alerts/:id` | Edit, pause/resume, re-arm |
| `DELETE` | `/api/v1/alerts/:id` | Delete and clear Triggered rows |
| `POST` | `/api/v1/alerts/:id/trigger` | Persist trigger state and event atomically |
| `GET` | `/api/v1/alerts/:id/events` | Per-alert event history |
| `GET` | `/api/v1/alerts/history` | Newest 200 user events |
| `DELETE` | `/api/v1/alerts/history` | Clear History UI and database rows |
| `POST` | `/api/v1/push/tokens` | Upsert authenticated FCM token |
| `DELETE` | `/api/v1/push/tokens/:token` | Remove authenticated device token |

`POST /alerts` sends the frontend `Alert.id` as `clientId`. PostgreSQL still
uses a UUID primary key, but creates upsert on `(user_id, client_id)` and all
resource routes accept UUID or client ID. This keeps chart overlay references
stable while requests are in flight and makes retries idempotent.

Alerts may also carry an optional immutable `source` JSON object. Drawing-created
alerts persist `{kind, drawingId, drawingTool, targetId, targetLabel, snapshotAt}`
through create, list, and bootstrap adapters. Patch payloads intentionally omit
`source`, making provenance immutable after creation. The backend validates this
metadata as provenance only; evaluation continues to use the snapshotted `price`,
so editing or deleting a drawing cannot alter an armed alert.

`POST /alerts/:id/trigger` is deliberately separate from generic PATCH. The
repository transaction:

1. updates trigger price/time and lifecycle status;
2. inserts one `alert_events` row;
3. prunes history beyond 200 rows for the user;
4. commits both state and history together.

One-time alerts become `triggered`. Recurring alerts stay `active` and update
their last trigger values so the existing one-minute re-arm gate still works.

### Line-trigger correctness

All open-browser and closed-browser evaluation now shares these exact rules:

| Condition | Trigger rule |
| --- | --- |
| `above` | `current >= target` |
| `below` | `current <= target` |
| `crossUp` | `previous < target && current >= target` |
| `crossDown` | `previous > target && current <= target` |

`previous` and `current` are consecutive observations after the alert is armed.
A crossing alert never fires on its first observation. Candle OHLC, historical
wicks, and accumulated high/low ranges are deliberately excluded: they cannot
prove that a wick happened after the alert was armed and previously produced
records such as `crossDown 1.14372 @ 1.14412`.

MT5 Bid is the canonical alert price. MT5 historical OHLC is Bid-based, so the
realtime chart provider and Next push evaluator also use Bid instead of the
Bid/Ask midpoint. Ask is only a fallback when Bid is invalid. The push worker
reads `/api/v1/mt5/ticks`; it skips evaluation when MT5 is unavailable and never
silently switches an MT5 alert to OANDA, TwelveData, or Binance.

Correctness is enforced at three layers:

1. the shared frontend predicate evaluates the tick-to-tick edge;
2. `triggerAlertAtom` rejects trigger prices on the wrong side of the target,
   including stale push reconciliation data;
3. the Go repository locks the alert and validates condition, target, and
   trigger price before updating state or inserting `alert_events`.

The closed-browser worker still wakes on an interval, but the Go MT5 service
retains the latest 512 ticks per symbol. `/api/v1/mt5/ticks?since=<unix-ms>`
returns those ticks in timestamp order, and the worker replays every observation
after the alert's `lastEvaluatedAt` (or `updatedAt` for a new revision). A wick
that crosses and returns entirely between two worker runs is therefore retained
without relying on ambiguous candle OHLC.

Replay cursors use backend `received_at`, not MT5 `time_msc`. Some brokers expose
server-clock tick timestamps several hours ahead of the API host; comparing
those directly with browser `updatedAt` previously made every worker evaluation
return `price unavailable` or could include pre-arm ticks. Go stamps each tick
with UTC receive time while preserving the original MT5 timestamps for charting.

### Arming revisions and data quality

Every create, edit, drag, enable, recurring-mode change, or manual re-arm
creates a new arming revision from `condition`, `symbol`, `price`, `recurring`,
and `updatedAt`. The first quote for a new revision establishes its baseline and
cannot satisfy a crossing condition. Note/channel-only edits retain the latest
trigger stamp; target/condition/enable/re-arm changes clear it.

The browser engine owns a reference-counted ticker subscription for every alert
symbol, including MT5 symbols outside the current chart and watchlist. Ticker
and kline ownership are tracked separately, so deleting an alert cannot
unsubscribe a chart that still owns the same symbol.

Only live MT5 quotes are evaluated in-browser; historical candle close is not a
fallback. The MT5 adapter rejects invalid Bid/Ask and out-of-order timestamps.
The closed-browser worker requires the newest backend receive timestamp to be
live (at most 60 seconds old or 5 seconds in the future), then evaluates the
ordered retained ticks. All alerts for one symbol in one worker pass read the
same frozen tick sequence and previous baseline, avoiding loop-order-dependent
crossings.

Recurring browser-open triggers sync their trigger timestamp and price into the
worker state. This prevents the worker from delivering the same crossing again
through push or external channels. Backend trigger transactions accept only
enabled, active alerts; duplicate one-time and disabled trigger requests fail
without inserting history events. Triggering does not change `updatedAt`, so it
does not accidentally create a new arming revision.

### Reopen reconciliation order

On browser reopen, authenticated workspace bootstrap still reads the alert as
`active` until the closed-browser trigger is written back. Push synchronization
and trigger reconciliation are therefore gated by `workspaceReadyAtom`:

```text
Firebase identity resolved
  -> backend session exchange resolved
  -> workspace bootstrap applies active/triggered/history snapshot
  -> workspaceReady = true
  -> fetch closed-browser trigger status immediately
  -> triggerAlertAtom moves one-time alert Active -> Triggered
  -> per-alert API queue persists trigger/event in Go
  -> debounced push sync removes the consumed one-time alert from worker state
```

Identity changes close the gate immediately. The gate stays closed while the
backend login exchange or workspace request is in flight, preventing an early
local reconcile from being overwritten by a later `active` bootstrap snapshot.
Reconciliation also reruns whenever the active alert snapshot changes, so it
does not wait for the normal 60-second status poll after bootstrap.

### Notification click navigation

FCM alert payloads include the MT5 symbol. The Firebase web link carries
`?symbol=<id>&source=alert`, and the service worker notification click handler:

1. posts `OPEN_ALERT_SYMBOL` to an existing app window and focuses it; or
2. opens a new app window with the symbol deep link.

`useNotificationDeepLink` validates and normalizes the symbol, waits until the
MT5 catalog contains it, then dispatches `setSymbolAtom`. This prevents the
startup default (`EURUSD`) or asynchronous catalog hydration from overwriting
the clicked alert symbol. The consumed query parameters are removed with
`history.replaceState` after capture.

History survives alert deletion. `alert_events.alert_id` uses `ON DELETE SET
NULL`, while `alert_ref` stores the stable client ID/UUID returned to the UI.
This matches Alert Center: clearing Triggered does not clear History.

## Bootstrap Shape

`GET /api/v1/sync/bootstrap` now includes:

```json
{
  "alerts": [],
  "triggeredAlerts": [],
  "history": []
}
```

`useWorkspaceBootstrap()` applies global notification settings first, then
passes the alert snapshot through `applyRemoteAlertsAtom`. DTO adapters convert
RFC 3339 timestamps to the numeric epoch seconds used by the alert engine and
map backend `clientId` back to frontend `id`.

For a user's first Phase 10 sign-in, an empty server snapshot does not erase a
pre-existing local workspace. Active alerts are idempotently created; triggered
alerts are created then triggered through the same per-alert queue. Local
history that cannot be reconstructed exactly remains cached until server events
replace it on a later bootstrap.

## Mutation Ordering

Alert actions remain synchronous from the component's perspective:

```text
user action
  -> update Jotai atoms
  -> persist local cache
  -> enqueue authenticated API mutation by alert id
```

Each alert has its own promise queue. A rapid `create -> edit -> trigger` sequence
therefore reaches the server in that order. Different alerts can sync in
parallel. A History clear waits for every alert mutation already queued, so it
cannot race ahead of a trigger event. Notification settings use their own serial
queue. API failures leave optimistic/local state intact and are reported by the
shared frontend error reporter.

Anonymous users keep the previous local-only behavior. Remote writes are enabled
only while `backendSessionAtom` is true.

## Push Token Flow

Enabling push now performs:

```text
Firebase Messaging getToken
  -> POST /api/push/register                 (Next closed-browser worker)
  -> POST /api/v1/push/tokens                (Go authenticated ownership)
  -> cache PushRegistration in localStorage
```

The Go call is required only when a backend session exists, preserving the
existing anonymous/local development behavior. Disabling push deletes the
Firebase token, unregisters the Next worker device, and best-effort deletes the
Go token row.

### Environment ownership

Start from `backend/.env.example` and `frontend/.env.example`:

| Runtime | Required for Phase 10 push integration |
| --- | --- |
| Go API (`backend/.env`) | `DATABASE_URL` plus Firebase Admin values used by normal authentication |
| Next browser bundle (`frontend/.env.local`) | `NEXT_PUBLIC_FIREBASE_*` Web app values and VAPID key |
| Next server (`frontend/.env.local`) | Firebase Admin values plus a production `PUSH_WORKER_SECRET` |

No FCM message is sent by Go. `/api/v1/push/tokens` records authenticated token ownership in
PostgreSQL; `/api/push/*` in Next owns evaluator registration and FCM delivery. Admin credentials
can reference the same service account in both runtime files, but must never be exposed through
`NEXT_PUBLIC_*` variables.

`usePushAlertSync` and `usePushTriggerReconcile` continue to use the Next worker
routes. Reconciled closed-browser triggers call the normal `triggerAlertAtom`,
which now records the trigger in PostgreSQL without sending the notification a
second time. Reconciliation cannot apply a stored trigger whose price is on the
wrong side of its alert line.

## Files

| File | Responsibility |
| --- | --- |
| `src/services/api/resources/alertsApi.ts` | DTOs, adapters, alert/history/token resource calls |
| `src/store/alertStore.ts` | Optimistic state, per-alert queues, migration, settings sync |
| `src/services/alertConditions.ts` | Shared level/cross predicates and final trigger-price guard |
| `src/services/market-data/mt5Price.ts` | Bid-based MT5 chart/alert price normalization |
| `src/services/market-data/subscriptionRegistry.ts` | Independent ticker/kline ownership per MT5 symbol |
| `src/hooks/useAlertEngine.ts` | Consecutive-tick live alert evaluation |
| `src/server/pushAlertEvaluator.ts` | Closed-browser ordered MT5 tick replay and evaluation |
| `src/hooks/useWorkspaceBootstrap.ts` | Applies remote alert snapshot, then opens the push runtime gate |
| `src/services/notifications/push.ts` | Dual token registration/unregistration |
| `src/hooks/usePushNotifications.ts` | Enables Go token sync only for backend sessions |
| `src/hooks/usePushTriggerReconcile.ts` | Post-bootstrap closed-browser lifecycle reconciliation |
| `src/hooks/useNotificationDeepLink.ts` | Routes FCM notification clicks to the MT5 chart symbol |
| `tests/alerts/alertsApi.test.ts` | Adapter and method/path/body contract tests |
| `tests/alerts/alertConditions.test.ts` | Crossing, level, wrong-side, and MT5 Bid regression tests |
| `tests/alerts/pushWorkspaceGate.test.ts` | Identity/bootstrap ordering gate regression test |
| `tests/alerts/mt5AlertSubscription.test.ts` | Alert ticker/chart kline ownership regression test |
| `tests/alerts/notificationDeepLink.test.ts` | Symbol query/message validation regression test |

Backend implementation lives in `backend/internal/alerts`; schema migration is
`backend/migrations/0011_alerts`.

## Verification

Run:

```bash
cd backend
go test ./...
go run ./cmd/migrate version

# Optional real-Postgres repository lifecycle test
ALERTS_INTEGRATION_DATABASE_URL=... go test ./internal/alerts \
  -run TestRepoIntegrationAlertLifecycleAndPushToken -count=1

cd ../frontend
npm run typecheck
npm run test:alerts
npm run test:ui
```

Expected database version after Phase 10: `11`, not dirty.
