# Phase 10 Alert API Sync

_Implemented 2026-07-10; alert validation, MT5 symbol routing, and push concurrency
verified 2026-07-23. Scope:
Go alert/history/push-token persistence, immutable technical targets, lifecycle
state, and frontend synchronization._

## Ownership

Phase 10 separates three concerns that previously shared one browser-local flow:

| Concern | Source of truth | Browser role |
| --- | --- | --- |
| Alert definitions and lifecycle | Go API + PostgreSQL `alerts` | Optimistic Jotai state and `localStorage` cache; fixed and dynamic targets remain versioned |
| Trigger audit history | PostgreSQL `alert_events` | Apply browser history only after the canonical trigger transaction succeeds, then hydrate it again on bootstrap |
| Global channel defaults | `user_settings.notifications` | `AlertSettings` atom/cache |
| Authenticated FCM device ownership | PostgreSQL `push_tokens` | Firebase token acquisition and local registration cache |
| Closed-browser evaluation cursor and pending-trigger state | Existing Next push worker store | Sync enabled alerts, preserve `armingRevision`, evaluate dynamic targets, retain pending canonical retries, and converge an open tab |

The Next push worker remains in place because it evaluates market conditions and
tracks evaluation cursors plus pending canonical trigger candidates. The Go
`push_tokens` table answers a different question:
which authenticated user owns each FCM device token.

## Backend Contract

Authenticated browser routes plus one service-authenticated worker route:

| Method | Route | Frontend action |
| --- | --- | --- |
| `GET` | `/api/v1/alerts?status=` | Explicit list/recovery reads |
| `POST` | `/api/v1/alerts` | Create, duplicate, first-sign-in migration |
| `PATCH` | `/api/v1/alerts/:id` | Edit, pause/resume, re-arm |
| `DELETE` | `/api/v1/alerts/:id` | Delete and clear Triggered rows |
| `POST` | `/api/v1/alerts/:id/trigger` | Persist trigger state and event atomically |
| `POST` | `/api/v1/alerts/worker-trigger` | Service-authenticated closed-browser trigger; worker secret + signed user delivery token |
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
so editing or deleting a drawing cannot alter an armed alert. Snapshot and
technical-anchor timestamps accept fractional Unix milliseconds produced by
chart interpolation instead of rejecting otherwise valid drawing alerts.

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

### Symbol identity and on-demand streams

Alert definitions keep their user-facing symbol, while quote lookup,
subscriptions, worker evaluation, and reconciliation resolve it to the executable
MT5 catalog identity. Shared aliases cover legacy crypto and metal names such as
`BTCUSDT`/`BTCUSD`, `ETHUSDT`/`ETHUSD`, legacy `ETCUSD`/`ETHUSD`, and
`XAUUSD`/`GOLD`. A unique broker prefix or suffix also resolves variants such as
`EURUSDm`, `EURUSD.raw`, `US30.cash`, and `AAPL.r`; ambiguous matches fail
closed.

The Go tick endpoint installs an on-demand MT5 stream subscription when the
resolved catalog symbol was not in the initial stream. The worker performs one
short warmup retry, then defers without advancing the alert cursor if no fresh
tick is available. Unknown requested symbols return no ticks and can never fall
back to unrelated cached history.

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

Browser-open triggers wait for their serialized Go trigger transaction before
applying the local lifecycle or dispatching notification channels. Recurring
browser-open triggers then sync their trigger timestamp and price into the worker
state, preventing a second normal evaluation of the same crossing. The browser retains
the exact evidence in a backoff queue when persistence fails transiently, so
advancing the live-price cursor cannot consume the crossing. Exact retries are
idempotent for both one-time and recurring alerts: migration `0022` stores the
arming revision on `alert_events` and uniquely keys an attempt by
`(alert_id, arming_revision, triggered_at)`, where `triggered_at` is the accepted
current-evidence timestamp. The same alert ID, arming revision, and evidence
timestamp denotes the same immutable market observation, so a transport retry
returns the existing event instead of inserting history again. A different price
or target under that same key is rejected as a collision; a later evidence
timestamp or a newly armed revision is a distinct attempt. Disabled,
stale-revision, or non-triggering evidence still fails without inserting history.
Triggering does not change `updatedAt` and does not accidentally create a new
arming revision.

If two valid clients race to commit the same one-time lifecycle, the loser
receives HTTP 200 with `alreadyTriggered` and the canonical event instead of a
misleading HTTP 400. The frontend treats that response as idempotent success and
still refuses to revive a locally edited or deleted alert from stale response
data.

### Canonical closed-browser order and reopen behavior

The Next evaluator never treats notification success as lifecycle success. It
persists the accepted evidence through the worker-only Go endpoint first. If that
request fails transiently, no FCM/Telegram/Discord channel runs; the exact
candidate remains pending and can retry without a live market tick. Ambiguous
transport/protocol responses and global worker auth/configuration failures also
remain recoverable. Alert-specific permanent 4xx rejections quarantine that
signature until a successful browser sync corrects its alert snapshot. Once PostgreSQL commits, a
one-time alert is terminal even when every notification channel later fails:

```text
Next worker detects crossing and freezes previous/current evidence
  -> POST /api/v1/alerts/worker-trigger
     (x-push-worker-secret + signed deliveryToken)
  -> PostgreSQL atomically updates lifecycle + inserts idempotent event
  -> drain FCM per device; group Telegram/Discord per event/channel in-run
  -> persist worker cursor + any failed channel work
     (oneTimeFired/lastTriggeredAt/evidence/pendingDelivery)
  -> browser reopen bootstrap already receives the alert as Triggered
```

`alreadyTriggered` proves canonical lifecycle/history, not provider delivery. An
exact retry therefore still drains that device record's pending work. FCM is
attempted per device; Telegram/Discord share the canonical event ID and channel
within one evaluator run so duplicate device records do not fan out duplicate
external sends. Failed channels remain pending and retry without a market tick or
reactivating the alert. Worker attempts deliberately use **at-least-once retry
semantics**; this is not an end-to-end provider guarantee. Without a transactional
provider outbox, a crash after canonical commit but before worker state is updated
can lose a provider attempt. A crash after provider acceptance, concurrent worker
processes, or simultaneous browser resync/edit can duplicate or remove non-atomic work.
PostgreSQL lifecycle/history and browser reopen state remain idempotent and correct.

`usePushAlertSync` waits until integration settings return a signed delivery token
before arming a non-empty worker snapshot, and an omitted token no longer erases a
stored credential. Identity changes still close `workspaceReadyAtom` immediately.
The token-keyed status route and `usePushTriggerReconcile` remain for legacy
worker records and open-tab cache convergence; they are no longer required to
turn an `active` PostgreSQL row into `triggered` after restart.

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

Create/edit entry points share validation for symbol, condition, positive finite
price, note/source limits, and technical-target geometry before they enqueue a
mutation. The Go model repeats those checks, counts note length by Unicode code
point, and normalizes prices to PostgreSQL `numeric(20,8)` precision. API error
extraction accepts Ky's structured `HTTPError.data`, nested/string JSON, and
plain-text responses so an actionable backend message replaces a generic
`Request failed with status 400`.

Push-alert replacement snapshots are validated all-or-nothing and serialized per
device token in the browser. The route validates again; Firestore writes are
transactional and the local-file fallback is serialized with atomic replacement.
Evaluator results merge only when their definition signature still matches,
preserving newer edits/removals, cursors, canonical events, pending deliveries,
and completed channel progress.

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
routes for snapshot/cursor convergence. A legacy reconciled trigger calls the
normal idempotent `triggerAlertAtom`, which waits for Go acknowledgement and does
not send the notification a second time. Reconciliation cannot apply a stored
trigger whose price is on the wrong side of its alert line.

## Files

| File | Responsibility |
| --- | --- |
| `src/services/api/resources/alertsApi.ts` | DTOs, adapters, alert/history/token resource calls |
| `src/store/alertStore.ts` | Optimistic state, per-alert queues, migration, settings sync |
| `src/services/alertValidation.ts` | Shared create/edit validation and note/source/technical-target limits |
| `src/services/alertSymbols.ts` | Resolves alert symbols against the MT5 catalog without changing the stored display symbol |
| `src/services/market-data/symbolAliases.ts` | Shared legacy alias and unique broker-prefix/suffix matching |
| `src/server/canonicalAlertTrigger.ts` | Signed worker-to-Go canonical trigger request |
| `src/server/pushAlertLifecycle.ts` | Enforces persistence-before-notification ordering |
| `src/server/pushAlertDeliveryPolicy.ts` | Retains failed delivery work, builds FCM per-device work, and groups external work by canonical event/channel in-run |
| `src/server/pushAlertStateMerge.ts` | Prevents stale evaluator writes from overwriting newer snapshot and channel state |
| `src/services/alertConditions.ts` | Shared level/cross predicates and final trigger-price guard |
| `src/services/market-data/mt5Price.ts` | Bid-based MT5 chart/alert price normalization |
| `src/services/market-data/subscriptionRegistry.ts` | Independent ticker/kline ownership per MT5 symbol |
| `src/hooks/useAlertEngine.ts` | Workspace-gated consecutive-tick live alert evaluation |
| `src/services/notifications/browserAlertTriggerQueue.ts` | Retains exact browser crossing evidence and retries transient canonical failures with backoff |
| `src/server/pushAlertEvaluator.ts` | Closed-browser ordered MT5 tick replay, pending canonical retry, dynamic target evaluation, and expiration |
| `src/services/dynamicAlertTargets.ts` | Shared time-indexed line/channel/Fib Channel evaluator |
| `src/services/pushAlertSanitizer.ts` | Strict target/evidence/arming-revision validation before push persistence |
| `src/services/notifications/pushAlertSnapshot.ts` | All-or-nothing browser push snapshot validation |
| `src/services/notifications/pushAlertSyncQueue.ts` | Per-device replacement-snapshot serialization |
| `src/hooks/useWorkspaceBootstrap.ts` | Applies remote alert snapshot, then opens the push runtime gate |
| `src/services/notifications/push.ts` | Dual token registration/unregistration |
| `src/hooks/usePushNotifications.ts` | Enables Go token sync only for backend sessions |
| `src/hooks/usePushTriggerReconcile.ts` | Post-bootstrap closed-browser lifecycle reconciliation |
| `src/hooks/useNotificationDeepLink.ts` | Routes FCM notification clicks to the MT5 chart symbol |
| `tests/alerts/alertsApi.test.ts` | Adapter and method/path/body contract tests |
| `tests/alerts/alertSymbols.test.ts` | Alias, broker suffix, ambiguity, and catalog-resolution regression tests |
| `tests/alerts/alertConditions.test.ts` | Crossing, level, wrong-side, and MT5 Bid regression tests |
| `tests/alerts/mt5AlertTicks.test.ts` | MT5 tick request, filtering, receive-time, and warmup regression tests |
| `tests/alerts/pushAlertSnapshot.test.ts` | Whole-snapshot rejection and duplicate-ID regression tests |
| `tests/alerts/pushAlertSyncQueue.test.ts` | Per-device sync ordering regression tests |
| `tests/alerts/pushAlertStoreConcurrency.test.ts` | Concurrent snapshot/evaluator merge regression tests |
| `tests/alerts/pushWorkspaceGate.test.ts` | Identity/bootstrap ordering gate regression test |
| `tests/alerts/workerCanonicalTrigger.test.ts` | Worker auth/body/idempotent acknowledgement regression test |
| `tests/alerts/pushAlertLifecycle.test.ts` | Persistence-before-delivery and delivery-failure regression test |
| `tests/alerts/pushAlertDeliveryPolicy.test.ts` | Per-device channel plan and per-event external grouping regression test |
| `tests/alerts/browserAlertTriggerQueue.test.ts` | Browser retry, stale-revision discard, and duplicate-delivery suppression regression test |
| `tests/alerts/pushAlertSyncCredential.test.ts` | Signed-token readiness gate regression test |
| `tests/alerts/mt5AlertSubscription.test.ts` | Alert ticker/chart kline ownership regression test |
| `tests/alerts/notificationDeepLink.test.ts` | Symbol query/message validation regression test |

Backend implementation lives in `backend/internal/alerts`; alert schema migrations are
`backend/migrations/0011_alerts`, `0019_alert_source`, `0020_alert_technical_target`, and
`0021_alert_expiration_and_arming_revision`, and
`0022_alert_event_idempotency`.

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

Expected database version after the current alert lifecycle hardening: `22`, not dirty.
