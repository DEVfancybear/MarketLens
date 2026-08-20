# SPEC — Lightweight Charts v5 maintenance and render-path optimization

- Tier: 2 (normal dependency maintenance and performance refactor)
- Spec approval: not obtained (autonomous run)
- Scope: `frontend` consumer app only; preserve unrelated working-tree changes.

## Acceptance criteria

### Scenario 1 — stable supported dependency

Given the frontend consumes TradingView Lightweight Charts
When the dependency metadata and lockfile are inspected
Then both resolve the latest stable upstream release available during this task (`5.2.0`), and the installed package reports the same version.

### Scenario 2 — v5 API compatibility

Given the app creates candlestick, area, and indicator series
When TypeScript compiles against the installed package typings
Then all series use the v5 `chart.addSeries(SeriesType, options)` API and marker integrations use `createSeriesMarkers`; no v4-only series or marker APIs are introduced.

### Scenario 3 — realtime render efficiency

Given a candle window whose prefix is unchanged
When the latest candle changes or one candle is appended
Then the existing update plan selects `series.update()` semantics (`update-latest` or `append`) and does not require a full `setData()` replacement.

### Scenario 4 — resize work is coalesced

Given a chart receives multiple `ResizeObserver` notifications in one frame
When the chart container settles
Then at most one chart resize transaction is scheduled for that frame, and pending work is cancelled during cleanup.

## Invariants (must not regress)

- Chart creation remains one-per-container and cleanup removes subscriptions, observers, RAFs, and the chart.
- Historical/replay replacements retain the existing logical viewport restoration behavior.
- Existing chart, replay, drawing, and browser regression tests remain green (zero new failures).
- No new runtime dependency is added; npm metadata and lockfile remain synchronized.

## Planned setup, dependencies, and verification

- Tools: existing Node/npm, TypeScript, ESLint, Node test runner, and Playwright setup.
- New runtime dependencies: none (the latest stable `lightweight-charts` is already pinned at `5.2.0`; avoid an unreleased preview build).
- Files expected to change: chart render path, test TypeScript resolution config (to make the existing CommonJS test runner valid), stale Lightweight Charts research note, and this SPEC/EVIDENCE record.
- Git operations: none required; preserve unrelated user changes.
- Verification: `npm run test:build`, targeted chart tests, `npm run typecheck`, `npm run lint`, and the smallest applicable Playwright browser regression twice consecutively.
