# MT5 Windows Connector Phase 3

- Updated: 2026-08-24
- Repository status: **IMPLEMENTED WITH WINDOWS CREDENTIAL MANAGER**
- Production status: **ACTIVATION-GATED**
- Scope: authenticated account lifecycle API, local credential custody, one-time worker grants,
  capability-driven browser UI, audit, abuse limits, and bilingual copy

Phase 3 makes the backend the only source of truth for the managed MT5 connector. The browser has
no connector feature flag, never stores a broker password, and renders the managed flow only when
authenticated `GET /api/v1/execution/accounts` returns `connectors.mt5Managed=true`.

## Delivered boundaries

| Boundary | Current behavior |
| --- | --- |
| Browser | Sends a password once over the authenticated API and clears form state after submit, error, or close |
| Go BFF | Injects the signed-in owner, applies session/mutation limits, owns credential I/O, and returns no public secret reference |
| Windows Credential Manager | Stores bounded generic records under the Go API identity with opaque `MarketLens:MT5:` targets |
| Rust gateway | Owns account state, revisions, owner-scoped persistence, audit, worker grants, and lifecycle commands |
| PostgreSQL | Stores opaque references and grant hashes, never login passwords or raw grant tokens |
| Worker grant | Random, one-time, and command/worker/session/lease-bound; Rust consumes the hash before Go reads the record |

Rust, PostgreSQL, the worker, command lines, and environment variables do not store a managed
broker password. The worker receives it only through the existing private one-time response after
Rust has consumed the exact grant.

## Account lifecycle

Authenticated public routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/execution/connectors/mt5/accounts` | Reserve, store, and activate a managed account |
| `GET` | `/api/v1/execution/connectors/accounts/:accountId` | Return owner-scoped redacted connection status |
| `GET` | `/api/v1/execution/connectors/accounts/:accountId/snapshot` | Return owner-scoped normalized account state |
| `GET` | `/api/v1/execution/connectors/accounts/:accountId/history` | Return bounded owner-scoped order/deal history |
| `POST` | `/api/v1/execution/connectors/accounts/:accountId/reconnect` | Reconnect or atomically rotate credentials |
| `POST` | `/api/v1/execution/connectors/accounts/:accountId/disconnect` | Drain/revoke a terminal without closing positions |
| `DELETE` | `/api/v1/execution/connectors/accounts/:accountId` | Drain, delete all exact credential records, and finalize removal |

Private worker route:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/execution-workers/mt5/credential-grants/consume` | Consume a Rust grant, retrieve one exact record, and delete session-mode material before responding |

Production ingress must not publish the worker route to browsers. Every public mutation requires
an active server session, owner identity comes only from that session, and optimistic
`connectionRevision` checks reject stale tabs.

## Credential modes and compensation

- `managed`: Windows Credential Manager retains the record for unattended reconnect on the same
  host and API identity. Rotation writes and activates a new random reference before deleting the
  previous exact target.
- `session`: Go deletes the record before returning the first worker consume response. A lost
  runtime transitions to `credentials_required`, and the user must enter the credential again.

A failed store write compensates the Rust reservation. Failed activation deletes the new record
only after reservation ownership is proven. Removal is prepare/finalize: worker state is fenced
first, then Go deletes active and pending exact targets before Rust finalizes the registry entry.
Not-found deletion is idempotent; every other store error fails closed.

## Local Windows credential store

The implementation uses `CredWriteW`, `CredReadW`, `CredDeleteW`, and a test-prefix-only
`CredEnumerateW` cleanup. Records use generic type, machine persistence, a versioned binary blob no
larger than 2,560 bytes, and empty username/comment/attributes. Target metadata contains no owner,
login, broker server, label, email, or password.

At startup, Go removes only structurally valid stale `MarketLens:MT5:test:*` canaries, creates a
new random canary, proves exact write/read/delete/absence, and then enables the connector. A missing
credential set, access denial, malformed record, changed identity, or unsupported operating system
leaves the capability false with a sanitized diagnostic.

## Backend configuration and recovery boundary

There is no third-party credential-service URL, API token, namespace, or frontend flag. The only
credential-adjacent backend setting is the independent identity key:

```dotenv
EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE=C:\ProgramData\MarketLens\secrets\mt5-identity-hmac.key
```

Run Go under one stable, dedicated, least-privilege Windows identity with a loaded user profile and
credential set. Credential Manager data is host/identity-bound: a PostgreSQL restore, host loss, or
service-account change does not restore the records. Existing references then fail closed and each
user reconnects. No plaintext export, backup endpoint, or automatic legacy-store import exists.

## Migration and activation

1. Apply additive migration `0039_mt5_vm_credentials.up.sql` through the canonical runner; no new
   database migration is required for the credential-store replacement.
2. Protect the identity HMAC key, pin the Go API identity, and keep all Rust/worker routes private.
3. Run the Windows disposable create/read/delete/absence smoke twice under the actual API identity.
4. Start the canonical backend runner and verify the authenticated account registry advertises the
   connector only after the startup probe succeeds.
5. Exercise a disposable Demo through connect, ready, reconnect/rotate, disconnect, and remove.
6. Verify PostgreSQL contains only opaque references/hashes and no synthetic or account credential
   target remains after its required cleanup.

Stop on identity drift, credential-store unavailability, stale owner/revision acceptance, replayed
grant, cross-owner observation, secret exposure, or failed cleanup. Complete the R15-9 two-owner,
three-Demo-account gate before any Live/funded activation. See
[the bare-metal runbook](MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md).

## Verification

Focused checks include Go provider/config/execution/API tests, a real disposable Windows lifecycle,
10,000 codec properties, hostile inputs, changed-line coverage, five credential-store mutants,
the existing eight managed-MT5 mutants, Rust/Python regressions, documentation checks, and
frontend capability compatibility. The canonical rerunnable entry point is:

```powershell
.\tools\verify-mt5-baremetal-managed-ea.ps1
```

Historical phase records that describe the former external credential service remain audit
artifacts only. They are not current setup instructions.
