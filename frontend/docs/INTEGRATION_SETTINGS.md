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

- Telegram and Discord can be verified using backend-owned test-send endpoints.
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
clear, test-send failure/success, signed-out state, and bridge restart guidance.

## Closed-browser scheduler

On a persistent Node host, `instrumentation.ts` evaluates in-process every
`PUSH_WORKER_INTERVAL_MS`. Vercel skips this interval, so production needs one
of these schedulers:

- Vercel Cron calling `GET /api/push/evaluate` with `CRON_SECRET` configured;
  Vercel supplies `Authorization: Bearer <CRON_SECRET>` automatically.
- cron-job.org calling `POST /api/push/evaluate` every minute with header
  `x-push-worker-secret: <PUSH_WORKER_SECRET>`.

`PUSH_WORKER_SECRET` must match in the Next worker and Go backend because Go
uses it as defense-in-depth for per-user closed-browser delivery. Deleting the
only external scheduler on Vercel stops evaluation even though device records
and integration credentials remain valid.
