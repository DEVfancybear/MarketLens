# Responsive Architecture

_Last updated: 2026-07-12_

This document defines the responsive plan for the trading terminal. The goal is
not to make the desktop layout shrink until it fits. The goal is to provide
three intentional layouts that preserve the chart as the primary workspace on
desktop, tablet, and phone.

## Research Sources

Sources reviewed for this plan:

- TradingView mobile landing page: confirms TradingView ships a dedicated
  mobile experience rather than treating the desktop web layout as the only UI.
  https://www.tradingview.com/mobile/
- Financial Tech Wiz TradingView mobile guide: shows the mobile app pattern of a
  bottom chart tab, bottom-right plus menu, indicators inside that plus menu,
  chart layout under the chart/dots flow, and notes that Pine Editor is not part
  of the mobile app flow.
  https://www.financialtechwiz.com/post/tradingview-mobile-app/
- Plus500 TradingView integration page: describes TradingView charts as
  interactive/responsive and highlights a large drawing-tool and indicator
  surface, which supports keeping responsive work focused on chart-first
  interaction rather than removing advanced tools.
  https://financialservices.plus500.com/tradingview/
- Binance mobile chart settings article: shows a comparable trading app pattern:
  compact interval row, chart settings icon, and a mobile sheet with Indicators,
  Drawing, Style, Date, and More actions.
  https://evrdh.tistory.com/entry/binance-chart-indicators
- FX Tetori iPad/tablet analysis: highlights that tablet-optimized trading apps
  use the larger screen deliberately with split charts, customizable panels, and
  full-screen tablet workspaces instead of simply scaling phone UI.
  https://tetori.jp/fx-smartphone/ipad-fx/

## Current State

The responsive shell foundation is implemented:

- `TerminalLayout` uses an 88px two-tier header, chart-first workspace surfaces,
  a resizable desktop right dock, and an overlay right drawer on tablet/phone.
- `useViewportMode` centralizes phone, tablet, and desktop classification.
- Entering tablet/phone mode closes the desktop right dock; the toolbar toggle
  opens it explicitly as a scrim-backed drawer.
- The command bar stays on one line and scrolls horizontally instead of
  wrapping.
- Coarse-pointer menu/icon controls expand to at least 44px.
- Dropdowns render through a body portal so toolbar/panel overflow cannot clip
  them. Features with fixed search/header content use `scrollMode="content"`
  and own one internal scroll region.
- Browser zoom is enabled, the shell uses `dvh`, and global reduced-motion
  handling is active.

Remaining phases include a phone-specific drawing presentation, responsive
full-screen/bottom-sheet variants for every legacy fixed dialog, and
viewport-specific dock size persistence.

## Product Principles

1. Chart first.
   The chart must keep the largest possible continuous area. Panels should not
   permanently steal screen area on phone.

2. Do not wrap trading toolbars.
   Wrapping destroys muscle memory. Use priority groups, horizontal scroll, or
   overflow menus.

3. Touch is a first-class input mode.
   Coarse pointer devices need larger hit targets, no hover-only controls, and
   edge-aware flyouts.

4. Desktop behavior should not regress.
   The current docked desktop model remains the default for wide screens.

5. Persist layout per breakpoint.
   A phone bottom-sheet height should not overwrite a desktop bottom dock height.

6. Responsive behavior is shared infrastructure.
   Components should ask a common viewport/layout policy instead of each
   component inventing its own `window.innerWidth` rules.

## Breakpoints

Use both width and pointer capability. Some tablets report desktop-class widths
but still need touch affordances.

| Mode | Width | Pointer | Primary layout |
| --- | --- | --- | --- |
| Phone | `< 768px` | any, usually coarse | Chart-first full screen with bottom navigation and sheets |
| Tablet portrait | `768-1023px` or coarse pointer | coarse/mixed | Chart with overlay drawers and bottom sheets |
| Tablet landscape | `1024-1199px` or coarse pointer | coarse/mixed | Chart plus optional overlay/temporary side panels |
| Desktop | `>= 1200px` and fine pointer | fine | Current docked layout |

Recommended constants:

```ts
export type ViewportMode = "phone" | "tablet" | "desktop";

export const RESPONSIVE_BREAKPOINTS = {
  phoneMax: 767,
  tabletMax: 1199,
};
```

## Shared State Model

Add one shared responsive policy layer.

```ts
interface ViewportState {
  width: number;
  height: number;
  mode: "phone" | "tablet" | "desktop";
  orientation: "portrait" | "landscape";
  pointer: "coarse" | "fine";
  hover: boolean;
  safeArea: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

interface ResponsivePanelState {
  rightPresentation: "dock" | "drawer" | "hidden";
  bottomPresentation: "dock" | "sheet" | "fullscreen" | "hidden";
  drawingPresentation: "rail" | "bottomBar" | "addSheet";
  toolbarPresentation: "full" | "compact" | "mobile";
}
```

Implementation target:

- Add `useViewport()` backed by `matchMedia`, `ResizeObserver`, and visual
  viewport events where available.
- Add a derived `responsivePolicyAtom`.
- Store panel sizes under breakpoint-aware keys:
  - `ui.panels.desktop`
  - `ui.panels.tablet`
  - `ui.panels.phone`
- Clamp persisted sizes on every viewport change.

## Layout Policy

### Desktop

Desktop keeps the current model:

- Top toolbar: full row.
- Left drawing rail: visible.
- Right watchlist: docked when open.
- Bottom panel: docked and resizable.
- Dialogs: centered or TradingView-style floating modals.

### Tablet

Tablet should use the screen like a trading workspace, not a stretched phone:

- Top toolbar: compact row with horizontally scrollable timeframe group and a
  `More` overflow menu for low-priority actions.
- Left drawing rail:
  - landscape and width `>= 900px`: rail can remain.
  - portrait or narrow tablet: convert to bottom drawing/action bar.
- Right watchlist:
  - default hidden.
  - opens as right drawer/slideover over the chart.
  - drawer width: `min(360px, 88vw)`.
- Bottom panel:
  - opens as a bottom sheet, not a permanent dock, unless landscape has enough
    height.
  - max height: `min(520px, 55vh)`.
  - collapsed by default when chart height would fall below 420px.
- Dialogs:
  - centered when space allows.
  - bottom sheet for tall forms in portrait.

### Phone

Phone should be chart-first:

- Top bar:
  - symbol/search, active timeframe, current price/connection, and menu.
  - no full desktop toolbar row.
- Drawing tools:
  - no permanent left rail.
  - bottom action bar with Cursor, Draw/Add, Indicators, Replay, Trade/More.
  - drawing groups open as full-width bottom sheets.
- Indicator menu:
  - full-screen or near-full-screen sheet.
  - search fixed at top.
  - active indicators listed below.
- Watchlist:
  - full-screen tab/drawer, not a dock.
- Bottom panel:
  - default hidden.
  - Replay/Trade/Journal/Pine open as bottom sheet.
  - Pine Editor should open full-screen because code editing needs height.
- Settings dialogs:
  - bottom sheet or full-screen form.
  - footer pinned above safe-area bottom.
  - inputs must avoid being hidden behind mobile keyboard.
- Context menus:
  - convert right-click menus to long-press/tap action sheets.

## Component Migration Plan

### Phase 1 - Responsive Infrastructure

Files:

- `src/hooks/useViewport.ts`
- `src/store/uiStore.ts`
- `src/components/layout/TerminalLayout.tsx`

Tasks:

- Add viewport detection and responsive policy.
- Split persisted panel sizes by viewport mode.
- Add size clamps:
  - desktop bottom: `140-560px`
  - tablet sheet: `180px-min(520px,55vh)`
  - phone sheet: `180px-min(76vh,calc(100vh - safe top - 48px))`
- Disable dock resizers when a panel is in drawer/sheet mode.
- Ensure chart resize is triggered synchronously when policy changes.

### Phase 2 - Top Toolbar

Files:

- `src/components/toolbar/TopToolbar.tsx`
- `src/components/toolbar/SymbolSearch.tsx`
- `src/components/ui/Dropdown.tsx`

Tasks:

- Assign priority to toolbar actions:
  - P0: symbol, timeframe, indicators/add, replay, trade state.
  - P1: SMC, settings, layout.
  - P2: screenshot, theme, fullscreen, connection detail.
- Desktop renders all.
- Tablet renders P0 plus visible P1, P2 in overflow.
- Phone renders compact top bar plus overflow.
- Timeframes become horizontal scroll on touch devices.

### Phase 3 - Drawing Tools

Files:

- `src/components/toolbar/DrawingToolbar.tsx`
- `src/components/chart/DrawingSettingsToolbar.tsx`

Tasks:

- Add `DrawingToolSurface` with variants:
  - `rail`
  - `bottomBar`
  - `sheet`
- Preserve the same `GROUPS` registry. Only the presentation changes.
- Replace hover-only color palette with tap-open palette on touch devices.
- Make flyouts edge-aware:
  - desktop: left rail flyout.
  - tablet/phone: bottom sheet or anchored popover.
- Minimum touch target: 40px tablet, 44px phone.

### Phase 4 - Panels

Files:

- `src/components/layout/BottomPanel.tsx`
- `src/components/watchlist/Watchlist.tsx`
- `src/components/trade/TradePanel.tsx`
- `src/components/pine/PineEditor.tsx`

Tasks:

- Create `ResponsivePanelShell`:
  - `dock`
  - `drawer`
  - `bottomSheet`
  - `fullscreen`
- Use this shell for Watchlist, BottomPanel, Trade, Replay, and Pine.
- Phone:
  - Watchlist fullscreen drawer.
  - Trade bottom sheet with sticky Buy/Sell footer.
  - Pine fullscreen editor.
- Tablet:
  - Watchlist drawer.
  - BottomPanel sheet.
- Desktop:
  - keep current dock behavior.

### Phase 5 - Dialogs And Menus

Files:

- `src/components/chart/ObjectSettingsDialog.tsx`
- `src/components/chart/PositionSettingsDialog.tsx`
- `src/components/toolbar/IndicatorSettingsDialog.tsx`
- `src/components/toolbar/IndicatorMenu.tsx`
- context menu components under `src/components/chart/`

Tasks:

- Add `ResponsiveDialogSurface`.
- Desktop: fixed/floating modal.
- Tablet: centered modal or bottom sheet based on height.
- Phone: bottom sheet/fullscreen.
- Pin footer actions.
- Add safe-area padding:

```css
padding-bottom: max(16px, env(safe-area-inset-bottom));
```

- Replace right-click-only interactions with tap/long-press actions on touch.

### Phase 6 - Chart And Gesture Behavior

Files:

- `src/components/chart/PriceChart.tsx`
- `src/components/chart/ChartArea.tsx`
- drawing interaction managers under `src/components/chart/drawing/`

Tasks:

- Treat viewport changes as immediate chart invalidations.
- Make overlay and drawing layers resize in the same frame as the chart canvas.
- Confirm pinch zoom, horizontal pan, vertical price scale drag, and drawing
  handle drag do not fight each other.
- Increase touch hit radius for drawings:
  - fine pointer: current radius.
  - coarse pointer: `max(current, 12px)`.
- Keep crosshair behavior predictable:
  - tap/hold can show crosshair.
  - dragging chart should not accidentally move selected drawings unless the
    drag starts on a handle/body hit target.

## Visual Rules

- Avoid nested cards in tool surfaces.
- Use compact, dense controls on desktop; larger targets on touch.
- Never let toolbar text wrap inside buttons.
- Prefer icons and overflow menus over squeezing text labels.
- Dialog width:
  - desktop: current `380-456px` depending on feature.
  - tablet: `min(480px, calc(100vw - 32px))`.
  - phone: `100vw` bottom sheet or fullscreen.
- Bottom sheets:
  - rounded top corners only.
  - fixed footer if actions are present.
  - content scrolls, shell does not.
- Respect safe area insets on iOS/Android browsers.

## Testing Plan

Add Playwright viewport coverage in the existing dedicated test area:

| Viewport | Purpose |
| --- | --- |
| `390x844` | iPhone portrait |
| `430x932` | large phone portrait |
| `844x390` | phone landscape |
| `768x1024` | tablet portrait |
| `1024x768` | tablet landscape |
| `1366x768` | desktop regression |
| `1920x1080` | wide desktop regression |

Test cases:

- Initial load keeps chart visible and interactive.
- Bottom panel does not consume most of phone/tablet viewport by default.
- Watchlist opens as drawer/fullscreen outside desktop.
- Drawing tools are reachable without a left rail on phone.
- Indicator popup fits phone viewport and has fixed search/header behavior.
- Settings dialogs do not overflow off-screen.
- Touch-size controls remain at least 40px on tablet and 44px on phone.
- Resizing/orientation changes reposition drawings immediately.
- Pine editor opens fullscreen on phone.
- Desktop screenshots remain unchanged except intentional responsive shell
  plumbing.

Recommended commands:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:responsive
```

`test:responsive` does not exist yet. Add it when Playwright coverage is
introduced.

## Acceptance Criteria

Phone:

- Chart is usable on first load without manually collapsing panels.
- No permanent left/right dock.
- Primary chart actions are reachable from bottom/overflow controls.
- Indicator and drawing menus open as sheets and fit the viewport.
- Pine Editor does not appear as a cramped bottom dock.

Tablet:

- Landscape can support a rail/drawer hybrid.
- Portrait uses sheets/drawers instead of permanent side docks.
- Watchlist and bottom panel do not reduce chart below the minimum usable height.
- Layout feels optimized for tablet space, not a scaled phone view.

Desktop:

- Existing dock behavior, resizers, hotkeys, drawing workflows, and chart
  performance remain intact.

## Implementation Notes

- Do not scatter raw breakpoint checks through component trees.
- Put viewport policy in one store/hook and pass presentation variants down.
- Keep tool registries shared. Responsive work changes presentation, not feature
  definitions.
- Do not persist hidden/open panel state blindly across modes. A right dock open
  on desktop should not force a phone drawer open on next visit.
- Any chart container size change must call the chart resize/invalidation path in
  the same frame. Previous zoom/viewport bugs came from deferred synchronization.
- Prefer CSS `dvh/svh` where needed, but centralize browser quirks in layout
  shell components.

## Proposed Milestones

1. Infrastructure and non-regression desktop shell.
2. Phone-safe initial layout with hidden docks and bottom action bar.
3. Tablet drawer/sheet model.
4. Responsive dialogs and menus.
5. Gesture/hit-target tuning.
6. Playwright screenshot and interaction coverage.
