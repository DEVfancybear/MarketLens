# Backend Architecture

## Overview

The backend has four relevant runtime components:

1. **Go API** - the primary Fiber HTTP server handling web requests.
2. **Python MT5 Bridge** - an isolated sidecar service that manages FTMO broker connectivity over
   browser-facing WebSockets on port 8787.
3. **Python MT5 Market-Data Sidecar** - a private tick/history bridge consumed by Go on port 8765.
4. **Python MT5 Verifier** - a short-lived helper launched by the Go API to verify one signed-in
   user's saved MT5 credentials.

The long-running Python bridges remain outside the Go HTTP request path and do not share memory or
state with the Go server. The verifier is deliberately separate from those bridges: the API sends
one credential request over stdin, reads one bounded sanitized JSON response, and never exposes the
password in command arguments or API responses. Verifier processes are serialized because the
native MetaTrader terminal owns one active local account session.

Current implementation note: the Fiber API and migrations through `0023` are implemented. The
runtime includes authenticated workspace sync, drawings/revisions, alerts with dynamic technical
targets and evidence verification, layouts, replay/trading, journal/screenshot contracts, and the
MT5 stream plus per-user verification. Keep business logic outside handlers so modules remain
testable without an HTTP server.

## Package Layout

```text
cmd/api/main.go          # Entrypoint, wires config and starts the server
internal/
  config/                # Environment-based configuration
  httpserver/            # HTTP app setup, routing, middleware, lifecycle
  health/                # Health-check endpoint
  auth/                  # Firebase verification, sessions, cookies, auth routes/middleware
  settings/              # User settings and integration repos/handlers
  mt5verify/             # Bounded stdin-only MT5 verifier process adapter
  workspace/             # Sync bootstrap envelope, including alert lifecycle state
  alerts/                # Fixed/dynamic alert targets, evidence validation, and history
  drawings/              # Drawing persistence and revision/tombstone sync
  layouts/               # Layout persistence and bootstrap
  replay/                # Replay sessions, datasets, clock, and trading
  journal/               # Journal/screenshot API and retention
  middleware/            # Shared Fiber middleware
bridge/                  # Python MT5 helpers and WebSocket sidecars
  ftmo_mt5/              # FTMO execution bridge (:8787) + verifier helper
  mt5_stream/            # Go-consumed market-data bridge (:8765)
```

## Python MT5 Execution Bridge (Sidecar)

The `bridge/` directory contains a standalone Python WebSocket service for FTMO MT5 broker
integration. It is an **isolated sidecar** - it does not share memory, state, or request paths with
the Go API.

Key characteristics:

- Runs as a separate OS process (`python -m bridge.ftmo_mt5.service`).
- Communicates with the frontend directly over WebSockets (port 8787 by default).
- Handles broker credentials, order execution, risk guards, symbol metadata, and audit logging.
- Does not depend on the Go server and can be started/stopped independently.

## MT5 Market Data And Verification

`bridge/mt5_stream` publishes private market data on `ws://localhost:8765`; the Go API consumes it
and exposes authenticated/public HTTP/WebSocket market-data routes to the frontend. Separately,
`internal/mt5verify` launches `bridge/ftmo_mt5/verify_account.py` for the authenticated Verify
endpoint. That helper has no listening port and is not the long-running execution bridge. In
production it must target a dedicated broker terminal installation; sharing the market-data
terminal would let a credential check switch or disconnect the live quote session.

## Request Flow

```text
Client
  -> HTTP app
  -> Shared middleware
  -> Route group
  -> Handler
  -> Service/domain code
  -> JSON response
```

## Design Decisions

- **Fiber**: Go web framework for API routing and middleware.
- **zerolog**: structured JSON logging suitable for production.
- **Graceful shutdown**: the API process should drain in-flight requests before exiting.
- **Internal packages**: backend code under `internal/` is private to this service.

## Adding A New Endpoint

1. Create a package under `internal/` for the domain area, for example `internal/marketdata/`.
2. Keep request/response DTOs near the handler.
3. Expose a route registration function that accepts a Fiber router or route group.
4. Register the route from `internal/httpserver/server.go`.
5. Add tests for domain logic separately from handler plumbing when possible.
