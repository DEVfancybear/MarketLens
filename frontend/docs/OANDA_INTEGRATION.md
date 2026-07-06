# OANDA INTEGRATION

_Implementation date: 2026-06-25. Production-grade forex/metals/indices data via OANDA v20 REST API._

## 1. Supported symbols

| Canonical ID | OANDA Instrument | Asset Class | Exchange | Price Precision |
|---|---|---|---|---|
| EURUSD | EUR_USD | forex | FX | 5 |
| GBPUSD | GBP_USD | forex | FX | 5 |
| USDJPY | USD_JPY | forex | FX | 3 |
| AUDUSD | AUD_USD | forex | FX | 5 |
| USDCAD | USD_CAD | forex | FX | 5 |
| USDCHF | USD_CHF | forex | FX | 5 |
| XAUUSD | XAU_USD | metal | OANDA | 2 |
| XAGUSD | XAG_USD | metal | OANDA | 3 |
| SPX500 | US_SPX500 | index | INDEX | 2 |
| NAS100 | US_NAS100 | index | INDEX | 2 |

All crypto symbols (BTCUSDT, ETHUSDT, etc.) continue to use Binance (no key required).

## 2. Configuration

Add to `.env.local` (gitignored):

```env
NEXT_PUBLIC_OANDA_API_KEY=<your-oanda-bearer-token>
NEXT_PUBLIC_OANDA_ACCOUNT_ID=<your-oanda-account-id>
# NEXT_PUBLIC_OANDA_PRACTICE=true  # default: true (practice); set to false for live
```

Get a practice account at: https://www.oanda.com/demo-account/

### Fallback behavior

- If `NEXT_PUBLIC_OANDA_API_KEY` is set → OANDA is used for all forex/metals/indices.
- If OANDA key is absent BUT `NEXT_PUBLIC_TWELVEDATA_API_KEY` is set → TwelveData is used as fallback.
- If neither is set → forex/metals/indices show "--" (but crypto via Binance still works).

Restart the frontend dev server after adding `NEXT_PUBLIC_TWELVEDATA_API_KEY`; Next.js public env
values are bundled at server start.

## 3. Connection flow

```
1. useMarketDataBootstrap → getMarketDataService()
2. MarketDataService constructor:
   ├─ OandaProvider (if NEXT_PUBLIC_OANDA_API_KEY)
   │   └─ symbolMap: EURUSD→EUR_USD, GBPUSD→GBP_USD, etc.
   └─ TwelveDataProvider (if NEXT_PUBLIC_TWELVEDATA_API_KEY, as fallback)
3. connect() → OandaProvider.verifyConnection() → GET /v3/accounts
4. If auth OK → startPolling() → GET /v3/accounts/{id}/pricing every 1s
5. Quotes flow: OandaProvider → MarketDataService.handleEvent → marketDataStore.updateQuote
6. Watchlist rows read useQuote(ticker) and update live
```

## 4. Provider architecture

`OandaProvider` implements `MarketDataServiceBinding`:

```ts
class OandaProvider {
  connect()                    // verify auth → start 1s polling loop
  disconnect()                 // stop polling, clear timers
  subscribe(sub)               // add instrument to poll set
  unsubscribe(symbol, tf?)     // remove instrument, stop polling if empty
  loadHistory(sym, tf, limit)  // REST: GET /v3/instruments/{inst}/candles
}
```

**Realtime comes from polling**, not WebSocket. OANDA's streaming endpoint is HTTP long-poll (SSE, newline-delimited JSON) only available on trade accounts. For the practice environment, 1-second REST polling is the production-grade approach — widely used by trading terminals for OANDA.

### Reconnect strategy

- **Fetch failure:** transient → ignored (next poll retries). If data has been stale >15s → reconnect triggered.
- **On reconnect:** full `connect()` cycle (verify → poll). Active instruments are already tracked in `this.instruments` map.
- **Backoff:** `1→2→5→10→30s` (same as Binance/TwelveData provider pattern).
- **State:** `connecting → connected → (error) → reconnecting → connected`.

## 5. Symbol mapping

Centralized in `symbols.ts`. The `oandaInstrument()` helper converts canonical → provider symbol:

```
EURUSD     → EUR_USD
GBPUSD     → GBP_USD
USDJPY     → USD_JPY
XAUUSD     → XAU_USD
SPX500     → US_SPX500
NAS100     → US_NAS100
```

TwelveData fallback symbols are centralized in `twelveDataSymbol()` / `twelveDataSymbolMap()`.
Do not reuse OANDA underscore instruments for TwelveData. Examples:

```
EURUSD -> EUR/USD
GBPUSD -> GBP/USD
XAUUSD -> XAU/USD
SPX500 -> SPX
NAS100 -> IXIC
```

## 6. Realtime pricing

- **Poll interval:** 1 second (`POLL_INTERVAL_MS = 1000`)
- **Endpoint:** `GET /v3/accounts/{accountID}/pricing?instruments=EUR_USD%2CGBP_USD...`
- **Auth:** `Authorization: Bearer {NEXT_PUBLIC_OANDA_API_KEY}`
- **Price:** bid/ask average (mid-point) from OANDA pricing
- **Daily change:** computed from `open` field (previous day's closing price) in the pricing response

### Quote normalization

```ts
last  = (ask + bid) / 2   // mid-price for display
change = last - open        // absolute daily change
changePct = (change / open) * 100
bid = raw bid price
ask = raw ask price
```

## 7. Historical data

- **Endpoint:** `GET /v3/instruments/{instrument}/candles?granularity=M15&count=1500&price=MBA`
- **Granularity mapping:** `1m → M1`, `5m → M5`, `15m → M15`, `1H → H1`, `4H → H4`, `1D → D`
- **Price component:** `MBA` (Mid/Bid/Ask) — uses `mid` by default, falls back to `bid` then `ask`
- **Volume:** OANDA may include volume; mapped to `MarketCandle.volume` when present
- **Max bars:** 5000 per request (OANDA limit)

The `HistoricalDataService` was extended with a `loadOanda()` method. History routing checks
`meta.provider === 'oanda'` first; if no OANDA key is configured but `NEXT_PUBLIC_TWELVEDATA_API_KEY`
exists, it falls back to TwelveData using `twelveDataSymbol()`.

## 8. MarketDataService routing

The `route()` method in `MarketDataService` now:

```
If symbol.provider === 'oanda':
  → Use OandaProvider (if configured)
  → Fall back to TwelveDataProvider (if configured)
  → Otherwise error (symbol shows "--")

If symbol.provider === 'twelvedata':
  → Use TwelveDataProvider (if configured)
  → Otherwise error

Otherwise (crypto):
  → Use BinanceProvider (always available, no key)
```

## 9. Extension points for future providers

- **`FxcmProvider`** (`providers/FxcmProvider.ts`) — stub, implements `MarketDataServiceBinding`
- **`ICMarketsProvider`** (`providers/ICMarketsProvider.ts`) — stub, implements `MarketDataServiceBinding`

Both are empty modules ready for future implementation. To add:
1. Copy `OandaProvider.ts` as a template
2. Replace REST endpoints and normalization
3. Register in `MarketDataService` (constructor, route, symbolsByProvider, statuses)
4. Add to `MarketProvider` type union
5. Add symbols to `MARKET_SYMBOLS` registry

## 10. Files changed

| File | Change |
|---|---|
| `types/marketData.ts` | Added `'oanda'` to `MarketProvider` |
| `services/market-data/symbols.ts` | Added OANDA-mapped symbols (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, XAUUSD, XAGUSD, SPX500, NAS100); added `oandaInstrument()` helper |
| `services/market-data/providers/OandaProvider.ts` | **New** — full provider: auth, polling, historical, reconnect |
| `services/market-data/providers/FxcmProvider.ts` | **New** — extension point stub |
| `services/market-data/providers/ICMarketsProvider.ts` | **New** — extension point stub |
| `services/market-data/MarketDataService.ts` | Wired OandaProvider with fallback to TwelveData; added `oanda` to all provider maps |
| `services/market-data/HistoricalDataService.ts` | Added OANDA historical path (`loadOanda` method) |
| `hooks/useMarketDataBootstrap.ts` | Updated comments only |
