# PHASE 6A PUSH NOTIFICATIONS

_Implemented 2026-07-01._

## Scope

Phase 6A adds Firebase Cloud Messaging (FCM) as an optional alert delivery channel. It does not
change alert evaluation, alert persistence, market-data subscriptions, or simulator behavior.

Telegram and Discord are implemented as server-side Phase 6A external alert channel extensions. They
reuse the same alert trigger and closed-browser worker flow without changing alert semantics. See
`docs/PHASE6A_TELEGRAM_DISCORD_PLAN.md`.

Runtime modes:

- **Browser-open mode:** existing `useAlertEngine` evaluates alerts in the browser and sends push
  through `/api/push/send`.
- **Closed-browser mode:** the browser syncs push-enabled alerts and the FCM token to the server;
  `npm run push-worker` or an external cron calls `/api/push/evaluate` to evaluate those alerts and
  send FCM while the app/browser is closed.

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
| `src/hooks/usePushAlertSync.ts` | Syncs push-enabled active alerts to the server store. |
| `src/services/notifications/notify.ts` | Adds the push delivery channel after existing channels. |
| `src/app/api/push/send/route.ts` | Server-side FCM sender using `firebase-admin`. |
| `src/app/api/push/register/route.ts` | Persists browser FCM tokens for closed-browser evaluation. |
| `src/app/api/push/unregister/route.ts` | Removes a token from the server store. |
| `src/app/api/push/alerts/sync/route.ts` | Stores the latest push-enabled alert snapshot per token. |
| `src/app/api/push/evaluate/route.ts` | Evaluates server-stored alerts and sends FCM. |
| `src/app/firebase-messaging-sw.js/route.ts` | Dynamic service worker with public Firebase config injected from env. |
| `src/server/pushAlertStore.ts` | Firestore-backed server store for tokens and alert snapshots, with local file fallback when Firebase Admin is not configured. |
| `src/server/pushAlertEvaluator.ts` | Server-side price polling and alert trigger evaluation. |
| `scripts/push-alert-worker.mjs` | Local worker loop for closed-browser push evaluation. |
| `src/components/alerts/AlertCenter.tsx` | Push toggle/status/error UI. |
| `src/components/alerts/AlertEditDialog.tsx` | Per-alert Push flag. |
| `.env.example` | Documents public Firebase config and server-only admin credentials. |

## Configuration

Public client values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
```

Server-only values for `/api/push/send`:

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

`FIREBASE_PRIVATE_KEY` may be stored with escaped newlines (`\n`); the API route normalizes it.

Closed-browser worker values:

```env
PUSH_WORKER_URL=http://localhost:3000
PUSH_WORKER_INTERVAL_MS=15000
PUSH_WORKER_SECRET=
```

Optional server-side market data values:

```env
OANDA_API_KEY=
OANDA_ACCOUNT_ID=
OANDA_PRACTICE=true
TWELVEDATA_API_KEY=
```

Crypto symbols use public Binance REST prices and do not require a key. Forex/metals/indices use
OANDA when configured and fall back to TwelveData when available.

## Closed-Browser Worker

**Local / self-hosted (default):** `src/instrumentation.ts` starts the same evaluator in-process
when the Next server boots (`register()` hook, `setInterval` on `PUSH_WORKER_INTERVAL_MS`), so a
single process is enough:

```bash
npm run start   # or npm run dev
```

Look for `[push-worker] in-process closed-browser evaluation started` in the server log. Set
`DISABLE_PUSH_WORKER=true` to opt out (e.g. to run the standalone worker instead).

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

If `PUSH_WORKER_SECRET` is empty, the evaluate endpoint is open. Set it in production.
For troubleshooting, call `/api/push/evaluate?debug=1` with the same secret header. The response
includes per-alert condition, target, previous price, current/open/high/low window, `met`, and
blocked/skipped reason without exposing the full FCM token. When a push is accepted by FCM, the
debug entry includes `messageId`.

For Binance crypto symbols, server-side evaluation reads the latest 60 one-minute candles and
aggregates high/low from the alert's last server evaluation time to now. This lets an external cron
catch alerts whose price touched the level between runs even if current spot price has already moved
back. Non-Binance symbols fall back to current-price polling unless a richer server-side quote
source is added later.
Server-side `crossUp` / `crossDown` use the same range-crossing rule as browser-open alerts:
`low <= target && high >= target` for up crosses and `high >= target && low <= target` for down
crosses.

If an alert is armed in the middle of a one-minute candle, the worker still includes that candle's
high/low because closed-browser mode has no tick stream. This favors catching touches between cron
runs; browser-open mode uses a stricter post-arm observed range to avoid false triggers.

Alert sync sends the alert's persisted `updatedAt` timestamp, not the time of the sync request.
This prevents opening the app or re-syncing push alerts from resetting the server evaluation window
and missing a touch that happened just before the cron run.

The browser also flushes the latest push-alert snapshot with `fetch(..., { keepalive: true })` on
`pagehide` / hidden visibility. This protects the closed-browser worker path when the user creates
or edits an alert and then closes the tab before the normal sync debounce completes.

Server push sends a data-first Web Push payload with `title` and `body` mirrored into `data`, an
absolute `fcmOptions.link`, and high urgency headers. The service worker is responsible for showing
the background notification.

## Failure Modes

- Missing public Firebase env: Alert Center shows Push setup status with missing env names.
- Unsupported browser/service worker: Push toggle is disabled.
- Permission denied: Push toggle is disabled until the user changes browser site settings.
- Missing Firebase Admin env: token registration falls back to local `.data/push-alerts.json`, but
  `/api/push/send` and `/api/push/evaluate` cannot send FCM.
- FCM send error: the app logs `Push notification failed: ...`; alert history remains intact.
- `Subscription failed - no active Service Worker`: unregister old service workers / clear site data
  after redeploy. The app now waits for `/firebase-messaging-sw.js` to activate before requesting
  an FCM token, and the worker calls `skipWaiting()`/`clients.claim()` on install/activate.
- Worker not running: browser-open push still works, but closed-browser alert evaluation does not.
  As of the in-process worker, this only applies on Vercel/serverless (or with
  `DISABLE_PUSH_WORKER=true`) where nothing is calling `/api/push/evaluate` on a schedule — check
  for the `[push-worker] in-process closed-browser evaluation started` boot log otherwise.
- Missing server-side market data credentials: Binance crypto alerts still work; OANDA/TwelveData
  symbols are skipped until server credentials are configured.

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

When Firebase Admin env is configured, synced push devices and alerts are stored in Firestore
collection `pushAlertDevices`. This is the expected production/Vercel path.

When Firebase Admin env is missing, local development falls back to `.data/push-alerts.json`.
That fallback is not suitable for Vercel/serverless persistence and should not be committed.
