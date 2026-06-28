# KNOWN ISSUES

_Last updated: 2026-06-25 (after Phase 1 + Phase 2). Phase 1's old "mock data" limitations are
**resolved** — see `PHASE1_REVIEW.md`. Remaining items below._

## Bugs / broken dependencies
- **`framer-motion` install is broken** (`motion-dom` does not export `GroupPlaybackControls` /
  `attachTimeline` / `NativeAnimationControls`). It is **not imported anywhere** (toasts + context
  menu use CSS keyframes). Importing it again will break `next build`.
  _Fix:_ pin a compatible `framer-motion`/`motion-dom` pair, or remove it from `package.json`.

## Limitations (by design)
- **Position-tool TP/SL highlight uses the live last price.** The Long/Short tool
  brightens its profit/risk zone from `candlesAtom`'s last close. In **replay mode**
  this is the master series' final close, not the replay-cursor price, so the
  highlight is not replay-aware. Acceptable for live use; revisit if positions need
  to be back-tested through the replay cursor.
- **TwelveData needs a key.** Forex/metals/indices quotes/candles require
  `NEXT_PUBLIC_TWELVEDATA_API_KEY`; without it those rows show "—". Crypto (Binance) needs no key.
- **Browser/system alert notifications require permission** and are off by default; enable from the
  Alert Center. Mobile **push** (Firebase) is Phase 6 — the dispatch seam is ready in
  `services/notifications/notify.ts`.
- **Deep replay history is REST-bounded** (most-recent N bars per TF); replaying far into the past
  is limited by provider history depth.

## Technical debt
- **Unwired drawing refactor (Phase 3).** `types/drawing.ts` (new tools + `zIndex/locked/
  visible/stop/target`), new `chartStore` actions (`duplicateDrawing/lockDrawing/hideDrawing/
  bringToFront/sendToBack/toggleLockAll/toggleHideAll`), and `components/chart/drawing/
  drawingRenderer.ts` were added but are **not yet used** by `DrawingLayer`/`DrawingToolbar`.
  Currently dead code; finish in Phase 3 (next milestone).
- **Legacy `Symbol`/`Quote` types** in `types/market.ts` may be orphaned after the mock's deletion —
  verify with a grep and remove if unused.
- **`MarketDataService.symbolsByProvider` lingers chart-only symbols** (timeframe-scoped kline
  unsubscribe doesn't remove the symbol). Cosmetic — affects only status aggregation. See
  `PHASE1_GAPS.md` A2.

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
