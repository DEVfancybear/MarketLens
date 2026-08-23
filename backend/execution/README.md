# Rust execution platform

This workspace is the production broker-neutral boundary for commands, account
risk, copy routing, durable outcomes, and MT5 EA sessions. It does not own chart
market data, Pine execution, or ordinary application CRUD.

## Crates

- `execution-domain`: versioned account, order, portfolio, command, and EA wire
  types. Monetary and quantity fields use decimal strings. Optional decimals
  accept either a missing field or explicit JSON `null`; numeric JSON values
  remain invalid to prevent floating-point loss.
- `execution-engine`: deterministic per-target normalization and risk routing.
- `execution-adapters`: the shared venue contract, MT5 queue adapter, and native
  API adapter boundary.
- `execution-gateway`: PostgreSQL-backed EA and loopback admin APIs.
- `mt5-vm-agent`: the Windows supervisor used by the Revision 15 bare-metal
  managed path. It owns a bounded,
  preallocated O(1) runtime registry, authenticated/replay-protected stdio,
  bounded per-account queues, startup throttling, Windows Job Object limits,
  separately installed and artifact-pinned terminal slots, isolated adapters,
  and lease/state fencing. It does not store broker credentials. Managed mode
  adds durable private-worker polling, redirected-stdin login, exact-PID
  named-pipe EA bootstrap, restart adoption/cleanup, and an explicit
  `bare_metal` substrate. Worker install/start stays separate from the backend
  runner. The older Phase 1 signed-agent validation remains historical evidence;
  production activation follows `../../docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`
  and still requires the R15-9 Demo gate.
- The Phase 2 MT5 VM control plane is PostgreSQL-backed inside
  `execution-gateway`: private worker enrollment/version negotiation, hashed and
  generation-fenced sessions, heartbeat/lease renewal, compatible placement,
  durable lifecycle command polling/redelivery, and idempotent acknowledgements.
  It remains disabled unless `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN` is configured;
  all routes stay on the loopback admin listener and no credential or order
  execution payload is accepted by this phase.
- Phase 3 adds owner-scoped account lifecycle state and one-time credential-grant
  hashes to `execution-gateway`. Rust never receives a broker password: the
  authenticated Go BFF owns Vault I/O and exchanges only opaque secret
  references over the loopback admin listener. See
  `../../docs/MT5_WINDOWS_VM_CONNECTOR_PHASE3.md`.

The gateway refuses to start without PostgreSQL and an unpredictable
`EXECUTION_ADMIN_TOKEN`. Commands and outcomes are tenant-scoped, target-scoped,
idempotent, and auditable. Unknown MT5 submission outcomes are reconciled and
never blindly resubmitted.

## Interfaces

- EA: `127.0.0.1:8790` by default. The public HTTPS Go relay forwards only the
  exact EA route allow-list to this loopback listener.
- Admin: `127.0.0.1:8791` by default. It is called only by the authenticated Go
  BFF and must never be publicly exposed.

Pairing tokens are 256-bit, single-use, expire in at most ten minutes, and are
bound to the authenticated owner. EA sessions are hashed at rest and bound to
the exact MT5 account identity.

## Checks

```powershell
cargo fmt --manifest-path backend/execution/Cargo.toml --all --check
cargo test --manifest-path backend/execution/Cargo.toml --workspace --all-targets
cargo clippy --manifest-path backend/execution/Cargo.toml --workspace --all-targets -- -D warnings
```

Production builds use `cargo build --locked --release` through the repository
`build-production.ps1`.
