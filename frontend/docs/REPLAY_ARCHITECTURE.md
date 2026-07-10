# Replay Architecture

_Last updated: 2026-07-07_

> **Current/legacy architecture.** Replay is still frontend-owned today. The
> approved target is a backend-owned deterministic replay engine with durable
> sessions, datasets, multi-timeframe aggregation, and isolated replay trading.
> Read `../../docs/REPLAY_BACKEND_MIGRATION_PLAN.md` before adding new replay
> business logic here. Until backend cutover, the invariants in this document
> remain mandatory for production maintenance.

This document is the maintenance guide for Bar Replay. It explains the state
machine, data visibility contract, chart viewport behavior, and regression
checks. Read this before changing replay selection, jump, playback, chart
rendering, SMC replay behavior, or trade backtesting behavior.

## 1. Goals

Replay has one hard rule:

```
No component may read candles after replayStore.cursor while replay is active.
```

The application enforces this by making `useVisibleCandles()` the only candle
source for chart rendering, indicators, SMC, and trade simulation. Replay does
not mutate the master candle array. It only moves a cursor over that array.

Research source:

- TradingView Lightweight Charts `ITimeScaleApi`: `setVisibleRange()` is
  clamped to currently existing data, while `setVisibleLogicalRange()` accepts
  caller-owned logical indexes. Replay owns bar indexes, so replay viewport
  recovery should use logical ranges.
  https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi

## 2. Key Files

| Area | File | Responsibility |
|---|---|---|
| Replay state | `src/store/replayStore.ts` | Jotai atoms and replay actions |
| Visibility gate | `src/hooks/useVisibleCandles.ts` | Returns full candles or `candles[0..cursor]` |
| Playback clock | `src/hooks/useReplayPlayback.ts` | Global rAF loop that advances the cursor |
| Replay helpers | `src/services/replayEngine.ts` | Speeds, date index helpers, sessions, MTF snapshot |
| Replay viewport helpers | `src/components/chart/replayViewport.ts` | Pure logical-range guards for blank future-whitespace replay views |
| Main chart | `src/components/chart/PriceChart.tsx` | Renders visible slice and realigns viewport after replay jumps |
| Chart area | `src/components/chart/ChartArea.tsx` | Passes visible candles to chart and panes |
| Bottom controls | `src/components/replay/ReplayControls.tsx` | Full replay controls in bottom panel |
| Floating toolbar | `src/components/replay/ReplayFloatingToolbar.tsx` | TradingView-style overlay controls |
| Timing menu | `src/components/replay/ReplayTimingMenu.tsx` | Select bar, select date, random bar |
| Selection canvas | `src/components/replay/ReplaySelectionLayer.tsx` | Click-to-pick and re-select overlay |
| Dashboard | `src/components/replay/ReplayDashboard.tsx` | Scrubber, jump input, replay stats, MTF panel |
| Hotkeys | `src/hooks/useHotkeys.ts` | Space, arrows, R, Escape replay behavior |
| MTF history | `src/hooks/useMtfSnapshotSeries.ts` | Loads higher-timeframe series for replay dashboard |
| Regression guard | `scripts/check-replay-logic.mjs` | Static and helper-level replay invariants |

## 3. State Model

`replayStore.ts` owns the replay state.

| Atom | Meaning |
|---|---|
| `activeAtom` | Replay is armed and downstream consumers must use the visible slice |
| `selectingAtom` | Initial click-to-start selection mode is active |
| `reSelectingAtom` | Replay is armed, user is choosing a new start bar |
| `playingAtom` | Playback clock should advance the cursor |
| `speedAtom` | Playback speed from `REPLAY_SPEEDS` |
| `cursorAtom` | Current visible candle index in the master candle array |
| `anchorAtom` | Earliest allowed replay cursor for the current replay session |
| `totalAtom` | Master candle count when replay was armed or last synchronized |
| `cursorTimeAtom` | Absolute open time of the current replay cursor |
| `anchorTimeAtom` | Absolute open time of the replay anchor |

Important invariant:

```
0 <= anchor <= cursor <= total - 1
```

`setTotalAtom` clamps `anchor` and `cursor` when loaded history shrinks. If
history becomes empty, it fully disarms replay and resets cursor state.

`cursorTimeAtom` and `anchorTimeAtom` are required because replay must survive
timeframe changes. Array index `120` on `15m` is not the same market time as
array index `120` on `5m`; timeframe changes must remap indices from saved
times with `reconcileReplayToCandlesAtom`.

## 4. State Machine

Replay has five user-visible states:

| State | Atom shape | Main UI |
|---|---|---|
| Idle | `active=false`, `selecting=false`, `reSelecting=false` | Start Replay / timing menu |
| InitialSelecting | `active=false`, `selecting=true` | Click a bar to start replay |
| ArmedPaused | `active=true`, `playing=false`, `reSelecting=false` | Transport controls, visible slice locked at cursor |
| Playing | `active=true`, `playing=true`, `reSelecting=false` | rAF clock advances cursor |
| ReSelecting | `active=true`, `reSelecting=true`, `playing=false` | Click a bar to restart replay from that bar |

State transitions:

| Action | From | To | Notes |
|---|---|---|---|
| `beginSelect()` | Idle | InitialSelecting | Chart overlay starts capturing pointer events |
| `cancelSelect()` | InitialSelecting | Idle | Escape also calls this |
| `arm(anchor, total)` | Idle/InitialSelecting | ArmedPaused | Sets `anchor`, `cursor`, `total`; pauses playback |
| `beginReSelect()` | ArmedPaused/Playing | ReSelecting | Pauses playback and keeps current cursor until click |
| `confirmReSelect(index)` | ReSelecting | ArmedPaused | Sets both `anchor` and `cursor` to clicked bar |
| `cancelReSelect()` | ReSelecting | ArmedPaused | Escape/right-click can cancel |
| `play()` | ArmedPaused | Playing | No-op at end of history |
| `pause()` | Playing | ArmedPaused | Keeps current cursor |
| `step(delta)` | ArmedPaused/Playing | Same | Clamps between `anchor` and `total - 1` |
| `setCursor(index)` | ArmedPaused/Playing | Same | Scrubber/latest-bar jump; clamps to replay bounds |
| `restart()` | ArmedPaused/Playing | ArmedPaused | Moves cursor back to `anchor` |
| `stop()` | ArmedPaused/Playing | ArmedPaused | Same cursor behavior as restart |
| `disarm()` | Any active state | Idle | Full history becomes visible again |

## 5. Candle Visibility Contract

Master candles live in `chartStore.candlesAtom`, mirrored from
`marketDataStore` by `useMarketData()`.

```
MarketDataService
  -> marketDataStore candles
  -> useMarketData()
  -> chartStore.candlesAtom          full master series
  -> useVisibleCandles()
       if replay idle: full series
       if replay active: candles.slice(0, cursor + 1)
  -> PriceChart, IndicatorPane, SMC engine, trade runtime
```

Do not bypass `useVisibleCandles()` in chart, indicators, SMC, or trade
simulation code. Doing so can leak future data.

The only intentional bypass is in `ReplaySelectionLayer` during re-select mode:
it reads `candlesAtom` directly so the user can pick a future bar. That full
array is used only for hover/click selection, not for rendering trading data.

## 6. Date Selection And Index Helpers

There are two different helper semantics:

| Helper | Used by | Semantics |
|---|---|---|
| `indexNearestByTime(candles, time)` | UI selection/jump | Closest real candle; clamps before/after loaded history |
| `indexAtOrBefore(candles, time)` | MTF replay snapshots | Latest candle with `open <= time`; returns `-1` before first candle |

Keep this split. UI selection should feel forgiving. MTF data must not reveal a
higher-timeframe bar that opens after the replay cursor.

Date input parsing uses `parseDateInput()`:

- `YYYY-MM-DD`
- `YYYY-MM-DD HH:mm`
- `YYYY-MM-DDTHH:mm`
- optional trailing `Z`

Inputs are normalized to UTC seconds.

## 7. Viewport Contract

Replay changes candle data in two very different ways:

1. Playback reveals one new bar at a time.
2. Jump/scrub/restart/re-select replaces the entire visible data window.

`PriceChart.tsx` must treat these differently.

### First load

On the first non-empty candle load, `PriceChart` calls `fitContent()` once.

### Realtime and one-bar replay playback

If the new candle data is a forming tick or a single appended bar, `PriceChart`
uses `series.update()`. It does not reset the viewport. This keeps user pan/zoom
stable while replay reveals candles at the right edge.

### Replay jump, scrubber, restart, re-select

When replay is active and the current logical viewport no longer intersects the
visible replay candle data, `PriceChart` calls `keepLatestBarInView()`:

- preserve current logical zoom width,
- move the logical right edge to the newest candle in the replacement slice,
- keep the normal right offset.

This prevents the blank-chart bug where the old viewport still looks at future
whitespace after the replay cursor jumps into the past. Non-replay structural
data replacements, including MT5 history refreshes and gap backfills, must not
call `keepLatestBarInView()` because that steals control from a user who has
panned or zoomed into right-side whitespace. The pure rules live in
`replayViewport.ts`:

- `replayRangeIntersectsData(range, dataLength)` checks whether the viewport
  overlaps `[0..lastVisibleReplayBar]`,
- `shouldRealignReplayViewport(range, dataLength)` returns true for blank
  future/past whitespace,
- `latestReplayLogicalRange(dataLength, currentRange)` preserves zoom width and
  moves the right edge to the latest replay candle plus the normal right offset.

Do not fix replay jump handlers by calling `fitContent()` directly. Viewport
realignment belongs in `PriceChart`, because every replay entry point ultimately
changes the same candle slice.

## 8. Playback Clock

`GlobalRuntime` mounts `useReplayPlayback()` once near the app root.

The hook reads the replay state through `getReplayState()` on every rAF tick.
This avoids subscribing React components to high-frequency playback updates.

Playback algorithm:

1. If not playing, reset accumulated time and schedule the next frame.
2. Accumulate frame delta.
3. Convert speed to interval with `speedToIntervalMs(speed)`.
4. Convert accumulated time to cursor steps, capped at 200 steps per frame.
5. Call `step(steps)`.
6. If the cursor reaches `total - 1`, pause playback.

Speed presets live in `REPLAY_SPEEDS`:

```
0.1x, 0.3x, 0.5x, 1x, 3x, 10x
```

## 9. Controls And Hotkeys

Main control surfaces:

- Bottom panel: `ReplayControls` and `ReplayDashboard`
- Floating toolbar: `ReplayFloatingToolbar`
- Chart picker overlay: `ReplaySelectionLayer`
- Top toolbar replay button: enters selection, exits replay, or cancels re-select

Replay hotkeys in `useHotkeys()`:

| Key | Behavior |
|---|---|
| `Space` | Play/pause while replay is active |
| `Shift+ArrowDown` | Play/pause while replay is active |
| `ArrowRight` | Pause and step forward one candle |
| `ArrowLeft` | Pause and step back one candle |
| `Shift+ArrowLeft` | Pause and step back ten candles |
| `R` | Restart to anchor |
| `Escape` | Cancel re-select, then initial select, then drawing/tool selection |

Hotkeys are ignored while typing in inputs, textareas, selects, or content
editable elements.

## 10. Multi-Timeframe Replay

`useMtfSnapshotSeries(symbol, active)` loads higher-timeframe histories only
while replay is active. It loads:

```
5m, 15m, 1H, 4H, 1D
```

`mtfSnapshot(cursorTime, seriesByTf)` then slices each higher-timeframe series
with `indexAtOrBefore()`. This means an H1 or 1D candle is shown only if its open
time has started by the replay cursor.

Do not use `indexNearestByTime()` in `mtfSnapshot()`. Nearest-time semantics can
select a future higher-timeframe candle and break no-look-ahead.

## 11. Interaction Layering

`ReplaySelectionLayer` is a canvas overlay inside `PriceChart`.

While selecting or re-selecting:

- pointer events are enabled on the replay canvas,
- chart pan/zoom is disabled,
- a vertical snap cursor and shaded future region are drawn,
- Escape cancels,
- right-click cancels re-select.

When not selecting:

- pointer events are disabled,
- canvas paints nothing,
- normal chart/drawing interactions continue.

The floating toolbar is marked with `data-chart-ui` so document-level drawing
and replay handlers do not treat toolbar clicks as chart clicks.

## 12. Performance Rules

- Keep the master candle array immutable from replay actions.
- Move only `cursor` during playback.
- Use `getReplayState()` in high-frequency loops instead of subscribing UI
  components to whole replay state.
- Keep hover state in `ReplaySelectionLayer` refs, not React state.
- Use `series.update()` for forming ticks and one-bar appends.
- Use full `setData()` only for structural data changes: symbol/timeframe load,
  theme changes, or replay window replacement.
- Do not recompute expensive overlays from the full master candle array during
  replay; pass the visible slice.

## 13. Testing And Regression Guards

Run these before committing replay changes:

```
npm run check:replay-logic
npm run typecheck
npm run lint
npm run build
```

`check:replay-logic` now delegates to `test:replay` and executes TypeScript
behavior tests instead of scanning source text with regular expressions. It
currently guards:

- closest-date selection,
- outside-history date clamping,
- `indexAtOrBefore()` no-look-ahead semantics,
- MTF snapshot at-or-before behavior,
- replay total/cursor clamping,
- `PriceChart` viewport realignment after replay window replacement.

Phase 0 backend-migration contracts additionally load the shared
`testdata/replay/contracts.v1.json` fixture from TypeScript and Go. Known-gap
tests reproduce partial-MTF look-ahead, skipped intermediate trade fills,
rewind with open positions, cross-symbol fills, hidden-tab catch-up, and
unavailable timeframe mapping. They remain expected legacy gaps until their
owning backend implementation phases replace them with parity assertions.

Manual smoke test:

1. Open `http://localhost:3000`.
2. Start Replay from the toolbar or bottom panel.
3. Use Select date to jump at least one day into the past.
4. Confirm candles remain visible and the latest revealed replay candle is near
   the right edge.
5. Drag the replay scrubber back and forward several times.
6. Confirm the chart never becomes visually blank.
7. Confirm Space and ArrowRight still reveal candles one by one without forcing
   a full fit/reset.

## 14. Common Failure Modes

### Chart is blank after jump

Check:

- `cursorAtom` is within `0..total - 1`.
- `useVisibleCandles()` returns at least one candle.
- `PriceChart` is taking the structural data-window branch.
- `keepLatestBarInView()` is called after `setData()`.

Do not patch individual jump buttons. The shared fix belongs in `PriceChart`.

### Future data appears during replay

Check:

- The component reads from `useVisibleCandles()`.
- The engine/helper receives the visible slice, not `candlesAtom`.
- MTF code uses `indexAtOrBefore()`, not nearest-time selection.

### Re-select cannot choose future candles

Check:

- `ReplaySelectionLayer` reads full `candlesAtom` only when `reSelecting` is true.
- Selection overlay pointer events are enabled.
- Chart pan/zoom is disabled only during selection.

### Replay resets or jumps to live after changing timeframe

This is a bug. `useMarketData()` may disarm replay when the symbol changes, but
it must not disarm replay when only the timeframe changes. The replay cursor is
kept by absolute candle time and `reconcileReplayToCandlesAtom` maps that time
to the new timeframe's candle index.

Check:

- `useMarketData()` guards `disarm()` behind `symbolChanged`.
- Timeframe history loads around `cursorTimeAtom` when the cursor is far from
  latest data.
- After history is set, `reconcileReplayToCandlesAtom` runs instead of
  index-only `setTotalAtom` while replay is active.

## 15. Known Boundaries

- Deep replay history is bounded by provider history loading. Current main
  history load uses `HISTORY_BARS = 1500` in `useMarketData()`.
- Replay MTF dashboard loads `MTF_BARS = 500` per higher timeframe.
- The app does not yet paginate older history on demand when a replay jump is
  outside loaded candles; it clamps to the closest loaded candle.
