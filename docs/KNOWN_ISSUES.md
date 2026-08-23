# KNOWN ISSUES

_Post-monorepo update 2026-07-07._

The historical issue log below is preserved. Current monorepo-specific issues:

- Revision 15's local implementation gate does not replace the production-like R15-9 broker gate.
  No production migration, worker install/start, backend cutover, Vault mutation, or three-account
  Demo flow has been executed. Live/funded activation remains unauthorized until that gate passes.
- CI produces and checksums `mt5-vm-agent.exe`, but the repository has no authorized code-signing
  identity or signing service. A production host whose Application Control policy rejects unsigned
  binaries still needs a legitimately signed/policy-approved agent artifact; hash pinning proves
  artifact identity, not publisher trust. Do not self-sign, weaken policy, or use a bypass.

- `cargo fmt` cannot run on the Windows development host: `cargo-fmt` is blocked by Application
  Control (`os error 4551`). CI still enforces `cargo fmt --all -- --check`, so a change that skips
  formatting will fail there. The `rustfmt` binary itself is **not** blocked - format and verify
  with it directly before pushing:

  ```bash
  rustfmt --edition 2024 path/to/file.rs
  rustfmt --edition 2024 --check path/to/file.rs
  ```

  Do not hand-match formatting; it failed CI once already on 2026-08-19.

- `backend/.env.example` cannot be copied verbatim: it ships
  `TRADE_RECOVERY_EMAIL_FROM="MarketLens Security <security@example.com>"` while leaving the SMTP
  host and credentials empty, and the config validator requires the whole SMTP group together, so a
  fresh copy fails to start with `config error: TRADE_RECOVERY_SMTP_HOST, TRADE_RECOVERY_EMAIL_FROM
  and both SMTP credentials must be configured together`. Clear that value or fill the group.
- Hardening candidate: `internal/config/config.go` calls `_ = godotenv.Load()`. If any line of
  `backend/.env` fails to parse, godotenv returns an error **and zero keys**, the error is
  discarded, and every setting silently falls back to its default - including `APP_ENV`, which then
  reads as `development` and skips the production required-secret validation. Consider failing fast
  when a `.env` exists but cannot be parsed. (Observed during the 2026-08-19 deploy work with a
  locally mis-written multi-line PEM; a correctly quoted single-line value parses fine.)
- `go test ./...` in `backend/` intermittently fails
  `TestPublicEARoutesRequireBearerAndNeverExposeAdmin` and
  `TestTradingMutationRateLimitIsScopedAfterAuthentication` with `i/o timeout` when packages run in
  parallel on a busy Windows host. Both pass in isolation and on re-run. Loopback port contention,
  not a product defect.

- `npm audit --omit=dev --audit-level=low` in `frontend/` no longer passes with zero
  findings: `nanoid@3.3.16` (GHSA-2v37-7h3g-55p8) is pulled into the production tree
  by the repository's own `postcss@8.5.23` override. Verified identical at commit
  `f94e346`, so the 2026-08-18 framework upgrade did not cause it - the advisory is
  simply newer than the last audit review. Resolving it means advancing the pinned
  PostCSS override, which `docs/SECURITY.md` requires be done with its own clean
  production audit and build.

- Two `frontend/tests/browser/platformUi.spec.ts` assertions fail and predate the
  2026-08-18 framework upgrade (verified by running the same specs against a clean
  worktree at `f94e346` with the old dependency set):
  - `mobile watchlist actions use the shared platform dialog` expects a
    `Delete "Mobile list"?` confirm dialog that the mobile watchlist manager never
    renders.
  - `desktop loads only the command-center presentation` expects the `SMC Terminal`
    brand label visible at 1366px, but `TopToolbar.tsx` gates it behind
    `hidden min-[1720px]:block`. Either the label's breakpoint or the test's
    expectation is wrong; decide which before changing either.
  `tools/verify-frontend-framework-upgrade.ps1` records both by name and still
  fails closed on any browser failure outside that set.
- Tailwind v4 caveat for future CSS work: v4 emits utilities inside real CSS
  cascade layers, so any **unlayered** rule in `frontend/src/app/globals.css`
  outranks every Tailwind utility regardless of specificity. Element-level resets
  belong in `@layer base`. Component classes (`.mobile-*`, `.desktop-terminal`)
  are intentionally left unlayered because their specificity already beat
  utilities under v3.
- Next.js 16.3.1's `experimental.useTypeScriptCli` cannot be enabled here: Next
  resolves its CLI checker strictly as `typescript/bin/tsc`, and the `typescript`
  package name is held by the TypeScript 6 API-compatibility package (bin `tsc6`)
  so typescript-eslint keeps a compiler API. Build-time type checking runs through
  that API instead; TypeScript 7 checks the same project via `npm run typecheck`.

- MT5 Windows VM connector Phase 1 remains conditional at the real-terminal
  release gate. The newest installed-slot test-host lifecycle passes, while the
  normal signed-agent path still needs an Application-Control-accepted artifact;
  the earlier isolated-terminal run recorded `MT5_IPC_TIMEOUT`. Resolve the
  supported multi-terminal MetaTrader/Python IPC boundary on the signed host,
  then rerun the full lifecycle, independent FTMO web comparison, and two-account
  isolation. See `MT5_WINDOWS_VM_CONNECTOR_PHASE1_VALIDATION.md`.
- MT5 Phase 4 migration verification is blocked on the current local database configuration:
  `backend/.env` points to port 55432, where no PostgreSQL listener is available, while the active
  local PostgreSQL 17 listener on 5432 rejects that stored credential. Supply a separate disposable
  URL through `MT5_PHASE4_DATABASE_URL` and run `tools/verify-mt5-phase4.ps1`; never reuse a
  production URL or paste the credential into docs/chat.
- Backend Phases 0-6 are complete: auth, settings/bootstrap, and watchlist persistence are live.
  Next backend persistence work starts at Phase 7 drawings/templates.
- Frontend authenticated bootstrap now reads server UI settings, SMC settings, notification
  settings, and full watchlist layouts. Watchlist mutation write-back is wired through backend
  Phase 6 APIs; browser localStorage is no longer a watchlist source of truth.
- Indicator catalog data must come from an API/provider; do not reintroduce hardcoded catalog
  fallbacks.
- Frontend docs referenced below as `docs/*.md` generally live under `frontend/docs/` after the
  monorepo split.

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
   **Current monorepo behavior:** the persistent Go API is the default scheduler; the Next loop is
   disabled unless `DISABLE_PUSH_WORKER=false` is explicitly configured.
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

   **Superseded 2026-07-18:** authenticated closed-browser triggers now commit
   directly to PostgreSQL before notification delivery. Bootstrap therefore
   already returns a one-time alert as triggered; token-keyed reconciliation is
   retained only for legacy worker records and open-tab cache convergence.

   **Superseded again 2026-07-24:** the evaluator now hydrates enabled active
   definitions from PostgreSQL through `/api/v1/alerts/worker-snapshot` before
   replay. A missed browser `pagehide` snapshot can no longer hide an alert from
   Telegram/Discord evaluation. Production scheduler defaults derive from the
   deployed HTTPS CORS origin instead of localhost, canonical 404 creation races
   retry, and the MT5 recovery window is 4,096 ticks/up to one hour.

   **Storage superseded 2026-07-26:** push-device snapshots, cursors, and
   pending delivery state moved from Firestore to PostgreSQL `push_tokens`
   through service-authenticated worker endpoints. Firestore quota and
   transport debugging no longer applies to the active implementation.

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
- **Replay with active orders/positions costs more than an empty-ledger run.**
  Empty Replay ledgers skip per-source-row trading queries, but pending orders,
  brackets, and non-zero positions intentionally retain deterministic row-by-row
  processing so high/low crossings are not skipped. High-speed latency therefore
  still depends on database proximity and the amount of active trading state.
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
- **Drawing interaction: dual listener overhead.** Minor, deliberately not fixed — the actual cost
  is a ref read, not worth the regression risk of gating listener attachment on the active tool.
  See `DRAWING_ENGINE_ARCHITECTURE.md` "Perf notes". (The other half of this pair, hitTest running
  on every idle pointerdown, was fixed 2026-07-02 with a bounding-box pre-filter.)

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
