# Responsive Architecture

_Last updated: 2026-07-17_

The terminal no longer implements mobile as responsive desktop DOM. It selects one of two isolated presentation platforms:

- Desktop command center: `src/components/desktop/DesktopTerminal.tsx`.
- Mobile/touch application: `src/components/mobile/MobileTerminal.tsx`.

The two roots are lazy-loaded independently from `src/components/Terminal.tsx`. They share stores, services, chart/domain engines and semantic tokens, but not shell JSX, navigation, watchlist/table presentation, drawing controls or workspace composition.

## Platform policy

`src/platform/platformPolicy.ts` selects:

| Result | Condition |
|---|---|
| Desktop | width is at least 1100px and the primary pointer is fine |
| Mobile/touch | width is below 1100px or the primary pointer is coarse |

This deliberately gives tablets and wide touch-first devices the touch platform. `useTerminalPlatform` observes viewport, Visual Viewport and pointer-capability changes.

## Desktop contract

- 56px command bar with explicit control groups.
- Docked drawing rail, chart, market desk and bottom workspace.
- Keyboard-operable resizers and dense data rows.
- Desktop dialogs and floating menus.

See `PLATFORM_UI_ARCHITECTURE.md` and `../design-system/marketlens/pages/desktop-terminal.md`.

## Mobile contract

- Five real screens: Chart, Markets, Trade, Portfolio and Menu.
- Chart-owned Draw, Indicators, Chart tools and Replay actions.
- Mobile-owned symbol picker, timeframe strip, market cards, drawing palette, order flow and data lists.
- The timeframe strip shares desktop favorites, cloud synchronization, the full interval catalog and custom interval validation.
- Mobile-owned Replay, Journal, Analytics, Pine, Object tree, Logs and Account presentations.
- Mobile chart tools expose SMC, saved layouts, chart/replay layouts, snapshots, display settings, connections, alerts and destructive chart actions.
- Markets expose the shared watchlist lists, sorting, sections, symbol ordering and catalog search.
- Full-screen/partial sheets, browser-Back dismissal and safe-area layout.
- 44x44px minimum product touch target.

See `MOBILE_TOUCH_GESTURES.md`, `MOBILE_DESKTOP_FEATURE_PARITY.md` and `../design-system/marketlens/pages/mobile-terminal.md`.

## Styling rule

Desktop/mobile dimensions are scoped to `.desktop-terminal` and `.mobile-terminal`/`.mobile-*`. Shared primitives may consume semantic colors, typography and focus styles, but must not introduce a shared responsive DOM layout.

## Shared overlay contract

Dialogs and transient surfaces keep their existing feature-specific JSX, but
share one responsive contract:

- `platform-dialog-overlay` owns the scrim, safe-area padding and mobile
  bottom-sheet alignment.
- `platform-dialog` is content-sized on mobile and scrolls through its
  `data-dialog-body`; use `platform-dialog--fullscreen` only for genuinely
  long workspaces such as application settings or the indicator browser.
- `data-dialog-header`, `data-dialog-tabs`, `data-dialog-body` and
  `data-dialog-footer` are layout slots. Headers/tabs stay fixed, tabs scroll
  horizontally, and the footer remains reachable above the safe area.
- Mobile controls use a 44px touch target, 16px form text, and preserve native
  checkbox dimensions while expanding the surrounding hit area.
- Shared form grids must explicitly own their internal flow. Coordinate fields
  use a one-column label/control grid inside each responsive two-column cell,
  and controls use `width: 100%` with `min-width: 0`; do not rely on an inline
  `<label>` to wrap differently as available width changes.
- Interval-visibility tiles are an explicit exception to the compact checkbox
  rule: each `role="checkbox"` tile fills its grid cell and remains at least
  44px tall, while native/compact checkbox controls stay square.
- Anchored color, line, template and object-tree menus use `mobile-popover`;
  pointer-position menus and dropdown portals clamp against the Visual
  Viewport through `src/hooks/useFloatingSurface.ts` and
  `src/utils/viewport.ts`.
- The chart timezone menu is a portalled `ChartPopupSurface` anchored from the
  `Select time zone` trigger. `floatingMenuPosition` computes fixed `left` and
  `top` coordinates and clamps them to the viewport; mobile media rules may
  constrain width/height but must not overwrite those coordinates.
- Mobile toasts render as non-blocking snackbars above bottom navigation. The
  toast body is click-through; only its dismiss action receives pointer input.

Keep these classes and slots common. A new dialog should add the contract
markers before introducing a one-off mobile media query.

## Feature parity rule

Presentation stays platform-specific, while feature catalogs and mutations remain shared. Drawing tools come from `DRAWING_TOOL_MANIFEST`, Indicator desktop/mobile presentations live in `IndicatorMenu`, and favorites/snapshots/watchlist/layout/trade actions use the same hooks, atoms and services. A new desktop feature must either receive a mobile entry point in the same change or be recorded as intentionally desktop-only.

The maintained capability matrix is `MOBILE_DESKTOP_FEATURE_PARITY.md`.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:ui
npx playwright test tests/browser/platformUi.spec.ts
npx playwright test tests/browser/mobileFeatureParity.spec.ts
npx playwright test tests/browser/mobileOverlayResponsive.spec.ts
npm run build
```

Verified overlay baseline on 2026-07-14: the dedicated responsive browser
spec passed 6/6, the mobile/desktop overlay regression set passed 11/11, the
UI unit set passed 39/39, and production build, typecheck and lint passed.

Latest mobile popup verification on 2026-07-16: `platformUi` passed 3/3,
`mobileOverlayResponsive` passed 6/6, and `npm run typecheck` passed.

Shared coordinate-field verification on 2026-07-17: the focused adaptive
dialog browser regression passed at 320x568, the reported 558x501 viewport,
and 844x390 landscape; the existing coordinate edit/undo-redo browser test,
targeted lint, and `npm run typecheck` also passed.

Required viewport checks: 320x568, 375x812, 390x844, 430x932, 558x501,
844x390, 768x1024, 1024x768, 1366x768 and 1920x1080.
