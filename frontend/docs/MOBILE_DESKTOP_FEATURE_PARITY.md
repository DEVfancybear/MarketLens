# Desktop-Mobile Feature Parity

_Last verified: 2026-07-16_

The current desktop terminal capabilities have a touch-operable mobile path. Desktop and mobile keep independent presentation shells, while catalogs, state transitions, persistence and API calls stay shared.

## Parity matrix

| Desktop capability | Mobile path | Shared implementation |
|---|---|---|
| Symbol search and selection | Chart symbol sheet and Markets search | Market symbol catalog and `setSymbolAtom` |
| Favorite and custom timeframes | Horizontal favorites plus the full Chart interval sheet | `timeframeSelectorModel` and `useTimeframeFavorites` |
| Indicator store, private scripts, favorites, source and delete | Indicators chart action or Menu workspace | `IndicatorMenu` state/actions and Pine stores |
| Smart Money Concepts visibility | Chart tools > Smart Money Concepts | `SMC_MENU_ITEMS`, `smcSettingsAtom` and `toggleSmcAtom` |
| Saved layouts and chart arrangements | Chart tools > Saved layouts | Layout and replay-layout atoms |
| Alerts | Menu > Alerts or Chart tools > Alerts | Shared Alert Center and alert store |
| Snapshot download/copy | Chart tools > Snapshot | `useChartSnapshotActions` |
| Grid, theme, reset view, fullscreen and connections | Chart tools > Chart display/Connections | Shared UI atoms, chart registry and integration settings |
| Complete drawing catalog | Draw chart action | `DRAWING_TOOL_MANIFEST` and `DrawingToolIcon` |
| Drawing favorites, color, keep mode, magnet and sync scope | Drawing tools > Creation defaults | `useDrawingToolFavorites` and chart preference atoms |
| Lock, hide and remove all drawings | Drawing tools > Manage all drawings | Shared drawing bulk actions and command model |
| Selected drawing properties | In-chart drawing settings toolbar | Shared drawing settings and object dialogs |
| Watchlist search, multiple lists and sorting | Markets search and Manage watchlists | Watchlist atoms and `sortWatchlistSymbols` |
| Watchlist sections and ordering | Markets > Manage watchlists; collapsible headers in the main list | Shared watchlist layout mutations |
| Object tree | Menu or Chart tools > Object tree | Shared `ObjectTreePanel` and drawing commands |
| Replay | Replay chart action or Menu | Replay client, mobile Replay workspace and shared session state |
| Actionable in-chart floating controls | Shared draggable mobile popup stack with visible handles | `ChartPopupSurface` and `useDraggableSurface` |
| Simulator/MT5 order flow and position actions | Trade screen | Shared tickets, MT5 stores, replay trading client and simulator persistence |
| Journal, Analytics and Pine | Menu workspaces | Shared APIs, stores, validation and domain calculations |
| Runtime logs | Menu or Chart tools > Runtime logs | `logsAtom` |
| Identity, cloud state, sign-in and sign-out | Chart avatar or Menu > Account | Shared auth atoms and `terminalAccount` helpers |
| Go to date and time zone | Bottom chart-time toolbar | Shared `ChartTimeToolbar` |

## Presentation-only differences

The following are input/layout affordances rather than missing product capabilities:

- Desktop dock resizing and panel collapse become focused mobile screens or full-screen sheets.
- Desktop hover and right-click actions have visible tap paths on mobile. Actionable floating chart controls also expose a visible touch/keyboard drag handle, remain clamped to chart or current Visual Viewport bounds through rotation, zoom and virtual-keyboard changes, and keep their task actions directly tappable.
- Modal sheets and dialogs retain their own focus and dismissal behavior; transient non-actionable chart overlays remain pointer-transparent rather than becoming draggable controls.
- Desktop keyboard shortcuts remain available to hardware keyboards; every task-critical action also has a mobile button.
- Dense desktop tables become cards or structured lists while using the same data and mutations.

## Shared-code rule

- Catalogs and validation belong in shared model modules.
- Persistence and remote synchronization belong in hooks/services shared by both platforms.
- Jotai atoms remain the single mutation path for chart, layout, watchlist and preference state.
- Platform components may differ in DOM and density but must not reimplement business rules.
- A new desktop capability must add a mobile entry point in the same change or document why it is intentionally desktop-only.

## Regression guard

`tests/browser/mobileFeatureParity.spec.ts` verifies:

- every creation-enabled drawing manifest entry is present on mobile;
- full timeframe catalog, favorite and custom-interval behavior;
- Indicator and Chart tools entry points;
- secondary workspaces and watchlist management;
- shared chart-popup touch dragging, chart/Visual Viewport clamping and Replay/action non-overlap;
- 44px touch targets and zero document overflow at 320x568 and 844x390.

Run the parity and platform suite with:

```bash
npx playwright test tests/browser/mobileFeatureParity.spec.ts tests/browser/mobileDrawing.spec.ts tests/browser/mobileReplay.spec.ts tests/browser/platformUi.spec.ts tests/browser/desktopOverlayRegression.spec.ts
```

Verified result on 2026-07-14: 18/18 browser tests passed. Typecheck, lint, drawing/UI/watchlist/indicator/trade/replay unit suites and the production build also passed.
