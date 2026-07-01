# KNOWN ISSUES

_Last updated: 2026-07-02 (closed-browser push debugging session). Phase 1's old "mock data"
limitations are **resolved** — see `PHASE1_REVIEW.md`. Remaining items below._

## Closed-browser push debugging session (2026-07-02) — reference for future bugs in this area

User report: create an alert, close the browser, no push notification arrives; reopening shows the
alert already triggered. Live-tested end to end (real server, real Firestore devices, real FCM
sends, real Telegram test send) rather than guessing. Found and fixed, in order:

1. **No evaluator was running at all.** Closed-browser delivery needs a second always-on process
   (`npm run push-worker` or an external cron hitting `/api/push/evaluate`); neither was running.
   Fixed by starting the evaluator in-process on server boot (`src/instrumentation.ts`), skipped on
   Vercel (`process.env.VERCEL`) or with `DISABLE_PUSH_WORKER=true`.
2. **FCM push TTL was 300s (5 min).** If the browser didn't reconnect to the push service within
   that window, the message was dropped even though the server-side send reported success. Bumped
   to 86400s (24h) in `src/server/firebaseAdmin.ts`.
3. **Duplicate-trigger race.** Overlapping `evaluatePushAlerts()` calls (worker interval vs. a
   manual/cron call landing at the same time) each read Firestore before the other's write landed,
   firing a one-time alert more than once (reproduced live: 3x for one crossing). Fixed with an
   in-process `inFlight` promise lock in `src/server/pushAlertEvaluator.ts`.
4. **False trigger from a full-history rescan (the big one).** `observedSinceArm()` in
   `src/hooks/useAlertEngine.ts` derived its rescan cutoff from the previous tick's candle time,
   falling back to **epoch 0** whenever that was `undefined` (candle history not loaded yet — easy
   to hit right after creating a fresh alert). Once that happened, every later tick rescanned the
   *entire* loaded candle series instead of just since-armed, so any historical dip anywhere in that
   series read as a live crossing and fired a false trigger (+ a real push for it). Fixed by tracking
   the cutoff as its own persisted field (`ObservedAlertRange.sinceMs`), only ever advanced forward
   from a real candle time — confirmed live via temporary console instrumentation and real console
   output from the user's browser.
5. **Real (not false) triggers could stay "Active" client-side.** The client's reopen-recovery scan
   is bounded by candle time **at the currently selected chart timeframe** — a brief crossing shortly
   after arming, contained inside a single coarse candle (e.g. 15m) that started before the alert was
   armed, is invisible to the client even though the server (1-minute resolution) already caught and
   delivered it. Rather than chasing finer client-side history, added a reconciliation path: the
   server persists the real `triggerPrice`; `POST /api/push/alerts/status` returns confirmed triggers
   for a device token; `src/hooks/usePushTriggerReconcile.ts` (polls on mount / tab-visible / 60s)
   applies them via the existing `triggerAlertAtom` without re-notifying.

**Debugging tools that worked well and are worth reusing:** `POST /api/push/evaluate?debug=1` with
the `x-push-worker-secret` header (per-alert condition/target/high/low/met/blocked without exposing
tokens); a small Node script using `@next/env`'s `loadEnvConfig()` + `firebase-admin` to read
`pushAlertDevices` documents directly (hand-rolled `.env` parsing missed quoted/multiline values —
use `@next/env`, not a custom parser); `POST /api/notifications/test` to verify Telegram/Discord
independent of any push/browser state; temporary `console.debug` in `useAlertEngine.ts` (Chrome logs
`console.debug` under the **Verbose** level, hidden by the Console's default filter — remind whoever
is looking to enable it) with "Preserve log" on, removed again once confirmed.

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
- **Drawing interaction: dual listener overhead + hitTest on every idle pointerdown.** Minor,
  no reported user-visible symptom. See `DRAWING_ENGINE_ARCHITECTURE.md` "Known unresolved perf
  notes".

## Workarounds
- **`api.binance.com` returns HTTP 451 from US-hosted server IPs** (e.g. Vercel serverless
  functions), which silently broke closed-browser crypto push alerts ("price unavailable" with no
  entry in `errors`). Server-side crypto price/kline fetches (`pushAlertEvaluator.ts`) use
  `data-api.binance.vision` instead — Binance's unrestricted public market-data mirror. Client-side
  fetches (browser) are not affected and can keep using `api.binance.com`.
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
