/**
 * MarketDataService (Phase 1, Step 6).
 *
 * Owns the concrete providers (Binance + OANDA + TwelveData), routes each
 * symbol to the right one (via the symbol registry), fans normalized
 * `MarketDataEvent`s into `marketDataStore`, and aggregates a single connection
 * status for the UI.
 *
 * It implements `MarketDataServiceBinding`, so once `attachMarketDataService()`
 * binds it, the store's intents (`connect/disconnect/subscribe/unsubscribe`)
 * delegate here. Pure service layer — no React/UI.
 *
 * Reconnect/auto-resubscribe lives in the providers; this service only routes.
 */
import {
  attachMarketDataService,
  useMarketDataStore,
  type MarketDataServiceBinding,
} from "@/store/marketDataStore";
import {
  type ConnectionStatus,
  type MarketDataEvent,
  type MarketProvider,
  type MarketSubscription,
  type Timeframe,
} from "@/types";
import { BinanceProvider } from "./providers/BinanceProvider";
import { TwelveDataProvider } from "./providers/TwelveDataProvider";
import { OandaProvider } from "./providers/OandaProvider";
import {
  getMarketSymbol,
  MARKET_SYMBOLS,
  twelveDataSymbolMap,
} from "./symbols";
import { CandleEngine } from "./CandleEngine";

/** Providers that stream price ticks only (no klines) → candles are built locally. */
const TICK_ONLY: Record<MarketProvider, boolean> = {
  binance: false,
  twelvedata: true,
  oanda: true,
  mock: false,
};

export interface MarketDataServiceOptions {
  twelveDataApiKey?: string;
  oandaApiKey?: string;
  oandaAccountId?: string;
  oandaPractice?: boolean;
}

export class MarketDataService implements MarketDataServiceBinding {
  private readonly binance: BinanceProvider;
  private readonly twelve: TwelveDataProvider | null;
  private readonly oanda: OandaProvider | null;

  /** Active canonical symbols per provider (drives connect()/status aggregation). */
  private readonly symbolsByProvider: Record<MarketProvider, Set<string>> = {
    binance: new Set(),
    twelvedata: new Set(),
    oanda: new Set(),
    mock: new Set(),
  };

  /** Builds candles from price ticks for tick-only providers. */
  private readonly candleEngine = new CandleEngine();

  /** Active kline timeframe per symbol (so ticks build the right bar). */
  private readonly tfBySymbol = new Map<string, Timeframe>();

  /** Latest status reported by each provider. */
  private readonly statuses: Record<MarketProvider, ConnectionStatus> = {
    binance: "disconnected",
    twelvedata: "disconnected",
    oanda: "disconnected",
    mock: "disconnected",
  };

  constructor(opts: MarketDataServiceOptions = {}) {
    const onEvent = (e: MarketDataEvent) => this.handleEvent(e);

    this.binance = new BinanceProvider({ onEvent });

    // OANDA: the primary forex/metals/indices provider.
    const oandaKey = opts.oandaApiKey ?? process.env.NEXT_PUBLIC_OANDA_API_KEY;
    const oandaAccountId =
      opts.oandaAccountId ?? process.env.NEXT_PUBLIC_OANDA_ACCOUNT_ID;
    if (oandaKey) {
      console.debug("[MarketDataService] OandaProvider ENABLED");
      this.oanda = new OandaProvider({
        onEvent,
        apiKey: oandaKey,
        accountId: opts.oandaAccountId,
        practice: opts.oandaPractice !== false,
        symbolMap: buildOandaSymbolMap(),
      });
    } else {
      this.oanda = null;
      console.debug(
        "[MarketDataService] OandaProvider DISABLED — no NEXT_PUBLIC_OANDA_API_KEY",
      );
    }

    // TwelveData: fallback for forex/metals/indices when OANDA is unavailable.
    const tdKey =
      opts.twelveDataApiKey ?? process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY;
    if (tdKey) {
      console.debug(
        "[MarketDataService] TwelveDataProvider ENABLED (fallback)",
      );
      this.twelve = new TwelveDataProvider({
        onEvent,
        apiKey: tdKey,
        symbolMap: twelveDataSymbolMap(),
      });
    } else {
      this.twelve = null;
      console.debug("[MarketDataService] TwelveData DISABLED — no key");
    }
  }

  // --------------------------------------------------------------- routing
  private route(
    symbol: string,
  ): { provider: MarketProvider; binding: MarketDataServiceBinding } | null {
    const meta = getMarketSymbol(symbol);
    if (!meta) return null;

    if (meta.provider === "oanda") {
      if (this.oanda) return { provider: "oanda", binding: this.oanda };
      if (this.twelve) return { provider: "twelvedata", binding: this.twelve };
      console.warn(
        "[MarketDataService] No provider for",
        symbol,
        "— OANDA/TwelveData keys missing",
      );
      return null;
    }

    if (meta.provider === "twelvedata") {
      if (this.twelve) return { provider: "twelvedata", binding: this.twelve };
      console.warn(
        "[MarketDataService] No provider for",
        symbol,
        "— TwelveData key missing",
      );
      return null;
    }

    return { provider: "binance", binding: this.binance };
  }

  // --------------------------------------------------------------- binding API
  connect() {
    if (this.symbolsByProvider.binance.size > 0) this.binance.connect();
    if (this.symbolsByProvider.twelvedata.size > 0) this.twelve?.connect();
    if (this.symbolsByProvider.oanda.size > 0) this.oanda?.connect();
  }

  disconnect() {
    this.binance.disconnect();
    this.twelve?.disconnect();
    this.oanda?.disconnect();
  }

  subscribe(sub: MarketSubscription) {
    const routed = this.route(sub.symbol);
    if (!routed) {
      console.warn(
        "[MarketDataService] subscribe DROPPED for",
        sub.symbol,
        "— no route",
      );
      return;
    }
    console.debug(
      "[MarketDataService] subscribe",
      sub.symbol,
      "→",
      routed.provider,
    );
    this.symbolsByProvider[routed.provider].add(sub.symbol);
    if (sub.timeframe) this.tfBySymbol.set(sub.symbol, sub.timeframe);
    routed.binding.subscribe(sub);
  }

  unsubscribe(symbol: string, timeframe?: Timeframe) {
    const meta = getMarketSymbol(symbol);
    if (!meta) return;

    const provider = meta.provider;
    if (!timeframe) {
      this.symbolsByProvider[provider]?.delete(symbol);
      this.tfBySymbol.delete(symbol);
      this.candleEngine.reset(symbol);
    } else {
      this.candleEngine.reset(symbol, timeframe);
    }

    const routed = this.route(symbol);
    if (routed) routed.binding.unsubscribe(symbol, timeframe);
  }

  // --------------------------------------------------------------- event routing
  private handleEvent(event: MarketDataEvent) {
    const store = useMarketDataStore.getState();
    switch (event.type) {
      case "quote": {
        store.updateQuote(event.quote);
        if (TICK_ONLY[event.provider]) {
          const tf = this.tfBySymbol.get(event.symbol);
          if (tf) {
            if (!this.candleEngine.getCurrent(event.symbol, tf)) {
              this.candleEngine.seedHistory(
                event.symbol,
                tf,
                store.getCandles(event.symbol, tf),
              );
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
      case "candle":
        store.updateCandle(event.symbol, event.timeframe, event.candle);
        break;
      case "status":
        this.statuses[event.provider] = event.status;
        store.setConnectionStatus(this.aggregateStatus());
        break;
    }
  }

  /** Collapse per-provider statuses (only providers with active subs count). */
  private aggregateStatus(): ConnectionStatus {
    const active = (
      Object.keys(this.symbolsByProvider) as MarketProvider[]
    ).filter((p) => this.symbolsByProvider[p].size > 0);
    if (active.length === 0) return "disconnected";
    const s = active.map((p) => this.statuses[p]);
    if (s.includes("connected")) return "connected";
    if (s.includes("connecting")) return "connecting";
    if (s.includes("reconnecting")) return "reconnecting";
    if (s.includes("error")) return "error";
    return "disconnected";
  }
}

// ---- singleton bootstrap ----------------------------------------------------
let singleton: MarketDataService | null = null;

/**
 * Lazily create the service and bind it to the store. Call once during app
 * bootstrap (GlobalRuntime → useMarketDataBootstrap). Idempotent.
 */
export function getMarketDataService(
  opts?: MarketDataServiceOptions,
): MarketDataService {
  if (!singleton) {
    singleton = new MarketDataService(opts);
    attachMarketDataService(singleton);
  }
  return singleton;
}

// ---- symbol maps -------------------------------------------------------------

/** Canonical app id → OANDA instrument name (EUR_USD format). */
function buildOandaSymbolMap(): Record<string, string> {
  return Object.fromEntries(
    MARKET_SYMBOLS.filter((s) => s.provider === "oanda").map((s) => [
      s.id,
      s.providerSymbol,
    ]),
  );
}
