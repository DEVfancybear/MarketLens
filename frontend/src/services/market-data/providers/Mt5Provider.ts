/**
 * Mt5Provider.
 *
 * Browser-side market-data adapter for the Go backend's MT5 stream cache. The
 * browser never connects to Python/MT5 directly: Python streams ticks to Go,
 * Go caches latest ticks, and this provider opens one browser WebSocket to
 * `/api/v1/mt5/stream`. REST `/mt5/ticks` remains a snapshot/debug endpoint;
 * watchlist quotes should use this push path instead of polling. MT5 chart
 * candles still come from `/api/v1/mt5/history`.
 */
import { apiWebSocketUrl } from "@/services/api/client";
import {
  RECONNECT_BACKOFF_MS,
  type MarketDataEvent,
  type MarketDataListener,
  type MarketProvider,
  type MarketQuote,
  type MarketSubscription,
  type Timeframe,
} from "@/types";
import { mt5ChartPrice } from "@/services/market-data/mt5Price";
import type { MarketDataServiceBinding } from "@/store/marketDataStore";

type StatusValue = Extract<MarketDataEvent, { type: "status" }>["status"];

type Mt5StreamTick = {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  time_msc?: number;
};

type Mt5StreamMessage = {
  type?: "status" | "snapshot" | "tick" | "error";
  connected?: boolean;
  source?: string;
  symbols?: string[];
  ticks?: Mt5StreamTick[];
  tick?: Mt5StreamTick;
  updatedAt?: string;
  lastError?: string;
};

export class Mt5Provider implements MarketDataServiceBinding {
  readonly name: MarketProvider = "mt5";

  private listener: MarketDataListener | null;
  private readonly symbols = new Set<string>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;
  private readonly previousBySymbol = new Map<string, number>();

  constructor(opts: { onEvent?: MarketDataListener } = {}) {
    this.listener = opts.onEvent ?? null;
  }

  setListener(listener: MarketDataListener | null) {
    this.listener = listener;
  }

  connect() {
    if (this.symbols.size === 0) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    if (typeof WebSocket === "undefined") {
      this.emitStatus("error", "WebSocket unavailable");
      return;
    }

    this.manualClose = false;
    this.emitStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const ws = new WebSocket(apiWebSocketUrl("mt5/stream"));
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      this.emitStatus("connected");
      this.sendSymbols("set_symbols", [...this.symbols]);
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.handleMessage(event.data);
    };
    ws.onerror = () => {
      if (this.ws !== ws || this.manualClose) return;
      this.emitStatus("error", "MT5 stream WebSocket error");
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.manualClose || this.symbols.size === 0) {
        this.emitStatus("disconnected");
        return;
      }
      this.emitStatus("reconnecting", "MT5 stream disconnected");
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.closeSocket();
    this.emitStatus("disconnected");
  }

  subscribe(sub: MarketSubscription) {
    const symbol = sub.symbol.trim().toUpperCase();
    if (!symbol) return;
    this.symbols.add(symbol);
    this.manualClose = false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSymbols("subscribe", [symbol]);
    } else {
      this.connect();
    }
  }

  unsubscribe(symbol: string, _timeframe?: Timeframe) {
    const normalized = symbol.trim().toUpperCase();
    this.symbols.delete(normalized);
    this.previousBySymbol.delete(normalized);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSymbols("unsubscribe", [normalized]);
    }
    if (this.symbols.size === 0) {
      this.manualClose = true;
      this.closeSocket();
      this.emitStatus("disconnected");
    }
  }

  private handleMessage(raw: unknown) {
    let message: Mt5StreamMessage;
    try {
      message = JSON.parse(String(raw)) as Mt5StreamMessage;
    } catch {
      this.emitStatus("error", "Invalid MT5 stream message");
      return;
    }

    if (message.type === "error") {
      this.emitStatus("error", message.lastError);
      return;
    }

    if (message.type === "status") {
      this.emitStatus(message.connected ? "connected" : "reconnecting", message.lastError);
      return;
    }

    if (message.type === "snapshot") {
      if (message.connected === false) {
        this.emitStatus("reconnecting", message.lastError);
      } else {
        this.emitStatus("connected");
      }
      for (const tick of message.ticks ?? []) {
        this.emit(this.normalizeTick(tick));
      }
      return;
    }

    if (message.type === "tick" && message.tick) {
      this.reconnectAttempt = 0;
      this.emitStatus("connected");
      this.emit(this.normalizeTick(message.tick));
    }
  }

  private normalizeTick(tick: Mt5StreamTick): MarketDataEvent {
    const symbol = tick.symbol.trim().toUpperCase();
    const bid = Number(tick.bid);
    const ask = Number(tick.ask);
    const last = mt5ChartPrice(bid, ask) ?? 0;
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

  private sendSymbols(type: "subscribe" | "unsubscribe" | "set_symbols", symbols: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (unique.length === 0 && type !== "set_symbols") return;
    this.ws.send(JSON.stringify({ type, symbols: unique }));
  }

  private closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }
  }

  private emit(event: MarketDataEvent) {
    this.listener?.(event);
  }

  private emitStatus(status: StatusValue, error?: string) {
    this.listener?.({ type: "status", provider: this.name, status, error });
  }
}
