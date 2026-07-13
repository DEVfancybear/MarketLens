# Backend Replay Phase 6 Runbook

_Implemented and repository-verified: 2026-07-11._

## Scope

Phase 6 completes the Replay authority cutover. Authenticated users use the Go
session actor by default. The frontend sends REST commands, applies ordered
WebSocket events, replaces stale projections from complete snapshots, and
renders only server-revealed bars. It does not advance time, aggregate replay
candles, request provider history for an active session, or process Replay
orders/fills locally.

`NEXT_PUBLIC_REPLAY_BACKEND_V1=false` remains a deployment kill switch. It
disables Replay UI and never selects a deleted browser engine.

## Mandatory deletion proof

Deleted production modules:

- `src/hooks/useReplayPlayback.ts`
- `src/hooks/useReplayBackendShadow.ts`
- `src/hooks/useMtfSnapshotSeries.ts`
- `src/hooks/useVisibleCandles.ts`
- `src/services/replayEngine.ts`
- `src/services/replay/backendReplayV1.ts`
- `src/store/replayStore.ts`

The cutover also removes Replay reconciliation/history branches from
`useMarketData`, feeds the normal simulator from live candles only, projects
chart/indicator/SMC input from `replayClientStore`, and routes rewind with
trading state through a backend fork. Alert creation is disabled during Replay
while existing live alerts and watchlists remain active.

Legacy helper/known-gap frontend tests and compiler entries were removed. The
retained frontend suite covers kill-switch/auth/loading/error controls, UTC
selection requests, ordered event/duplicate/gap behavior, stale snapshot
rejection, reconnect replacement, progressive bars, layout DTOs, isolated
trading projection, and viewport geometry.

## Boundary enforcement

`npm run check:replay-client-boundary` scans the frontend source and fails if a
mandatory file or removed identifier returns, if Replay UI imports full chart
history or local trade evaluation, if a Replay market timer appears, or if an
unapproved module writes projection snapshots. ESLint also restricts Replay UI
imports. `.github/workflows/ci.yml` runs the boundary check before Replay tests,
typecheck, and production build.

## Verification

### Sparse-market playback continuity (2026-07-13)

Replay session preparation retains the normal 70/30 history/future window, but
probes farther forward when the returned candle tail does not cover the
requested `before` boundary. A future-row count alone is insufficient: a
Friday 23:30 selection may still contain a complete 15-minute source interval
while the page ends inside the weekend. The probe is driven by returned time
coverage rather than a hard-coded Forex calendar, so it also handles daily
sources, holidays, broker closures, and 24/7 instruments. Creation rejects a
dataset with no real row after the selected cursor instead of persisting a
session that is already effectively complete.

When an actor step lands entirely inside a market gap, the shared simulated
clock advances to the earliest next stored row across the session tracks. No
synthetic candles are created. On the exact reported flows, selecting
`2026-07-10 23:30 UTC` or `23:45 UTC` and pressing Play advances the cursor to
the real `2026-07-13 00:00 UTC` row while status remains `playing`; Play/Pause
therefore stays usable on desktop and mobile clients, including at 10x.

Regression coverage includes 1m and 1D history probing across the weekend,
rejection of a dataset with no playable future row, 1x and 10x
`play -> __clock_step`, and synchronized sparse-gap barriers.

### Selection, First-day viewport, and lifecycle hardening (2026-07-13)

The backend-authority boundary remains unchanged. The follow-up closes the full
`Select bar -> Select date -> First day` path on desktop and mobile:

- MT5 history pagination reuses a cache entry only when the cached range covers
  the requested `before` cursor. A newer cached tail triggers a bridge fetch.
- Replay forks may clamp the visible partial bucket only to the first available
  source row. Requests before the dataset, or synchronized tracks that do not
  cover the selected time, remain validation errors.
- API errors that expose an HTTP status are logged with that status, so a typed
  Replay validation response remains `422` in both the response and request log.
- The frontend gives every hydrated session and reset a deterministic 120-bar
  logical range. A one-bar First-day result therefore remains a narrow candle
  instead of being expanded by `fitContent()`.
- Selection owns chart input through the shared interaction lock. Mobile gets a
  center-seeded selector, pointer-capture fallbacks, confirm/cancel controls, and
  an accessible keyboard slider.
- Chart callbacks, queued animation frames, and deferred `chart.remove()` calls
  are generation-guarded to prevent stale work from touching a disposed canvas.

Regression coverage includes backend cache/fork/logging tests, frontend Replay
state/viewport/lifecycle tests, and browser flows for desktop First day plus
mobile selection, confirm, cancel, and chart navigation.

### Replay timing and rendering follow-up (2026-07-11)

The Phase 6 authority boundary is unchanged, but playback delivery and chart
presentation now use a bounded batching pipeline:

```text
actor clock (speed + elapsed time)
  -> one __clock_step { count } transaction
  -> aggregate/finalize source rows + isolated ledger
  -> track.bars.batch + cursor.advanced
  -> replayClientStore timestamp merge
  -> PriceChart series.update() + requestAnimationFrame interpolation
```

- Auto interval follows the current single-chart timeframe or the largest
  supported common interval in synchronized layouts. Changing timeframe/layout
  replaces the session at its current simulated time and recalculates Auto.
- Speeds `>= 1x` batch approximately `speed` intervals per second; elapsed-time
  catch-up compensates for transaction latency and the first fast tick begins
  immediately after Play.
- The server emits a finalized overlap candle plus newly revealed candles in one
  batch. The frontend finalizes that overlap first and animates only the new
  candles, avoiding repeated full-series `setData()` calls.
- Empty trading ledgers take a one-query fast path. Deterministic row-by-row
  processing remains enabled whenever pending orders or non-zero positions
  exist.
- Speed slider traffic is coalesced latest-wins so Play cannot sit behind stale
  `set_speed` requests. Paused/completed/reconnected views always snap back to
  authoritative data.

Observed local PostgreSQL validation after the fast path showed successive
clock commits approximately 1.24-1.44 seconds apart instead of the previous
multi-second/per-row stall; a test session advanced continuously to its dataset
end. Exact latency still depends on database location and active trading state.

Passed on 2026-07-11:

- `npm run typecheck`
- `npm run lint` (zero errors; five pre-existing hook warnings)
- `npm run check:replay-client-boundary` (282 source files)
- `npm run test:replay` (21 tests)
- `npm run test:chart` (61 tests)
- `npm run build`
- `go test ./...`
- `go vet ./...`

Deployment validation should still exercise the complete authenticated Replay
flow against PostgreSQL and a real MT5 history source, including disconnect,
reconnect, command conflict, fork, synchronized tracks, trading report, and the
documented performance gates. That operational validation does not restore or
retain any local Replay authority.
