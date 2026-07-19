# UI Test Coverage

Run pure UI/model tests:

```bash
npm run test:ui
```

Covered contracts include:

- Dialog viewport clamping and oversized-dialog reachability.
- Mobile/desktop platform policy for phone, tablet, coarse and fine pointers.
- Mobile sheet gesture threshold, dismiss boundary, cancellation rollback and foreign-pointer rejection.
- Integration-settings late-load merging and secret reset behavior.
- Draggable popup sub-pixel stability, preventing layout/update feedback loops.
- Timeframe favorite/custom-interval behavior.
- Private workspace access and bottom-workspace defaults.
- Indicator inline-row grouping, user-facing errors and session recovery.

Run rendered browser coverage:

```bash
npm run test:chart-browser
```

`tests/browser/platformUi.spec.ts` verifies:

- Mobile and desktop mount mutually exclusive presentation roots.
- Five-screen mobile navigation and selected-state semantics.
- Visible mobile button targets are at least 44x44px.
- Portrait/landscape and desktop have no horizontal page overflow.
- Dark/light theme switching.
- Modal chart-interaction boundary, hidden background and browser-Back dismissal.
- Connection settings remain topmost and keyboard-focusable over mobile workspace sheets.
- Draggable chart surfaces remain error-free across mobile viewport and keyboard-style resizes.
- Desktop command bar, drawing rail and market sidebar presence.

`tests/browser/desktopOverlayRegression.spec.ts` verifies:

- Indicator search renders one stable focus treatment and restores focus.
- Chart Settings is portaled, visible, inside the viewport and topmost over the
  chart.
- Symbol, timeframe, layout and snapshot dropdowns use the same collision-safe
  portal, retain their declared widths and return focus on Escape.
- The current price marker matches the live Lightweight Charts price-scale
  geometry at 1366px and after resizing to 1100px.
- Go To exposes only the supported single-date flow; Custom range remains
  absent.

Chart/drawing browser specs continue to cover viewport synchronization and pointer drawing behavior.
