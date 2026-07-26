# SMC Trading Terminal Backend

The production backend has four deliberately separated surfaces:

1. **Go API/BFF (`:8080`)** authenticates users, injects the owner identity into
   execution calls, owns ordinary CRUD, replay, alerts, and browser market data.
2. **Rust execution gateway (`:8790`, `:8791`)** owns deterministic risk checks,
   copy routing, per-target idempotency, durable commands/events, and venue
   adapter boundaries. Both listeners bind to loopback. Port `8791` is internal
   admin traffic only; Go relays an exact allow-list of public EA routes to
   `8790`.
3. **Common MT5 EA** is attached once per terminal/account. It supports FTMO,
   Exness, and other MT5 brokers without broker-specific binaries or passwords.
4. **MT5 market-data sidecar (`:8765`)** is private and read-only. It is not an
   order connector and cannot authorize execution.

Demo and Live MT5 accounts follow the same path. A broker's own
`trade_allowed`, Algo Trading, symbol rules, and the server-side risk policy
still fail closed.

## Production

From the repository root, the only normal production command is:

```powershell
.\run-backend-production.ps1
```

The runner builds both `backend/bin/api.exe` and
`backend/bin/execution-gateway.exe`, applies migrations before replacement,
starts the private market-data process, starts Rust before Go, and verifies all
health gates. See the repository `AGENTS.md` for recovery-switch policy.

Required execution configuration:

```dotenv
DATABASE_URL=postgres://...
EXECUTION_GATEWAY_BIND=127.0.0.1:8790
EXECUTION_ADMIN_BIND=127.0.0.1:8791
EXECUTION_EA_URL=http://127.0.0.1:8790
EXECUTION_ADMIN_URL=http://127.0.0.1:8791
EXECUTION_ADMIN_TOKEN=at-least-32-random-characters
EXECUTION_DATABASE_MAX_CONNECTIONS=10
```

The public EA URL is the existing Go API path, for example
`https://api.tradingterminal.io.vn/execution-ea`. Go forwards only the exact
health/session/poll/event allow-list to `:8790`. Never publish either Rust port
directly or place `EXECUTION_ADMIN_TOKEN` in the browser or EA.

## MT5 account setup

1. In the Trade workspace, select **Add → Download MT5 EA** and copy the
   downloaded `SMCExecutionEA.ex5` into the terminal's Experts folder.
2. Add the public EA URL to MT5's WebRequest allow-list.
3. Attach the EA to one chart and enter the five-minute one-time pairing token
   generated in the Trade workspace.
4. Enable Algo Trading.

MT5 supports one active account per terminal, so run one terminal per account.
The same EA binary is used for all brokers. The derived account identity is
tenant-bound and stable for `owner + server + login`; raw credentials are never
stored.

## Development checks

```powershell
go test ./internal/execution ./internal/settings ./internal/config ./internal/httpserver ./cmd/api
```

```powershell
cargo test --manifest-path execution/Cargo.toml --workspace --all-targets
```

Publish the EA with `bridge/mt5_ea/Publish-SMCExecutionEA.ps1`. It requires
MetaEditor to report `0 errors, 0 warnings` and produces a verified frontend
download plus SHA-256 checksum.

## Structure

```text
backend/
  cmd/api/                    Go API entry point
  internal/execution/         authenticated BFF for Rust admin API
  execution/
    crates/execution-domain/  versioned broker-neutral types
    crates/execution-engine/  deterministic risk and copy routing
    crates/execution-adapters/ venue adapter contract
    crates/execution-gateway/ durable EA/admin gateway
  bridge/mt5_ea/              common broker-neutral MT5 EA
  bridge/mt5_stream/          private read-only market-data process
  migrations/0026_*           execution platform schema
  migrations/0027_*           irreversible legacy credential removal
```

The historical FTMO Connector/verifier code and routes no longer exist.

See `../docs/TRADE_EXECUTION_ARCHITECTURE.md` and
`../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md` for the detailed broker-neutral
design, threat model, production gates, and native-venue enablement policy.
