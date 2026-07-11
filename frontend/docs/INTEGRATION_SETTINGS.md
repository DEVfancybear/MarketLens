# Integration Settings

The top chart settings menu opens **Connections & notifications** for private,
per-user MT5, Telegram, and Discord configuration.

## Security contract

- The browser submits a secret only when creating or replacing it.
- Backend AES-GCM encryption uses a domain-separated SHA-256 key derived from
  `AUTH_JWT_SECRET`; ciphertext is stored in `user_integrations`.
- GET and PUT responses return `passwordConfigured`, `botTokenConfigured`, and
  `webhookConfigured`, never plaintext or ciphertext.
- Leaving a secret input blank preserves the stored secret. Clear actions are
  explicit booleans.
- Integration routes require the normal authenticated backend session.

## Runtime behavior

- Telegram and Discord use **Save & send test**: the current form draft is
  persisted first, then the backend-owned test-send endpoint uses that saved
  configuration. This prevents a test from silently using stale credentials.
- Telegram bot tokens and chat IDs are validated separately. A bot token has
  the `<bot-id>:<secret>` shape; a chat ID must be numeric (including negative
  group/channel IDs) or a public `@channel` username. A token pasted into the
  Chat ID field is rejected before storage.
- Provider rejection details are surfaced without returning stored secrets, so
  errors such as an invalid token or missing chat are actionable.
- Browser-open alert delivery uses these per-user credentials and enable flags.
- Closed-browser devices store a backend-signed delivery token, never channel
  credentials. The worker authenticates with `PUSH_WORKER_SECRET` when it is
  configured (required in production), forwards the
  signed token and alert payload, and Go resolves the correct user before
  decrypting and sending through that user's enabled channels.
- MT5 login/server/password are runtime provisioning settings. The native Python
  bridge is a host-local singleton and must reconnect or restart before a newly
  saved account becomes active.

## Verification

Run `go test ./...`, `npm run typecheck`, `npm run lint`, and `npm run build`.
Manually verify create, masked reload, blank-secret preservation, replacement,
clear, draft-save-before-test, swapped Telegram-field validation, provider
failure/success, signed-out state, and bridge restart guidance.

## Closed-browser scheduler

The primary scheduler is `backend/internal/alertworker`. A persistent Go backend
calls the Next evaluator immediately at boot and then every
`ALERT_EVALUATOR_INTERVAL`. Calls are sequential, timeout-bounded, and carry
`PUSH_WORKER_SECRET`.

Set `ALERT_EVALUATOR_URL` to the deployed frontend
`https://<host>/api/push/evaluate`. The Next in-process evaluator is disabled
by default; set `DISABLE_PUSH_WORKER=false` only when it must replace the Go
scheduler.

The Node in-process loop and these services remain optional fallbacks:

- Vercel Cron calling `GET /api/push/evaluate` with `CRON_SECRET` configured;
  Vercel supplies `Authorization: Bearer <CRON_SECRET>` automatically.
- cron-job.org calling `POST /api/push/evaluate` every minute with header
  `x-push-worker-secret: <PUSH_WORKER_SECRET>`.

`PUSH_WORKER_SECRET` must match in the Next evaluator and Go backend. External
cron deletion no longer stops evaluation while the persistent Go scheduler is
enabled and can reach the frontend URL.
