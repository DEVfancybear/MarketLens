# Replay Architecture

_Updated after backend Replay Phase 6 cutover: 2026-07-11._

## Authority boundary

Replay is authenticated and backend-owned. The Go/PostgreSQL session actor is
the only authority for simulated time, cursors, revealed bars, interval/MTF
aggregation, synchronized tracks, orders, fills, positions, and equity. The
browser never falls back to a local Replay engine.

```text
Replay controls / UTC selection candidate
  -> replayApi REST command with idempotency key + expected version
  -> Go session actor + PostgreSQL transaction
  -> ordered Replay events / complete reconnect snapshot
  -> replaySocket
  -> replayClientStore + replayTradingClientStore
  -> useChartSeries
  -> PriceChart / indicators / SMC
```

## Client modules

| Module | Responsibility |
| --- | --- |
| `services/api/resources/replayApi.ts` | Typed session, command, bars, fork, and report DTOs |
| `services/replay/replaySocket.ts` | WebSocket transport, reconnect/gap recovery, serialized versioned commands |
| `store/replayClientStore.ts` | Read-only latest server snapshot, revealed bars, connection/error projection |
| `store/replayTradingClientStore.ts` | Read-only trading projection plus backend command wrappers |
| `hooks/useChartSeries.ts` | Select live candles or server-revealed Replay bars |
| `components/replay/*` | Presentation controls, UTC candidate selection, dashboard, and lifecycle gate |
| `components/chart/replayViewport.ts` | Presentation-only viewport and coordinate geometry |

`ReplayClientRuntime` closes the session on logout or kill-switch activation and
recreates it when synchronized layout configuration changes. It never schedules
market steps. `GlobalRuntime` mounts transport lifecycle only.

## Selection and commands

The selection overlay may snap a chart coordinate to a candidate UTC time for
presentation. It sends that time to the backend; it does not convert the time
to a local replay cursor or decide availability. The backend validates dataset
bounds and returns explicit errors.

Controls send `play`, `pause`, `step`, `seek`, `restart`, and `set_speed`
commands using the current server version. Commands are serialized. Older
responses cannot replace a projection that has already applied a newer event.
Backward movement with trading state uses a backend fork.

## Market and trading isolation

While a Replay session is active or preparing:

- `useMarketData` does not request provider history, refresh MT5 chart bars, or
  backfill gaps for the chart;
- chart, indicators, and SMC consume only `useChartSeries()`;
- `useTradeRuntime` does not feed the normal simulator ledger;
- MT5 execution is disabled and the order ticket uses the isolated Replay
  trading projection;
- existing live alerts and watchlists continue, but new alert creation is
  disabled.

## Failure and rollback

`NEXT_PUBLIC_REPLAY_BACKEND_V1` defaults on. Setting it to `false` disables the
Replay UI. API/auth failures show a sign-in or server error state and never
start a local clock. WebSocket gaps recover through ordered event fetch or a
complete server snapshot.

## Enforcement and tests

Run:

```bash
npm run check:replay-client-boundary
npm run test:replay
```

The boundary scan keeps mandatory legacy files/identifiers deleted, rejects
full-history/local-trading imports in Replay UI, restricts market timers, and
limits projection writes. ESLint applies matching restricted imports. See
`../../docs/REPLAY_BACKEND_PHASE6.md` from the monorepo root for the deletion proof
and full verification runbook.
