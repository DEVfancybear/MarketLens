# Chart Layout Architecture

_Updated 2026-07-22._

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

`ChartLayoutWorkspace` is the shared desktop/mobile renderer. The active slot
mounts the complete interactive `ChartArea`; inactive slots mount real,
read-only `PriceChart` previews. A preview has its own history/subscription and
becomes the interactive chart when the user activates it.

## State ownership

| Module | Responsibility |
| --- | --- |
| `store/replayLayoutStore.ts` | Arrangement, four stable pane records, active slot, Replay scope, and track mapping |
| `components/chart/ChartLayoutWorkspace.tsx` | Grid rendering, preview market data, pane activation, and active-chart focus treatment |
| `store/chartStore.ts` | Active chart symbol/timeframe plus indicator and drawing state |
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
       -> active slot: ChartArea
       -> inactive slots: read-only PriceChart previews
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

Stable pane IDs are also drawing chart IDs. This prevents switching panes from
mixing drawing scopes even though the interactive chart component is remounted.
Indicators currently remain layout-wide and are rendered consistently in the
active chart and previews.

## Saved layout lifecycle

Saved layouts require an authenticated backend session. Arrangement controls
remain available without authentication, but anonymous/sign-out reset returns
the workspace to one chart and `single_chart` Replay scope.

`SavedLayoutState` version 1 persists:

- arrangement and Replay scope;
- all four pane records and the active slot;
- indicator configuration;
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

The Go Replay service requires track slots contiguous from zero. An active UI
pane can be slot 1, 2, or 3 after a saved-layout restore, so
`replayTracksForBackend()` remaps a one-chart session to backend slot zero.
`PriceChart` and `useChartSeries()` map that track back to the active UI slot.
All-chart layouts already produce ordered, contiguous tracks.

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
- The Layout trigger reports `aria-haspopup="menu"` and its expanded state.
- Destructive delete uses the shared confirmation dialog.

## Verification

Focused coverage:

- `tests/replay/replayLayoutStore.test.ts`
- `tests/replay/replayUiState.test.ts`
- `tests/browser/chartLayoutWorkspace.spec.ts`
- `tests/browser/desktopOverlayRegression.spec.ts`

Recommended gates:

```bash
npm run typecheck
npm run test:replay
npm run build
npx playwright test tests/browser/chartLayoutWorkspace.spec.ts tests/browser/desktopOverlayRegression.spec.ts
```
