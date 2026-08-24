# MT5 Windows VM connector Phase 2 durable control plane

- Status: **repository implementation complete; operational activation gated**
- Review date: 12 August 2026
- Scope: private worker registry, fenced placement leases, scheduler, durable
  lifecycle commands, and worker acknowledgements
- Explicitly excluded: credential storage/retrieval, public account-connect API,
  broker order execution, and production worker density increases

Phase 2 adds the durable server-side control plane without weakening the open
Phase 1 security gates. It is disabled unless an independent worker bootstrap
secret is configured, and every route remains on the execution gateway's
loopback admin listener.

## 1. Delivered data model

Migration `0038_mt5_vm_control_plane` is additive and creates:

- `execution_mt5_vm_workers`: protocol/runtime/image versions, bounded capacity,
  drain/health state, heartbeat expiry, monotonically increasing worker session
  generation, and only a SHA-256 worker-session token hash;
- `execution_mt5_vm_accounts`: non-secret runtime binding and synchronization
  state. It stores neither a raw MT5 login nor password;
- `execution_mt5_vm_account_leases`: one durable account placement with worker
  session generation, monotonically increasing lease generation, expiry, and a
  terminal release reason;
- `execution_mt5_vm_control_commands`: non-trading lifecycle commands with
  idempotency key, absolute expiry, bounded dispatch lease/redelivery state, and
  idempotent received/succeeded/failed acknowledgements;
- additive `execution_accounts.connector_kind` values `ea | windows_vm` so the
  existing EA transport remains unchanged.

All placement, lease, command, and acknowledgement state is PostgreSQL-backed;
gateway restart loses no control-plane authority.

## 2. Private worker contract

The shared Rust DTO module is
`execution-domain::mt5_vm_control`. Protocol v1 supplies strict, unknown-field
rejecting envelopes for hello, heartbeat, lease claims, poll, lifecycle command,
and acknowledgement messages. Durable payload/result bodies cross the worker
wire as JSON text and are parsed again before PostgreSQL writes.

Private routes:

| Route | Authentication | Purpose |
| --- | --- | --- |
| `POST /v1/mt5-vm/workers/hello` | worker bootstrap token | Negotiate protocol and exchange for a worker session |
| `POST /v1/mt5-vm/workers/heartbeat` | worker bearer session | Renew the worker and exact reported account leases |
| `POST /v1/mt5-vm/workers/poll` | worker bearer session | Lease/redeliver durable lifecycle commands |
| `POST /v1/mt5-vm/workers/ack` | worker bearer session | Persist idempotent received/final acknowledgement |
| `GET /v1/admin/mt5-vm/workers` | execution admin token | Inspect registry health/capacity without tokens |
| `POST /v1/admin/mt5-vm/commands` | execution admin token | Queue stop/reconcile for an exact active lease |

`EXECUTION_MT5_VM_BOOTSTRAP_TOKEN` is optional but must contain at least 32
characters when present. If absent, worker enrollment returns a fail-closed
service-disabled response; the existing EA gateway continues normally. The
bootstrap token is not a worker session and cannot call admin routes. A hello
returns a 256-bit random session token, stores only its hash, and increments the
worker session generation. Re-enrollment immediately fences commands and leases
owned by the replaced session.

## 3. Scheduler and fencing behavior

The scheduler runs inside `execution-gateway` and:

1. expires missed worker heartbeats, account leases, and command deadlines;
2. moves managed accounts to `reconnecting` and session accounts to
   `credentials_required` after ownership loss;
3. claims the oldest queued account that currently has an eligible worker with
   `FOR UPDATE SKIP LOCKED`, so an incompatible account cannot starve the queue;
4. selects only healthy, non-draining workers matching the required protocol
   and runtime version;
5. enforces the Phase 2 ceiling of four scheduled terminals per worker;
6. increments the durable account lease generation on every reassignment;
7. commits the binding, lease, and `provision_account` command atomically.

Poll dispatch requires the current worker session and current unexpired account
lease. A stale worker cannot poll or acknowledge a command after worker restart,
heartbeat loss, reassignment, or lease expiry. A provision success queues an
idempotent reconciliation command. The account becomes `ready` only when the
result explicitly proves account, portfolio, and instrument synchronization.

Lifecycle payloads recursively reject keys that could contain login, password,
credential, secret reference, token, or authorization material. Phase 2 accepts
only `provision_account`, `stop_account`, and `reconcile_account`; it has no
`ExecuteCommand`/order mutation path.

## 4. Repository verification

Verified on the Windows development host:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" check `
  --manifest-path backend/execution/Cargo.toml -p execution-gateway

& "$env:USERPROFILE\.cargo\bin\cargo.exe" test `
  --manifest-path backend/execution/Cargo.toml -p execution-gateway
```

The last runnable gateway suite passed 64 tests, including Phase 2 protocol
negotiation, separate bootstrap/admin authentication, four-slot ceiling, nested
secret rejection, wire shape, idempotent/fail-closed acknowledgement
transitions, complete-sync ready gate, and migration boundary. After the final
payload-filter and scheduler starvation hardening, `cargo check`, format, and
gateway clippy pass, but Windows Smart App Control blocked the newly rebuilt
unsigned test executable before it ran (`os error 4551`). This is a host policy
block, not a compile or test assertion failure, and a fresh post-hardening test
execution remains part of the signed-host evidence. `mt5-vm-agent` clippy also
passes. Gateway clippy allows the four pre-existing Rust 1.97 lint classes in
legacy copier/risk code for that invocation; no other warning is present.
PowerShell parsing validates the production runner change.

## 5. Operational activation gate

Fresh disposable evidence (2026-08-21) from
`tools/run-mt5-phase2-operational.ps1` passed two deterministic attempts. Each
attempt started two gateway processes against loopback PostgreSQL 17.11,
survived sequential restart, rotated the worker session, fenced five stale HTTP
surfaces, increased the lease generation, and asserted exactly one current
`provision_account` command. Tokens and the disposable runtime were removed.
This closes the repository/disposable Phase 2 gate; it does not create a signed
production worker artifact or close the separate Phase 1 broker gates.

Repository implementation is complete, but do not call Phase 2 operationally
active until all of the following are recorded:

1. apply migration `0038` to a disposable PostgreSQL environment and exercise
   restart persistence with two gateway processes;
2. configure a unique worker bootstrap secret through the production secret
   system and keep it distinct from `EXECUTION_ADMIN_TOKEN`;
3. connect a signed/reputable VM agent over an approved private outbound
   transport, rotate its worker session, and prove the old session cannot renew,
   poll, or acknowledge;
4. reassign a disposable managed account and prove the generation increases,
   the stale command is fenced, and the new worker receives exactly one durable
   provision command;
5. keep the remaining Phase 1 signed-agent, independent FTMO web, and live
   two-account isolation gates open until their evidence exists.

Do not expose the loopback listener publicly, put either control token in a
browser/EA, store MT5 credentials in a lifecycle payload, or add order execution
before the later credential and demo-execution phases.
