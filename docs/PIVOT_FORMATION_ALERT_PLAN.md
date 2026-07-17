# Pivot Formation Alert Plan

_Status: deferred/pending. This document is an implementation plan only. The
2026-07-16 Swing S/R runtime change does not add an Alert Center indicator-event
type or dispatch pivot notifications._

## Decision summary

- A pivot-formation alert must be calculated, deduplicated, persisted, and
  dispatched by the Go backend.
- The frontend may create/edit an alert snapshot and render API state/history;
  it must not inspect candles, detect pivots, or submit a client-claimed pivot
  trigger.
- The implementation must extend a common indicator-event registry so future
  indicators can publish events without adding indicator-specific routes or
  browser calculators.
- Initial Swing S/R alerts fire only after the confirmation bar closes. An
  unconfirmed candidate is never an alert event.
- Live alerts must continue while the chart or browser is closed. Replay may
  preview events, but it must not dispatch live notification channels.

## Why this is deferred

The current indicator runtime is stateless: the frontend sends a replay-aware
OHLCV window to `POST /api/v1/indicator-runtime/compute`, and the backend returns
chart primitives. That is sufficient for rendering, but not for a durable alert
that must run with the browser closed.

The current alert model is also price/drawing-oriented:

- `alert_condition` contains only `above`, `below`, `crossUp`, and `crossDown`.
- An alert requires a positive creation-time `price`.
- Dynamic technical targets describe drawing geometry, not an indicator/config
  snapshot.
- The public trigger route verifies price/geometry evidence submitted by a
  client or worker. A pivot event has to be derived from authoritative candles
  instead of trusted as a client claim.

Adding a Swing-only boolean to either system would make future indicator events
harder to support and would violate backend ownership. The work below therefore
starts with the common contract and durable evaluator.

## Product semantics

The first supported event family is `SWING_SR`:

| Field | Required behavior |
| --- | --- |
| Event keys | `pivot.high.formed`, `pivot.low.formed`, or either |
| Pivot time | Timestamp of the candle that owns the swing price |
| Confirmation time | Timestamp of the closed candle at `pivot index + right strength` |
| Trigger value | Confirmed source value at the pivot candle |
| High strength | Snapshot of `length`; left and right strength are equal in v1 |
| Low strength | Snapshot of `length2`; left and right strength are equal in v1 |
| Sources | Snapshot of `highSource` and `lowSource`; use the runtime's supported OHLC-derived sources |
| Repainting | None after dispatch; a candidate is not observable before its right window closes |
| Frequency | Once per unique confirmed pivot per arming revision |
| One-time alert | Moves to `triggered` after its first accepted event |
| Recurring alert | Remains active and may fire for later unique pivots; no time-based 60-second suppression |
| Chart navigation | Does not mutate the saved symbol, timeframe, event key, or indicator inputs |

`formed` means **confirmed at bar close**. Intrabar candidate notifications are
outside v1 because a forming confirmation candle can still change and invalidate
the candidate. If intrabar support is added later, it needs a separate event key
and explicit repaint policy.

The protected reference script publicly notes that an alert is available when a
swing is formed. Its private source is not an implementation dependency. Pivot
timing must continue to follow the clean-room backend semantics documented in:

- [Swing high low support & resistance](https://www.tradingview.com/script/RQnLfaNE-Swing-high-low-support-resistance/)
- [Pine Script visuals FAQ](https://www.tradingview.com/pine-script-docs/faq/visuals/)
- [Pine Script alert FAQ](https://www.tradingview.com/pine-script-docs/faq/alerts/)

## Common backend indicator-event contract

Do not place alert detection in an HTTP handler or in a `SWING_SR`-specific
scheduler. Extend the registered indicator definition so calculation and event
detection share normalization, history requirements, and math:

```go
type IndicatorDefinition struct {
    Calculate       IndicatorCalculator
    NormalizeConfig IndicatorConfigNormalizer
    RequiredHistory IndicatorHistoryRequirement
    EventDetectors  map[string]IndicatorEventDetector
}
```

The exact Go names may change, but these invariants may not:

1. `detectRuntimePivots` remains the one comparison/confirmation implementation
   for built-in Swing output, Pine `ta.pivothigh()`/`ta.pivotlow()`, and Swing
   event detection.
2. Normalized event inputs exclude presentation-only settings such as colors,
   line widths, visibility, labels, and pane placement.
3. Every detector declares the minimum warmup/history it needs.
4. Events are deterministic for `(runtime version, normalized config, ordered
   candles)`.
5. A future indicator registers event keys in the same definition; it does not
   add another alert API route.

Suggested backend event DTO:

```json
{
  "version": 1,
  "id": "deterministic-event-key",
  "indicatorType": "SWING_SR",
  "eventKey": "pivot.high.formed",
  "symbol": "EURUSD",
  "timeframe": "15m",
  "pivotTime": 1784206800,
  "confirmedAt": 1784229300,
  "value": 1.18452,
  "configHash": "sha256:...",
  "runtimeVersion": 1,
  "metadata": { "side": "high" }
}
```

`id` is a stable identity, not a random delivery id. A recommended identity
input is:

```text
indicatorType | eventKey | symbol | timeframe | pivotTime |
confirmedAt | normalizedConfigHash | runtimeVersion
```

The alert id and `armingRevision` are added to the persistence dedupe key so two
users or two separately armed alerts can receive the same market event.

## Immutable alert snapshot

An indicator-event alert snapshots calculation inputs at creation. Later edits
to an indicator instance do not silently retarget the alert.

Suggested v1 target:

```json
{
  "version": 1,
  "kind": "indicatorEvent",
  "indicatorType": "SWING_SR",
  "eventKeys": ["pivot.high.formed", "pivot.low.formed"],
  "symbol": "EURUSD",
  "timeframe": "15m",
  "runtimeVersion": 1,
  "config": {
    "length": 25,
    "length2": 25,
    "highSource": "high",
    "lowSource": "low"
  },
  "configHash": "sha256:...",
  "sourceIndicatorId": "ind_client_id"
}
```

- `sourceIndicatorId` is optional provenance only. Deleting or editing that
  chart instance does not change the alert.
- The server canonicalizes the config and computes `configHash`; it does not
  trust a client-provided hash.
- Only event-affecting config is persisted. Styles and chart visibility are not
  part of alert identity.
- Editing symbol, timeframe, event keys, runtime version, or calculation inputs
  increments `armingRevision`, resets the evaluation cursor, and creates a new
  dedupe domain.
- Editing note or delivery channels does not re-arm the alert.

## Persistence migration

Prefer a discriminated alert union instead of adding pivot values to the price
condition enum.

Recommended migration shape:

1. Add `alert_kind` with `price`, `technical`, and `indicator_event`; existing
   rows default to their current compatible kind.
2. Add bounded `indicator_event_target jsonb` with object/version checks.
3. Make creation-time `condition` and `price` nullable only for
   `indicator_event`; retain strict checks for price/technical alerts.
4. Extend `alert_events` with `event_kind`, `event_key`, `event_payload`,
   `pivot_time`, `confirmed_at`, and `arming_revision`. The event's confirmed
   pivot value can continue to populate target/trigger price compatibility
   fields if those columns remain non-null.
5. Persist `last_evaluated_bar_time` per alert or in a separate evaluator cursor
   table. Cursor writes must be transactional with accepted events.
6. Add a unique idempotency constraint equivalent to:

   ```text
   alert_id + arming_revision + backend_event_id
   ```

7. Keep existing price/drawing rows and API responses backward compatible.

Do not use a positive placeholder price on the alert row. The next pivot price
does not exist at creation time, and a fake value would leak into chart lines,
history, notification text, and validation.

## API changes

Keep the current alert resource family:

- `POST /api/v1/alerts` accepts a discriminated indicator-event target.
- `PATCH /api/v1/alerts/:id` applies the re-arm rules above.
- list/bootstrap/history responses return the target and typed event payload.
- `POST /api/v1/alerts/:id/trigger` rejects indicator-event alerts. Only the
  backend evaluator may persist their trigger.
- An optional read-only preview endpoint may return recent matching events for
  configuration UX, but it must call the same backend detector and must never
  dispatch notification channels.

All request DTOs must reject unknown fields, unsupported indicator/event keys,
invalid timeframes, strengths outside runtime limits, unsupported sources, and
oversized JSON snapshots.

## Live evaluator flow

```text
authoritative MT5 candle-close stream / recovery fetch
  -> normalize symbol + timeframe and close status
  -> load/group active indicator-event snapshots
  -> group by symbol/timeframe/indicatorType/configHash/runtimeVersion
  -> run common backend event detector once per group
  -> filter events newer than each alert cursor
  -> transaction: insert deduped event + update cursor/status
  -> existing delivery fan-out
  -> Alert Center bootstrap/history/realtime refresh
```

Operational requirements:

- Evaluate only closed candles in v1.
- Group identical snapshots so one calculation fans out to many alerts.
- Fetch enough pre-cursor history for left/right strength and warmup; do not
  infer a pivot from a truncated window.
- On restart, fetch from the persisted cursor plus required warmup and process
  missed closed bars in time order.
- Use a bounded worker pool and per-group serialization. Two workers receiving
  the same close must converge through the unique event constraint.
- A corrected historical bar does not redispatch an already accepted event in
  v1. Record an operational warning if the correction changes a past result.
- Unsupported or unavailable symbol/timeframe data leaves the alert active with
  a surfaced evaluator error; it must not fabricate a trigger.

The evaluator should consume a backend candle source directly. Calling the
browser-owned `indicator-runtime/compute` request loop is not an acceptable
closed-browser implementation.

## Replay behavior

- Replay-visible candles may be sent to a read-only preview calculation.
- A replay preview exposes an event only when its confirmation candle has been
  revealed.
- Replay never writes live `alert_events` or sends toast, browser, push,
  Telegram, or Discord notifications.
- Creating a live alert while viewing Replay must clearly snapshot the chosen
  live symbol/timeframe; it must not silently arm at the replay cursor.
- A future replay-specific alert simulator needs a separate session-scoped
  store and is outside this plan.

## Frontend scope

The frontend is a configuration and presentation client only.

Required UI work:

- Add `Indicator event` as an Alert Center source type.
- Allow creation from Alert Center and optionally from an indicator legend
  action such as `Add alert`.
- Select the active Swing S/R instance, high/low/either event, immutable symbol
  and timeframe snapshot, recurrence, note, and delivery channels.
- Display `Swing high formed` / `Swing low formed`, pivot value, pivot time,
  confirmation time, symbol, timeframe, and snapshot summary in active alerts
  and history.
- Show backend evaluator/data errors without trying a browser fallback.

Forbidden frontend work:

- Importing or recreating `detectRuntimePivots`.
- Scanning chart candles for a formation event.
- Triggering an indicator alert from `IndicatorResult.series` changes.
- Treating a returned horizontal line or last value as proof of a new event.
- Dispatching an indicator notification before backend persistence succeeds.

## Delivery and notification text

After an event is accepted, reuse the existing channel fan-out. Suggested
notification fields:

```text
Title: EURUSD 15m — Swing high formed
Body: 1.18452 pivot confirmed at 14:15 (pivot bar 08:00)
```

The persisted backend event is authoritative. Delivery failure updates delivery
status/logging but never deletes the trigger event or rolls back the alert state.

For recurring pivot alerts, each unique pivot is a legitimate new event; the
price-alert 60-second re-arm guard must not suppress distinct pivots.

## Security and validation

- Use backend-authoritative OHLCV and candle-close status.
- Scope evaluator queries and persisted events to the owning user.
- Canonicalize symbol/timeframe/config before hashing.
- Bound strengths to the common runtime range and bound history fetches.
- Version every target and event payload; reject unknown versions.
- Never accept a client-supplied `formed=true`, pivot timestamp, or pivot value
  as trigger evidence.
- Rate-limit preview/configuration calls separately from the durable evaluator.

## Test matrix

Backend unit tests:

- high and low events appear exactly on the confirmation bar;
- no event exists in the right-hand unconfirmed tail;
- equal-value plateaus follow the shared strict pivot policy;
- all eight supported sources produce detector/runtime parity;
- different high/low strengths and event selectors are honored;
- normalized config hashes ignore style-only changes;
- event ids are deterministic.

Persistence/evaluator tests:

- duplicate candle-close delivery inserts one event;
- restart recovery processes missed bars once and advances the cursor;
- two alerts with the same config share calculation but persist independently;
- one-time and recurring lifecycle behavior;
- calculation edits increment `armingRevision`; channel edits do not;
- a stale worker revision cannot trigger a re-armed alert;
- client trigger requests for indicator-event alerts are rejected;
- closed-browser evaluation uses the authoritative candle source;
- migration preserves every existing price/drawing alert.

Frontend tests:

- create/edit payload snapshots the selected indicator inputs;
- Alert Center renders backend status and event history;
- indicator edits do not mutate an existing alert snapshot;
- API failure does not cause client-side pivot evaluation;
- desktop/mobile surfaces expose the same fields;
- Replay preview does not call notification dispatch.

End-to-end acceptance:

1. Arm a recurring Swing high alert, close the browser, and form a confirmed
   pivot in test market data.
2. Verify exactly one backend event and one delivery attempt per enabled
   channel.
3. Reopen the app and verify the same event in Alert Center history.
4. Redeliver the same candle-close message and verify no duplicate.
5. Form a later pivot and verify a second recurring event.

## Implementation phases

### Phase 0 — Contract and migration

- Introduce the discriminated alert kind, target/event DTOs, validation, and
  backward-compatible database migration.
- Add fixtures proving current price and drawing alerts are unchanged.

### Phase 1 — Common event registry

- Extend backend indicator definitions with normalized config, history
  requirements, and event detectors.
- Add `SWING_SR` formation detectors using `detectRuntimePivots`.
- Add deterministic event and config hashing tests.

### Phase 2 — Durable evaluator

- Connect authoritative closed candles, grouping, cursor recovery, transactional
  dedupe, alert lifecycle, and delivery fan-out.
- Add operational metrics for group count, evaluation latency, lag, duplicates,
  dispatch attempts, and failures.

### Phase 3 — Alert Center UI

- Add creation/edit/history presentation using API-owned state.
- Add optional indicator-legend entry point without any calculation logic.

### Phase 4 — Replay preview and rollout

- Add non-dispatching preview if needed.
- Roll out behind a server capability flag, observe evaluator lag/dedup metrics,
  then enable indicator-event creation.

## Acceptance criteria

The feature is complete only when:

- pivot detection is backend-only and shared with the indicator runtime;
- alerts work with the browser closed;
- confirmation is no-lookahead and bar-close deterministic;
- duplicate/restart delivery cannot create duplicate alert events;
- alert snapshots are immutable and versioned;
- frontend contains no indicator-event calculator or trigger fallback;
- existing price/drawing alerts remain backward compatible;
- Replay cannot dispatch live notifications;
- backend, database, frontend, mobile, and closed-browser tests pass.

## Non-goals for v1

- Pine `alertcondition()` or arbitrary custom-script alert execution.
- Alerting when price crosses a previously formed Swing S/R level.
- Intrabar/unconfirmed pivot candidates.
- Strategy order alerts or multi-condition alert builders.
- Retargeting an alert automatically when the source indicator is edited.
- Client-only/offline alert evaluation.

## Expected file areas

| Area | Expected ownership |
| --- | --- |
| Indicator definition/event registry | `backend/internal/pineruntime` |
| Durable evaluator and alert validation | `backend/internal/alerts` plus backend market-data integration |
| Schema/cursors/idempotency | `backend/migrations`, `backend/internal/alerts/repo.go` |
| API documentation | `backend/docs/API.md`, `backend/docs/DATABASE.md` |
| Alert source/config/history UI | `frontend/src/components/alerts`, `frontend/src/store/alertStore.ts` |
| API adapters/types only | `frontend/src/services/api/resources/alertsApi.ts` |
| Architecture docs/tests | `frontend/docs`, backend/frontend test suites |
