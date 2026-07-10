# Backend Replay Phase 1 Runbook

_Implemented: 2026-07-10._

## Scope

Phase 1 establishes an authenticated persistence and immutable-data boundary.
It does not advance simulated time. A created session is immediately returned
as `paused`; play/pause/step commands, event streams, progressive aggregation,
replay trading, and multi-chart synchronization belong to later phases.

The active frontend replay engine is unchanged. The new frontend module can
inspect a backend snapshot only when `NEXT_PUBLIC_REPLAY_BACKEND_V1=true`.
There is no automatic fallback from a backend session to a local replay session.

## Enable and migrate

Set these backend values:

```env
REPLAY_ENGINE_ENABLED=true
REPLAY_MAX_BARS_PER_TRACK=5000
REPLAY_CLEANUP_INTERVAL=1h
REPLAY_SESSION_RETENTION=720h
REPLAY_DATASET_RETENTION=168h
```

Apply the normal Go migration runner so `0012_replay_backend.up.sql` is applied:

```powershell
cd backend
go run ./cmd/migrate version
go run ./cmd/migrate up
go run ./cmd/migrate version
```

Replay routes mount only when PostgreSQL, Firebase auth, and the replay flag are
all configured. Every endpoint uses the existing httpOnly access cookie; an
unauthenticated request returns `401`, and a session owned by another user is
reported as `404`.

The frontend inspection client is enabled separately:

```env
NEXT_PUBLIC_REPLAY_BACKEND_V1=true
```

## Phase 1 HTTP contract

Create a pinned single-chart snapshot:

```http
POST /api/v1/replay/sessions
Content-Type: application/json

{
  "mode": "single_chart",
  "start": { "kind": "time", "time": "2026-05-01T09:30:00Z" },
  "endTime": null,
  "replayInterval": "auto",
  "speed": 1,
  "tracks": [
    { "slot": 0, "symbol": "EURUSD", "chartTimeframe": "15m" }
  ]
}
```

The response is `202 Accepted` with a `paused` snapshot. `GET
/api/v1/replay/sessions/:id` returns the same ownership-scoped reconnect
snapshot. `DELETE /api/v1/replay/sessions/:id` idempotently marks the owned
session `closed` and increments its version.

Each track includes its selected cursor row and `visibleThrough` time, plus the
dataset's `firstAvailableTime`, `lastAvailableTime`, source timeframe, interval,
row count, snapshot time, status, and SHA-256 checksum.

Phase 1 accepts exactly one track in slot `0`, `mode=single_chart`,
`start.kind=time`, and `replayInterval=auto`. Symbol names are normalized and
validated against the MT5 catalog when it is available. Unsupported input is
`400`; a valid requested time with no prepared data is `422` with
`data_point_unavailable`; corrupt provider OHLCV is reported as dataset
preparation failure.

## Dataset rules

The loader asks the existing MT5 history service for at most 5,000 rows at the
chart timeframe. It places the requested start near 70 percent through the
window, preserving older context and future rows in PostgreSQL. Future rows are
not returned in the Phase 1 snapshot.

Before persistence, candles are validated for finite values, nonnegative
volume, and valid OHLC bounds; timestamps are sorted and duplicate timestamps
use the final provider row. The checksum includes provider, symbol, timeframe,
interval, timestamp, and IEEE-754 OHLCV values in canonical byte order.

The requested time resolves to the candle at or before that time; it never
selects a future candle because the next open happens to be closer. A requested
end time must also fit inside the prepared immutable window.

Dataset creation uses a transaction-scoped PostgreSQL advisory lock keyed by
checksum. An existing ready checksum is reused. New bars are bulk-copied before
dataset readiness, session, and track are committed atomically, so a failed
request cannot expose a partial replay session. The create endpoint allows a
70-second backend budget and the typed browser client allows 75 seconds for a
cold MT5 history request.

## Retention and rollback

The cleanup worker deletes closed/failed sessions older than session retention
and then deletes old datasets only when no track references them. Each pass is
bounded to 100 rows. Active and paused sessions are never deleted by this job.

To rollback runtime behavior, set both replay flags to `false`; this disables
the new route/client path without activating it in the legacy UI. Run the down
migration only after accepting deletion of replay sessions/datasets and after
the API process is stopped.

## Verification

Repository verification completed for the Phase 1 implementation:

```powershell
cd backend
sqlc generate
go test ./...

cd ../frontend
npm run test:replay
npm run typecheck
```

Before enabling the feature in an environment, also verify migration version
`12`, start the API with `REPLAY_ENGINE_ENABLED=true`, authenticate through the
normal backend session exchange, and smoke-test create -> get -> close against
a real MT5 history source. Record the environment, time, symbol/timeframe, and
result below; never record cookies, database URLs, or Firebase credentials.

### Environment verification log

- Pending.
