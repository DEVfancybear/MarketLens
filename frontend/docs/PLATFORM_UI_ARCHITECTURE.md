# Desktop and Mobile UI Architecture

_Last updated: 2026-07-16_

## Outcome

The trading terminal is now composed as two presentation platforms, selected at one boundary in `components/Terminal.tsx` and loaded as separate lazy chunks:

- Desktop: `components/desktop/DesktopTerminal.tsx` owns the command bar, drawing rail, docked chart, market desk and bottom workspaces.
- Mobile/touch: `components/mobile/MobileTerminal.tsx` owns its chart app bar, shared-favorite timeframe strip, five-screen bottom navigation, touch drawing catalog, market/watchlist management, trade flow, portfolio and menu workspaces.

Desktop and mobile do not share layout JSX, navigation, watchlist presentation, drawing controls, symbol picker, timeframe picker, order-flow layout or data-list layout. Changing desktop composition therefore cannot silently reflow the mobile application, and vice versa.

## What remains shared

Presentation is split; domain behavior is not duplicated. Both platforms use the same:

- Jotai atoms and business models.
- API clients, streams, replay/trading services and persistence.
- Chart canvas/series engine and drawing command model.
- Semantic theme contract and market color meanings.
- Formatting, validation and catalog data.
- Feature catalogs and synchronization hooks for drawings, timeframes, SMC, snapshots, authentication and watchlist sorting.

New trading rules belong in stores/services. Platform-specific component composition belongs under `components/desktop` or `components/mobile`. Shared domain and presentation controllers may expose explicit platform presentations; shell composition, density, and interaction details remain platform-owned.

## Platform selection

`resolveTerminalPlatform` chooses desktop only when the viewport is at least 1100px and the primary pointer is not coarse. Smaller viewports and touch-first devices use mobile controls, including wide tablets. `useTerminalPlatform` observes resize, pointer-capability and Visual Viewport changes so rotation and virtual keyboards do not leave a stale shell mounted.

## Mobile navigation

The mobile app exposes five real screens:

1. Chart
2. Markets
3. Trade
4. Portfolio
5. Menu

Draw, Indicators, Chart tools and Replay are chart actions. Journal, Analytics, Pine, Object tree, Logs, Account and integration settings live under Menu. Chart tools also provide SMC, layouts, snapshots, alerts, display settings and connection access. Modal content uses `MobileSheet`; the background application is hidden from assistive technology while a sheet is open.

Markets owns catalog search, list switching, sorting, sections and explicit symbol/section move controls. Trade owns simulator, MT5 and Replay execution presentations while reusing the same ticket, persistence and command stores as desktop.

See `MOBILE_DESKTOP_FEATURE_PARITY.md` for the maintained capability matrix.

## Touch and drag model

Pointer Events are used instead of HTML Drag and Drop. A sheet gesture tracks one primary `pointerId`, begins after 8px, dismisses after 72px of visible downward travel and rolls back on `pointercancel`/lost capture. The handle owns the drag gesture; sheet content keeps native vertical scrolling. Actionable chart popups use the same primary-pointer and capture principles through a separate shared surface contract described below.

Rules for new mobile interactions:

- Touch target is at least 44x44px, with visible pressed/focus state.
- Never depend on hover, right-click, drag, swipe or long-press alone.
- Provide a tap, close, menu or numeric-input alternative for every drag action.
- Use `touch-action: manipulation` for taps and `none` only on a dedicated gesture handle.
- Track one active pointer and ignore non-primary pointers for single-pointer operations.
- Keep system back edges clear and respect safe-area insets.
- Respect `prefers-reduced-motion` and never block browser zoom.

See `design-system/smc-trading-terminal/pages/mobile-terminal.md` for the full mobile contract.

## Mobile chart popup contract

All actionable floating surfaces rendered over the mobile chart use
`components/chart/ChartPopupSurface.tsx` and
`hooks/useDraggableSurface.ts`. The surface marks the chart-UI boundary and
provides a visible 44px `ChartPopupDragHandle`; the hook centralizes primary
pointer capture, cancel rollback, keyboard Arrow movement, Home reset and
chart/viewport clamping. A portalled popup clamps against `getViewportRect()`
and is remeasured on Visual Viewport resize/scroll, so browser zoom and the
virtual keyboard cannot leave its controls outside the visible area. Popup
content remains independently tappable, editable and scrollable because only
the handle owns `touch-action: none`.

`ChartArea` owns the common `data-chart-popup-bounds` region and the
`.mobile-chart-popup-stack` overlay host. The mobile chart action bar and
compact Replay controls are siblings in this host, so layout gap, paint order
and hit testing are deterministic instead of depending on nested stacking
contexts. Selected-drawing settings, indicator legend, Replay selection HUD,
risk controls and mobile chart context menus reuse the same drag primitive.
Context menus still use `useFloatingSurface` for pointer-anchor placement and
available width/height; the shared popup surface composes mobile drag and
dismissal behavior with that layout rather than duplicating or discarding it.

The shared surface is not a blanket wrapper for every visual chart overlay.
Non-actionable transient output such as crosshair labels, price markers and
drawing previews stays pointer-transparent. Modal dialogs retain the dialog
contract, while `MobileSheet` retains focus trapping, Back/Escape/scrim/Close
dismissal and its downward-only handle gesture.

## Theme contract

Dark and light modes use semantic CSS variables in `app/globals.css`. Tailwind maps RGB channel variables through `<alpha-value>`, so token opacity modifiers work consistently. Chart colors mirror the same palette in `chartTheme.ts`.

The root theme helper toggles only `theme-dark`/`theme-light` and preserves unrelated document classes. Controls use `--text`, `--text-muted`, `--border`, `--border-strong`, `--accent`, `--bull` and `--bear`; raw chrome colors are not permitted in new platform UI.

## Desktop overlay contract

Desktop menus must not depend on the stacking context of the command bar,
chart, dock or sidebar. The shared `components/ui/Dropdown.tsx` therefore uses a
document-body portal by default. `portal={false}` is an explicit escape hatch
for a consumer with a reviewed local-positioning requirement; it is not the
normal desktop path.

The shared portal contract provides:

- fixed positioning from the trigger rectangle;
- left/right alignment plus an 8px viewport boundary;
- opening above the trigger when the available space below is smaller;
- a bounded `maxHeight` with vertical scrolling for tall content;
- repositioning on resize, ancestor scroll and content resize;
- pointer-outside dismissal that recognizes both trigger and portaled panel;
- Arrow Down/Up opening with first/last-action focus;
- Escape dismissal and focus return to the trigger;
- semantic theme inheritance from the root CSS variables;
- `data-chart-ui` isolation so popup interaction never reaches chart gestures.

The default applies to all 11 shared dropdown consumers: chart settings, SMC,
symbol search, timeframe, saved layout, snapshot, user menu, three watchlist
menus and Replay timing. Consumers with text fields keep input autofocus;
dynamic and bottom-anchored consumers rely on collision/reposition handling.

`ChartSettingsMenu` is the reference semantic implementation. Its trigger
announces `aria-haspopup`, `aria-expanded` and `aria-controls`; its panel uses a
named `menu` with `menuitem`/`menuitemcheckbox` rows. Raising arbitrary z-index
values inside the toolbar is forbidden because it cannot cross an ancestor
stacking context.

## Accessibility contract

- Sheets and dialogs have modal semantics, an accessible name, Escape handling, focus trap and focus return.
- Actionable chart-popup drag handles have an accessible name, 44px mobile target, Arrow-key movement and Home reset.
- Active navigation uses `aria-current="page"`.
- Resizers expose separator role, values and arrow-key operation.
- Text inputs use a 16px font on mobile to avoid iOS auto-zoom.
- Market direction is never communicated by color alone.
- Reduced-motion users receive no non-essential transitions or animation.

## Verification

Run:

```bash
npm run typecheck
npm run lint
npm run test:ui
npx playwright test tests/browser/desktopOverlayRegression.spec.ts
npx playwright test tests/browser/platformUi.spec.ts
npx playwright test tests/browser/mobileFeatureParity.spec.ts
npm run test:chart
npm run build
```

Verified parity baseline on 2026-07-14:

- selected mobile parity/drawing/replay, platform and desktop overlay browser regressions: 18/18;
- pure UI/model tests: 33/33;
- drawing tests: 153/153;
- watchlist tests: 18/18;
- indicator catalog, trade and replay tests: 3/3, 6/6 and 30/30;
- typecheck, lint and production build: pass.

Viewport matrix:

- Mobile portrait: 320x568, 375x812, 390x844, 430x932.
- Mobile landscape: 844x390.
- Tablet: 768x1024 and 1024x768.
- Desktop: 1366x768, 1440x900 and 1920x1080.

At mobile widths verify five-screen navigation, the four chart actions, no horizontal page overflow, touch targets, safe areas, light/dark parity, full drawing/timeframe catalogs, chart pan/pinch, chart-popup drag/clamping and Replay/action hit testing, sheet cancel/dismiss and secondary workspaces. At desktop widths verify docks, keyboard resizers, chart tools, dialog focus behavior and bottom workspaces.

## Change checklist

- Desktop presentation imports no mobile presentation outside the `Terminal` boundary.
- Mobile presentation imports no desktop shell, dock, watchlist or data-table component. A shared multi-presentation component must expose its platform presentation explicitly and keep mutations common.
- Mobile styles remain scoped to `.mobile-*`/`.mobile-terminal`.
- Shared code contains no component-level viewport checks.
- Shared desktop dropdowns use the portal contract unless a reviewed local
  positioning exception is documented.
- Actionable mobile chart overlays use `ChartPopupSurface` and the shared
  `ChartArea` bounds/stacking contract; transient output and modal surfaces are
  explicitly excluded.
- New gestures have a non-drag alternative and unit tests for cancel/foreign-pointer paths.
- Every new surface is reviewed in dark and light themes.
- Every new desktop capability has a tested mobile entry point or an explicit exception in `MOBILE_DESKTOP_FEATURE_PARITY.md`.
