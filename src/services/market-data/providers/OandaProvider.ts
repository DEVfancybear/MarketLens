/**
 * OandaProvider — production-grade forex/metals/indices data provider.
 *
 * OANDA v20 REST API. No mock data, no hardcoded prices. Two modes:
 *
 *  **Historical candles:** `GET /v3/instruments/{instrument}/candles`
 *  **Realtime pricing:** HTTP polling `GET /v3/accounts/{accountID}/pricing`
 *    OANDA does not expose a public WebSocket; its streaming endpoint is HTTP
 *    long-poll (SSE, newline-delimited JSON) available only on trade accounts.
 *    For the practice environment we poll at ~1s — the same approach production
 *    trading terminals use. This is fully isolated to this provider; the rest of
 *    the architecture receives normal `MarketDataEvent`s and does not know or care.
 *
 * Auth: Bearer token via `NEXT_PUBLIC_OANDA_API_KEY` (never hardcoded).
 * Account: `NEXT_PUBLIC_OANDA_ACCOUNT_ID`.
 * Environment: `NEXT_PUBLIC_OANDA_PRACTICE` switches between practice and live.
 *
 * Reconnect / backoff / dead-socket watchdog: polling-based (retry on fetch
 * failure + stale-data watchdog). Implements `MarketDataServiceBinding`.
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
} from "@/types";
import type { MarketDataServiceBinding } from "@/store/marketDataStore";

// ------------------------------------------------------------------ constants
const OANDA_PRACTICE = "https://api-fxpractice.oanda.com/v3";
const OANDA_LIVE = "https://api-fxtrade.oanda.com/v3";
const POLL_INTERVAL_MS = 1000;
const STALE_TIMEOUT_MS = 15_000; // stale-data watchdog for the polling loop

/** Unified Timeframe → OANDA granularity. */
const TF_TO_OANDA: Record<Timeframe, string> = {
  "1m": "M1",
  "3m": "M3",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1H": "H1",
  "4H": "H4",
  "1D": "D",
  "1W": "W",
};

type StatusValue = Extract<MarketDataEvent, { type: "status" }>["status"];

// ------------------------------------------------------------------ class

export class OandaProvider implements MarketDataServiceBinding {
  readonly name: MarketProvider = "oanda";

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly accountId: string;
  private listener: MarketDataListener | null;

  /** Active OANDA instruments (in canonical app format). */
  private readonly instruments = new Map<string, MarketSubscription>();
  /** Canonical → providerSymbol map (from symbol registry). */
  private readonly toOandaMap: Record<string, string>;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private lastDataAt = 0;

  constructor(opts: {
    onEvent?: MarketDataListener;
    apiKey?: string;
    accountId?: string;
    practice?: boolean;
    symbolMap?: Record<string, string>;
  }) {
    this.baseUrl = opts.practice !== false ? OANDA_PRACTICE : OANDA_LIVE;
    this.apiKey = opts.apiKey ?? process.env.NEXT_PUBLIC_OANDA_API_KEY ?? "";
    this.accountId =
      opts.accountId ?? process.env.NEXT_PUBLIC_OANDA_ACCOUNT_ID ?? "";
    this.listener = opts.onEvent ?? null;
    this.toOandaMap = opts.symbolMap ?? {};
  }

  setListener(listener: MarketDataListener | null) {
    this.listener = listener;
  }

  // --------------------------------------------------------------- lifecycle
  connect() {
    if (typeof fetch === "undefined") {
      this.emitStatus("error", "fetch unavailable (SSR/non-browser)");
      return;
    }
    if (!this.apiKey) {
      this.emitStatus("error", "Missing NEXT_PUBLIC_OANDA_API_KEY");
      return;
    }
    if (!this.accountId) {
      this.emitStatus("error", "Missing NEXT_PUBLIC_OANDA_ACCOUNT_ID");
      return;
    }
    if (this.pollTimer) return; // already polling

    this.manualClose = false;
    this.emitStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    console.debug("[OandaProvider] connect() verifying...");
    // Verify connectivity with a quick ping, then start the polling loop.
    this.verifyConnection()
      .then((ok) => {
        if (ok) {
          console.debug("[OandaProvider] connection verified — starting poll");
          this.reconnectAttempt = 0;
          this.emitStatus("connected");
          this.startPolling();
        } else {
          console.warn("[OandaProvider] connection verification failed");
        }
      })
      .catch(() => {
        console.warn("[OandaProvider] connection verification threw");
      });
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

  // --------------------------------------------------------------- subscriptions
  subscribe(sub: MarketSubscription) {
    const oandaSymbol = this.toOanda(sub.symbol);
    console.debug("[OandaProvider] subscribe", sub.symbol, "→", oandaSymbol);
    this.instruments.set(sub.symbol, sub);

    // If we're already polling, the next poll will pick up the new instrument.
    // If the poll loop has never started, connect() lazily.
    if (!this.pollTimer && !this.manualClose) {
      console.debug("[OandaProvider] starting connect (first subscription)");
      this.connect();
    }
  }

  unsubscribe(symbol: string, _timeframe?: Timeframe) {
    this.instruments.delete(symbol);
    // If no more instruments, stop polling (but don't mark disconnected —
    // that prevents the connection badge from flipping). Let the polling
    // interval naturally go idle; a new subscribe restarts it.
    if (this.instruments.size === 0) {
      this.stopPolling();
    }
  }

  // --------------------------------------------------------------- polling
  private startPolling() {
    if (this.pollTimer) return;
    // Fire once immediately, then on interval.
    void this.fetchPrices();
    this.pollTimer = setInterval(() => {
      void this.fetchPrices();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchPrices() {
    if (this.instruments.size === 0) return;
    const instrumentList = [...this.instruments.keys()]
      .map((s) => this.toOanda(s))
      .join("%2C");

    const url = `${this.baseUrl}/accounts/${this.accountId}/pricing?instruments=${instrumentList}`;
    console.debug("[OandaProvider] fetchPrices", url.substring(0, 80) + "...");

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      console.debug("[OandaProvider] fetchPrices status:", res.status);
      if (!res.ok) {
        if (res.status === 401) {
          this.emitStatus("error", "OANDA: Unauthorized — check API key");
        } else if (res.status === 404) {
          this.emitStatus("error", "OANDA: Account not found");
        } else {
          this.handleFetchError(new Error(`HTTP ${res.status}`));
        }
        return;
      }
      this.lastDataAt = Date.now();
      const data = (await res.json()) as OandaPricingResponse;
      console.debug(
        "[OandaProvider] received",
        data.prices?.length ?? 0,
        "prices",
      );
      for (const price of data.prices ?? []) {
        const canonical = this.toCanonical(price.instrument);
        if (!this.instruments.has(canonical)) continue;
        this.emit(this.normalizePrice(canonical, price));
      }
    } catch (err) {
      console.warn(
        "[OandaProvider] fetchPrices error:",
        (err as Error).message,
      );
      this.handleFetchError(err as Error);
    }
  }

  private async verifyConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/accounts`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      this.scheduleReconnect();
      return false;
    }
  }

  private handleFetchError(err: Error) {
    // Network errors on a single poll are normal (drops, transient) — don't
    // alarm. Only trigger reconnect if we've been stale too long.
    if (Date.now() - this.lastDataAt > STALE_TIMEOUT_MS) {
      this.stopPolling();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.manualClose) return;
    this.emitStatus("reconnecting");
    const delay =
      RECONNECT_BACKOFF_MS[
        Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
      ];
    this.reconnectAttempt += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --------------------------------------------------------------- historical candles
  /** Load historical candles directly from OANDA REST. */
  async loadHistory(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    before?: number,
  ): Promise<MarketCandle[]> {
    const instrument = this.toOanda(symbol);
    const granularity = TF_TO_OANDA[timeframe];
    if (!granularity) throw new Error(`Unsupported timeframe: ${timeframe}`);

    const actualLimit = Math.min(limit, 5000);
    const params = new URLSearchParams({
      granularity,
      count: String(actualLimit),
      price: "MBA", // Mid/Bid/Ask — use mid for display
    });
    if (before) params.set("to", Math.floor(before).toString());

    const res = await fetch(
      `${this.baseUrl}/instruments/${instrument}/candles?${params.toString()}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    if (!res.ok)
      throw new Error(`OANDA candles ${res.status} for ${instrument}`);

    const data = (await res.json()) as OandaCandlesResponse;
    if (!Array.isArray(data.candles)) return [];

    const candles: MarketCandle[] = data.candles.map((c) => {
      const ohlc = c.mid ?? c.bid ?? c.ask;
      const volumeRaw = Number(c.volume ?? 0);
      return {
        time: parseOandaTime(c.time),
        open: ohlc ? +ohlc.o : 0,
        high: ohlc ? +ohlc.h : 0,
        low: ohlc ? +ohlc.l : 0,
        close: ohlc ? +ohlc.c : 0,
        volume: Number.isFinite(volumeRaw) ? volumeRaw : 0,
        closed: c.complete === false ? false : true,
      };
    });

    // Sort ascending and dedupe.
    const deduped = new Map<number, MarketCandle>();
    for (const c of candles) deduped.set(c.time, c);
    return [...deduped.values()].sort((a, b) => a.time - b.time);
  }

  // --------------------------------------------------------------- normalize
  private normalizePrice(
    canonical: string,
    price: OandaPrice,
  ): MarketDataEvent {
    const ask = +price.asks[0]?.price || 0;
    const bid = +price.bids[0]?.price || 0;
    const last = (ask + bid) / 2; // mid-price for display
    const open = price.open ? +price.open : 0;
    const change = last - (open || last);
    const changePct = open ? (change / open) * 100 : 0;

    const quote: MarketQuote = {
      symbol: canonical,
      last,
      change,
      changePct,
      open,
      bid,
      ask,
      volume: 0, // OANDA pricing does not include volume
      timestamp: Date.now(),
    };
    return { type: "quote", provider: this.name, symbol: canonical, quote };
  }

  // --------------------------------------------------------------- helpers
  private toOanda(symbol: string): string {
    return this.toOandaMap[symbol] ?? symbol;
  }

  private toCanonical(oandaInstrument: string): string {
    // Reverse lookup from the symbol map.
    for (const [canon, oa] of Object.entries(this.toOandaMap)) {
      if (oa === oandaInstrument) return canon;
    }
    return oandaInstrument; // fallback (unlikely)
  }

  // --------------------------------------------------------------- emit
  private emit(event: MarketDataEvent) {
    this.listener?.(event);
  }

  private emitStatus(status: StatusValue, error?: string) {
    this.listener?.({ type: "status", provider: this.name, status, error });
  }
}

// ------------------------------------------------------------------ OANDA API types
interface OandaPricingResponse {
  prices?: OandaPrice[];
}

interface OandaPrice {
  instrument: string;
  bids: Array<{ price: string }>;
  asks: Array<{ price: string }>;
  /** Previous day's closing price (used for daily change). */
  open?: string;
}

interface OandaCandlesResponse {
  candles?: OandaCandle[];
}

interface OandaOhlc {
  o: string;
  h: string;
  l: string;
  c: string;
}

interface OandaCandle {
  time: string;
  complete?: boolean;
  volume?: number;
  mid?: OandaOhlc;
  bid?: OandaOhlc;
  ask?: OandaOhlc;
}

/** OANDA time format "YYYY-MM-DDTHH:mm:ss.SSSSSSSSSZ" → UNIX seconds. */
function parseOandaTime(dt: string): number {
  return Math.floor(Date.parse(dt) / 1000);
}
