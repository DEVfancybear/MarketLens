# PHASE 6A PUSH NOTIFICATIONS

_Implemented 2026-07-01; MT5 symbol and snapshot concurrency hardened 2026-07-23._

## Scope

Phase 6A adds Firebase Cloud Messaging (FCM) as an optional alert delivery channel. It does not
change alert evaluation, alert persistence, market-data subscriptions, or simulator behavior.

Telegram and Discord are implemented as server-side Phase 6A external alert channel extensions. They
reuse the same alert trigger and closed-browser worker flow without changing alert semantics. See
`PHASE6A_TELEGRAM_DISCORD_PLAN.md`.

Runtime modes:

- **Browser-open mode:** `useAlertEngine` evaluates alerts and waits for the Go
  trigger transaction. A live in-memory candidate makes one delivery attempt
  after either a new commit or `alreadyTriggered`; bootstrap/reconcile stays silent.
- **Closed-browser mode:** the browser syncs push-enabled alerts and the FCM token to the server;
  `npm run push-worker` or an external cron calls `/api/push/evaluate` to evaluate those alerts and
  persist the canonical Go lifecycle before draining per-device FCM work while
  the app/browser is closed. Failed delivery remains pending independently.

## User Behavior

1. Open Alert Center.
2. Click the Push toggle.
3. Browser asks for notification permission.
4. The app registers `/firebase-messaging-sw.js` and gets an FCM token.
5. New alerts inherit the global Push setting.
6. Turning global Push on also enables Push for existing active alerts so they are synced to the
   closed-browser worker. Existing alerts can still enable/disable Push from the alert edit dialog.
7. When an alert triggers, `deliverAlert()` sends toast/sound/browser channels as before and sends
   FCM push when both global and per-alert push flags are enabled.

Push failures are logged and do not block alert history or other notification channels.

## Code Map

| File | Responsibility |
|---|---|
| `src/store/alertStore.ts` | Adds `settings.push` and per-alert `alert.push`; migrates old saved alerts. |
| `src/store/notificationStore.ts` | Stores push token, permission, status, and error state. |
| `src/services/firebase/client.ts` | Initializes browser Firebase Messaging only when configured/supported. |
| `src/services/notifications/push.ts` | Capability checks, token registration, token deletion, push send request. |
| `src/hooks/usePushNotifications.ts` | React hook used by Alert Center to enable/disable push. |
| `src/hooks/usePushAlertSync.ts` | Resolves broker symbols and syncs complete push-enabled alert snapshots to the server store. |
| `src/hooks/useExternalSyncToken.ts` | Shared stable per-browser token for Telegram/Discord-only sync (no FCM registration needed). |
| `src/hooks/usePushTriggerReconcile.ts` | Pulls back server-confirmed triggers the client's own chart-timeframe-bound scan couldn't see. |
| `src/services/notifications/notify.ts` | Adds the push delivery channel after existing channels. |
| `src/services/notifications/pushAlertSnapshot.ts` | Validates all-or-nothing replacement snapshots before upload. |
| `src/services/notifications/pushAlertSyncQueue.ts` | Serializes replacement-snapshot writes for each device token. |
| `src/app/api/push/send/route.ts` | Server-side FCM sender using `firebase-admin`. |
| `src/app/api/push/register/route.ts` | Persists browser FCM tokens for closed-browser evaluation. |
| `src/app/api/push/unregister/route.ts` | Removes a token from the server store. |
| `src/app/api/push/alerts/sync/route.ts` | Stores the latest push-enabled alert snapshot per token. |
| `src/app/api/push/alerts/status/route.ts` | Returns confirmed server-side triggers for a device token, for client reconciliation. |
| `src/app/api/push/evaluate/route.ts` | Evaluates server-stored alerts and sends FCM. |
| `src/app/firebase-messaging-sw.js/route.ts` | Dynamic service worker with public Firebase config injected from env. |
| `src/server/pushAlertStore.ts` | Transactional Firestore store, with serialized atomic local-file fallback, for tokens and alert snapshots. |
| `src/server/pushAlertStateMerge.ts` | Merges evaluator results without overwriting newer definitions, cursors, events, or channel progress. |
| `src/server/pushAlertEvaluator.ts` | MT5 tick replay, warmup, pending trigger retry, and alert evaluation. |
| `src/server/canonicalAlertTrigger.ts` | Service-authenticated worker acknowledgement to Go/PostgreSQL. |
| `src/server/pushAlertLifecycle.ts` | Enforces canonical persistence before notification delivery. |
| `src/server/pushAlertDeliveryPolicy.ts` | Retains failed delivery work, creates FCM per-device work, and groups Telegram/Discord by canonical event/channel in-run. |
| `scripts/push-alert-worker.mjs` | Local worker loop for closed-browser push evaluation. |
| `src/components/alerts/AlertCenter.tsx` | Push toggle/status/error UI. |
| `src/components/alerts/AlertEditDialog.tsx` | Per-alert Push flag. |
| `.env.example` | Documents public Firebase config and server-only admin credentials. |

## Configuration

Copy `frontend/.env.example` to `frontend/.env.local`. The public Firebase Web values and the
server-only Firebase Admin values are both required for end-to-end browser push: the browser uses
the Web config to obtain an FCM token, while Next route handlers use Admin credentials to send it.

Public client values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
```

Server-only values for `/api/push/send` and the closed-browser evaluator:

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

`FIREBASE_PRIVATE_KEY` may be stored with escaped newlines (`\n`); the API route normalizes it.
Never expose these values with a `NEXT_PUBLIC_` prefix. The Go API separately needs Firebase Admin
credentials in `backend/.env` for ID-token verification, even when both runtimes use the same
Firebase project and service account.

Closed-browser worker values:

```env
PUSH_WORKER_URL=http://localhost:3000
PUSH_WORKER_INTERVAL_MS=15000
PUSH_WORKER_SECRET=
CRON_SECRET=
DISABLE_PUSH_WORKER=true
```

Closed-browser market data comes only from the Go MT5 endpoint selected by
`NEXT_PUBLIC_API_BASE_URL` (or `http://localhost:8080` in local development).
The evaluator never substitutes Binance, OANDA, or TwelveData for an MT5 alert,
so the Go API and MT5 bridge must be connected.

## Closed-Browser Worker

**Local / self-hosted (default):** the persistent Go API calls
`/api/push/evaluate` immediately at boot and then every
`ALERT_EVALUATOR_INTERVAL`. Keep `DISABLE_PUSH_WORKER=true` so Next does not
evaluate the same alert in parallel.

In production, set `ALERT_EVALUATOR_URL` explicitly to the deployed frontend
when practical. If omitted, the backend derives
`https://<first non-local CORS origin>/api/push/evaluate`; it no longer falls
back silently to localhost when the frontend is remote.

If the Go scheduler is unavailable, `src/instrumentation.ts` can start the same
evaluator inside a persistent Next process:

```bash
npm run start   # or npm run dev
```

Set `DISABLE_PUSH_WORKER=false`, restart Next, and look for
`[push-worker] in-process closed-browser evaluation started` in the server log.

The standalone worker script still exists for cases where the in-process loop isn't wanted (e.g.
running the evaluator on a separate box from the web process):

```bash
npm run start
npm run push-worker
```

`npm run push-worker` loads `.env.local` and `.env` before polling, so `PUSH_WORKER_SECRET` should
match the value used by the running Next server.

**Vercel / serverless:** `src/instrumentation.ts` skips starting the in-process loop when
`process.env.VERCEL` is set, since serverless functions can't host a long-lived interval. Use an
external scheduler such as cron-job.org. Configure it to call:

```text
POST /api/push/evaluate
Header: x-push-worker-secret: <PUSH_WORKER_SECRET>
```

Production requires either `PUSH_WORKER_SECRET` or official Vercel
`CRON_SECRET`. Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
The endpoint is open without either secret only in non-production development.
For troubleshooting, call `/api/push/evaluate?debug=1` with the same secret header. The response
includes per-alert condition, target, previous price, current/open/high/low window, `met`, and
blocked/skipped reason without exposing the full FCM token. When a push is accepted by FCM, the
debug entry includes `messageId`.

The worker requests the Go service's retained MT5 ticks since its receive-time
cursor and replays consecutive Bid observations. It does not infer crossings
from candle high/low. If a catalog symbol is not in the initial stream, the first
tick request installs an on-demand subscription and the worker performs one
short warmup retry before deferring to the next evaluator interval.
The Go service retains up to 4,096 ticks per symbol and the evaluator caps its
request to the most recent hour.

Before replay, the worker uses the signed delivery token plus
`PUSH_WORKER_SECRET` to load enabled active alerts from
`POST /api/v1/alerts/worker-snapshot`. PostgreSQL is therefore authoritative
even when closing the browser races or misses its final push snapshot. The last
validated browser snapshot is used only when that canonical read is unavailable.

Symbol routing is shared with the browser: known legacy aliases and a unique
broker prefix/suffix resolve to the executable catalog id, while ambiguous
variants fail closed. Returned ticks are filtered back to that broker identity,
must carry a fresh backend `received_at`, and retain their MT5 market timestamp
for dynamic drawing projection. An unknown requested symbol cannot receive
unrelated cached history.

Alert sync sends the alert's persisted `updatedAt` timestamp, not the time of the sync request.
This prevents opening the app or re-syncing push alerts from resetting the server evaluation window
and missing a touch that happened just before the cron run.

The browser also flushes the latest push-alert snapshot with `fetch(..., { keepalive: true })` on
`pagehide` / hidden visibility. This protects the closed-browser worker path when the user creates
or edits an alert and then closes the tab before the normal sync debounce completes.

Each browser sync is a complete device snapshot. The browser and route reject
the whole write if any alert is malformed or IDs are duplicated; no partial
filter may accidentally prune otherwise valid server alerts. Per-device browser
writes are serialized. Firestore mutations use transactions, while the local
fallback serializes all mutations and atomically renames a unique temporary
file. Evaluator state merges preserve newer alert definitions and already
completed channel progress while retaining a frozen failed delivery after the
active one-time alert disappears.

FCM token registration is idempotent and receives one bounded retry for a
transient network/timeout abort. Production Firestore mutations are not placed
behind the global queue required by the single local JSON file, so an evaluator
pass for other devices cannot starve a registration request. Final aborts are
reported as a stable timeout message instead of exposing the browser-specific
`signal is aborted without reason` text.

Server push sends a data-first Web Push payload with `title` and `body` mirrored into `data`, an
absolute `fcmOptions.link`, and high urgency headers. The service worker is responsible for showing
the background notification.

## Web Push's Fundamental Limitation

Browser push delivery (FCM webpush) requires the browser's own background process to stay alive,
even with every tab/window closed — the OS doesn't deliver it directly, the browser vendor's push
service does, and that needs a resident (if minimized/backgrounded) browser process to relay it to
the service worker. If the browser application itself is fully quit/killed, no web push
implementation — including this one — can deliver a notification until it's reopened. `TTL` (see
below) only controls how long the push service holds the message while waiting for that
reconnection; it doesn't remove the requirement.

Telegram/Discord delivery does not have this limitation: it's a plain server-to-API call made by
`/api/push/evaluate`, independent of any browser or service worker state. Prefer those channels
(or use them alongside FCM push) when reliable closed-browser delivery matters more than needing
the browser open at all.

FCM `webpush.headers.TTL` (`src/server/firebaseAdmin.ts`) is 86400s (24h, previously 300s/5min).
If the browser doesn't reconnect within TTL, the push service drops the message even though the
server-side send reports success (`messageId` returned, no error) — a 5-minute TTL was silently
losing pushes for any realistically long closed-browser window.

## Failure Modes

- Missing public Firebase env: Alert Center shows Push setup status with missing env names.
- Unsupported browser/service worker: Push toggle is disabled.
- Permission denied: Push toggle is disabled until the user changes browser site settings.
- Push registration timeout: the client retries once; if both attempts time out,
  verify the Vercel function can reach Firestore and try the Push toggle again.
- Missing Firebase Admin env: token registration falls back to local `.data/push-alerts.json`, but
  `/api/push/send` and `/api/push/evaluate` cannot send FCM.
- Browser-open FCM send error: the app logs `Push notification failed: ...`; alert history remains intact.
- Closed-browser FCM send error: the worker retains that device's pending FCM work and retries it without reactivating the alert.
- `Subscription failed - no active Service Worker`: unregister old service workers / clear site data
  after redeploy. The app now waits for `/firebase-messaging-sw.js` to activate before requesting
  an FCM token, and the worker calls `skipWaiting()`/`clients.claim()` on install/activate.
- Worker not running: browser-open push still works, but closed-browser alert evaluation does not.
  Check the Go log for `backend alert evaluator scheduler started` and the Next
  access log for successful `POST /api/push/evaluate`. If using the Next fallback,
  check for `[push-worker] in-process closed-browser evaluation started` instead.
- MT5 bridge disconnected, stale, or symbol unresolved: the worker skips the
  alert instead of substituting another market source. Check
  `/api/v1/mt5/status`, the symbol catalog, dynamic stream subscriptions, and
  `/api/v1/mt5/ticks?symbol=<broker-symbol>`.

## Manual Test Checklist

1. Start app with no Firebase env.
   - Alert Center renders.
   - Push toggle shows setup/error state.
   - Toast/sound/browser alerts still work.
2. Configure public Firebase env only.
   - Push toggle requests permission.
   - Permission granted creates a token in local storage key `pushNotifications`.
   - Permission denied sets the Push denied state.
3. Configure Firebase Admin env.
   - Create an alert with Push enabled.
   - Trigger it while the app is open.
   - `/api/push/send` returns `{ ok: true, messageId }`.
4. Disable Push.
   - Token is deleted through Firebase Messaging when available.
   - Local registration is cleared.
   - New alerts no longer inherit push enabled.
5. Edit an existing alert.
   - Push flag can be toggled independently from Sound and Browser.
6. Closed-browser mode.
   - Enable Push, create a push-enabled alert, then close the browser tab.
   - Run `npm run push-worker` while the Next server stays up.
   - Move price through the alert condition.
   - Confirm the OS/browser shows an FCM notification.

## Persistence Note

Phase 10 adds authenticated Go persistence without replacing the closed-browser
worker. Alert definitions/history are stored in PostgreSQL `alerts` and
`alert_events`; FCM ownership is stored in `push_tokens`. Enabling a token with
an active backend session writes `POST /api/v1/push/tokens`.

When Firebase Admin env is configured, closed-browser evaluator cursors, pending
trigger candidates, and alert snapshots remain in Firestore collection
`pushAlertDevices`. PostgreSQL is authoritative for lifecycle and history. The
worker must first call `/api/v1/alerts/worker-trigger` with the shared worker
secret and signed user token. Both a new commit and an idempotent
`alreadyTriggered` acknowledgement may drain
FCM work per device and Telegram/Discord work per event/channel within the run;
this prevents an ambiguous commit response from losing delivery. Transient/global
failures remain pending, alert-specific permanent rejections are quarantined
until browser resync, and no channel is sent before commit. See
`PHASE10_ALERT_API_SYNC.md` for the canonical flow;
token-keyed reconciliation is now fallback cache convergence.

When Firebase Admin env is missing, local development falls back to `.data/push-alerts.json`.
That fallback is not suitable for Vercel/serverless persistence and should not be committed.
