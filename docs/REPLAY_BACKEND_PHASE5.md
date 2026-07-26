# Backend Replay Phase 5 Runbook

_Implemented and repository-verified: 2026-07-10._

## Scope

Phase 5 extends a replay session from one chart to a synchronized layout of up
to four tracks. `single_chart` accepts exactly one track. `all_charts` accepts
one to four tracks with unique layout slots from 0 through 3; slots may be
sparse when a pane cannot participate at the selected time. Every command
still owns one optimistic session version and one PostgreSQL transaction.

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
controller sends the corresponding ordered track list. Expanding a layout
keeps `Current chart` as the default; synchronized `All charts` Replay requires
an explicit scope choice. Every track keeps its stable layout slot in both
modes. This pins a single-chart session to the pane where it was created when
focus moves to a sibling, while non-owner panes continue receiving live data.
In synchronized mode, the currently active pane is marked as the required
track.

Dataset availability errors include `slot`, `symbol`, `chartTimeframe`,
`firstAvailableTime`, and `lastAvailableTime`. If an optional sibling is
unavailable at session creation, the controller retries without only that
identified track. The sparse backend slot contract prevents the remaining
tracks from moving to different panes; the unavailable pane continues to show
live data and the Replay toolbar reports that state. The active pane and the
only track in `single_chart` mode are never silently removed.

Changing layout or scope closes and recreates the shadow session instead of
mutating an existing session's track set.

## Activation and playback latency

Create and fork responses include an optional `initialBars` projection on each
track. It is response-only and is not stored in the session snapshot rows. The
frontend prepares all fallback bars first (for compatibility with an older
backend), strips that transport field, and publishes the snapshot plus every
track's bars atomically. The previous live or Replay projection stays visible
through dataset preparation, so a slow MT5 history read cannot blank a chart.

The optimized create path is one HTTP request instead of create plus a
redundant session GET plus one bars GET per track. A four-pane session therefore
drops from six activation requests to one. While the backend owns an active
WebSocket, Step/Play state is applied from its ordered events rather than
re-fetching all revealed bars after each command. Seek/Restart retains the last
coherent projection until its authoritative reset hydration arrives.

During create/fork preparation the chart temporarily pauses competing live
history reads but continues rendering cached candles. Once connected, only
panes owned by Replay stop their live-history subscriptions; sibling panes in
`Current chart` mode remain live.

## Configuration and verification

`REPLAY_MAX_TRACKS_PER_SESSION` defaults to 4 and is capped by the database
slot constraint. No new migration is needed because `replay_session_mode` and
four replay-track slots were created in migration `0012`.

Repository verification passed:

- `go test ./...`
- `go vet ./...`
- `npm run typecheck`
- `npm run test:replay`
- `npx playwright test tests/browser/chartLayoutWorkspace.spec.ts tests/browser/replayMultiChartAvailability.spec.ts`
- `npm run lint` (zero errors; five pre-existing hook warnings)
- `npm run build`

Phase 6 enables the backend path by default and executes the mandatory legacy
frontend replay deletion contract.
