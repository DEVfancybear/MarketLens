/**
 * TwelveDataProvider (Phase 1, Step 5).
 *
 * Realtime forex / metals / indices via TwelveData's single price WebSocket
 * (`wss://ws.twelvedata.com/v1/quotes/price`). One socket multiplexes many
 * symbols through `subscribe` / `unsubscribe` actions — never one per symbol.
 *
 * TwelveData's WS streams PRICE ticks only (no klines), so this provider emits
 * unified `quote` events. Realtime candle construction from those ticks is the
 * CandleEngine's job (Step 8); historical candles come from the REST
 * HistoricalDataService (Step 7).
 *
 * Pure service layer — implements `MarketDataServiceBinding`.
 *
 * The API key is read from `NEXT_PUBLIC_TWELVEDATA_API_KEY` (client-side WS, so
 * it must be a public env var) or passed explicitly. It is NEVER hardcoded or
 * committed — see `.env.example`.
 */
import {
  RECONNECT_BACKOFF_MS,
  type MarketDataEvent,
  type MarketDataListener,
  type MarketProvider,
  type MarketQuote,
  type MarketSubscription,
  type Timeframe,
} from '@/types';
import type { MarketDataServiceBinding } from '@/store/marketDataStore';

const TD_WS_BASE = 'wss://ws.twelvedata.com/v1/quotes/price';

type StatusValue = Extract<MarketDataEvent, { type: 'status' }>['status'];

export interface TwelveDataProviderOptions {
  onEvent?: MarketDataListener;
  /** Overrides `NEXT_PUBLIC_TWELVEDATA_API_KEY`. */
  apiKey?: string;
  /**
   * Maps a canonical app symbol → TwelveData symbol (e.g. "EURUSD" → "EUR/USD").
   * Defaults to identity. The reverse map is built automatically so emitted
   * events carry the canonical symbol.
   */
  symbolMap?: Record<string, string>;
  url?: string;
}

export class TwelveDataProvider implements MarketDataServiceBinding {
  readonly name: MarketProvider = 'twelvedata';

  private ws: WebSocket | null = null;
  private readonly base: string;
  private readonly apiKey: string;
  private listener: MarketDataListener | null;

  /** canonical → TwelveData symbol, and the reverse. */
  private readonly toTdMap: Record<string, string>;
  private readonly toCanonicalMap: Record<string, string>;

  /** Active TwelveData symbols. */
  private readonly symbols = new Set<string>();

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  constructor(opts: TwelveDataProviderOptions = {}) {
    this.base = opts.url ?? TD_WS_BASE;
    this.apiKey = opts.apiKey ?? process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY ?? '';
    this.listener = opts.onEvent ?? null;
    this.toTdMap = opts.symbolMap ?? {};
    this.toCanonicalMap = Object.fromEntries(
      Object.entries(this.toTdMap).map(([canon, td]) => [td, canon]),
    );
  }

  setListener(listener: MarketDataListener | null) {
    this.listener = listener;
  }

  private toTd(symbol: string): string {
    return this.toTdMap[symbol] ?? symbol;
  }
  private toCanonical(tdSymbol: string): string {
    return this.toCanonicalMap[tdSymbol] ?? tdSymbol;
  }

  // ----------------------------------------------------------------- lifecycle
  connect() {
    if (typeof WebSocket === 'undefined') {
      this.emitStatus('error', 'WebSocket unavailable (SSR/non-browser)');
      return;
    }
    if (!this.apiKey) {
      this.emitStatus('error', 'Missing NEXT_PUBLIC_TWELVEDATA_API_KEY');
      return;
    }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manualClose = false;
    this.emitStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

    const ws = new WebSocket(`${this.base}?apikey=${encodeURIComponent(this.apiKey)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.emitStatus('connected');
      if (this.symbols.size > 0) this.send({ action: 'subscribe', params: { symbols: [...this.symbols].join(',') } });
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

  // --------------------------------------------------------------- subscriptions
  /** `channels`/`timeframe` are ignored — TwelveData WS is price-only. */
  subscribe(sub: MarketSubscription) {
    const td = this.toTd(sub.symbol);
    if (this.symbols.has(td)) return;
    this.symbols.add(td);
    if (!this.ws) {
      this.connect();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.send({ action: 'subscribe', params: { symbols: td } });
    }
  }

  unsubscribe(symbol: string, _timeframe?: Timeframe) {
    const td = this.toTd(symbol);
    if (!this.symbols.has(td)) return;
    this.symbols.delete(td);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ action: 'unsubscribe', params: { symbols: td } });
    }
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  // ----------------------------------------------------------------- normalize
  private handleMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const event = msg.event as string | undefined;
    if (event === 'price') {
      this.emit(this.normalizePrice(msg));
    } else if (event === 'subscribe-status') {
      // Surface subscribe failures (e.g. plan limits) without crashing.
      const fails = (msg.fails as unknown[] | undefined) ?? [];
      if (fails.length) this.emitStatus('error', `subscribe failed: ${JSON.stringify(fails)}`);
    }
    // 'heartbeat' and anything else → ignore (keepalive).
  }

  private normalizePrice(m: Record<string, unknown>): MarketDataEvent {
    const tdSymbol = String(m.symbol);
    const symbol = this.toCanonical(tdSymbol);
    const last = +String(m.price);
    const tsRaw = Number(m.timestamp);
    const quote: MarketQuote = {
      symbol,
      last,
      // WS price ticks carry no daily change; left at 0 (filled by a REST
      // /quote snapshot or CandleEngine at a higher layer).
      change: 0,
      changePct: 0,
      volume: m.day_volume != null ? +String(m.day_volume) : 0,
      timestamp: Number.isFinite(tsRaw) ? tsRaw * 1000 : Date.now(),
    };
    return { type: 'quote', provider: this.name, symbol, quote };
  }

  // ----------------------------------------------------------------- emit
  private emit(event: MarketDataEvent) {
    this.listener?.(event);
  }
  private emitStatus(status: StatusValue, error?: string) {
    this.listener?.({ type: 'status', provider: this.name, status, error });
  }
}
