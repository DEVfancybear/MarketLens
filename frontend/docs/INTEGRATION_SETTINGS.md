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
- MT5 login/server/password and verification state are owned by the authenticated
  user. Saving changed credentials invalidates only that user's prior verification.
- **Connect & Verify MT5** persists the current draft, decrypts it only inside the
  backend, and runs a short-lived native MT5 login check. The browser receives a
  sanitized account summary, never the stored password.
- The production runner provisions the dedicated FTMO verifier automatically;
  product users do not configure terminal paths, Python, source code, or environment variables.
- The dialog provides a Windows Connector download. The user opens FTMO MT5, signs in, runs the
  Connector, and allows the browser's Local Network Access prompt. The Connector binds only to
  `127.0.0.1:8787`.
- Each browser connection requests a short-lived, one-use backend ticket. The Connector selects
  the open FTMO terminal matching that ticket's login/server and rechecks the account immediately
  before each live order. It never receives the saved MT5 password.

## Verification

Run `go test ./...`, the Python verifier tests, `npm run typecheck`, `npm run
lint`, and `npm run build`. Manually verify MT5 success/failure, per-user
isolation, invalidation after login/server/password changes, account mismatch,
masked reload, blank-secret preservation, clear, notification test flows,
signed-out state, and bridge restart guidance.

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

Before Telegram/Discord (or FCM) delivery, the evaluator calls
`POST /api/v1/alerts/worker-trigger` with that shared secret and the user's signed
`deliveryToken`. PostgreSQL lifecycle/history acknowledgement is mandatory. Only
after a durable new or idempotent acknowledgement may channel dispatch start.
`alreadyTriggered:true` still drains retained at-least-once worker attempts so an ambiguous commit response
does not consume the crossing. Transient/global auth or
configuration failures retry; alert-specific permanent 4xx failures quarantine
that alert until corrected browser sync. Telegram/Discord are grouped by canonical
event/channel within one worker run, while FCM remains per device. Without a
transactional provider outbox, a crash after canonical commit but before worker
state is updated can lose a provider attempt; a crash after provider acceptance
or simultaneous browser resync can duplicate/remove non-atomic work. Lifecycle/history remain correct.
`/settings/integrations/worker-deliver` remains notification-only.
