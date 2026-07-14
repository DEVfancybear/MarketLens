# Responsive Architecture

_Last updated: 2026-07-14_

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
- Chart-owned Draw, Indicators, Chart tools and Replay actions.
- Mobile-owned symbol picker, timeframe strip, market cards, drawing palette, order flow and data lists.
- The timeframe strip shares desktop favorites, cloud synchronization, the full interval catalog and custom interval validation.
- Mobile-owned Replay, Journal, Analytics, Pine, Object tree, Logs and Account presentations.
- Mobile chart tools expose SMC, saved layouts, chart/replay layouts, snapshots, display settings, connections, alerts and destructive chart actions.
- Markets expose the shared watchlist lists, sorting, sections, symbol ordering and catalog search.
- Full-screen/partial sheets, browser-Back dismissal and safe-area layout.
- 44x44px minimum product touch target.

See `MOBILE_TOUCH_GESTURES.md`, `MOBILE_DESKTOP_FEATURE_PARITY.md` and `../design-system/smc-trading-terminal/pages/mobile-terminal.md`.

## Styling rule

Desktop/mobile dimensions are scoped to `.desktop-terminal` and `.mobile-terminal`/`.mobile-*`. Shared primitives may consume semantic colors, typography and focus styles, but must not introduce a shared responsive DOM layout.

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
npm run build
```

Verified parity baseline on 2026-07-14: 18/18 selected mobile/platform/desktop browser tests passed; production build, typecheck and lint passed.

Required viewport checks: 320x568, 375x812, 390x844, 430x932, 844x390, 768x1024, 1024x768, 1366x768 and 1920x1080.
