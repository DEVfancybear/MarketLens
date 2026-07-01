# PHASE 6A PUSH NOTIFICATIONS

_Implemented 2026-07-01._

## Scope

Phase 6A adds Firebase Cloud Messaging (FCM) as an optional alert delivery channel. It does not
change alert evaluation, alert persistence, market-data subscriptions, or simulator behavior.

Important runtime boundary:

- Existing alert evaluation still runs in the browser through `useAlertEngine`.
- FCM delivery is triggered by the running app when an alert fires.
- Alerts cannot fire while the whole app/browser is closed until a future server-side alert worker
  evaluates prices outside the browser.

## User Behavior

1. Open Alert Center.
2. Click the Push toggle.
3. Browser asks for notification permission.
4. The app registers `/firebase-messaging-sw.js` and gets an FCM token.
5. New alerts inherit the global Push setting.
6. Existing alerts can enable/disable Push from the alert edit dialog.
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
| `src/services/notifications/notify.ts` | Adds the push delivery channel after existing channels. |
| `src/app/api/push/send/route.ts` | Server-side FCM sender using `firebase-admin`. |
| `src/app/firebase-messaging-sw.js/route.ts` | Dynamic service worker with public Firebase config injected from env. |
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

## Failure Modes

- Missing public Firebase env: Alert Center shows Push setup status with missing env names.
- Unsupported browser/service worker: Push toggle is disabled.
- Permission denied: Push toggle is disabled until the user changes browser site settings.
- Missing Firebase Admin env: token registration can succeed, but `/api/push/send` returns 503.
- FCM send error: the app logs `Push notification failed: ...`; alert history remains intact.

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

## Future Server-Side Alert Worker

To support alerts while the browser is fully closed, add a server-side process that:

1. Persists alert definitions and FCM tokens in a server database.
2. Subscribes to market data independently from the browser.
3. Reuses the same condition semantics from `src/services/alertEngine.ts`.
4. Sends FCM using the same Firebase Admin message shape used by `/api/push/send`.

That worker should be added as a separate milestone because it changes persistence, market-data
ownership, and deployment topology.
