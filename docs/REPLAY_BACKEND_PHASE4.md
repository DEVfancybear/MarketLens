# Backend Replay Phase 4 Runbook

_Implemented and environment-verified: 2026-07-10._

## Scope

Phase 4 gives every trading-enabled replay session its own PostgreSQL account,
orders, fills, net positions, equity curve, and report. The replay actor applies
each newly revealed base row to the ledger in sequence inside the same database
transaction as cursor advancement, events, and checkpoints. Normal simulator
and MT5 state are never read or written by the replay ledger.

## Database

Migration `0014_replay_trading` adds `replay_accounts`, `replay_orders`,
`replay_fills`, `replay_positions`, and `replay_equity_points`, plus ownership
foreign keys, idempotent fill constraints, enums, and `updated_at` triggers.
The verified local schema is `version=14 dirty=false`.

## Trading contract

Session creation accepts `trading.enabled`, starting equity, base currency,
commission metadata, and the audited `conservative_ohlc` bar path model.
Supported commands are `place_order`, `cancel_order`, `close_position`,
`update_order`, and `reset_trading`.

Every fill records its source `dataset_seq`. Gap orders fill at the first
executable open. When both brackets occur in one source bar, bullish bars use
`open -> low -> high -> close`; bearish bars use
`open -> high -> low -> close`.

Backward `seek`/`restart` after a fill returns `409 rewind_requires_fork` unless
the command includes `resetTrading=true`. Alternatively,
`POST /api/v1/replay/sessions/:id/fork` creates a clean higher-generation
session over the same immutable dataset at the requested earlier time.

## Projection, report, and verification

Snapshots include an optional read-only `trading` projection. The Trade UI
uses it for the ticket, account, orders, positions, chart levels, and report
export. Normal simulator feeding and MT5 execution are suspended during replay.

`GET /api/v1/replay/sessions/:id/report` returns JSON; `?format=csv` exports
fills. Verification passed `sqlc generate`, `go test ./...`, 18 replay client
tests, TypeScript typecheck, and the production Next.js build.

Phase 5 adds synchronized layouts. Phase 6 deletes the transitional frontend
clock and rollback-only replay paths.
