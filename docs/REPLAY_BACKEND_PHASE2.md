# Backend Replay Phase 2 Runbook

_Implemented and environment-verified: 2026-07-10._

## Scope

Phase 2 makes Go authoritative for a single-chart replay clock while the
frontend still renders the legacy replay cursor as an instant rollback path.
The backend owns session status, speed, cursor advancement, simulated time,
command ordering, event sequence, disconnect pause, and restart recovery.

Phase 2 advances the immutable chart-timeframe rows pinned by Phase 1. Loading
1-minute base rows and progressively aggregating chart/MTF bars belongs to
Phase 3. Replay trading remains disabled until Phase 4.

## Migration and configuration

Apply migration `0013_replay_clock`:

```powershell
cd backend
go run ./cmd/migrate up
go run ./cmd/migrate version
```

Expected result is `version=13 dirty=false`. Runtime configuration:

```env
REPLAY_ENGINE_ENABLED=true
REPLAY_MAX_BARS_PER_TRACK=5000
REPLAY_DISCONNECT_GRACE=5s
REPLAY_ACTOR_LEASE_TTL=5s
REPLAY_CLEANUP_INTERVAL=1h
REPLAY_SESSION_RETENTION=720h
REPLAY_DATASET_RETENTION=168h
```

Set `NEXT_PUBLIC_REPLAY_BACKEND_V1=true` to enable the development shadow. The
shadow creates a matching backend session, mirrors legacy controls, consumes
ordered server events, and reports candle-time divergence in the development
console. It never writes server cursor/fill state into the legacy replay store.

## HTTP and WebSocket contract

Commands use `POST /api/v1/replay/sessions/:id/commands`:

```json
{
  "idempotencyKey": "client-generated-unique-key",
  "expectedVersion": 4,
  "type": "step",
  "payload": { "count": 2 }
}
```

Phase 2 supports `play`, `pause`, `step`, `seek`, `restart`, `set_speed`, and
`close`. Step count is limited to 1-100. Seek resolves to the dataset row at or
before the requested UTC time and never selects a future row.

Each committed mutation increments the session version once and persists the
session/track state, one or more events, a checkpoint, and the applied command
result in the same transaction. Repeating an idempotency key returns the stored
result with `duplicate=true`. A stale expected version returns HTTP `409` with
`error.code=version_conflict` and `details.currentVersion`.

Recovery APIs:

- `GET /api/v1/replay/sessions/:id` returns a complete snapshot including
  `lastEventSeq`.
- `GET /api/v1/replay/sessions/:id/events?afterSeq=N` returns up to 1,000
  ownership-scoped ordered events.
- `GET /api/v1/replay/sessions/:id/stream` upgrades to an authenticated
  WebSocket, sends a complete `snapshot` envelope first, then committed events.

The client applies only the exact next event sequence. It rejects duplicates,
stops on a gap, calls HTTP event recovery, and replaces its projection with a
fresh snapshot if the gap cannot be closed.

## Clock and recovery behavior

- One replay row advances every `1000 / speed` milliseconds, with a 16 ms floor.
- `step` is valid only while paused; every command is serialized by the session
  actor. While `playing`, the actor claims a durable owner/expiry lease on the
  session row and renews it every half `REPLAY_ACTOR_LEASE_TTL`.
- The lease claim is serialized inside the command transaction. A second API
  instance receives retryable `session_busy` while the current lease is active;
  after a process dies, the lease expires without depending on a pooler's
  PostgreSQL connection affinity.
- When the final row or configured end time is reached, status becomes
  `completed`.
- After the last WebSocket subscriber disconnects, the actor waits
  `REPLAY_DISCONNECT_GRACE` and commits `paused/no_subscribers`.
- API restart finds persisted `playing` sessions and atomically commits
  `paused/server_restart`. A session still owned by another healthy instance is
  retried until its lease is released or expires; wall-clock time is never
  caught up.
- The latest checkpoint checksum is validated before a lazy actor starts. A
  mismatch stops command processing instead of guessing state.

## Verification

```powershell
cd backend
sqlc generate
go test ./...

cd ../frontend
npm run test:replay
npm run typecheck
```

The local Windows environment was migrated from version 12 to 13 with
`dirty=false`. A real FTMO MetaTrader 5 `EURUSD`/`15m` dataset with 5,000 rows
passed: command idempotency, stale-version `409`, backend clock ticks, WebSocket
snapshot/events, ordered HTTP recovery, seek, restart, five-second disconnect
pause, checkpoint validation, and process restart recovery to
`paused/server_restart`. A separate multi-instance lease smoke verified durable
owner persistence, retryable contention, and recovery after orphan lease
expiry. Smoke sessions and their unreferenced datasets were removed afterward,
and verification processes were stopped.
