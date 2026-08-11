# Chart Layout Architecture

_Updated 2026-08-11._

## Scope and behavior contract

The Layout menu owns three related workspace concerns:

1. saved layout snapshots;
2. the visible chart arrangement;
3. whether Bar Replay targets the current chart or every visible chart.

The behavior follows TradingView's documented model:

- a layout is a saved workspace containing chart settings, indicators, and drawings;
- multi-chart layouts keep a distinct symbol and interval per chart;
- Bar Replay can run on the current chart or all charts, with all selected charts
  synchronized by time.

References:

- [TradingView layouts quick guide](https://www.tradingview.com/support/solutions/43000746975-tradingview-layouts-a-quick-guide/)
- [Layouts, charts, drawings, and indicators](https://www.tradingview.com/support/solutions/43000692404-layouts-charts-drawings-indicators-and-their-interaction/)
- [Synchronized Bar Replay](https://www.tradingview.com/blog/en/synchronized-bar-replay-45933/)

## Supported arrangements

| Preset | Visible slots | CSS grid |
| --- | --- | --- |
| `single` | `0` | one column, one row |
| `two_horizontal` | `0, 1` | two columns, one row |
| `two_vertical` | `0, 1` | one column, two rows |
| `grid_2x2` | `0, 1, 2, 3` | two columns, two rows |

`ChartLayoutWorkspace` is the shared desktop/mobile renderer. In a multi-chart
arrangement, every visible slot owns one persistent read-only `PriceChart`
preview keyed by its stable pane ID. The active slot additionally mounts the
complete interactive `ChartArea` on an opaque layer above that preview. Changing
focus therefore replaces only the interactive layer; it never unmounts the
outgoing pane's painted preview.

Keeping the preview mounted is a rendering invariant, not only a data-cache
optimization. Lightweight Charts can resize its canvas backing bitmap to the
current device-pixel ratio shortly after mount. That resize clears the bitmap;
a newly mounted non-interactive preview may not receive another render frame
and can remain blank even though its candles, OHLC text, DOM, and canvas sizes
are all valid. The persistent preview has already completed that lifecycle and
retains its painted bitmap through repeated focus changes.

The active preview remains full-size below the interactive surface; it is never
hidden with `display: none`, which would collapse its resize measurements.
While covered, it suppresses indicators, legends, alerts, drawings, markers,
and pointer handling. This avoids duplicate indicator work and prevents the
hidden preview from competing with the active chart for the shared alert-line
registry. Single-chart mode continues to mount only one interactive
`ChartArea`.

Cold preview history is loaded through one shared low-priority queue because
the MT5 bridge exposes one history slot. Each queued task rechecks the
symbol/timeframe cache before calling the API, so duplicate symbols at the same
interval share the first successful result while duplicate symbols at different
intervals remain isolated. Pane changes abort obsolete tasks. A visible empty
pane retries transient HTTP, bridge warm-up, and empty-history failures with
capped backoff and pane-specific jitter until candles arrive; one temporary
failure therefore cannot leave that pane permanently blank.

Preview subscriptions and history recovery have separate lifecycles. Every
visible live preview keeps its kline subscription while focus moves, so the
active-to-inactive handoff never drops the pane's last lease. Only an inactive
preview starts REST history recovery; the covered active preview observes the
same keyed candle store while `ChartArea` owns active loading. This prevents
duplicate cold-history requests without reintroducing subscription churn.

When the active `ChartArea` becomes a read-only preview, it records the last
coherent live series under the stable pane ID. The preview renders that series
only while its exact symbol/timeframe cache is empty, then yields immediately
to keyed market data. Replay projections are never retained as live fallback.
This handoff covers all four arrangements and removes the active-to-inactive
blank frame without hard-coding any symbol.

The same slot contract applies to symbol drag/drop in every preset. Watchlist
pointer dragging resolves the chart section under the cursor, shows a
pane-local drop preview, then updates only that pane's symbol while preserving
its interval. The target pane becomes active; sibling panes and watchlist order
are unchanged.

## State ownership

| Module | Responsibility |
| --- | --- |
| `store/replayLayoutStore.ts` | Arrangement, four stable pane records, active slot, Replay scope, chart drop state, alert-line ownership, and track mapping |
| `components/chart/ChartLayoutWorkspace.tsx` | Grid rendering, preview market data, pane activation, and active-chart focus treatment |
| `store/chartStore.ts` | Active symbol/timeframe bridge plus pane-scoped indicator and drawing registries |
| `store/layoutStore.ts` | Capture, restore, create, update, default, and delete saved snapshots |
| `services/api/resources/layoutsApi.ts` | Typed backend layout DTOs and CRUD calls |
| `components/toolbar/TopToolbar.tsx` | Desktop Layout menu and `Ctrl+S` behavior |
| `components/mobile/MobileChartToolsWorkspace.tsx` | Mobile controls for the same atoms/actions |

The state flow is:

```text
Layout menu
  -> setChartLayoutPresetAtom / setReplayLayoutModeAtom
  -> chartPanesAtom + activeChartSlotAtom
  -> ChartLayoutWorkspace
       -> every multi-chart slot: persistent read-only PriceChart preview
       -> active multi-chart slot: opaque ChartArea overlay
       -> single-chart slot: ChartArea only
```

`chartStore.symbolAtom` and `timeframeAtom` remain the active chart bridge used
by existing toolbar and chart code. `chartPanesAtom` is the source of truth for
inactive panes. When a pane becomes active, the workspace switches the drawing
context and mirrors that pane's symbol/timeframe into the active chart atoms.
When the active selection changes, it is written back to that pane.

## Pane invariants

- There are always four normalized pane records, even when fewer are visible.
- Slot zero keeps the stable id `main`; later slots default to `chart-2`,
  `chart-3`, and `chart-4`.
- Expanding an arrangement initializes a never-used visible pane from the
  active pane once.
- Shrinking an arrangement hides pane records without deleting their market
  selection. Expanding again restores them.
- The active slot must be visible. Loading malformed or legacy state falls back
  to the first visible slot.
- Snapshot normalization validates slot numbers, IDs, symbols, and timeframes,
  and guarantees unique stable IDs.
- Selecting `single` forces Replay scope back to `single_chart`.
- Expanding from `single` keeps the safe `single_chart` Replay scope.
  `All charts` is always an explicit user choice.

Stable pane IDs are also drawing chart IDs. This prevents switching panes from
mixing drawing scopes even though the active interactive overlay is remounted.
The same IDs own `IndicatorConfig.chartScope`; indicators created in one pane
are filtered out of sibling panes. Legacy indicator presets without a scope are
bound to the active pane once at the persistence boundary.

Drawing creation defaults to `chart-only`. `layout-symbol` and `global` remain
explicit user-selected synchronization modes. Version 2 of the chart setting
migrates the former implicit `global` default without overriding later
versioned choices. Inactive panes project their own cached drawing slice so an
object remains visible in its source pane while another pane is active.

Pane activation always closes transient drawing/indicator editors and returns
the active drawing tool to Cursor before changing context. The drawing
interaction cancellation key includes symbol, layout ID, and pane ID; an
unfinished Long Position or any other tool therefore cannot continue in the
new pane.

## Current workspace persistence

`settings.chart.symbol` is the authenticated user's latest active symbol.
`setSymbolAtom` writes a local pending marker immediately and queues the backend
patch. The pending local value wins during a refresh until the bootstrap value
acknowledges it; sign-out explicitly flushes the settings queue before ending
the backend session.

`settings.chart.workspaceLayout` autosaves the complete current projection for
all supported presets: arrangement, Replay scope, four pane records, active
slot, and chart-local alert ownership. The chart-settings mutation queue
coalesces rapid changes and `flushChartSettings()` drains it before backend
logout. On the next authenticated bootstrap this current workspace wins over a
default saved layout, so a 2-horizontal, 2-vertical, or 2x2 session reopens
exactly as the user left it. A default saved layout is used only when an account
does not yet have a current-workspace snapshot.

EURUSD remains the backend default only for an account that has never selected
a symbol. Explicitly loading a saved layout still adopts and persists that
layout's active symbol.

## Saved layout lifecycle

Saved layouts require an authenticated backend session. Arrangement controls
remain available without authentication, but anonymous/sign-out reset returns
the workspace to one chart and `single_chart` Replay scope.

`SavedLayoutState` version 1 persists:

- arrangement and Replay scope;
- all four pane records and the active slot;
- per-layout alert-line chart ownership;
- pane-scoped indicator configuration for every chart in the layout;
- drawings rebound to a stable `drawingContextId`;
- panel sizes, open states, and bottom-panel tab;
- top-level symbol/timeframe compatibility fields for older snapshots.

The first saved layout becomes the default only when no default exists.
Authenticated bootstrap sorts layouts with the default first and loads the
default snapshot automatically. Loading a snapshot restores pane state before
applying the active pane's chart/drawing state.

Actions have the following semantics:

| Action | Result |
| --- | --- |
| Save current as | Creates a new backend snapshot and adopts a new stable drawing layout scope |
| Update selected | Overwrites the same layout ID and preserves its default flag |
| Make selected default | Marks only the selected layout as default |
| Delete selected | Confirms first, deletes remotely, then loads the remaining default or newest layout |
| `Ctrl+S` | Updates the active layout; if none is active, opens the save prompt |
| `Ctrl+Alt+S` / `Ctrl+Shift+S` | Retain image download/copy behavior |

## Replay track mapping

Replay remains backend-authoritative; layout code only determines session
tracks and maps them to visible panes.

| Scope | UI tracks |
| --- | --- |
| `single_chart` | Active visible pane only |
| `all_charts` | Every visible pane in slot order |

Replay track slots preserve the layout slot exactly. A Current-chart session
created from UI pane 1, 2, or 3 therefore remains pinned to that pane even when
focus moves elsewhere. `PriceChart` and `useChartSeries()` select a Replay track
only by the exact pane slot; unmatched panes continue to render live data.

Changing arrangement, active market state, or Replay scope causes
`ReplayClientRuntime` to compare the desired track configuration and recreate
the session when required. Inactive panes stay live in `single_chart` mode; all
visible panes consume their server-revealed track in `all_charts` mode.

See `REPLAY_ARCHITECTURE.md` for session authority, commands, interval, and
projection rules.

## Accessibility contract

- Arrangement and Replay choices use radio-menu semantics and `aria-checked`.
- `All charts` is a real disabled menu item in a single-chart arrangement.
- Each chart section exposes its slot and active state through an accessible
  label.
- Inactive previews use a full-pane activation button with a visible keyboard
  focus ring.
- A watchlist drag shows a high-contrast, pointer-transparent drop target on
  only the hovered chart.
- The Layout trigger reports `aria-haspopup="menu"` and its expanded state.
- Destructive delete uses the shared confirmation dialog.

## Verification

Focused coverage:

- `tests/replay/replayLayoutStore.test.ts`
- `tests/replay/replayUiState.test.ts`
- `tests/browser/chartLayoutWorkspace.spec.ts`
- `tests/browser/desktopOverlayRegression.spec.ts`
- `tests/chart/indicatorChartScope.test.ts`
- `tests/chart/chartSettingsPersistence.test.ts`

The layout browser suite includes a cold-history recovery regression that
switches a chart from active to preview while its first request is in flight,
forces the next request to fail, and verifies that the same-symbol,
different-timeframe pane repaints after the automatic retry.
It also alternates focus between two panes twelve times, waits beyond the
delayed device-pixel-ratio resize window on every switch, and proves that both
original preview DOM nodes remain connected with live canvas backing stores.
`paneSeriesRetention.test.ts` additionally proves that an empty keyed cache
uses only the matching live frame, that authoritative keyed candles replace it,
and that Replay/other-symbol data can never leak into the fallback. The same
retention path now feeds active charts as well as previews. A bounded
`sessionStorage` frame is keyed by drawing layout, pane, symbol, and timeframe,
so a browser refresh can paint candles immediately while the authoritative
history request warms; cached frames expire after 24 hours and Replay frames
are never persisted.

Recommended gates:

```bash
npm run typecheck
npm run test:replay
npm run build
npx playwright test tests/browser/chartLayoutWorkspace.spec.ts tests/browser/desktopOverlayRegression.spec.ts
```
