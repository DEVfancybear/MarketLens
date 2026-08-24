# Backend architecture

MarketLens separates browser authentication, execution authority, broker adaptation, credentials,
market data, and persistence so no browser or broker adapter can bypass server-side policy.

## Runtime boundaries

1. **Go API/BFF (`:8080`)**
   - Fiber HTTP/WebSocket server for browser-facing APIs.
   - Verifies Firebase Google identities, owns backend sessions, injects the authenticated owner,
     applies Origin/rate-limit/security middleware, and relays an exact execution allow-list.
   - Owns workspace CRUD, alerts, replay, journal, simulated trading, trade authorization, and the
     browser-facing market-data fan-out.
2. **Rust execution gateway (`127.0.0.1:8790` and `127.0.0.1:8791`)**
   - `127.0.0.1:8790` is the common MT5 EA listener.
   - `127.0.0.1:8791` is the internal admin and managed-worker listener.
   - Owns deterministic risk, account lifecycle, copy routing, idempotency, durable commands,
     reconciliation, prop-risk policy, and broker-neutral adapter contracts.
3. **Common MT5 EA**
   - One EA per terminal/account for FTMO, Exness, and other MT5 brokers.
   - Receives already-authorized commands, runs terminal/broker checks, submits them, and returns
     portfolio, instrument, transaction, and command evidence.
   - Current gateway minimum is EA `1.26`.
4. **MT5 Windows worker/agent**
   - Supervises bounded terminal/adapter slots and the managed common-EA bootstrap path.
   - Uses private, authenticated, replay-protected, generation/lease-fenced control sessions.
   - The bare-metal managed path is activation-gated by the operator runbook and Demo evidence.
5. **Windows Credential Manager**
   - Stores generic managed broker credentials behind opaque random references under the Go API's
     stable Windows identity.
   - Go performs local WinCred I/O; Rust and PostgreSQL never receive or retain a broker password.
   - Workers consume one-time, worker/session/lease/command-bound credential grants.
6. **PostgreSQL**
   - Durable source of truth for users, sessions, workspace state, replay, execution state, audit,
     managed-worker lifecycle, and synchronized account data.
7. **Private MT5 market-data sidecar (`localhost:8765`)**
   - Python adapter for symbol catalogs, ticks, history, and broker session observations.
   - Go consumes it and fans data out to browsers. It is read-only and cannot authorize orders.

## Exposure model

```text
Browser
  -> public HTTPS
  -> Go API/BFF :8080
       -> PostgreSQL
       -> Windows Credential Manager
       -> private MT5 stream localhost:8765
       -> Rust admin 127.0.0.1:8791

Common MT5 EA
  -> public HTTPS /execution-ea allow-list on Go
  -> Rust EA listener 127.0.0.1:8790

Managed MT5 Windows worker
  -> private authenticated Go/Rust worker routes
  -> Rust admin listener 127.0.0.1:8791
```

Only Go is internet-facing. Neither Rust listener nor the Python market-data sidecar may be
published. The public `/execution-ea` relay exposes only health, session creation, command polling,
and event upload.

## Trust and ownership rules

- Browser cookies identify a user but do not authorize a trade by themselves. Sensitive execution
  mutations require an active backend session and, when configured, a short-lived
  `X-Trade-Authorization` capability bound to the operation and payload.
- Go derives owner identity from the authenticated session. Client-supplied owner IDs are never
  authoritative.
- Rust is the execution authority. It validates account ownership, risk, venue capability,
  idempotency, liveness, instrument constraints, and command lifecycle before queueing work.
- Account identity is tenant-bound and derived with a server-side HMAC key from owner, broker
  server, and login. Raw login credentials are not an identity key.
- A successful MT5 submission is not proof of a fill. Broker events and reconciliation are
  authoritative, and unknown delivery outcomes are never blindly resubmitted.
- PostgreSQL is required for production. In-memory or browser-only state is not a production
  substitute for commands, events, sessions, audit, or managed lifecycle.

## Go package map

```text
backend/
  cmd/api/                 production HTTP API entry point
  cmd/migrate/             embedded migration runner
  cmd/mt5-stream/          standalone market-data diagnostic consumer
  internal/
    alerts/                alert state, evidence, history, push-worker contracts
    auth/                  Firebase verification, sessions, JWTs, cookies
    config/                environment loading and validation
    db/                    PostgreSQL pool and migration integration
    drawings/              drawings, templates, tool favorites
    execution/             authenticated BFF and exact EA relay
    health/                liveness and readiness
    httpserver/            Fiber app, middleware order, route mounting
    indicators/            indicator preset persistence
    journal/               journal and screenshot metadata
    layouts/               saved layouts
    mt5stream/             Go market-data consumer/cache/fan-out
    mt5credentials/        bounded credential domain and Windows Credential Manager adapter
    pineruntime/           backend indicator/Pine runtime endpoints
    pinescripts/           private scripts and public indicator store
    replay/                deterministic replay sessions and actor engine
    settings/              settings and notification integrations
    simtrading/            durable simulated accounts and positions
    tradeauth/             optional trade password and authorization capability
    watchlists/            watchlists, sections, order, preferences
    workspace/             authenticated bootstrap envelope
  bridge/
    mt5_ea/                common broker-neutral execution EA
    mt5_session/           read-only native session-schedule helper
    mt5_stream/            private Python market-data adapter
    mt5_vm/                validation harnesses and worker adapter
  execution/               Rust workspace
  migrations/              ordered PostgreSQL migrations
```

## Rust execution workspace

- `execution-domain`: versioned wire/domain types and validation.
- `execution-engine`: deterministic normalization, risk, and multi-target routing.
- `execution-adapters`: venue adapter boundary.
- `execution-gateway`: EA/admin HTTP listeners, PostgreSQL persistence, copier, reconciliation,
  managed control plane, and read synchronization.
- `mt5-vm-agent`: bounded Windows process/slot supervisor and managed worker client.

See [the execution workspace README](../execution/README.md) for crate-specific checks.

## Request flows

### Ordinary protected API

```text
request -> request ID/recovery/security/Origin/CORS middleware
        -> access-cookie authentication
        -> owner-scoped handler/service/repository
        -> PostgreSQL
        -> standard JSON/error envelope
```

### Browser execution

```text
browser -> Go auth + active-session + rate limits
        -> optional payload-bound trade authorization
        -> Rust admin API with server token and owner identity
        -> risk/idempotency/adapter routing
        -> durable target command
        -> EA poll -> MT5 -> event/reconciliation -> browser state
```

### Managed account connection

```text
browser -> Go reserves owner-scoped account and writes credential to Windows Credential Manager
        -> Rust places lifecycle work on a compatible private worker
        -> worker consumes a one-time credential grant
        -> isolated terminal login and exact-PID common-EA bootstrap
        -> snapshots/history synchronized to Rust/PostgreSQL
```

Deletion and credential rotation are multi-step, fail-closed flows. Go finalizes credential-store
deletion only after Rust has fenced or removed the corresponding lifecycle state.

## Adding a backend endpoint

1. Put domain logic and DTO validation in the owning `internal/<domain>` package.
2. Scope protected resources from authenticated locals, never a body/query owner ID.
3. Register the route under `/api/v1` from its handler and wire it in `cmd/api/main.go` and
   `internal/httpserver/server.go`.
4. Add unit/handler tests, ownership/error cases, and an integration test when persistence or an
   external boundary changes.
5. Update [API.md](API.md), [CONFIGURATION.md](CONFIGURATION.md), and
   [DATABASE.md](DATABASE.md) when their contracts change.
