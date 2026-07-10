# Backend Replay Phase 5 Runbook

_Implemented and repository-verified: 2026-07-10._

## Scope

Phase 5 extends a replay session from one chart to a synchronized layout of up
to four tracks. `single_chart` accepts exactly slot 0; `all_charts` accepts two
to four unique, contiguous slots. Every command still owns one optimistic
session version and one PostgreSQL transaction.

## Shared barrier and calendars

Session creation prepares an immutable dataset and progressive aggregate state
for every track. `replayInterval=auto` resolves to the largest supported
interval that every source dataset can build and that divides every selected
chart timeframe. Weekly/monthly tracks synchronize on daily source boundaries.

`step` and clock ticks compute one target `simulatedTime`, advance every track
to the latest source row at or before that target, process trading rows in
source order, persist all cursors, then emit ordered events. Sparse MT5 market
calendars may leave a track cursor unchanged while the shared time advances;
the engine does not fabricate candles across weekends or closed sessions.
Snapshots expose each derived `marketCalendar` identifier.

The barrier completes at the earliest pinned dataset end (or the configured
session end), so no track can run beyond another track's available history.
Seek, restart, and fork rebuild every track at the same requested simulated
time. Replay orders that read a market price require `trackId` in synchronized
mode, keeping fills and positions isolated to the selected chart.

## Frontend layout scope

The Layout menu now stores a one-, two-, or four-slot preset and exposes
`Current chart` versus `All charts` replay scope. The feature-flagged replay
controller sends the corresponding ordered track list; slot 0 remains the
active chart projection. Changing layout or scope closes and recreates the
shadow session instead of mutating an existing session's track set.

## Configuration and verification

`REPLAY_MAX_TRACKS_PER_SESSION` defaults to 4 and is capped by the database
slot constraint. No new migration is needed because `replay_session_mode` and
four replay-track slots were created in migration `0012`.

Repository verification passed:

- `go test ./...`
- `go vet ./...`
- `npm run typecheck`
- `npm run test:replay` (20 tests)
- `npm run lint` (zero errors; five pre-existing hook warnings)
- `npm run build`

Phase 6 enables the backend path by default and executes the mandatory legacy
frontend replay deletion contract.
