# KNOWN ISSUES

_Last updated: 2026-06-25._

## Bugs / broken dependencies
- **`framer-motion` install is broken** (`motion-dom` does not export `GroupPlaybackControls` /
  `attachTimeline` / `NativeAnimationControls`). It is **not imported anywhere** (the chart
  context menu uses a CSS pop-in animation). Importing it again will break `next build`.
  _Fix:_ pin a compatible `framer-motion`/`motion-dom` pair, or remove it from `package.json`.

## Limitations (by design, current phase)
- **All market data is mock.** `services/marketData.ts` is a deterministic seeded generator.
  Watchlist "realtime" quotes never move; there is no WebSocket / connection status / reconnect.
  Phase 1 replaces this (see `NEXT_TASKS.md`).
- **No incremental tick path.** `PriceChart` pushes data via `series.setData(...)` on every
  visible-candle change. Realtime should use `series.update(lastBar)` for O(1) tick updates.
- **No central market-data store.** Market state lives in `chartStore` + React Query cache;
  Phase 1 introduces `marketDataStore` as the single source of truth.

## Technical debt
- **Unwired drawing refactor (Phase 3).** `types/drawing.ts` (new tools + `zIndex/locked/
  visible/stop/target`), new `chartStore` actions (`duplicateDrawing/lockDrawing/hideDrawing/
  bringToFront/sendToBack/toggleLockAll/toggleHideAll`), and `components/chart/drawing/
  drawingRenderer.ts` were added but are **not yet used** by `DrawingLayer`/`DrawingToolbar`.
  Currently dead code; either finish in Phase 3 or revert before Phase 1.
- **Mock history feeds replay/SMC.** `replayEngine.mtfSnapshot` and `smcEngine` pull higher-TF
  history from the mock `getHistorySync`; repoint to `HistoricalDataService` when removing mock.
- **`tradeStore` price feed** comes from the visible candle stream; ensure realtime ticks flow
  through `useTradeRuntime` so order fills/SL/TP keep working.

## Workarounds
- **Windows `next build` worker race.** "Collecting page data" sometimes fails with
  `Cannot find module './<chunk>.js'` or `/_not-found`. This is a Next-on-Windows race (project
  under `Downloads`, watched by AV/sync), **not** a code error. _Workaround:_ re-run
  `npm run build` once (warm chunks) — it then passes. Do **not** delete `.next` between tries.
- **`git` not on PATH** in this environment; the binary lives at
  `C:\Program Files\Git\cmd\git.exe`. Call it by full path (the repo itself is fine).

## Environment notes
- Branch `master`, remote `origin → github.com/DEVfancybear/tradingview.git`.
- `.gitignore` covers `node_modules`, `.next`, `.env*.local` — safe for `git add .`.
- No secrets/keys present in the tree. When adding keyed providers (TwelveData), use
  `.env.local` (gitignored) — never commit keys.
