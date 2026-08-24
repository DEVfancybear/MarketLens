# Database design and migration ledger

Migration head: `0042`.

PostgreSQL is the durable source of truth for backend sessions, user workspace state, alerts,
replay/simulation, execution commands/events/audit, and managed MT5 lifecycle. Production does not
fall back to in-memory execution persistence.

## Migration rules

- Migrations are ordered `NNNN_name.up.sql` and `NNNN_name.down.sql` files under
  `backend/migrations` and are embedded in `cmd/migrate`.
- Never edit an applied migration. Add the next version and fix forward.
- The canonical source runner and artifact deployer apply `up` before replacing services and refuse
  a dirty migration state.
- Artifact deploy can restore previous binaries after restart failure, but it never rolls the
  database back automatically. Operators must assess restored-binary compatibility and fix forward.
- Every schema change needs a disposable up/down/up rehearsal and behavior/constraint assertions.

Commands for a disposable or operator-approved database:

```powershell
Set-Location backend
go run ./cmd/migrate version
go run ./cmd/migrate up
```

Never point development tests or manual down migrations at production.

## Ownership and secret boundaries

- User-owned tables carry `user_id` and repositories query by owner plus resource identity.
- Cross-user resources are not exposed by globally addressable IDs.
- Refresh tokens, EA sessions, pairing tokens, worker sessions, grants, and recovery codes are
  stored as hashes or otherwise non-recoverable server representations.
- Managed MT5 broker passwords live only in Windows Credential Manager under the API service
  identity. PostgreSQL stores opaque `secret_ref` values and one-time grant hashes, never passwords.
- Managed broker identity uses keyed 32-byte fingerprints and a safe masked suffix. Raw login and
  exact broker server are not persisted in the managed connection/account-state rows.
- Monetary/quantity values crossing the execution boundary use decimal strings and PostgreSQL
  numeric/text contracts rather than floating-point JSON.

## Schema domains

### Identity and sessions

- `users`, `auth_identities`: canonical user and Google/Firebase identity mapping.
- `sessions`: hashed rotating refresh sessions, ancestry, expiry, revocation, user-agent/IP audit.
- `push_tokens`: owner/device/platform registration and closed-browser worker state.
- `trade_security_settings`, `trade_unlock_sessions`, `trade_authorizations`,
  `trade_password_recovery_codes`: optional trade-password security and recovery.

### Workspace and charting

- `user_settings`, `layouts`. Revisioned desktop chart task tabs live in the existing
  `user_settings.chart.taskTabs` JSONB key; writes serialize on the owner row and preserve sibling
  chart settings, so no migration or separate table is required.
- `watchlists`, `watchlist_sections`, `watchlist_symbols`, `watchlist_preferences`.
- `drawings`, `drawing_templates`, `drawing_tool_favorites`.
- `pine_scripts`, `public_pine_scripts`, `indicator_presets`.

Client IDs and unique constraints make retries idempotent. Drawing revisions and tombstones support
multi-device convergence. Opaque chart payloads remain JSONB so the backend does not reinterpret
frontend geometry/style contracts.

### Alerts and integrations

- `alerts`, `alert_events`: lifecycle, immutable source/technical target, arming revision, trigger
  idempotency, and retained history.
- `user_integrations`: notification integration metadata and encrypted/write-only legacy fields;
  legacy MT5 credential columns were removed in `0027`.

### Replay and simulated trading

- Replay datasets/bars, sessions/tracks, commands/events/checkpoints, accounts/orders/fills,
  positions, and equity points.
- `sim_accounts`, `sim_positions`: persistent client-synchronized simulation state and analytics.
- Replay actor lease/version fields serialize command application and prevent lookahead/failover
  ambiguity.

### Journal and object storage

- `journal_entries`, `screenshots`: owner-scoped journal and object metadata.
- `object_deletion_queue`: durable cleanup work so row deletion and object deletion can converge
  after partial failures.

### Broker-neutral execution

- `execution_accounts`, `execution_instruments`, `execution_positions`,
  `execution_pending_orders`, `execution_symbol_mappings`.
- `execution_commands`, `execution_target_commands`, `execution_events`,
  `execution_audit_log`.
- `execution_copy_groups`, `execution_copy_targets`, continuous-copy inbox/work/outbox/link,
  reconciliation, and error tables.
- `execution_risk_policies`, prop-risk assignments/daily state/profile catalog.
- `execution_pairing_tokens`, `execution_ea_sessions`, and account layout.

Parent and per-target command records separate a user's intent from each normalized target outcome.
Idempotency keys, delivery leases, terminal acknowledgements, external-event uniqueness, and
unknown-outcome reconciliation prevent blind resubmission.

### Managed MT5 lifecycle

- `execution_mt5_vm_workers`: private worker identity, protocol/runtime versions, bounded capacity,
  heartbeat, drain/state, hashed session, generation, and `bare_metal` substrate.
- `execution_mt5_vm_accounts`: owner-scoped reservation/status/revision, worker/lease assignment,
  persistence mode, opaque credential reference, keyed identity/server fingerprints, safe masked suffix,
  and disconnect fencing.
- `execution_mt5_vm_account_leases`: assignment lease generation and expiry.
- `execution_mt5_vm_control_commands`: durable lifecycle command poll/redelivery/ack state.
- `execution_mt5_vm_credential_grants`: hashed, one-time, expiry- and generation-bound grants.
- sync/account/position/pending-order/instrument/history/deal/coverage tables: durable read model with
  worker, lease, session-generation, sequence, and owner fencing.

Migration `0042` binds managed pairing/EA sessions to account, worker session, lease, connection
revision, slot, exact terminal PID, and gateway origin. Its database functions:

- bind one managed bootstrap to the current fenced runtime;
- advance readiness only when worker/lease, terminal account evidence, four sync families, EA
  session/version, and successful recent command poll agree;
- fence disconnect idempotently, revoke sessions/grants, queue exact-account stop work, and mark
  undelivered versus unknown delivery outcomes without inventing broker results.

The active-identity index prevents two active managed controllers for the same keyed broker
identity. Conflict paths do not reveal the existing owner or raw identity.

## Migration ledger

| Version | Purpose |
| --- | --- |
| `0001` | PostgreSQL extensions |
| `0002` | Users, Google identities, refresh sessions, push tokens |
| `0003` | User settings and layouts |
| `0004` | Watchlists and symbols |
| `0005` | Watchlist sections/layout/preferences |
| `0006` | Watchlist sort preferences |
| `0007` | Drawings and templates |
| `0008` | Drawing-tool favorites |
| `0009` | Private Pine scripts and indicator presets |
| `0010` | Public Pine store |
| `0011` | Alerts and trigger events |
| `0012` | Replay datasets, sessions, and tracks |
| `0013` | Replay clock, commands, events, checkpoints, actor lease |
| `0014` | Replay accounts/orders/fills/positions/equity |
| `0015` | Journal, screenshots, object-deletion queue |
| `0016` | Simulated accounts/positions and journal position FK |
| `0017` | User notification integrations |
| `0018` | Drawing revisions/tombstones |
| `0019` | Alert source provenance |
| `0020` | Alert technical targets |
| `0021` | Alert expiration and arming revision |
| `0022` | Alert trigger-attempt idempotency |
| `0023` | Historical MT5 verification timestamp |
| `0024` | Manual watchlist ordering |
| `0025` | PostgreSQL push-device worker state |
| `0026` | Broker-neutral execution platform |
| `0027` | Irreversible removal of legacy stored MT5 credentials |
| `0028` | Successful EA command-poll liveness |
| `0029` | Unknown execution delivery outcome |
| `0030` | Execution account layout |
| `0031` | Initial trade authorization records |
| `0032` | Optional trade password and unlock sessions |
| `0033` | Deferred-copy delivery metadata |
| `0034` | Prop-risk guard assignment and daily state |
| `0035` | Continuous copier durable inbox/work/outbox/reconciliation |
| `0036` | Versioned prop-risk profile catalog |
| `0037` | Trade-password recovery codes |
| `0038` | Managed MT5 worker/control-plane lifecycle |
| `0039` | Opaque credential references and credential grants |
| `0040` | Managed MT5 account/portfolio/instrument read sync |
| `0041` | Managed MT5 orders/deals/history coverage sync |
| `0042` | Bare-metal managed EA bootstrap, identity uniqueness, readiness, disconnect fencing |

## Retention and privacy

- Session expiry/revocation, pairing/grant expiry, worker leases, replay retention, alert history
  caps, and object-deletion work require scheduled cleanup/monitoring.
- Audit records must remain useful without carrying raw credentials or reusable tokens.
- Account deletion must fence execution/worker state and revoke grants before removing exact Windows
  credential records and owner metadata; retries must converge after partial failure.
- Backups of PostgreSQL do not contain managed broker passwords, but they remain sensitive because
  they include user, trading, session-hash, and audit metadata.

See [TRADE_EXECUTION_ARCHITECTURE.md](../../docs/TRADE_EXECUTION_ARCHITECTURE.md) and
[TRADE_PRODUCTION_SECURITY_RUNBOOK.md](../../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md) for the
execution invariants and incident procedures.
