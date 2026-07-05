# OANDA DEBUG REPORT

_Date: 2026-06-25_

## 1. Root cause

**Forex symbols show `"--"` because `MarketDataService.route()` returns `null` for them, causing the subscription to be silently dropped.** No data ever reaches `marketDataStore.quotes[...]`, so `useQuote('EURUSD')` returns `undefined` and the watchlist renders `"--"`.

There are two possible underlying causes:

### Cause A (most likely): No OANDA API key configured

```
getMarketDataService() called with no opts
  → MarketDataService constructor reads process.env.NEXT_PUBLIC_OANDA_API_KEY
  → env var is undefined/empty → this.oanda = null
  → also: NEXT_PUBLIC_TWELVEDATA_API_KEY is undefined → this.twelve = null
  → route('EURUSD') checks meta.provider === 'oanda'
    → this.oanda is null → this.twelve is null → returns null
  → subscribe() sees null route → returns early (SILENTLY)
  → marketDataStore never receives any quote for EURUSD
  → WatchRow renders "--"
```

### Cause B (less likely): OANDA API key is set but connection fails

The OANDA API key is configured in `.env.local` but:
- The API key is invalid → 401 error → `emitStatus('error', ...)`
- The account ID is wrong → 404 error → `emitStatus('error', ...)`
- Network failure → `verifyConnection` throws → `scheduleReconnect`

## 2. Failed component

**`MarketDataService`** — the `subscribe()` method silently drops subscriptions when no provider is available for a symbol. There is zero diagnostic output.

## 3. Failed file

**`src/services/market-data/MarketDataService.ts`** — `route()` method returns `null` with no warning; `subscribe()` silently returns early.

## 4. Failed function

**`route(symbol: string)`** — when both `this.oanda` and `this.twelve` are null (no API keys configured), forex/metals/indices symbols return `null` instead of routing to a usable provider.

## 5. Fix required (implemented)

Added diagnostic console logging to three locations:

### 5.1 MarketDataService constructor (lines 84-110)
Logs whether OANDA and TwelveData keys are present or missing at instantiation time.

### 5.2 MarketDataService.route() (lines 119-131)
Logs a `console.warn` when a symbol can't be routed to any provider.

### 5.3 MarketDataService.subscribe() (lines 148-152)
Logs every subscription attempt (which symbol → which provider) and warns when a subscription is dropped.

### 5.4 OandaProvider.subscribe() (line 141)
Logs every instrument subscription with the canonical → OANDA symbol mapping.

### 5.5 OandaProvider.fetchPrices() (lines 182-212)
Logs the pricing request URL (truncated), HTTP status code, and number of prices received.

### 5.6 OandaProvider.connect() (lines 113-124)
Logs the connection verification flow.

## 6. How to verify the fix

1. Start the dev server: `npm run dev`
2. Open the browser console (F12 → Console tab)
3. Look for these diagnostic messages:
   - `[MarketDataService] OandaProvider DISABLED — no NEXT_PUBLIC_OANDA_API_KEY` → **Cause A confirmed**
   - `[MarketDataService] OandaProvider ENABLED` → env vars are set, check further
   - `[MarketDataService] subscribe DROPPED for EURUSD — no route` → routing failure confirmed
   - `[OandaProvider] subscribe EURUSD → EUR_USD` → routing is working
   - `[OandaProvider] fetchPrices status: 401` → auth failure
4. If Cause A: create `.env.local` with `NEXT_PUBLIC_OANDA_API_KEY` and `NEXT_PUBLIC_OANDA_ACCOUNT_ID`
5. If Cause B with 401: verify the API key is valid
6. If Cause B with 404: verify the account ID is correct

## 7. Files changed

| File | Change |
|---|---|
| `src/services/market-data/MarketDataService.ts` | Added `console.debug`/`console.warn` in constructor, `route()`, and `subscribe()` |
| `src/services/market-data/providers/OandaProvider.ts` | Added `console.debug`/`console.warn` in `subscribe()`, `connect()`, `fetchPrices()` |

## 8. Symbol mapping (verified correct)

| Canonical ID | Provider | OANDA Instrument |
|---|---|---|
| EURUSD | oanda | EUR_USD |
| GBPUSD | oanda | GBP_USD |
| USDJPY | oanda | USD_JPY |
| AUDUSD | oanda | AUD_USD |
| USDCAD | oanda | USD_CAD |
| USDCHF | oanda | USD_CHF |
| XAUUSD | oanda | XAU_USD |
| SPX500 | oanda | US_SPX500 |
| NAS100 | oanda | US_NAS100 |
| BTCUSDT | binance | BTCUSDT |
