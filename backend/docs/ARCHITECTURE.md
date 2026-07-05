# Backend Architecture

## Overview

The Go backend follows a standard layered architecture:

```
cmd/api/main.go          → Entry point, wires dependencies, starts the server
internal/
  config/                → Environment-based configuration
  httpserver/            → HTTP server setup, routing, middleware chain
  health/                → Health-check endpoint
  middleware/             → Shared HTTP middleware (logging, etc.)
```

## Request flow

```
Client
  │
  ▼
┌─────────────────────┐
│  middleware.Logging  │  ← Logs method, path, status, latency
├─────────────────────┤
│  http.ServeMux       │  ← Stdlib routing (Go 1.22+ patterns)
├─────────────────────┤
│  Handler             │  ← Domain handler (health, etc.)
└─────────────────────┘
```

## Design decisions

- **Stdlib `net/http`** — no framework dependency; Go 1.22+ routing patterns provide
  method-aware routing (`GET /health`) without third-party routers.
- **`zerolog`** — structured, zero-allocation JSON logging suitable for production.
- **Graceful shutdown** — `signal.NotifyContext` listens for SIGINT/SIGTERM and drains
  in-flight requests before exiting.

## Adding a new endpoint

1. Create a handler package under `internal/` (e.g. `internal/marketdata/`)
2. Export a `RegisterRoutes(mux *http.ServeMux)` function
3. Call it from `internal/httpserver/server.go`
