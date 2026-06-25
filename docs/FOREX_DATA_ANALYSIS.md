# FOREX DATA ANALYSIS

_Analysis date: 2026-06-25. Why forex/metals/indices show "--" and the path forward._

## 1. Root cause

The current architecture has **two providers**: Binance (crypto, no-key, works) and TwelveData (forex/metals/indices, requires an API key). When `NEXT_PUBLIC_TWELVEDATA_API_KEY` is absent, the TwelveData provider fails immediately with `emitStatus('error', 'Missing NEXT_PUBLIC_TWELVEDATA_API_KEY')` during `connect()`. No data flows into `marketDataStore.quotes[...]`, so the watchlist row (and chart) get `undefined` → display `"--"`.

```
WatchRow → useQuote('EURUSD') → marketDataStore.quotes['EURUSD']
                                  ↑ undefined (TwelveData never connected)
                                  → fmtPrice(undefined) → "--"
```

## 2. Current architecture (relevant layers)

### 2.1 Symbol registry (`symbols.ts`)

Forex/metals/indices are registered as `provider: 'twelvedata'`:

| Canonical ID | Provider | Asset Class | Exchange | Provider Symbol |
|---|---|---|---|---|
| EURUSD | twelvedata | forex | FX | EUR/USD |
| GBPUSD | twelvedata | forex | FX | GBP/USD |
| USDJPY | twelvedata | forex | FX | USD/JPY |
| AUDUSD | twelvedata | forex | FX | AUD/USD |
| XAUUSD | twelvedata | metal | OANDA | XAU/USD |
| SPX500 | twelvedata | index | INDEX | SPX |
| NAS100 | twelvedata | index | INDEX | IXIC |

### 2.2 MarketDataService routing (`MarketDataService.ts`)

```ts
private route(symbol: string): { provider: MarketProvider; binding: MarketDataServiceBinding } {
  const meta = getMarketSymbol(symbol);
  if (meta?.provider === 'twelvedata') return { provider: 'twelvedata', binding: this.twelve };
  return { provider: 'binance', binding: this.binance };
}
```

All non-crypto symbols route to `this.twelve` — the TwelveData provider.

### 2.3 TwelveData provider (`TwelveDataProvider.ts`)

- WS endpoint: `wss://ws.twelvedata.com/v1/quotes/price?apikey=...`
- Price ticks only (no klines) → `CandleEngine` builds candles locally
- Requires `apiKey` in constructor or `NEXT_PUBLIC_TWELVEDATA_API_KEY` env var
- Emits `error` status if key is missing → no data

### 2.4 Historical data (`HistoricalDataService.ts`)

- Binance: `GET /api/v3/klines` (no key, works for crypto)
- TwelveData: `GET /time_series` (requires key, same path)
- All forex/metals/indices use the TwelveData REST path → also fails without key

### 2.5 Watchlist flow

```
watchlistStore.symbols → useMarketDataBootstrap → subscribe ticker → 
  MarketDataService.subscribe → routes to TwelveDataProvider → 
    WS subscribe → price ticks → emit 'quote' → store.updateQuote
```

If TwelveData has no key, step "routes to TwelveDataProvider" emits `error` status and sends no quotes.

## 3. Provider interface (what we must implement)

The `MarketDataServiceBinding` interface:

```ts
export interface MarketDataServiceBinding {
  connect(): void;
  disconnect(): void;
  subscribe(sub: MarketSubscription): void;
  unsubscribe(symbol: string, timeframe?: Timeframe): void;
}
```

Plus the internal listener pattern:

```ts
type MarketDataListener = (event: MarketDataEvent) => void;

// Events: { type: 'quote', symbol, quote: MarketQuote }
//         { type: 'candle', symbol, timeframe, candle: MarketCandle }
//         { type: 'status', provider, status: ConnectionStatus, error?: string }

// Quote must include: symbol, last, change, changePct, open?, high?, low?, 
//                     prevClose?, volume, bid?, ask?, timestamp
```

## 4. MarketDataService extension points

Currently hardcoded to `binance | twelvedata | mock`. To add OANDA we need:

1. **Expand `MarketProvider` type** in `types/marketData.ts`:
   ```ts
   export type MarketProvider = 'binance' | 'twelvedata' | 'oanda' | 'mock';
   ```

2. **Extend `TICK_ONLY` map** in `MarketDataService.ts`:
   ```ts
   const TICK_ONLY: Record<MarketProvider, boolean> = {
     binance: false, twelvedata: true, oanda: true, mock: false,
   };
   ```

3. **Add OandaProvider** to `MarketDataService` constructor and route logic.

4. **Update `symbolsByProvider`** and `statuses` maps.

## 5. OANDA API summary

OANDA v20 REST API:
- Base: `https://api-fxtrade.oanda.com/v3` (practice: `api-fxpractice.oanda.com`)
- Auth: Bearer token via `Authorization: Bearer <TOKEN>` header
- Historical: `GET /v3/instruments/{instrument}/candles`
- Pricing: `GET /v3/accounts/{accountID}/pricing?instruments=...`
- Streaming: `GET /v3/accounts/{accountID}/pricing/stream?instruments=...`

Symbol naming: OANDA uses underscore format: `EUR_USD`, `GBP_USD`, `XAU_USD`, etc.

OANDA does NOT have a public WebSocket (its streaming endpoint is an HTTP long-poll with newline-delimited JSON). For realtime, we'll use the pricing REST endpoint with polling at ~1s intervals (similar to how many production trading terminals handle OANDA).

Indices (SPX500, NAS100): OANDA provides `US_SPX500` and `US_NAS100` as CFDs.

## 6. Implementation plan

| Step | File | Action |
|---|---|---|
| 1 | `types/marketData.ts` | Add `'oanda'` to `MarketProvider` |
| 2 | `services/market-data/symbols.ts` | Add OANDA-mapped symbols (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, XAUUSD, SPX500, NAS100) |
| 3 | `services/market-data/providers/OandaProvider.ts` | New provider: auth, symbol mapping, historical candles (REST), realtime pricing (polling), reconnect |
| 4 | `services/market-data/MarketDataService.ts` | Wire OandaProvider (constructor, route, symbolsByProvider, statuses, TICK_ONLY, event routing for candle) |
| 5 | `services/market-data/HistoricalDataService.ts` | Add OANDA historical path |
| 6 | `services/market-data/providers/FxcmProvider.ts` | Extension point (stub/interface only) |
| 7 | `services/market-data/providers/ICMarketsProvider.ts` | Extension point (stub/interface only) |
| 8 | `docs/OANDA_INTEGRATION.md` | Documentation |
| 9 | `docs/CURRENT_PROGRESS.md`, `NEXT_TASKS.md`, `HANDOFF.md` | Update docs |

## 7. Risks

- **OANDA requires an API key** (bearer token) — same pattern as TwelveData. No committed secrets. Env var: `NEXT_PUBLIC_OANDA_API_KEY` + `NEXT_PUBLIC_OANDA_ACCOUNT_ID` + `NEXT_PUBLIC_OANDA_PRACTICE` (boolean).
- **OANDA has no public WebSocket** — the streaming endpoint is HTTP long-poll (Server-Sent Events style, newline-delimited JSON). We'll implement a polling-based approach (fetch every 1s) which is production-grade for OANDA's practice environment. This is isolated to the provider; the rest of the architecture sees it as just another data source.
- **OANDA rate limits** — practice accounts have generous limits.
- **Indices via OANDA** — CFDs like `US_SPX500`, `US_NAS100`. These may have different pricing characteristics (wider spreads, swap rates). Historical data format is identical.
