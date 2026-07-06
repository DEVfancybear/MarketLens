/**
 * BinanceProvider (Phase 1, Step 4).
 *
 * A single combined WebSocket to Binance's public market streams. It NEVER
 * opens one socket per symbol — symbols are added/removed on the live socket via
 * the JSON-RPC `SUBSCRIBE` / `UNSUBSCRIBE` control messages. All payloads are
 * normalized into the unified `MarketDataEvent` shape and pushed to a listener.
 *
 * Streams supported: `@ticker`, `@miniTicker`, `@kline_<interval>`.
 * Reconnect: walks `RECONNECT_BACKOFF_MS` (1→2→5→10→30s), infinite retries,
 * and auto-resubscribes every active stream on reconnect.
 *
 * Pure service layer — no React, no UI. Implements `MarketDataServiceBinding`
 * so it can be attached to `marketDataStore` (directly or via MarketDataService
 * in Step 6).
 */
import {
  RECONNECT_BACKOFF_MS,
  type MarketCandle,
  type MarketDataEvent,
  type MarketDataListener,
  type MarketProvider,
  type MarketQuote,
  type MarketSubscription,
  type Timeframe,
} from '@/types';
import type { MarketDataServiceBinding } from '@/store/marketDataStore';

// Use the standard WSS/443 endpoint by default. The old `:9443` endpoint is
// valid, but local networks and corporate firewalls often block non-standard
// TLS ports, which leaves the chart without realtime candles in development.
const BINANCE_WS_URL = 'wss://stream.binance.com/ws';

/**
 * Dead-socket watchdog. A liquid Binance kline/ticker stream pushes data at
 * least once per second, so a prolonged silence on an OPEN socket means it has
 * died without firing `onclose` (a common failure on flaky networks / sleeping
 * tabs). If no frame arrives within `STALE_TIMEOUT_MS` while we have active
 * subscriptions, recycle the socket so the normal reconnect path resubscribes.
 */
const STALE_TIMEOUT_MS = 45_000;
const WATCHDOG_INTERVAL_MS = 15_000;

/** Unified Timeframe → Binance kline interval. */
const TF_TO_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1H': '1h', '2H': '2h', '4H': '4h', '1D': '1d', '1W': '1w',
  '1M': '1M',
};
/** Binance kline interval → unified Timeframe (reverse). */
const INTERVAL_TO_TF: Record<string, Timeframe> = Object.fromEntries(
  Object.entries(TF_TO_INTERVAL).map(([tf, iv]) => [iv, tf as Timeframe]),
) as Record<string, Timeframe>;

export interface BinanceProviderOptions {
  onEvent?: MarketDataListener;
  /** Override the WS endpoint (testnet / proxy). */
  url?: string;
}

export class BinanceProvider implements MarketDataServiceBinding {
  readonly name: MarketProvider = 'binance';

  private ws: WebSocket | null = null;
  private readonly url: string;
  private listener: MarketDataListener | null;

  /** Active stream names, e.g. "btcusdt@ticker", "btcusdt@kline_1m". */
  private readonly streams = new Set<string>();

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private rpcId = 1;

  /** Epoch ms of the last inbound frame; drives the dead-socket watchdog. */
  private lastMessageAt = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private onlineBound = false;
  private readonly onOnline = () => this.handleOnline();

  constructor(opts: BinanceProviderOptions = {}) {
    this.url = opts.url ?? BINANCE_WS_URL;
    this.listener = opts.onEvent ?? null;
  }

  setListener(listener: MarketDataListener | null) {
    this.listener = listener;
  }

  // ----------------------------------------------------------------- lifecycle
  connect() {
    if (typeof WebSocket === 'undefined') {
      this.emitStatus('error', 'WebSocket unavailable (SSR/non-browser)');
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manualClose = false;
    this.bindOnline();
    this.startWatchdog();
    this.emitStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.emitStatus('connected');
      // Auto-resubscribe everything that should be active.
      if (this.streams.size > 0) this.sendControl('SUBSCRIBE', [...this.streams]);
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => this.emitStatus('error', 'WebSocket error');
    ws.onclose = () => {
      this.ws = null;
      if (this.manualClose) {
        this.emitStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manualClose = true;
    this.stopWatchdog();
    this.unbindOnline();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.emitStatus('disconnected');
  }

  private scheduleReconnect() {
    this.emitStatus('reconnecting');
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // -------------------------------------------------------- dead-socket watchdog
  private startWatchdog() {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.checkStale(), WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Recycle an OPEN-but-silent socket so the reconnect path resubscribes. */
  private checkStale() {
    if (this.manualClose || this.streams.size === 0) return; // idle → expect no data
    if (this.ws?.readyState !== WebSocket.OPEN) return;       // (re)connecting handled elsewhere
    if (Date.now() - this.lastMessageAt <= STALE_TIMEOUT_MS) return;
    this.emitStatus('reconnecting', 'No data — recycling stale socket');
    try {
      this.ws.close(); // → onclose → scheduleReconnect (+ auto-resubscribe)
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------- network recovery
  private bindOnline() {
    if (this.onlineBound || typeof window === 'undefined') return;
    window.addEventListener('online', this.onOnline);
    this.onlineBound = true;
  }

  private unbindOnline() {
    if (!this.onlineBound || typeof window === 'undefined') return;
    window.removeEventListener('online', this.onOnline);
    this.onlineBound = false;
  }

  /** Network came back — skip the remaining backoff and reconnect immediately. */
  private handleOnline() {
    if (this.manualClose) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.connect();
  }

  // --------------------------------------------------------------- subscriptions
  subscribe(sub: MarketSubscription) {
    const names = this.streamsFor(sub);
    const fresh = names.filter((n) => !this.streams.has(n));
    fresh.forEach((n) => this.streams.add(n));
    if (fresh.length === 0) return;
    // Open the socket lazily on first subscription.
    if (!this.ws) {
      this.connect();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.sendControl('SUBSCRIBE', fresh);
    }
    // If still CONNECTING, onopen will resubscribe the full set.
  }

  unsubscribe(symbol: string, timeframe?: Timeframe) {
    const prefix = `${symbol.toLowerCase()}@`;
    const remove = timeframe
      ? [`${symbol.toLowerCase()}@kline_${TF_TO_INTERVAL[timeframe]}`]
      : [...this.streams].filter((n) => n.startsWith(prefix));
    const present = remove.filter((n) => this.streams.has(n));
    if (present.length === 0) return;
    present.forEach((n) => this.streams.delete(n));
    if (this.ws?.readyState === WebSocket.OPEN) this.sendControl('UNSUBSCRIBE', present);
  }

  private streamsFor(sub: MarketSubscription): string[] {
    const s = sub.symbol.toLowerCase();
    const out: string[] = [];
    for (const ch of sub.channels) {
      if (ch === 'ticker') out.push(`${s}@ticker`);
      else if (ch === 'miniTicker') out.push(`${s}@miniTicker`);
      else if (ch === 'kline' && sub.timeframe) out.push(`${s}@kline_${TF_TO_INTERVAL[sub.timeframe]}`);
    }
    return out;
  }

  private sendControl(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
    if (this.ws?.readyState !== WebSocket.OPEN || params.length === 0) return;
    this.ws.send(JSON.stringify({ method, params, id: this.rpcId++ }));
  }

  // ----------------------------------------------------------------- normalize
  private handleMessage(raw: string) {
    this.lastMessageAt = Date.now(); // any frame (incl. RPC acks) proves liveness
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // JSON-RPC ack to SUBSCRIBE/UNSUBSCRIBE → ignore.
    if ('result' in msg && 'id' in msg) return;

    const e = msg.e as string | undefined;
    if (e === '24hrTicker') this.emit(this.normalizeTicker(msg));
    else if (e === '24hrMiniTicker') this.emit(this.normalizeMiniTicker(msg));
    else if (e === 'kline') this.emit(this.normalizeKline(msg));
  }

  private normalizeTicker(m: Record<string, unknown>): MarketDataEvent {
    const symbol = String(m.s);
    const quote: MarketQuote = {
      symbol,
      last: +String(m.c),
      change: +String(m.p),
      changePct: +String(m.P),
      open: +String(m.o),
      high: +String(m.h),
      low: +String(m.l),
      prevClose: m.x != null ? +String(m.x) : undefined,
      volume: +String(m.v),
      timestamp: Number(m.E) || Date.now(),
    };
    return { type: 'quote', provider: this.name, symbol, quote };
  }

  private normalizeMiniTicker(m: Record<string, unknown>): MarketDataEvent {
    const symbol = String(m.s);
    const open = +String(m.o);
    const last = +String(m.c);
    const quote: MarketQuote = {
      symbol,
      last,
      open,
      high: +String(m.h),
      low: +String(m.l),
      change: last - open,
      changePct: open ? ((last - open) / open) * 100 : 0,
      volume: +String(m.v),
      timestamp: Number(m.E) || Date.now(),
    };
    return { type: 'quote', provider: this.name, symbol, quote };
  }

  private normalizeKline(m: Record<string, unknown>): MarketDataEvent {
    const k = m.k as Record<string, unknown>;
    const symbol = String(k.s);
    const candle: MarketCandle = {
      time: Math.floor(Number(k.t) / 1000),
      open: +String(k.o),
      high: +String(k.h),
      low: +String(k.l),
      close: +String(k.c),
      volume: +String(k.v),
      closed: Boolean(k.x),
    };
    const timeframe = INTERVAL_TO_TF[String(k.i)] ?? '1m';
    return { type: 'candle', provider: this.name, symbol, timeframe, candle };
  }

  // ----------------------------------------------------------------- emit
  private emit(event: MarketDataEvent) {
    this.listener?.(event);
  }

  private emitStatus(status: MarketQuoteStatus, error?: string) {
    this.listener?.({ type: 'status', provider: this.name, status, error });
  }
}

/** Local alias to keep the status union tidy at call sites. */
type MarketQuoteStatus = Extract<MarketDataEvent, { type: 'status' }>['status'];
