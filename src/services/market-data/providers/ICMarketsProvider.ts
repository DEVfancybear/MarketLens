/**
 * ICMarketsProvider — extension point (NOT YET IMPLEMENTED).
 *
 * Placeholder for a future IC Markets data provider. IC Markets is a leading
 * Australian ECN broker with MetaTrader 4/5 and cTrader APIs.
 *
 * When implemented it should:
 *  - Implement `MarketDataServiceBinding`
 *  - Emit unified `MarketDataEvent`s (quote + candle)
 *  - Support the same symbol mapping pattern (canonical → IC Markets instrument)
 *  - Use API-key auth (env var: NEXT_PUBLIC_ICMARKETS_API_KEY)
 *  - Never open one socket per symbol
 *
 * Implementation template: copy OandaProvider.ts and replace the REST endpoints
 * and normalization logic. The store/service layer already supports adding a new
 * provider (just register in MarketDataService).
 */
export {}; // module marker — no implementation yet
