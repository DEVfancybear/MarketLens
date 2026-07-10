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

Passed on 2026-07-11:

- `npm run typecheck`
- `npm run lint` (zero errors; five pre-existing hook warnings)
- `npm run check:replay-client-boundary` (282 source files)
- `npm run test:replay` (19 tests)
- `npm run build`
- `go test ./...`
- `go vet ./...`

Deployment validation should still exercise the complete authenticated Replay
flow against PostgreSQL and a real MT5 history source, including disconnect,
reconnect, command conflict, fork, synchronized tracks, trading report, and the
documented performance gates. That operational validation does not restore or
retain any local Replay authority.
