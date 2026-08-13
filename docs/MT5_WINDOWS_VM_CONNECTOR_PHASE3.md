# MT5 Windows VM Connector Phase 3

- Date: 2026-08-13
- Repository status: **IMPLEMENTED AND TESTED**
- Production status: **DISABLED BY DEFAULT; ACTIVATION GATES REMAIN**
- Scope: credential vault, authenticated account lifecycle API, one-time worker
  grants, capability-driven browser UI, audit, abuse limits, and bilingual copy

Phase 3 makes the backend the only source of truth for the managed MT5
connector. The browser has no connector feature flag, never stores a broker
password, and renders the managed flow only when the authenticated
`GET /api/v1/execution/accounts` response returns
`connectors.mt5Managed=true`.

## Delivered boundaries

| Boundary | Phase 3 behavior |
| --- | --- |
| Browser | Sends a password once over the authenticated same-origin API; clears form state after submit/error/close |
| Go BFF | Injects the signed-in owner, applies session and mutation limits, writes/reads/deletes Vault secrets, and returns no public secret reference |
| Rust gateway | Owns account state, revisions, owner-scoped persistence, audit, worker grants, and lifecycle commands |
| PostgreSQL | Stores only opaque `secret_ref` values and SHA-256 grant hashes; no login password or raw grant token |
| Vault KV v2 | Stores credential material under a backend-owned path and permanently deletes all versions on rotation/removal |
| Worker grant | Random, one-time, command/worker/session/lease-bound; Rust consumes the hash before Go reads Vault |

The legacy EA connection path is unchanged. Removing Phase 3 Vault settings and
restarting the Go API disables the managed capability without exposing a dead UI
or changing existing EA accounts.

## Account lifecycle

Authenticated public routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/execution/connectors/mt5/accounts` | Reserve, vault, and activate a managed account |
| `GET` | `/api/v1/execution/connectors/accounts/:accountId` | Return owner-scoped redacted connection status |
| `POST` | `/api/v1/execution/connectors/accounts/:accountId/reconnect` | Reconnect with a stored secret or atomically rotate credentials |
| `POST` | `/api/v1/execution/connectors/accounts/:accountId/disconnect` | Drain/revoke a terminal without closing broker positions |
| `DELETE` | `/api/v1/execution/connectors/accounts/:accountId` | Drain, permanently delete secret versions, and finalize removal |

Private worker route:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/execution-workers/mt5/credential-grants/consume` | Consume a one-time Rust grant, retrieve the exact Vault secret, and delete session-mode material before responding |

Production ingress must not publish the private worker route to browsers. Every
public mutation requires an active server session, owner identity comes only
from that session, and optimistic `connectionRevision` checks reject stale tabs.

## Credential modes

- `managed`: Vault retains the encrypted credential for unattended reconnect or
  VM migration. Rotation activates the new reference before permanently deleting
  the previous KV metadata and every old version.
- `session`: the credential is permanently deleted before the first worker
  consume response is returned. A lost runtime transitions to
  `credentials_required` and the user must enter it again.

Failed Vault writes compensate the Rust reservation. Failed activation deletes
the new Vault secret and aborts the reservation. Removal is a two-step
prepare/finalize operation: an active worker must acknowledge stop first, then
the client repeats removal with the new revision so Go can delete Vault material
before registry finalization.

## Backend-only configuration

There is no `NEXT_PUBLIC_*` managed-connector flag. KV mount `secret` and prefix
`marketlens/mt5` are backend contracts rather than deployment settings.

Required together to enable Phase 3:

```dotenv
MT5_VAULT_ADDR=https://vault.internal.example
MT5_VAULT_API_TOKEN_FILE=C:\ProgramData\MarketLens\secrets\mt5-vault.token
```

`MT5_VAULT_NAMESPACE` is optional for namespaced Vault deployments. The token
itself must never be placed in an environment variable or repository file. The
token role should be limited to KV v2 read/create/update and permanent metadata
delete under `secret/marketlens/mt5/*`. Go rereads the token file per request so
operators can rotate it without putting token material in process arguments.

## Migration and activation

1. Complete the unresolved Phase 1 signed-agent/two-account isolation gate and
   the Phase 2 disposable-PostgreSQL restart/session-reassignment gate.
2. Apply additive migration `0039_mt5_vm_credentials.up.sql` through the normal
   production runner. Do not down-migrate while any managed account exists.
3. Provision the narrow Vault policy, store its token in an ACL-restricted
   absolute file, and set the two required backend values above.
4. Keep `/api/v1/execution-workers/mt5/*` on private worker ingress only.
5. Start the canonical backend runner, verify the managed capability is present,
   then exercise one disposable demo through connect, Ready, reconnect, rotate,
   disconnect, and remove.
6. Inspect Vault metadata and PostgreSQL after removal. No credential version,
   plaintext password, or raw grant token may remain.

Operational activation must stop if Vault is unavailable, a stale owner/revision
is accepted, a secret appears in logs/responses/database, or the worker grant can
be replayed.

## Verification record

Passed on 2026-08-13:

- `go test ./internal/config ./internal/execution ./internal/mt5vault ./cmd/api`
- `cargo test --manifest-path backend/execution/Cargo.toml -p execution-gateway`
  — 67 passed, 0 failed
- `npm run typecheck`
- `npm run check:i18n` — 4 passed, 0 failed
- `git diff --check`

Coverage includes authenticated owner injection, public reference/password
redaction, Vault-write compensation, managed rotation, permanent deletion of
active and pending credential versions, session deletion before worker response,
grant hashing/redaction, request/Vault-payload memory clearing, migration
plaintext guards, rate limits, and complete English/Vietnamese translation keys.

ESLint could not load the repository configuration because the installed
`eslint-config-next` package does not resolve the configured
`eslint-config-next/core-web-vitals` ESM path. TypeScript and i18n checks pass;
repair that pre-existing toolchain issue before using lint as an activation gate.
`cargo clippy -D warnings` also reaches the gateway but currently fails on 11
pre-existing warnings in `copier.rs` and `main.rs`; it reports no warning in the
new Phase 3 module.

## Remaining non-Phase-3 gates

This document does not declare the no-install connector production-ready. The
Phase 1 and Phase 2 operational evidence above remains mandatory, and Phase 4
still owns normalized broker read synchronization. No live credential or
production order test was performed as part of this repository implementation.
