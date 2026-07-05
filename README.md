# SMC Trading Terminal

A professional, TradingView-style trading platform for **Smart Money Concept** traders —
combining a candle chart engine, a strict no-look-ahead **Replay Mode**, an automated
**SMC engine**, a **trade simulator**, a **journal**, and a **performance analytics**
dashboard.

This is a monorepo with two main packages:

- [`frontend/`](frontend/) — Next.js / React / TypeScript frontend application
- [`backend/`](backend/) — Go API server

## Quick start

### Frontend

```bash
cd frontend
npm install
npm run dev       # http://localhost:3000
```

### Backend

```bash
cd backend
go mod tidy
go run ./cmd/api  # http://localhost:8080
```

## Tech stack

| Layer    | Technology                                      |
| -------- | ----------------------------------------------- |
| Frontend | Next.js 16 · TypeScript · TailwindCSS · Zustand |
| Backend  | Go 1.22 · net/http · zerolog                    |
