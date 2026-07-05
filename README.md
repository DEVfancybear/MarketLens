# SMC Trading Terminal

TradingView-style trading terminal for Smart Money Concept traders. The platform includes a
browser charting workspace, drawing tools, Pine-style indicators, replay mode, a trade simulator,
journaling, analytics, and a Go API backend.

This repository is a monorepo with separate frontend and backend packages.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `frontend/` | Next.js / React / TypeScript trading terminal UI |
| `backend/` | Go API server using Fiber |
| `docs/` | Root-level monorepo documentation |
| `bridge/` | Local bridge tooling and integration experiments |

## Quick Start

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server: `http://localhost:3000`

### Backend

```bash
cd backend
go mod tidy
go run ./cmd/api
```

Backend dev server: `http://localhost:8080`

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, Jotai, Lightweight Charts |
| Backend | Go 1.22, Fiber, zerolog |

## Deployment Notes

- Vercel frontend deployments must use `frontend` as the project root directory.
- The Go backend is deployed as a separate service, not inside the Vercel frontend build.
- Root docs describe cross-project rules only. Frontend and backend implementation docs live in
  their own package folders.

## Documentation

- Root docs: [`docs/README.md`](docs/README.md)
- Frontend docs: [`frontend/docs/README.md`](frontend/docs/README.md)
- Backend docs: [`backend/docs/README.md`](backend/docs/README.md)
