# Candle Virtualization — Phase 1 Incremental Work

_Implemented: 2026-07-11._

## Scope

Phase 1 applies the no-regret changes selected by the measured 5,000-bar
baseline. It does not window the primary candle series or change indicator
math, Replay visibility, time domains, drawing anchors, alerts, or trading.

## Changes

### Indicator write plans

Every projected indicator series now selects one of four writes:

- `none` when time/value/color output is identical;
- `update-latest` when only the latest point changed;
- `append` when one point was appended to a value-equal prefix;
- `replace` for history corrections, window shifts, or arbitrary Pine changes.

The comparison includes histogram/custom point color. Unknown custom scripts
therefore keep the safe replacement fallback whenever any historical output
changes. Series style options are applied only when their signature changes.

### Separate pane anchor

The invisible pane time anchor no longer calls `setData` on every visible-range
notification. It uses the same write planner, so normal pan/zoom is skipped,
new candles append with `update`, and right-offset whitespace or structural
history changes still replace when required.

Main-to-pane visible-range synchronization is coalesced to one animation-frame
task while retaining integer-range deduplication for extended Pine guides.

### React commit reduction

Pane indicator results and legend text are derived with memoization during the
existing render instead of computing in an effect and issuing a second legend
state update. This removes the measured nested-update pattern without delaying
the displayed latest value.

### SMC worker payload

SMC input is sliced to the engine's existing 1,500-bar analysis tail before
`postMessage`. The worker and synchronous fallback share the same selector, so
the optimization changes transfer size but not the computation domain.

For a 5,000-bar input, each full SMC post drops from 5,000 to 1,500 candle
objects, a 70% reduction before structured clone.

## Correctness policy

- Timestamp remains series identity.
- Primary candle latest/append writes are unchanged.
- Indicator `update` is permitted only with a value-equal prefix.
- Historical corrections and changed custom output use `setData`.
- Pane anchors retain future right-offset logical slots.
- SMC still analyzes exactly the most recent 1,500 bars.
- Replay cannot receive future candles through any new cache or write plan.

## Validation

- Pure write-plan tests cover unchanged data, latest changes, append, color
  changes, historical corrections, and window shifts.
- SMC tests prove small-array identity and the 1,500-bar tail cap.
- Existing pane projection/time-anchor and Replay tests remain enabled.
- Phase 0 counters now report skipped indicator writes/options, incremental
  indicator/anchor updates, viewport coalescing, and avoided SMC candles.

## Post-change benchmark gate

Run the same 5,000-bar pane/custom-indicator workload used by Phase 0. Expected
counter-level invariants:

- pane-anchor `setData` is no longer proportional to viewport notifications;
- SMC posted candles are at most `post.calls × 1,500`;
- `smc.worker.post.candlesAvoided` is positive for 5,000-bar inputs;
- unchanged indicator outputs increment `series.indicator.skipped`;
- built-in latest/append paths increment `series.indicator.update.calls`;
- ordinary primary candles still use zero structural replacements except the
  intentional Replay prefix reset in the benchmark.

Primary-series windowing remains deferred unless a later large-history trace
shows that its current write path becomes material.

## Deferred item

Removing the `marketDataStore` to `chartStore.candlesAtom` compatibility mirror
is intentionally deferred. Drawing/trade write atoms synchronously read the
chart atom, while Replay selection owns a separate candidate/live distinction.
Changing that ownership in this phase would exceed a no-regret incremental
change and requires a dedicated store migration with broader integration tests.
