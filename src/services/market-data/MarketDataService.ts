/**
 * MarketDataService (Phase 1, Step 6).
 *
 * Owns the concrete providers (Binance + TwelveData), routes each symbol to the
 * right one (via the symbol registry), fans normalized `MarketDataEvent`s into
 * `marketDataStore`, and aggregates a single connection status for the UI.
 *
 * It implements `MarketDataServiceBinding`, so once `attachMarketDataService()`
 * binds it, the store's intents (`connect/disconnect/subscribe/unsubscribe`)
 * delegate here. Pure service layer — no React/UI.
 *
 * Reconnect/auto-resubscribe lives in the providers; this service only routes.
 *
 * NOTE: created but not bootstrapped into the app yet. Call
 * `getMarketDataService()` from app bootstrap in Steps 10–13 to go live.
 */
import {
  attachMarketDataService,
  useMarketDataStore,
  type MarketDataServiceBinding,
} from '@/store/marketDataStore';
import {
  type ConnectionStatus,
  type MarketDataEvent,
  type MarketProvider,
  type MarketSubscription,
  type Timeframe,
} from '@/types';
import { BinanceProvider } from './providers/BinanceProvider';
import { TwelveDataProvider } from './providers/TwelveDataProvider';
import { getMarketSymbol, twelveDataSymbolMap } from './symbols';
import { CandleEngine } from './CandleEngine';

/** Providers that stream price ticks only (no klines) → candles are built locally. */
const TICK_ONLY: Record<MarketProvider, boolean> = {
  binance: false,
  twelvedata: true,
  mock: false,
};

export interface MarketDataServiceOptions {
  twelveDataApiKey?: string;
}

export class MarketDataService implements MarketDataServiceBinding {
  private readonly binance: BinanceProvider;
  private readonly twelve: TwelveDataProvider;

  /** Active canonical symbols per provider (drives connect()/status aggregation). */
  private readonly symbolsByProvider: Record<MarketProvider, Set<string>> = {
    binance: new Set(),
    twelvedata: new Set(),
    mock: new Set(),
  };

  /** Builds candles from price ticks for tick-only providers. */
  private readonly candleEngine = new CandleEngine();

  /** Active kline timeframe per symbol (so ticks build the right bar). */
  private readonly tfBySymbol = new Map<string, Timeframe>();

  /** Latest status reported by each provider. */
  private readonly statuses: Record<MarketProvider, ConnectionStatus> = {
    binance: 'disconnected',
    twelvedata: 'disconnected',
    mock: 'disconnected',
  };

  constructor(opts: MarketDataServiceOptions = {}) {
    const onEvent = (e: MarketDataEvent) => this.handleEvent(e);
    this.binance = new BinanceProvider({ onEvent });
    this.twelve = new TwelveDataProvider({
      onEvent,
      apiKey: opts.twelveDataApiKey,
      symbolMap: twelveDataSymbolMap(),
    });
  }

  // --------------------------------------------------------------- routing
  private route(symbol: string): { provider: MarketProvider; binding: MarketDataServiceBinding } {
    const meta = getMarketSymbol(symbol);
    if (meta?.provider === 'twelvedata') return { provider: 'twelvedata', binding: this.twelve };
    // Default everything else to Binance (crypto).
    return { provider: 'binance', binding: this.binance };
  }

  // --------------------------------------------------------------- binding API
  connect() {
    // Reconnect providers that have active subscriptions; idle providers connect
    // lazily on their first subscribe.
    if (this.symbolsByProvider.binance.size > 0) this.binance.connect();
    if (this.symbolsByProvider.twelvedata.size > 0) this.twelve.connect();
  }

  disconnect() {
    this.binance.disconnect();
    this.twelve.disconnect();
  }

  subscribe(sub: MarketSubscription) {
    const { provider, binding } = this.route(sub.symbol);
    this.symbolsByProvider[provider].add(sub.symbol);
    if (sub.timeframe) this.tfBySymbol.set(sub.symbol, sub.timeframe);
    binding.subscribe(sub);
  }

  unsubscribe(symbol: string, timeframe?: Timeframe) {
    const { provider, binding } = this.route(symbol);
    // A timeframe-scoped unsubscribe is partial (drops the kline but keeps the
    // ticker), so the symbol stays "active" until a full unsubscribe.
    if (!timeframe) {
      this.symbolsByProvider[provider].delete(symbol);
      this.tfBySymbol.delete(symbol);
      this.candleEngine.reset(symbol);
    } else {
      this.candleEngine.reset(symbol, timeframe);
    }
    binding.unsubscribe(symbol, timeframe);
  }

  // --------------------------------------------------------------- event routing
  private handleEvent(event: MarketDataEvent) {
    const store = useMarketDataStore.getState();
    switch (event.type) {
      case 'quote': {
        store.updateQuote(event.quote);
        // Tick-only providers (TwelveData) have no kline stream — build candles
        // from price ticks via the CandleEngine and push them to the store.
        if (TICK_ONLY[event.provider]) {
          const tf = this.tfBySymbol.get(event.symbol);
          if (tf) {
            if (!this.candleEngine.getCurrent(event.symbol, tf)) {
              this.candleEngine.seedHistory(event.symbol, tf, store.getCandles(event.symbol, tf));
            }
            const { current, closed } = this.candleEngine.applyTick(
              event.symbol,
              tf,
              event.quote.last,
              Math.floor(event.quote.timestamp / 1000),
              event.quote.volume,
            );
            if (closed) store.updateCandle(event.symbol, tf, closed);
            store.updateCandle(event.symbol, tf, current);
          }
        }
        break;
      }
      case 'candle':
        store.updateCandle(event.symbol, event.timeframe, event.candle);
        break;
      case 'status':
        this.statuses[event.provider] = event.status;
        store.setConnectionStatus(this.aggregateStatus());
        break;
    }
  }

  /** Collapse per-provider statuses (only providers with active subs count). */
  private aggregateStatus(): ConnectionStatus {
    const active = (Object.keys(this.symbolsByProvider) as MarketProvider[]).filter(
      (p) => this.symbolsByProvider[p].size > 0,
    );
    if (active.length === 0) return 'disconnected';
    const s = active.map((p) => this.statuses[p]);
    if (s.includes('connected')) return 'connected';
    if (s.includes('connecting')) return 'connecting';
    if (s.includes('reconnecting')) return 'reconnecting';
    if (s.includes('error')) return 'error';
    return 'disconnected';
  }
}

// ---- singleton bootstrap ----------------------------------------------------
let singleton: MarketDataService | null = null;

/**
 * Lazily create the service and bind it to the store. Call once during app
 * bootstrap (Steps 10–13). Idempotent.
 */
export function getMarketDataService(opts?: MarketDataServiceOptions): MarketDataService {
  if (!singleton) {
    singleton = new MarketDataService(opts);
    attachMarketDataService(singleton);
  }
  return singleton;
}
