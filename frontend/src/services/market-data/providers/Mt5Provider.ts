/**
 * Mt5Provider.
 *
 * Browser-side market-data adapter for the Go backend's MT5 stream cache. The
 * browser never connects to Python/MT5 directly: Python streams ticks to Go,
 * Go caches latest ticks, and this provider polls `/api/v1/mt5/ticks` for the
 * currently subscribed symbols. These ticks are quote/watchlist data only; MT5
 * chart candles come from `/api/v1/mt5/history`.
 */
import { getMt5Ticks } from "@/services/api/resources/mt5Api";
import {
  RECONNECT_BACKOFF_MS,
  type MarketDataEvent,
  type MarketDataListener,
  type MarketProvider,
  type MarketQuote,
  type MarketSubscription,
  type Timeframe,
} from "@/types";
import type { MarketDataServiceBinding } from "@/store/marketDataStore";

const POLL_INTERVAL_MS = 750;
const STALE_TIMEOUT_MS = 10_000;

type StatusValue = Extract<MarketDataEvent, { type: "status" }>["status"];

export class Mt5Provider implements MarketDataServiceBinding {
  readonly name: MarketProvider = "mt5";

  private listener: MarketDataListener | null;
  private readonly symbols = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;
  private inFlight = false;
  private lastDataAt = 0;
  private readonly previousBySymbol = new Map<string, number>();

  constructor(opts: { onEvent?: MarketDataListener } = {}) {
    this.listener = opts.onEvent ?? null;
  }

  setListener(listener: MarketDataListener | null) {
    this.listener = listener;
  }

  connect() {
    if (this.pollTimer || this.symbols.size === 0) return;
    this.manualClose = false;
    this.emitStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    void this.poll();
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  disconnect() {
    this.manualClose = true;
    this.stopPolling();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.emitStatus("disconnected");
  }

  subscribe(sub: MarketSubscription) {
    const symbol = sub.symbol.trim().toUpperCase();
    if (!symbol) return;
    this.symbols.add(symbol);
    if (!this.pollTimer && !this.manualClose) this.connect();
  }

  unsubscribe(symbol: string, _timeframe?: Timeframe) {
    const normalized = symbol.trim().toUpperCase();
    this.symbols.delete(normalized);
    this.previousBySymbol.delete(normalized);
    if (this.symbols.size === 0) {
      this.stopPolling();
      this.emitStatus("disconnected");
    }
  }

  private async poll() {
    if (this.inFlight || this.symbols.size === 0) return;
    this.inFlight = true;
    try {
      const snapshot = await getMt5Ticks([...this.symbols]);
      if (!snapshot.connected) {
        this.emitStatus("reconnecting", snapshot.lastError);
        return;
      }

      if (snapshot.ticks.length > 0) {
        this.lastDataAt = Date.now();
        this.reconnectAttempt = 0;
        this.emitStatus("connected");
      } else if (Date.now() - this.lastDataAt > STALE_TIMEOUT_MS) {
        this.emitStatus("connecting", "Waiting for MT5 ticks");
      }

      for (const tick of snapshot.ticks) {
        this.emit(this.normalizeTick(tick));
      }
    } catch (error) {
      this.handlePollError(error as Error);
    } finally {
      this.inFlight = false;
    }
  }

  private normalizeTick(tick: {
    symbol: string;
    bid: number;
    ask: number;
    timestamp: number;
    time_msc?: number;
  }): MarketDataEvent {
    const symbol = tick.symbol.trim().toUpperCase();
    const bid = Number(tick.bid);
    const ask = Number(tick.ask);
    const last = Number.isFinite(bid + ask) && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : bid || ask || 0;
    const previous = this.previousBySymbol.get(symbol) ?? last;
    this.previousBySymbol.set(symbol, last);

    const timestamp =
      Number.isFinite(tick.time_msc) && tick.time_msc
        ? tick.time_msc
        : tick.timestamp * 1000;
    const change = last - previous;
    const quote: MarketQuote = {
      symbol,
      last,
      change,
      changePct: previous ? (change / previous) * 100 : 0,
      bid,
      ask,
      volume: 0,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    };
    return { type: "quote", provider: this.name, symbol, quote };
  }

  private handlePollError(error: Error) {
    if (this.manualClose) return;
    this.emitStatus("error", error.message);
    this.stopPolling();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.manualClose || this.reconnectTimer) return;
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
      ];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private emit(event: MarketDataEvent) {
    this.listener?.(event);
  }

  private emitStatus(status: StatusValue, error?: string) {
    this.listener?.({ type: "status", provider: this.name, status, error });
  }
}
