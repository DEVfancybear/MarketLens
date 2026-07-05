# PHASE 1 GAPS

_Audit date: 2026-06-25. Open items found while auditing Phase 1 (Steps 1–17)._

**None of these block Phase 1's success criteria.** They are carried forward as cleanup/hardening
and, where relevant, are addressed at the start of Phase 2.

## A. Functional gaps (carry-forward)

| # | Gap | Impact | Disposition |
|---|---|---|---|
| A1 | **Subscriptions are not reference-counted.** `marketDataStore.subscribe/unsubscribe` key on presence: if two consumers subscribe the same key (e.g. watchlist ticker + an alert on the same symbol), the first `unsubscribe` tears it down for both. | Latent — only bites when a second consumer of the *same* ticker key appears. | **Fixed at the start of Phase 2** (the Alert Engine subscribes alert-symbol tickers). Add refcounting to the registry. |
| A2 | **Chart-only symbols linger in `MarketDataService.symbolsByProvider`.** A timeframe-scoped kline unsubscribe (by design, to preserve a possible ticker) never removes the symbol from the provider's active set. | Cosmetic — affects only status aggregation; no socket leak, no wrong data. | Backlog. Resolve with channel ref-counting when A1's refcount is generalized. |
| A3 | **TwelveData providers need an API key.** Forex/metals/indices show "—" and build no candles without `NEXT_PUBLIC_TWELVEDATA_API_KEY`. | By design (no committed keys). | Documented in `.env.example` / HANDOFF. Not a gap to fix. |
| A4 | **Deep replay history is bounded by REST.** Higher-TF MTF + history load the most recent N bars; replaying far into the past is limited by provider history depth. | Minor — matches real platforms (paginate on demand). | Backlog (pagination on scroll-back). |

## B. Dead code / debt

| # | Item | Disposition |
|---|---|---|
| B1 | **Legacy `Symbol` and `Quote` interfaces** in `types/market.ts` may now be orphaned after the mock's deletion. | Verify with a grep and remove if unused (low risk). |
| B2 | **Unwired drawing refactor (Phase 3).** `components/chart/drawing/drawingRenderer.ts`, extended `types/drawing.ts`, and new `chartStore` drawing actions are present but not wired into `DrawingLayer`/`DrawingToolbar`. | Finish in Phase 3 (or revert). Build is green (additive). |
| B3 | **`framer-motion` install is broken** (`motion-dom` export mismatch). Not imported anywhere. | Pin a compatible pair or remove from `package.json`. Re-importing it will break `next build`. |

## C. Environment / process

| # | Item | Disposition |
|---|---|---|
| C1 | **Windows `next build` worker race** ("Collecting page data" → `Cannot find module './<chunk>.js'`). Next-on-Windows race (project under `Downloads`), not a code error. | Re-run `npm run build` once (warm chunks). Don't delete `.next` between tries. |
| C2 | **`git` not on PATH**; binary at `C:\Program Files\Git\cmd\git.exe`. | Call by full path. |

## D. Explicitly verified NOT gaps

- No mock data remains (grep-verified).
- No duplicate sockets (one combined WS per provider).
- No TODO/FIXME markers in `src/`.
- Reconnect covers both the `onclose` path and silently-dead sockets (watchdog) + network recovery.
- Replay no-look-ahead guarantee intact over the realtime master series (`useVisibleCandles`).
