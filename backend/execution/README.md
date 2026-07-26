# Rust execution platform

This workspace is the production broker-neutral boundary for commands, account
risk, copy routing, durable outcomes, and MT5 EA sessions. It does not own chart
market data, Pine execution, or ordinary application CRUD.

## Crates

- `execution-domain`: versioned account, order, portfolio, command, and EA wire
  types. Monetary and quantity fields use decimal strings.
- `execution-engine`: deterministic per-target normalization and risk routing.
- `execution-adapters`: the shared venue contract, MT5 queue adapter, and native
  API adapter boundary.
- `execution-gateway`: PostgreSQL-backed EA and loopback admin APIs.

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
