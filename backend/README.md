# SMC Trading Terminal Backend

Go API server for the SMC Trading Terminal.

Backend framework decision: **Fiber**.

## Quick Start

```bash
# Install dependencies
go mod tidy

# Run the server
go run ./cmd/api
```

Default server: `http://localhost:8080`

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `APP_ENV` | `development` | Runtime environment |

## Project Structure

```text
backend/
  cmd/api/main.go              # Entry point
  internal/
    config/config.go           # Environment config
    httpserver/server.go       # Fiber app and server setup
    health/handler.go          # Health-check endpoint
    middleware/                # Shared Fiber-compatible middleware
  docs/                        # Backend architecture and API docs
```

New backend code should use Fiber handlers, route groups, and middleware.
