# Replay Architecture

_Updated after multi-chart Replay scope and track mapping: 2026-07-22._

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
| `store/replayLayoutStore.ts` | Visible pane state, current/all-chart scope, and UI-to-backend track mapping |
| `hooks/useChartSeries.ts` | Select live candles or server-revealed Replay bars |
| `components/replay/*` | Presentation controls, UTC candidate selection, dashboard, and lifecycle gate |
| `components/chart/replayViewport.ts` | Presentation-only viewport and coordinate geometry |
| `components/chart/replayCandlePresentation.ts` | Identity-preserving projection and frame-by-frame OHLC interpolation |
| `components/chart/chartInteractionLock.ts` | Reference-counted drawing, alert, and Replay gesture ownership |
| `components/chart/chartLifecycle.ts` | Safe Lightweight Charts teardown after the active paint stack unwinds |
| `services/replay/replayErrorMessage.ts` | UTC-safe availability guidance for typed Replay API failures |
| `services/replay/trailingReplayCommand.ts` | Presentation-input debounce/coalescing; never advances market time |

`ReplayClientRuntime` closes the session on logout or kill-switch activation and
recreates it when synchronized layout configuration changes. It never schedules
market steps. `GlobalRuntime` mounts transport lifecycle only.

## Layout scope and track mapping

The Layout menu exposes `Current chart` and `All charts`. Current-chart scope
creates one track for the active visible pane; inactive panes continue to show
live data. All-chart scope creates one ordered track per visible pane and is
disabled for the single-chart arrangement.

Expanding a single chart into any multi-chart preset selects `All charts` by
default, while retaining `Current chart` as an explicit option. This behavior
is shared by 2-horizontal, 2-vertical, and 2x2 layouts rather than special-cased
for four panes.

UI pane slots are stable so hidden charts can retain symbol/timeframe state.
Backend session tracks have a stricter contract: slots must be contiguous from
zero. `replayTracksForLayout()` first builds UI tracks, then
`replayTracksForBackend()` maps a one-chart session to backend slot zero even
when the selected UI pane is slot 1, 2, or 3. `PriceChart` and
`useChartSeries()` map that single server track back to
`activeChartSlotAtom`. Multi-chart tracks retain visible slot order.

Changing the desired tracks causes `ReplayClientRuntime` to replace the session
configuration. The actor still owns the shared simulated time and advances all
tracks atomically. Pane and saved-layout lifecycle details are documented in
`CHART_LAYOUT_ARCHITECTURE.md`.

## Selection and commands

The selection overlay may snap a chart coordinate to a candidate UTC time for
presentation. It sends that time to the backend; it does not convert the time
to a local replay cursor or decide availability. The backend validates dataset
bounds and returns explicit errors.

The overlay is also the semantic input surface. It exposes an accessible
horizontal slider, supports Arrow/Home/End plus Enter/Space/Escape, and accepts
only one primary pointer through capture and document-level completion. Mobile
seeds the candidate nearest the chart center immediately because a touch device
has no hover event before its first tap. The visible line, date label, and
confirm/cancel HUD therefore exist before the user scrubs. While selection is
active, the shared chart interaction lock owns pan/zoom; releasing Replay cannot
unlock a concurrent drawing or alert drag.

A chart-timeframe bucket may start before the first source row in a prepared
dataset. If the selected bucket is the same bucket that contains that first
row, a backend fork clamps to the first source row. A genuinely earlier bucket,
or a bucket not covered by every synchronized track, remains unavailable.

Controls send `play`, `pause`, `step`, `seek`, `restart`, and `set_speed`
commands using the current server version. Commands are serialized. Older
responses cannot replace a projection that has already applied a newer event.
If the actor clock advances before a command arrives, the client retries a
`version_conflict` with the returned current version and a new idempotency key.
Backward movement with trading state uses a backend fork.

Pause is the deliberate exception to strict expected-version rejection. It is
an idempotent safety command and applies to the latest session state even if a
clock step committed after the client snapshot. Status and speed may be shown
optimistically, but no cursor, bar, simulated time, or trading value is locally
projected. See `REPLAY_CONTROL_INCIDENTS.md` for the incident timeline and
reconciliation rules.

## Interval and clock semantics

Replay speed means revealed Replay intervals per wall-clock second, matching
TradingView's update model; it does not mean chart candles per network request.
For a single chart, Auto resolves to its current chart timeframe (`5m -> 300`,
`15m -> 900`, `1H -> 3600`). A synchronized multi-chart layout resolves to the
largest supported interval common to every track. Weekly and monthly charts use
one day because their calendar boundaries cannot be represented by a fixed
week/month duration.

For speed below 1x, the actor reveals one interval every `1 / speed` seconds.
For speed at or above 1x, it uses one durable command transaction per second and
sets `count = round(speed * elapsedSeconds)`, bounded to 1..100. The first fast
tick is scheduled immediately after Play. Transaction time is subtracted from
the next timer, and elapsed-time catch-up prevents a slow database round trip
from permanently reducing the requested playback rate.

`__clock_step { count }` advances all synchronized tracks and the isolated
trading ledger atomically. A multi-interval advance emits one ordered
`track.bars.batch` rather than one WebSocket message and React render per source
row. The batch contains the finalized version of the previously-forming candle,
the completed new candles, and the latest forming candle. `cursor.advanced`
follows it in the same authoritative event order.

Sparse market calendars do not consume hundreds of empty Replay intervals.
Session preparation compares the returned candle tail with the requested
history boundary, probes beyond a page that ends inside a closure, and requires
a real future row. If the next interval still lies wholly in a weekend, holiday,
or broker closure, the backend advances the shared clock directly to the
earliest next stored row without inventing candles. The browser receives the
normal ordered bar/cursor events and keeps the same controls on desktop and
mobile.

## Candle presentation

`replayClientStore` merges a batch by timestamp in one projection update.
`useChartSeries` uses a `WeakMap` projector so the unchanged candle prefix keeps
object identity. The last old candle is allowed to change because the batch
finalizes it; this overlap must not turn a valid append into a full `setData()`.

`PriceChart` therefore performs the following presentation sequence:

1. restore the last authoritative prefix;
2. finalize the overlapping forming candle with `series.update()`;
3. append each genuinely new candle with `series.update()`;
4. interpolate OHLC and volume on `requestAnimationFrame`, starting flat at the
   candle open and finishing at the authoritative values;
5. if Pause interrupts an animation, freeze the exact rendered frame and candle
   count instead of revealing the unpresented remainder of the received batch;
6. snap to authoritative data on completion, reconnect, seek/restart, or a
   structural dataset replacement.

Animation duration is `clamp(920 / speed, 90, 850)` milliseconds per newly
revealed candle. At 10x, a normal ten-candle server batch is presented in about
900ms, leaving room before the next clock batch. The chart never invents a
price, candle timestamp, cursor, or simulated time; interpolation is only a
visual transition between server-owned values.

## Indicator causality boundary

The backend's `tracks[0].visibleThrough` is the only authority for the latest
candle an indicator may observe. `PriceChart` converts that RFC 3339 timestamp
to the inclusive Unix-second `replayCutoff` field on the common indicator
runtime request. Catalog indicators, saved Pine scripts, and future indicators
all use this same contract; no indicator-specific Replay exception is allowed.

Before compilation, the backend filters normalized candles at or before the
cutoff. It removes future-only series/labels, clips continuous geometry that
crosses the boundary, disables right extension, and keeps live behavior
unchanged when the field is omitted. Histogram/discrete output does not receive
an invented boundary sample. The cutoff is part of the backend cache key.

History warm-up during Replay may fetch context only with `before` set strictly
before the latest authoritative Replay candle. This avoids importing a provider
forming candle whose high/low/close already includes data beyond the Replay
cursor. A missing or invalid cutoff fails closed and renders no runtime result
until a valid server snapshot arrives.

The frontend separately clips plotted series, labels, and magnet points and
allows a cached result to flow forward only when
`cachedCutoff <= requestedCutoff` in the same session. It never reuses a future
result while rewinding, and never mixes live with Replay results. These checks
are defense in depth; the backend remains the enforcement point.

## Timeframe and layout changes during Replay

Changing symbol, timeframe, layout, or Replay scope while a session exists
creates a replacement backend session at the current authoritative simulated
time. The replacement preserves speed and account configuration, requests Auto
interval again, reconnects the event stream, and hydrates only the replacement
track bars. `useMarketData` remains disabled during this handoff, while
`ChartArea` treats Replay's own projection/connection as the loading authority.
This prevents the perpetual provider-loading spinner previously seen when
switching from `15m` to `5m` inside Replay.

Old sessions whose stored interval no longer matches Auto are normalized with a
versioned `set_replay_interval` command. This keeps the same behavior across all
supported chart timeframes rather than carrying an interval chosen for the
previous chart.

## Replay viewport and chart lifecycle

Replacing or forking a session changes track identity. The client intentionally
drops bars from the old track before hydrating the replacement, so a First day
fork can produce the valid sequence `many bars -> empty -> one bar`. The empty
window resets Replay viewport initialization. The first non-empty window then
uses a deterministic 120-logical-bar span with the current right offset and is
marked initialized for that session/reset. It must not call `fitContent()` on a
single candle, because Lightweight Charts expands that candle across most of
the plot.

The initialization requestAnimationFrame is replaceable and is canceled on an
empty reset or chart cleanup. Before applying it checks the active frame,
session, and viewport-controller identities and reads the latest candle count.
A stale hydration callback cannot write an old range into a recreated chart.

Chart cleanup first disables ResizeObserver, viewport, crosshair, animation,
and parent references. `chart.remove()` is queued until the current JavaScript
stack finishes. This is required because Lightweight Charts can invoke a React
subscriber from inside its paint frame; synchronous removal at that point
disposes the time-axis canvas before the same paint stack returns, producing
`Object is disposed`. The same teardown primitive is used by the main price
chart and the analytics equity chart.

## Performance guardrails

The common no-order/no-position case performs one active-ledger-state query per
track and skips all per-source-row order, bracket, and mark-to-market queries.
This is critical because one 10x `15m` clock batch can reveal roughly 150 source
`1m` rows. Active orders or positions still use deterministic row-by-row ledger
processing so fills and brackets cannot skip intermediate prices.

Interactive controls use a 300 ms trailing idle window. Speed and Play/Pause are
latest-wins, rapid Step counts are summed, and repeated Restart clicks are
coalesced. Status/speed update immediately through narrow optimistic overrides;
commands remain serialized and versioned after the idle window. Pending input
is canceled on replacement/Exit, and responses for inactive sessions are
ignored. `step`, `seek`, and `restart` explicitly rehydrate bars; ordinary Play
ticks rely on ordered socket events and do not issue a full bars request per
update.

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

Paginated MT5 history may reuse cache only when the cached window reaches the
requested `before` boundary. Otherwise the backend synchronously refreshes that
page before deciding availability. Typed `data_point_unavailable` responses
retain HTTP 422 in request logs and expose first/last UTC bounds to every Replay
surface instead of showing only `Unprocessable Entity`.

## Enforcement and tests

Run:

```bash
npm run check:replay-client-boundary
npm run test:replay
npm run test:chart
npm run typecheck
cd ../backend && go test ./internal/pineruntime
go test ./internal/replay/...
```

The boundary scan keeps mandatory legacy files/identifiers deleted, rejects
full-history/local-trading imports in Replay UI, restricts market timers, and
limits projection writes. ESLint applies matching restricted imports. See
`../../docs/REPLAY_BACKEND_PHASE6.md` from the monorepo root for the deletion proof
and full verification runbook.

Regression coverage includes Auto interval selection, timeframe replacement,
speed batching and elapsed catch-up, immediate fast Play, ordered batch events,
no-ledger fast path, projection batch merging, finalized-forming-bar overlap,
OHLC interpolation bounds, normal-speed single append, and high-speed append.
It also includes stale paginated-history refresh, partial first-bucket forks,
mobile touch/keyboard selection, compact landscape, session-expiry cleanup, and
the active `Select bar -> Select date -> First day` empty-to-one-bar viewport.
Indicator regressions cover the backend FVG and generic primitive cutoff,
invalid boundaries, HTTP contract, live-vs-Replay cache keys, causal rewind
fallbacks, and frontend series/label/magnet clipping.
