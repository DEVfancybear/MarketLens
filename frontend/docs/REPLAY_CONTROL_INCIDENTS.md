# Replay Control Incidents: Pause Race and Input Latency

_Resolved 2026-07-11. This note documents the two related Replay control bugs,
their failure modes, and the invariants that future changes must preserve._

## Scope

The affected surfaces were the floating chart toolbar, the bottom Replay panel,
and Replay hotkeys. The backend remained the only authority for simulated time,
cursor movement, revealed bars, speed, and session status. The fixes add only an
optimistic presentation layer and trailing input transport; they do not add a
browser playback clock.

## Incident 1: Pause request did not stop candle playback

### User-visible symptoms

- Pressing Pause could leave the pause icon active and candles continuing to
  appear.
- At speeds such as 3x, more than one candle could appear after the click.
- The command request contained a valid `pause` payload and an
  `expectedVersion`, but the command endpoint failed.

### Root cause A: Pause lost an optimistic-version race

The actor clock and user commands share the session version. A real failure was:

```text
client snapshot version       8
pause request expectedVersion 8
clock step commits version    9
pause command result          rejected/version_conflict
```

This validation is correct for cursor-dependent commands such as `step`,
`seek`, trading mutations, and most configuration changes. It is incorrect for
Pause: Pause is an idempotent safety command whose meaning is always "stop the
latest session state." Rejecting it because the clock advanced guarantees that
the clock can continue advancing while the user is trying to stop it.

The backend now allows the external `pause` command to apply against the latest
version while retaining expected-version validation for other commands. The
actor transaction still serializes Pause with clock steps, clears actor
ownership after the status becomes paused, and emits the normal authoritative
state event.

### Root cause B: canceling the animation still revealed the batch

A fast clock commit can reveal a batch of candles before `PriceChart` finishes
presenting them. The old pause path canceled the current
`requestAnimationFrame`, then the next chart effect called `setData()` with the
already-received complete batch. The clock was no longer advancing, but the
remaining candles appeared at once, which looked like playback had ignored
Pause.

The chart now preserves the exact rendered candle count and the interpolated
latest candle when Pause interrupts an animation. It does not apply the hidden
remainder of the received presentation burst during that pause transition.

### Immediate client feedback

Pause writes an optimistic `status: paused` control override before transport.
This stops the chart presentation without waiting for network/database latency.
An authoritative response or `state.changed` event clears the override only
when it acknowledges the same value. A stale response cannot turn the UI back
to playing while a newer local pause intent exists. On a real command failure,
the override is cleared and the client refreshes the server snapshot.

## Incident 2: Speed and other controls felt blocked by API latency

### User-visible symptoms

- The speed thumb and label lagged behind pointer movement because their value
  was bound directly to the last server snapshot.
- Moving through several speed values could start a request for the first value
  and serialize later values behind it.
- Rapid Step clicks generated a queue of individual requests.
- Play, Pause, Restart, panel controls, and hotkeys could appear delayed behind
  earlier control requests.

### Root cause

The old speed coalescer started flushing immediately on the first `change`
event. It could replace a desired value while a request was running, but it was
not a trailing debounce: user input was still coupled to API completion. All
commands also shared a serialized promise queue for version safety, so noisy
input created visible backpressure.

### Trailing input model

Replay controls now use a 300 ms idle window:

| Control | Immediate local behavior | Request after input becomes idle |
| --- | --- | --- |
| Speed | Update thumb, label, and presentation speed | Send only the final speed |
| Play/Pause | Show the final requested status immediately | Send only the final status |
| Step | Show paused status immediately | Sum rapid counts into one Step request |
| Restart | Show paused status immediately | Coalesce repeated Restart clicks |
| Exit | Clear the Replay projection immediately | Cancel pending controls and close now |

Examples:

```text
speed: 1x -> 2x -> 3x -> 10x  => one set_speed { speed: 10 }
step:  +1 -> +1 -> +10         => one step { count: 12 }
play -> pause within 300 ms    => one pause command
```

Step while playing carries a `pauseFirst` intent. After the idle window, the
serialized transport pauses the server before sending the aggregated Step, so
the backend's "step requires paused" invariant remains intact.

### Optimistic-control reconciliation

`ReplayClientStore` holds narrow overrides for only `status` and `speed`.
Server-owned time, cursor, tracks, bars, orders, positions, and equity are never
optimistically changed.

Reconciliation rules are:

1. apply the local control value immediately;
2. continue applying ordered cursor/bar events without removing the override;
3. ignore stale command/state values for the overridden field;
4. clear an override when an authoritative snapshot/event matches it;
5. clear and refresh on command failure;
6. cancel pending trailing commands on session replacement or Exit;
7. ignore an in-flight response if its session is no longer active.

These rules let users manipulate controls freely without allowing local input
to become Replay market-time authority.

## Implementation map

| File | Responsibility |
| --- | --- |
| `services/replay/trailingReplayCommand.ts` | Generic trailing debounce, latest-value merge, Step accumulation, waiter settlement |
| `services/replay/replaySocket.ts` | Optimistic control APIs, 300 ms scheduling, serialization, failure refresh, lifecycle cancellation |
| `store/replayClientStore.ts` | Status/speed override reconciliation with ordered server state |
| `components/replay/ReplayFloatingToolbar.tsx` | Floating toolbar integration |
| `components/replay/ReplayControls.tsx` | Bottom Replay panel integration |
| `hooks/useHotkeys.ts` | Keyboard integration using the same control APIs |
| `components/chart/PriceChart.tsx` | Freeze interrupted candle presentation at the rendered frame |
| `backend/internal/replay/runtime_repo.go` | Stale-version exception for idempotent Pause only |

## Regression coverage and verification

Automated coverage includes:

- stale expected versions are allowed only for Pause;
- optimistic status/speed survive stale server snapshots until acknowledgment;
- rapid slider changes send only the final value;
- rapid Step presses combine into one count;
- Replay client boundary permits the dedicated input-debounce module but still
  rejects browser-owned market timers elsewhere;
- high-speed candle presentation and viewport tests remain green.

Run the focused verification suite:

```bash
cd frontend
npm run typecheck
npm run lint -- --quiet
npm run test:replay
npm run check:replay-toolbar-events
npm run check:replay-client-boundary

cd ../backend
go test ./internal/replay ./internal/httpserver
```

## Maintenance invariants

- Never restore strict expected-version rejection for Pause.
- Never bind interactive control display directly to an in-flight server value.
- Never use the debounce timer to advance simulated time or reveal bars.
- Keep Exit immediate and cancel pending control intent on lifecycle changes.
- Route the floating toolbar, bottom panel, and hotkeys through the same APIs.
- Preserve command serialization after debounce so every request uses a current
  authoritative version.
