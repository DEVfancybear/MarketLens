# Backend Architecture

## Overview

The backend is a Go API service. The selected web framework is **Fiber**.

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
```

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
