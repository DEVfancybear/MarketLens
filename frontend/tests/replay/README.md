# Replay Contract Tests

Phase 6 retains only frontend client-responsibility tests. Replay clocks,
aggregation, selection validation, and trading behavior are covered by Go.

Run:

```bash
npm run test:replay
```

The suite covers feature-gate semantics, server snapshot replacement, ordered
event application, duplicate/gap handling, progressive bar projection,
isolated trading projection, synchronized and sparse layout DTOs, exact
per-track availability recovery, typed API error messages, shared
chart-interaction ownership, chart lifecycle guards, and deterministic one-bar
viewport behavior.

Browser regressions live in `tests/browser/`:

- `replayFirstDay.spec.ts` exercises `Select bar -> Select date -> First day`
  and asserts that the first revealed candle keeps the normal logical width.
- `mobileReplay.spec.ts` covers the center-seeded selection line, drag, keyboard,
  confirm/cancel, and mobile Replay navigation behavior.
- `replayMultiChartAvailability.spec.ts` reproduces the four-pane `422`
  availability response, verifies that only the unavailable sibling is
  isolated, and asserts that the remaining backend tracks keep their original
  pane slots.
- `chartLayoutWorkspace.spec.ts` covers all layout presets, symbol drop targets,
  per-pane countdowns, and pane-owned drawings and indicators.

Run those focused browser contracts with:

```bash
npx playwright test tests/browser/replayFirstDay.spec.ts tests/browser/mobileReplay.spec.ts tests/browser/replayMultiChartAvailability.spec.ts tests/browser/chartLayoutWorkspace.spec.ts
```

Shared fixtures live at `testdata/replay/contracts.v1.json` from the repository
root and are also loaded by Go tests.
