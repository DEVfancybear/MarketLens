# Backend Architecture

## Overview

The backend has two components:

1. **Go Fiber API** - the primary HTTP server handling web requests.
2. **Python MT5 Bridge** - an isolated sidecar service that manages FTMO broker connectivity over
   WebSockets.

The Python bridge runs as a separate process. It is not part of the Go Fiber request path and does
not share memory or state with the Go server.

Fiber is the common HTTP layer for routing, middleware, request parsing, response writing, and
future API modules. Keep business logic outside handlers so modules remain testable without an HTTP
server.

## Package Layout

```text
cmd/api/main.go          # Entrypoint, wires config and starts the server
internal/
  config/                # Environment-based configuration
  httpserver/            # Fiber app setup, routing, middleware, lifecycle
  health/                # Health-check endpoint
  middleware/            # Shared Fiber-compatible middleware
bridge/                  # Python MT5 WebSocket bridge (sidecar)
  ftmo_mt5/              # FTMO broker integration
```

## Python MT5 Bridge (Sidecar)

The `bridge/` directory contains a standalone Python WebSocket service for FTMO MT5 broker
integration. It is an **isolated sidecar** - it does not share memory, state, or request paths with
the Go Fiber API.

Key characteristics:

- Runs as a separate OS process (`python -m bridge.ftmo_mt5.service`).
- Communicates with the frontend directly over WebSockets (port 8787 by default).
- Handles broker credentials, order execution, risk guards, symbol metadata, and audit logging.
- Does not depend on the Go server and can be started/stopped independently.

## Request Flow

```text
Client
  -> Fiber app
  -> Shared middleware
  -> Route group
  -> Handler
  -> Service/domain code
  -> JSON response
```

## Design Decisions

- **Fiber**: primary Go web framework for API routing and middleware.
- **zerolog**: structured JSON logging suitable for production.
- **Graceful shutdown**: the API process should drain in-flight requests before exiting.
- **Internal packages**: backend code under `internal/` is private to this service.

## Adding A New Endpoint

1. Create a package under `internal/` for the domain area, for example `internal/marketdata/`.
2. Keep request/response DTOs near the handler.
3. Expose a route registration function that accepts a Fiber router or route group.
4. Register the route from `internal/httpserver/server.go`.
5. Add tests for domain logic separately from handler plumbing when possible.
