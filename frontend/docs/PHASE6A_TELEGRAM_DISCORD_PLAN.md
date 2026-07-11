# PHASE 6A TELEGRAM AND DISCORD ALERT CHANNELS

_Implemented 2026-07-01; credential architecture replaced 2026-07-11 by
`INTEGRATION_SETTINGS.md`._

> Current source of truth: credentials are per-user, AES-GCM encrypted in the
> Go backend, and delivered through signed user tokens. The environment-based
> credential design below is retained only as historical context and must not
> be restored.

## 1. Objective

Extend Phase 6A beyond Firebase Cloud Messaging by adding two server-side alert delivery channels:

- **Telegram:** send triggered alert messages to a configured chat, group, or channel.
- **Discord:** send triggered alert messages to a configured webhook.

Firebase push remains the browser/device push channel. Telegram and Discord are external messaging
channels for users who want alerts even when browser push is unreliable, unavailable, or not enough
for team workflows.

## 2. Current Baseline

Implemented Phase 6A already provides:

- Alert evaluation in the browser through `useAlertEngine`.
- Closed-browser alert evaluation through `/api/push/evaluate` plus `npm run push-worker` or an
  external cron.
- Notification fan-out through `src/services/notifications/notify.ts`.
- Per-alert channel flags for toast, sound, browser, and Firebase push.
- Server-side FCM send through Firebase Admin.
- Firestore/local fallback storage for push-enabled alert snapshots.
- Telegram and Discord delivery through server-only API routes and the closed-browser worker.

Telegram and Discord should reuse the existing alert trigger and closed-browser evaluator flow. They
must not create a second alert engine.

## 3. Target Behavior

User-facing behavior:

1. User configures Telegram and/or Discord in Connections & notifications.
2. Alert Center shows Telegram and Discord channel toggles only when the related server config is
   available.
3. New alerts inherit the global Telegram/Discord settings, like existing Push behavior.
4. Existing active alerts can enable or disable Telegram/Discord per alert from the edit dialog.
5. When an alert triggers while the app is open, `deliverAlert()` sends enabled external messages.
6. When an alert triggers in closed-browser mode, `/api/push/evaluate` also sends enabled external
   messages.
7. Delivery failures are logged and surfaced as non-blocking notification errors. Alert history,
   toast, sound, browser, and Firebase push must still complete.

Operational behavior:

- Telegram and Discord credentials stay server-only.
- Browser code never receives bot tokens or webhook URLs.
- A test endpoint can send a sample message for setup validation.
- Duplicate sends are prevented by the same once-only/recurring alert state already used by the
  alert engine and server evaluator.

## 4. Non-Goals

- Do not store Telegram bot tokens, chat IDs, Discord webhook URLs, or signing secrets in
  localStorage or `NEXT_PUBLIC_*` variables.
- Do not implement incoming Telegram commands in this milestone.
- Do not implement Discord slash commands in this milestone.
- Do not require Telegram or Discord config for builds, local development, Firebase push, or MT5.
- Do not change alert trigger semantics.
- Do not replace Firebase push; these are additional channels.

## 5. Service Environment Variables

Only scheduler/service authentication remains in env:

```env
PUSH_WORKER_SECRET=
CRON_SECRET=
```

Rules:

- No user's Telegram or Discord credential belongs in deployment env.
- `PUSH_WORKER_SECRET` protects scheduler-to-Next and Next-to-Go requests.
- `CRON_SECRET` is the official Vercel Cron bearer secret.

## 6. Data Model Changes

Extend alert settings and per-alert flags:

```ts
interface AlertSettings {
  sound: boolean;
  browser: boolean;
  push: boolean;
  telegram: boolean;
  discord: boolean;
}

interface Alert {
  sound?: boolean;
  browser?: boolean;
  push?: boolean;
  telegram?: boolean;
  discord?: boolean;
}
```

Migration rules:

- Existing saved alerts default `telegram` and `discord` to `false`.
- Existing global settings default both channels to `false`.
- Enabling a global external channel may optionally enable it for existing active alerts, matching
  the current Push behavior, but only after the server reports that the channel is configured.

## 7. Proposed Code Map

| File | Responsibility |
|---|---|
| `src/services/notifications/external.ts` | Shared alert message formatting, timeout, retry, and result types. |
| `src/services/notifications/telegram.ts` | Server-side Telegram Bot API sender. |
| `src/services/notifications/discord.ts` | Server-side Discord webhook sender. |
| `src/app/api/notifications/capabilities/route.ts` | Returns which external channels are configured, without exposing secrets. |
| `src/app/api/notifications/test/route.ts` | Sends a sample Telegram/Discord message for setup validation. |
| `src/app/api/notifications/send/route.ts` | Server endpoint used by browser-open alert dispatch for Telegram/Discord. |
| `src/services/notifications/notify.ts` | Adds non-blocking browser-open external channel dispatch. |
| `src/server/pushAlertEvaluator.ts` | Sends Telegram/Discord in closed-browser evaluation after an alert is met. |
| `src/store/alertStore.ts` | Adds global and per-alert Telegram/Discord channel flags with migration. |
| `src/store/notificationStore.ts` | Optionally stores external channel capability/status for Alert Center UI. |
| `src/components/alerts/AlertCenter.tsx` | Adds Telegram/Discord global toggles and setup status. |
| `src/components/alerts/AlertEditDialog.tsx` | Adds per-alert Telegram/Discord checkboxes. |
| `.env.example` | Documents server-only Telegram/Discord config placeholders. |

## 8. Message Contract

Use one normalized payload internally:

```ts
interface ExternalAlertMessage {
  alertId: string;
  symbol: string;
  condition: "above" | "below" | "crossUp" | "crossDown";
  targetPrice: number;
  triggerPrice: number;
  note?: string;
  triggeredAt: number;
  source: "browser-open" | "closed-browser-worker";
}
```

Recommended message text:

```text
Trading alert triggered
BTCUSDT crossed up 108000
Trigger price: 108125.50
Time: 2026-07-01T11:20:00.000Z
Note: Breakout alert
```

Telegram formatting:

- Use `sendMessage`.
- Prefer plain text or conservative MarkdownV2 with proper escaping.
- Disable link previews.

Discord formatting:

- Use a webhook POST with `content` first.
- Optional later improvement: embed with symbol, condition, prices, and timestamp fields.
- Avoid `@everyone`/`@here` mentions by default through `allowed_mentions: { parse: [] }`.

## 9. API Design

### Legacy Next notification routes

Returns:

```json
{
  "telegram": { "configured": true, "enabled": true },
  "discord": { "configured": false, "enabled": false }
}
```

No secrets are returned.

The old `/api/notifications/*` env-backed routes are compatibility-only. New UI
and browser-open delivery use `/api/v1/settings/integrations`; closed-browser
delivery uses `/api/v1/settings/integrations/worker-deliver`.

Headers:

```text
x-push-worker-secret: <PUSH_WORKER_SECRET>
```

Body:

```json
{
  "channel": "telegram"
}
```

Returns delivery result and short error messages only.

### `POST /api/notifications/send`

Used by browser-open alert dispatch. It should accept the normalized alert message plus requested
channels, validate configuration, and send only server-configured channels.

The endpoint must be idempotent per alert trigger if a `triggerId` is supplied later. Initial
implementation can rely on existing alert trigger once-only logic and server evaluator state.

## 10. Implementation Milestones

### Milestone A - Docs and Configuration

- Status: complete.
- Added this plan.
- Added `.env.example` placeholders.
- Updated Phase 6 docs and changelog.

Exit criteria:

- Documentation clearly separates Firebase browser push from Telegram/Discord external messages.

### Milestone B - Server Senders

- Status: complete.
- Added server-side Telegram/Discord senders in `src/server/externalNotifications.ts`.
- Added shared formatter and timeout handling.
- Added capabilities endpoint.
- Added test endpoint.

Exit criteria:

- `npm run typecheck`, `npm run lint`, and `npm run build` pass with no Telegram/Discord env.
- Test endpoint returns configured/unconfigured states without leaking secrets.

### Milestone C - Browser-Open Alert Dispatch

- Status: complete.
- Added global/per-alert channel flags.
- Added Alert Center and edit dialog UI.
- Added `/api/notifications/send`.
- Wired `deliverAlert()` after existing local channels and Firebase push.

Exit criteria:

- Triggering an alert can send Telegram/Discord while the app is open.
- Failures are visible but non-blocking.
- Existing toast/sound/browser/FCM behavior is unchanged.

### Milestone D - Closed-Browser Worker Dispatch

- Status: complete.
- Extended the synced alert snapshot to include `telegram` and `discord` flags.
- Updated `/api/push/evaluate` to send Telegram/Discord when an alert is met.
- Added debug output showing external channel delivery status.
- Added an external-only sync token so Telegram/Discord closed-browser delivery does not require
  Firebase Messaging to be configured.

Exit criteria:

- A closed-browser worker trigger can send Firebase, Telegram, and Discord independently.
- One channel failure does not block the others.

### Milestone E - Hardening

- Status: partial.
- Added short request timeout.
- Worker delivery is protected by a signed user token plus the optional service secret.
- Retry/backoff remains a future hardening step if Telegram/Discord rate limits become noisy.

Exit criteria:

- External channels are production-safe behind server-only env.
- Setup failure states are understandable from Alert Center or debug endpoints.

## 11. Manual Test Checklist

Telegram:

1. Start app with no Telegram env.
   - Capability returns unconfigured.
   - Telegram UI is disabled or hidden.
2. Configure invalid token.
   - Test endpoint returns a concise error.
   - No secret value appears in response or logs.
3. Configure valid token and chat ID.
   - Test endpoint sends a sample message.
   - Browser-open alert sends a Telegram message.
   - Closed-browser worker alert sends a Telegram message.

Discord:

1. Start app with no Discord env.
   - Capability returns unconfigured.
   - Discord UI is disabled or hidden.
2. Configure invalid webhook URL.
   - Test endpoint returns a concise error.
3. Configure valid webhook URL.
   - Test endpoint sends a sample message.
   - Browser-open alert sends a Discord message.
   - Closed-browser worker alert sends a Discord message.
   - Message does not ping `@everyone` or `@here`.

Regression:

- Toast/sound/browser/FCM continue when Telegram fails.
- Toast/sound/browser/FCM continue when Discord fails.
- Build works with all Telegram/Discord env missing.
- Secrets are never exposed in browser bundles, API responses, or committed files.

## 12. Rollback Plan

- Set `TELEGRAM_ALERTS_ENABLED=false` and `DISCORD_ALERTS_ENABLED=false`.
- Leave per-alert flags in persisted alert data; disabled server config should prevent delivery.
- If needed, hide external channel UI when capabilities report disabled.
- Existing Firebase push and local notification channels remain unaffected.

## 13. Acceptance Criteria

- Telegram and Discord are opt-in, server-configured alert channels.
- Browser-open and closed-browser alert paths both support external delivery.
- Credentials stay server-only.
- Channel failures are isolated and non-blocking.
- Debug/test endpoints make setup verifiable without exposing secrets.
- Documentation covers setup, implementation sequence, testing, rollback, and risk controls.
