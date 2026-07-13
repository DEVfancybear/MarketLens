# Responsive Architecture

_Last updated: 2026-07-13_

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

See `PLATFORM_UI_ARCHITECTURE.md` and `../design-system/smc-trading-terminal/pages/desktop-terminal.md`.

## Mobile contract

- Five real screens: Chart, Markets, Trade, Portfolio and Menu.
- Chart-owned Draw and Replay actions.
- Mobile-owned symbol picker, timeframe strip, market cards, drawing palette, order flow and data lists.
- Mobile-owned Replay, Journal, Analytics and Pine presentations.
- Full-screen/partial sheets, browser-Back dismissal and safe-area layout.
- 44x44px minimum product touch target.

See `MOBILE_TOUCH_GESTURES.md` and `../design-system/smc-trading-terminal/pages/mobile-terminal.md`.

## Styling rule

Desktop/mobile dimensions are scoped to `.desktop-terminal` and `.mobile-terminal`/`.mobile-*`. Shared primitives may consume semantic colors, typography and focus styles, but must not introduce a shared responsive DOM layout.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:ui
npx playwright test tests/browser/platformUi.spec.ts
npm run build
```

Required viewport checks: 320x568, 375x812, 390x844, 430x932, 844x390, 768x1024, 1024x768, 1366x768 and 1920x1080.
