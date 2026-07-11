import type { PushAlertCondition } from "@/types/pushAlerts";
import {
  isFreshMt5Tick,
  mt5ChartPrice,
} from "@/services/market-data/mt5Price";
import {
  alertArmingRevision,
  findPriceConditionTrigger,
  previousPriceForRevision,
} from "@/services/alertConditions";
import type { PushDeviceRecord, ServerPushAlert } from "@/types/pushAlerts";
import { firebaseAdminConfigured, sendFirebasePush } from "./firebaseAdmin";
import { sendUserIntegrationNotifications } from "./externalNotifications";
import { listPushDevices, updatePushDevice } from "./pushAlertStore";

const RECURRING_REARM_MS = 60_000;
const MT5_TICK_REPLAY_LOOKBACK_MS = 10 * 60_000;

interface EvaluationResult {
  devices: number;
  alerts: number;
  triggered: number;
  skipped: number;
  errors: string[];
  debug?: AlertEvaluationDebug[];
}

interface AlertEvaluationDebug {
  token: string;
  alertId: string;
  symbol: string;
  condition: PushAlertCondition;
  target: number;
  prev?: number;
  current?: number;
  open?: number;
  high?: number;
  low?: number;
  since?: number;
  candles?: number;
  met?: boolean;
  skipped?: string;
  blocked?: string;
  messageId?: string;
  external?: Array<{ channel: string; ok: boolean; error?: string }>;
}

interface PriceSnapshot {
  current: number;
  ticks: Array<{ price: number; timestamp: number }>;
  open?: number;
  high?: number;
  low?: number;
  candles?: unknown[];
}

export function alertSignature(alert: ServerPushAlert): string {
  return alertArmingRevision(
    alert.condition,
    alert.symbol,
    alert.price,
    alert.recurring,
    alert.updatedAt,
  );
}

const CONDITION_SYMBOL: Record<PushAlertCondition, string> = {
  above: ">=",
  below: "<=",
  crossUp: "crosses above",
  crossDown: "crosses below",
};

function formatAlert(alert: ServerPushAlert, triggerPrice: number) {
  const op = CONDITION_SYMBOL[alert.condition];
  return {
    title: `${alert.symbol} alert`,
    body: `${alert.symbol} ${op} ${alert.price} - now ${triggerPrice}${alert.note ? ` - ${alert.note}` : ""}`,
  };
}

async function fetchMt5Price(symbol: string): Promise<PriceSnapshot | undefined> {
  const configuredBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const apiBase = (configuredBase || "http://localhost:8080").replace(/\/+$/, "");
  const res = await fetch(
    `${apiBase}/api/v1/mt5/ticks?symbols=${encodeURIComponent(symbol)}&since=${Date.now() - MT5_TICK_REPLAY_LOOKBACK_MS}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(`MT5 ticks request failed (${res.status} ${res.statusText})`);
  }
  const body = (await res.json()) as {
    connected?: boolean;
    ticks?: Array<{
      symbol?: string;
      bid?: number;
      ask?: number;
      timestamp?: number;
      time_msc?: number;
      received_at?: number;
    }>;
  };
  if (body.connected === false) return undefined;
  const normalized = symbol.trim().toUpperCase();
  const ticks = (body.ticks ?? [])
    .filter((item) => item.symbol?.trim().toUpperCase() === normalized)
    .map((item) => ({
      price: mt5ChartPrice(Number(item.bid), Number(item.ask)),
      timestamp:
        Number(item.received_at) ||
        Number(item.time_msc) ||
        Number(item.timestamp) * 1000,
    }))
    .filter(
      (item): item is { price: number; timestamp: number } =>
        item.price !== undefined && Number.isFinite(item.timestamp),
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  const latest = ticks[ticks.length - 1];
  if (!latest || !isFreshMt5Tick(latest.timestamp)) return undefined;
  return { current: latest.price, ticks };
}

async function fetchCurrentPrice(symbol: string): Promise<PriceSnapshot | undefined> {
  // The runtime catalog and chart are MT5-backed. Never silently evaluate an
  // MT5 alert against OANDA/TwelveData: small feed and spread differences can
  // report a crossing that never appeared on the chart.
  return fetchMt5Price(symbol);
}

function shouldEvaluate(device: PushDeviceRecord, alert: ServerPushAlert) {
  const signature = alertSignature(alert);
  const state = device.alertState[alert.id];
  if (!state || state.signature !== signature) return { signature };
  return { signature, state };
}

// Serializes evaluate calls within this process: the in-process worker's
// setInterval and an overlapping manual/cron call otherwise both read
// Firestore before either write lands, sending the same trigger twice.
let inFlight: Promise<EvaluationResult> | null = null;

export function evaluatePushAlerts(
  options: { debug?: boolean } = {},
): Promise<EvaluationResult> {
  if (inFlight) return inFlight;
  const run = runEvaluation(options).finally(() => {
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
}

async function runEvaluation(
  options: { debug?: boolean },
): Promise<EvaluationResult> {
  const result: EvaluationResult = {
    devices: 0,
    alerts: 0,
    triggered: 0,
    skipped: 0,
    errors: [],
  };
  if (options.debug) result.debug = [];

  const canSendFirebase = firebaseAdminConfigured();

  const devices = await listPushDevices();
  result.devices = devices.length;

  const symbols = new Set<string>();
  for (const device of devices) {
    if (
      !device.settingsPush &&
      !device.settingsTelegram &&
      !device.settingsDiscord
    ) {
      continue;
    }
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
    if (
      (!device.settingsPush &&
        !device.settingsTelegram &&
        !device.settingsDiscord) ||
      device.alerts.length === 0
    ) {
      continue;
    }
    const lastPrices = { ...device.lastPrices };
    const previousPrices = { ...device.lastPrices };
    const alertState = { ...device.alertState };

    for (const alert of device.alerts) {
      result.alerts += 1;
      const price = prices[alert.symbol];
      if (price === undefined) {
        result.skipped += 1;
        result.debug?.push({
          token: device.token.slice(-8),
          alertId: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          target: alert.price,
          skipped: "price unavailable",
        });
        continue;
      }

      const { signature, state } = shouldEvaluate(device, alert);
      const sameAlertState = state?.signature === signature;
      const since =
        sameAlertState && state?.lastEvaluatedAt !== undefined
          ? state.lastEvaluatedAt
          : alert.updatedAt;
      const prev = previousPriceForRevision(
        signature,
        state?.signature,
        previousPrices[alert.symbol],
      );
      const oneTimeFired = state?.oneTimeFired && !alert.recurring;
      const rearmBlocked =
        alert.recurring &&
        state?.lastTriggeredAt !== undefined &&
        now - state.lastTriggeredAt < RECURRING_REARM_MS;
      const replayTicks = price.ticks.filter((tick) => tick.timestamp > since);
      const matchedTick = findPriceConditionTrigger(
        alert.condition,
        alert.price,
        prev,
        replayTicks,
      );
      const met = matchedTick !== undefined;
      const evaluatedThrough = price.ticks[price.ticks.length - 1]?.timestamp ?? now;

      const debugEntry: AlertEvaluationDebug = {
        token: device.token.slice(-8),
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        target: alert.price,
        prev,
        current: price.current,
        since,
        candles: replayTicks.length,
        met,
        blocked: oneTimeFired
          ? "one-time fired"
          : rearmBlocked
            ? "recurring rearm"
            : undefined,
      };
      result.debug?.push(debugEntry);

      if (!oneTimeFired && !rearmBlocked && matchedTick) {
        const triggerPrice = matchedTick.price;
        const triggeredAt = matchedTick.timestamp;
        const message = formatAlert(alert, triggerPrice);
        let deliverySucceeded = false;

        try {
          if (device.settingsPush && alert.push && canSendFirebase) {
            const messageId = await sendFirebasePush({
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
            debugEntry.messageId = messageId;
            deliverySucceeded = true;
          } else if (device.settingsPush && alert.push && !canSendFirebase) {
            result.errors.push("Firebase Admin is not configured.");
          }
        } catch (error) {
          result.errors.push(
            `${alert.symbol}/${alert.id}: ${error instanceof Error ? error.message : "push send failed"}`,
          );
        }

        const externalResults = await sendUserIntegrationNotifications(
          device.deliveryToken,
          {
            alertId: alert.id,
            symbol: alert.symbol,
            condition: alert.condition,
            targetPrice: alert.price,
            triggerPrice,
            note: alert.note,
            triggeredAt,
            source: "closed-browser-worker",
          },
          {
            telegram: device.settingsTelegram && alert.telegram,
            discord: device.settingsDiscord && alert.discord,
          },
        );
        if (externalResults.length > 0) {
          debugEntry.external = externalResults;
          deliverySucceeded ||= externalResults.some((item) => item.ok);
          for (const item of externalResults) {
            if (!item.ok) {
              result.errors.push(
                `${alert.symbol}/${alert.id}/${item.channel}: ${item.error ?? "external send failed"}`,
              );
            }
          }
        }

        if (deliverySucceeded) {
          result.triggered += 1;
          alertState[alert.id] = {
            signature,
            lastTriggeredAt: triggeredAt,
            lastEvaluatedAt: evaluatedThrough,
            oneTimeFired: !alert.recurring,
            triggerPrice,
          };
        } else {
          alertState[alert.id] = {
            signature,
            lastTriggeredAt: state?.lastTriggeredAt,
            lastEvaluatedAt: evaluatedThrough,
            triggerPrice: state?.triggerPrice,
            oneTimeFired: state?.oneTimeFired,
          };
        }
      } else {
        alertState[alert.id] = {
          signature,
          lastTriggeredAt: state?.lastTriggeredAt,
          lastEvaluatedAt: evaluatedThrough,
          oneTimeFired: state?.oneTimeFired,
          triggerPrice: state?.triggerPrice,
        };
      }

      lastPrices[alert.symbol] = price.current;
    }

    await updatePushDevice(device.token, { lastPrices, alertState });
  }

  return result;
}
