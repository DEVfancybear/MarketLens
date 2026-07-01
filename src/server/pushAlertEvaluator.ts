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
  curr: number,
): boolean {
  switch (condition) {
    case "above":
      return curr >= target;
    case "below":
      return curr <= target;
    case "crossUp":
      return prev !== undefined && prev < target && curr >= target;
    case "crossDown":
      return prev !== undefined && prev > target && curr <= target;
  }
}

function formatAlert(alert: ServerPushAlert, triggerPrice: number) {
  const op = CONDITION_SYMBOL[alert.condition];
  return {
    title: `${alert.symbol} alert`,
    body: `${alert.symbol} ${op} ${alert.price} - now ${triggerPrice}${alert.note ? ` - ${alert.note}` : ""}`,
  };
}

async function fetchBinancePrice(symbol: string): Promise<number | undefined> {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return undefined;
  const body = (await res.json()) as { price?: string };
  const price = Number(body.price);
  return Number.isFinite(price) ? price : undefined;
}

async function fetchOandaPrice(symbol: string): Promise<number | undefined> {
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
  if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
  return undefined;
}

async function fetchTwelveDataPrice(symbol: string): Promise<number | undefined> {
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
  return Number.isFinite(price) ? price : undefined;
}

async function fetchCurrentPrice(symbol: string): Promise<number | undefined> {
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

  const prices: Record<string, number> = {};
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
      const current = prices[alert.symbol];
      if (current === undefined) {
        result.skipped += 1;
        continue;
      }

      const { signature, state } = shouldEvaluate(device, alert);
      const prev = lastPrices[alert.symbol];
      const oneTimeFired = state?.oneTimeFired && !alert.recurring;
      const rearmBlocked =
        alert.recurring &&
        state?.lastTriggeredAt !== undefined &&
        now - state.lastTriggeredAt < RECURRING_REARM_MS;

      if (!oneTimeFired && !rearmBlocked && conditionMet(alert.condition, alert.price, prev, current)) {
        const message = formatAlert(alert, current);
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
              triggerPrice: String(current),
              source: "server-worker",
            },
          });
          result.triggered += 1;
          alertState[alert.id] = {
            signature,
            lastTriggeredAt: now,
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
          oneTimeFired: state?.oneTimeFired,
        };
      }

      lastPrices[alert.symbol] = current;
    }

    await updatePushDevice(device.token, { lastPrices, alertState });
  }

  return result;
}
