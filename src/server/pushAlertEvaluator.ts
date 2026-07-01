import { getMarketSymbol, oandaInstrument } from "@/services/market-data/symbols";
import type { PushAlertCondition } from "@/types/pushAlerts";
import type { PushDeviceRecord, ServerPushAlert } from "@/types/pushAlerts";
import { firebaseAdminConfigured, sendFirebasePush } from "./firebaseAdmin";
import { listPushDevices, updatePushDevice } from "./pushAlertStore";

const RECURRING_REARM_MS = 60_000;

interface EvaluationResult {
  devices: number;
  alerts: number;
  triggered: number;
  skipped: number;
  errors: string[];
}

interface PriceSnapshot {
  current: number;
  open?: number;
  high?: number;
  low?: number;
  candles?: PriceCandle[];
}

interface PriceCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function alertSignature(alert: ServerPushAlert): string {
  return `${alert.condition}:${alert.symbol}:${alert.price}:${alert.recurring}`;
}

const CONDITION_SYMBOL: Record<PushAlertCondition, string> = {
  above: ">=",
  below: "<=",
  crossUp: "crosses above",
  crossDown: "crosses below",
};

function conditionMet(
  condition: PushAlertCondition,
  target: number,
  prev: number | undefined,
  price: PriceSnapshot,
): boolean {
  const curr = price.current;
  const high = price.high ?? curr;
  const low = price.low ?? curr;
  const open = price.open ?? prev;
  switch (condition) {
    case "above":
      return high >= target;
    case "below":
      return low <= target;
    case "crossUp":
      return (prev !== undefined ? prev < target : open !== undefined && open < target) && high >= target;
    case "crossDown":
      return (prev !== undefined ? prev > target : open !== undefined && open > target) && low <= target;
  }
}

function priceWindow(snapshot: PriceSnapshot, since: number): PriceSnapshot {
  if (!snapshot.candles?.length) return snapshot;
  const candles = snapshot.candles.filter((c) => c.closeTime >= since);
  const window = candles.length > 0 ? candles : [snapshot.candles[snapshot.candles.length - 1]];
  const first = window[0];
  const last = window[window.length - 1];
  return {
    current: last.close,
    open: first.open,
    high: Math.max(...window.map((c) => c.high)),
    low: Math.min(...window.map((c) => c.low)),
    candles: window,
  };
}

function formatAlert(alert: ServerPushAlert, triggerPrice: number) {
  const op = CONDITION_SYMBOL[alert.condition];
  return {
    title: `${alert.symbol} alert`,
    body: `${alert.symbol} ${op} ${alert.price} - now ${triggerPrice}${alert.note ? ` - ${alert.note}` : ""}`,
  };
}

async function fetchBinancePrice(symbol: string): Promise<PriceSnapshot | undefined> {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=10`,
    { cache: "no-store" },
  );
  if (!res.ok) return undefined;
  const body = (await res.json()) as Array<
    [number, string, string, string, string, string, number]
  >;
  const candles: PriceCandle[] = body
    .map((k) => ({
      openTime: Number(k[0]),
      closeTime: Number(k[6]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }))
    .filter(
      (k) =>
        Number.isFinite(k.openTime) &&
        Number.isFinite(k.closeTime) &&
        Number.isFinite(k.open) &&
        Number.isFinite(k.high) &&
        Number.isFinite(k.low) &&
        Number.isFinite(k.close),
    );
  const last = candles[candles.length - 1];
  if (!last) return undefined;
  return {
    current: last.close,
    open: last.open,
    high: last.high,
    low: last.low,
    candles,
  };
}

async function fetchOandaPrice(symbol: string): Promise<PriceSnapshot | undefined> {
  const key = process.env.OANDA_API_KEY ?? process.env.NEXT_PUBLIC_OANDA_API_KEY;
  const account =
    process.env.OANDA_ACCOUNT_ID ?? process.env.NEXT_PUBLIC_OANDA_ACCOUNT_ID;
  if (!key || !account) return undefined;

  const host =
    process.env.OANDA_PRACTICE === "false" ||
    process.env.NEXT_PUBLIC_OANDA_PRACTICE === "false"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";
  const instrument = oandaInstrument(symbol);
  const res = await fetch(
    `${host}/v3/accounts/${account}/pricing?instruments=${encodeURIComponent(instrument)}`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}` },
    },
  );
  if (!res.ok) return undefined;
  const body = (await res.json()) as {
    prices?: Array<{
      bids?: Array<{ price?: string }>;
      asks?: Array<{ price?: string }>;
      closeoutBid?: string;
      closeoutAsk?: string;
    }>;
  };
  const item = body.prices?.[0];
  const bid = Number(item?.bids?.[0]?.price ?? item?.closeoutBid);
  const ask = Number(item?.asks?.[0]?.price ?? item?.closeoutAsk);
  if (Number.isFinite(bid) && Number.isFinite(ask)) return { current: (bid + ask) / 2 };
  return undefined;
}

async function fetchTwelveDataPrice(symbol: string): Promise<PriceSnapshot | undefined> {
  const key = process.env.TWELVEDATA_API_KEY ?? process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY;
  if (!key) return undefined;
  const market = getMarketSymbol(symbol);
  const providerSymbol =
    market?.assetClass === "forex"
      ? `${market.base}/${market.quote}`
      : market?.providerSymbol ?? symbol;
  const res = await fetch(
    `https://api.twelvedata.com/price?symbol=${encodeURIComponent(providerSymbol)}&apikey=${encodeURIComponent(key)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return undefined;
  const body = (await res.json()) as { price?: string };
  const price = Number(body.price);
  return Number.isFinite(price) ? { current: price } : undefined;
}

async function fetchCurrentPrice(symbol: string): Promise<PriceSnapshot | undefined> {
  const market = getMarketSymbol(symbol);
  if (market?.provider === "binance" || symbol.endsWith("USDT")) {
    return fetchBinancePrice(symbol);
  }
  const oanda = await fetchOandaPrice(symbol);
  if (oanda !== undefined) return oanda;
  return fetchTwelveDataPrice(symbol);
}

function shouldEvaluate(device: PushDeviceRecord, alert: ServerPushAlert) {
  const signature = alertSignature(alert);
  const state = device.alertState[alert.id];
  if (!state || state.signature !== signature) return { signature };
  return { signature, state };
}

export async function evaluatePushAlerts(): Promise<EvaluationResult> {
  const result: EvaluationResult = {
    devices: 0,
    alerts: 0,
    triggered: 0,
    skipped: 0,
    errors: [],
  };

  if (!firebaseAdminConfigured()) {
    result.errors.push("Firebase Admin is not configured.");
    return result;
  }

  const devices = await listPushDevices();
  result.devices = devices.length;

  const symbols = new Set<string>();
  for (const device of devices) {
    if (!device.settingsPush) continue;
    for (const alert of device.alerts) symbols.add(alert.symbol);
  }

  const prices: Record<string, PriceSnapshot> = {};
  await Promise.all(
    [...symbols].map(async (symbol) => {
      try {
        const price = await fetchCurrentPrice(symbol);
        if (price !== undefined) prices[symbol] = price;
      } catch (error) {
        result.errors.push(
          `${symbol}: ${error instanceof Error ? error.message : "price fetch failed"}`,
        );
      }
    }),
  );

  const now = Date.now();
  for (const device of devices) {
    if (!device.settingsPush || device.alerts.length === 0) continue;
    const lastPrices = { ...device.lastPrices };
    const alertState = { ...device.alertState };

    for (const alert of device.alerts) {
      result.alerts += 1;
      const price = prices[alert.symbol];
      if (price === undefined) {
        result.skipped += 1;
        continue;
      }

      const { signature, state } = shouldEvaluate(device, alert);
      const sameAlertState = state?.signature === signature;
      const since =
        sameAlertState && state?.lastEvaluatedAt !== undefined
          ? state.lastEvaluatedAt
          : alert.updatedAt;
      const priceWindowSinceLastEval = priceWindow(price, since);
      const prev = lastPrices[alert.symbol];
      const oneTimeFired = state?.oneTimeFired && !alert.recurring;
      const rearmBlocked =
        alert.recurring &&
        state?.lastTriggeredAt !== undefined &&
        now - state.lastTriggeredAt < RECURRING_REARM_MS;

      if (!oneTimeFired && !rearmBlocked && conditionMet(alert.condition, alert.price, prev, priceWindowSinceLastEval)) {
        const triggerPrice = priceWindowSinceLastEval.current;
        const message = formatAlert(alert, triggerPrice);
        try {
          await sendFirebasePush({
            token: device.token,
            title: message.title,
            body: message.body,
            data: {
              alertId: alert.id,
              symbol: alert.symbol,
              condition: alert.condition,
              targetPrice: String(alert.price),
              triggerPrice: String(triggerPrice),
              source: "server-worker",
            },
          });
          result.triggered += 1;
          alertState[alert.id] = {
            signature,
            lastTriggeredAt: now,
            lastEvaluatedAt: now,
            oneTimeFired: !alert.recurring,
          };
        } catch (error) {
          result.errors.push(
            `${alert.symbol}/${alert.id}: ${error instanceof Error ? error.message : "push send failed"}`,
          );
        }
      } else {
        alertState[alert.id] = {
          signature,
          lastTriggeredAt: state?.lastTriggeredAt,
          lastEvaluatedAt: now,
          oneTimeFired: state?.oneTimeFired,
        };
      }

      lastPrices[alert.symbol] = price.current;
    }

    await updatePushDevice(device.token, { lastPrices, alertState });
  }

  return result;
}
