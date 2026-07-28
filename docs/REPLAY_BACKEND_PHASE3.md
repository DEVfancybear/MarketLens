# Backend Replay Phase 3 Runbook

_Implemented and environment-verified: 2026-07-10._

## Scope

Phase 3 separates replay interval from chart timeframe and makes Go the data
authority for revealed chart bars. Replay tracks pin immutable MT5 rows at the
resolved playback interval; daily, weekly, and monthly Auto sessions pin `1D`
rows. Each command processes every source row through the target simulated-time
barrier, progressively updates the chart candle, and never sends unrevealed
source OHLC to the browser.

Phase 3 still supports one `single_chart` track. Multi-layout synchronization
belongs to Phase 5 and replay trading remains disabled until Phase 4.

## Database and configuration

No new migration is required. Phase 3 uses `replay_dataset_bars` and the
versioned JSON in `replay_tracks.aggregate_state`, both introduced by migration
`0012`. The expected local database remains `version=13 dirty=false`.

```env
REPLAY_ENGINE_ENABLED=true
REPLAY_MAX_BARS_PER_TRACK=5000
REPLAY_DISCONNECT_GRACE=5s
REPLAY_ACTOR_LEASE_TTL=5s
```

`NEXT_PUBLIC_REPLAY_BACKEND_V1=true` enables the Phase 3 projection. While the
flag is on, chart, indicator, SMC, and MTF consumers receive only backend
revealed aggregates. Turning it off restores the legacy data path as the
rollback strategy until final cutover.

## Replay interval and source resolution

- Auto Replay uses source rows matching the chart interval from `1m` through
  `4H`.
- Synchronized layouts use their largest shared Auto interval as the source for
  every track.
- `1D`, `1W`, and `1M` Auto charts use `1D` source rows.
- `auto` resolves to the chart interval for intraday/daily charts and `1D` for
  weekly/monthly charts.
- Explicit intervals must be available from the pinned source and evenly build
  the chart timeframe. Invalid choices return
  `422 unsupported_replay_interval`.
- `set_replay_interval` changes the interval without changing chart buckets or
  exposing more data; it cannot select an interval smaller than the immutable
  source pinned when the session was created.

One `step` advances `count × replayIntervalSeconds` of simulated market time.
All base rows inside that span are processed sequentially. Known gaps advance
the simulated-time barrier without fabricating candles.

## Progressive bars and recovery

Each source row updates a UTC-aligned intraday, day, Monday-week, or calendar
month bucket. Higher-timeframe candles remain `complete=false` until their
bucket closes. All rows are processed in source order; redundant repaint events
inside one atomic command are coalesced to the final state of each affected
chart bucket:

- `track.bar.upsert` creates or replaces one revealed aggregate;
- `cursor.advanced` records the source cursor and last revealed source time;
- `track.reset` tells clients to discard bars after seek/restart and rehydrate;
- `state.changed` includes status, speed, and resolved replay interval.

Initial load and recovery use:

```text
GET /api/v1/replay/sessions/:id/tracks/:trackId/bars
GET /api/v1/replay/sessions/:id/tracks/:trackId/bars?timeframe=4H
```

The ownership join is enforced before any source rows are read. Responses are
always bounded by the persisted track cursor. A seek outside the pinned window
returns `422 data_point_unavailable` with `firstAvailableTime` and
`lastAvailableTime`; the cursor is not moved.

## Verification

```powershell
cd backend
sqlc generate
go test ./...

cd ../frontend
npm run test:replay
npm run typecheck
npm run build
```

Local verification kept PostgreSQL at `version=13 dirty=false`. A real FTMO
MetaTrader 5 smoke pinned 5,000 `EURUSD` `1m` rows for a `15m` chart. A one-minute
step revealed exactly one additional source row, produced an ordered
`track.bar.upsert`, and the resulting partial OHLCV matched only the prior
partial plus that row. The same reveal barrier produced a 17-bar server `4H`
series. The smoke session/dataset were removed and all verification processes
were stopped.
