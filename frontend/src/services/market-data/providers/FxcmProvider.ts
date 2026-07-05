/**
 * FxcmProvider — extension point (NOT YET IMPLEMENTED).
 *
 * Placeholder for a future FXCM data provider. FCXM is a well-known retail forex
 * broker with a REST + WebSocket API (https://api.fxcm.com/).
 *
 * When implemented it should:
 *  - Implement `MarketDataServiceBinding`
 *  - Emit unified `MarketDataEvent`s (quote + candle)
 *  - Support the same symbol mapping pattern (canonical → FCXM instrument)
 *  - Use bearer-token auth (env var: NEXT_PUBLIC_FXCM_API_KEY)
 *  - Never open one socket per symbol
 *
 * Implementation template: copy OandaProvider.ts and replace the REST endpoints
 * and normalization logic. The store/service layer already supports adding a new
 * provider (just register in MarketDataService).
 */
export {}; // module marker — no implementation yet
