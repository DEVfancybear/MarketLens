import type { PushAlertCondition } from "@/types/pushAlerts";
import {
  isFreshMt5Tick,
} from "@/services/market-data/mt5Price";
import { normalizeMt5AlertTicks } from "@/services/market-data/mt5AlertTicks";
import {
  alertArmingRevision,
  findPriceConditionMatch,
  previousPriceForRevision,
} from "@/services/alertConditions";
import {
  findTechnicalAlertTrigger,
  orderedTechnicalPricePoints,
  targetAt,
  technicalTargetSignature,
} from "@/services/dynamicAlertTargets";
import type {
  PendingPushAlertDelivery,
  PendingPushAlertTrigger,
  PushDeviceRecord,
  ServerPushAlert,
} from "@/types/pushAlerts";
import type { TechnicalAlertEvidence } from "@/types/technicalAlerts";
import {
  alertConditionLabel,
  formatAlertNotificationMessage,
} from "@/services/notifications/alertMessage";
import { firebaseAdminConfigured, sendFirebasePush } from "./firebaseAdmin";
import { sendUserIntegrationNotifications } from "./externalNotifications";
import { listPushDevices, updatePushDevice } from "./pushAlertStore";
import { acknowledgeCanonicalAlertTrigger } from "./canonicalAlertTrigger";
import { persistBeforeNotification } from "./pushAlertLifecycle";
import {
  createPendingPushAlertDelivery,
  externalAlertDeliveryKey,
} from "./pushAlertDeliveryPolicy";

const RECURRING_REARM_MS = 60_000;
const MT5_TICK_REPLAY_LOOKBACK_MS = 10 * 60_000;

interface EvaluationResult {
  devices: number;
  alerts: number;
  triggered: number;
  expired: number;
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
  ticks: Array<{ price: number; timestamp: number; receivedAt: number }>;
  receivedThrough: number;
  open?: number;
  high?: number;
  low?: number;
  candles?: unknown[];
}

type PushAlertState = PushDeviceRecord["alertState"][string];
type ExternalChannel = "telegram" | "discord";
type ExternalDeliveryResult = {
  channel: ExternalChannel;
  ok: boolean;
  error?: string;
};
type ExternalDeliveryCache = Map<string, Promise<ExternalDeliveryResult>>;

export function alertSignature(alert: ServerPushAlert): string {
  return `${alertArmingRevision(
    alert.condition,
    alert.symbol,
    alert.price,
    alert.recurring,
    alert.armingRevision,
  )}:${technicalTargetSignature(alert.technicalTarget)}`;
}

async function deliverExternalOnce({
  cache,
  channel,
  device,
  alert,
  delivery,
}: {
  cache: ExternalDeliveryCache;
  channel: ExternalChannel;
  device: PushDeviceRecord;
  alert: ServerPushAlert;
  delivery: PendingPushAlertDelivery;
}): Promise<ExternalDeliveryResult> {
  const key = externalAlertDeliveryKey(delivery.eventId, channel);
  const existing = cache.get(key);
  if (existing) return existing;

  const work = sendUserIntegrationNotifications(
    device.deliveryToken,
    {
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      conditionLabel: alertConditionLabel(alert.condition, alert.technicalTarget),
      targetPrice: delivery.candidate.targetPrice,
      triggerPrice: delivery.candidate.triggerPrice,
      note: alert.note,
      triggeredAt: delivery.candidate.triggeredAt,
      timeZone:
        delivery.notificationTimeZone ??
        device.notificationTimeZone ??
        "UTC",
      source: "closed-browser-worker",
    },
    {
      telegram: channel === "telegram",
      discord: channel === "discord",
    },
  )
    .then((items): ExternalDeliveryResult => {
      const item = items.find((candidate) => candidate.channel === channel);
      return item
        ? { channel, ok: item.ok, error: item.error }
        : { channel, ok: false, error: `${channel} returned no delivery result` };
    })
    .catch((error): ExternalDeliveryResult => ({
      channel,
      ok: false,
      error: error instanceof Error ? error.message : `${channel} send failed`,
    }));
  cache.set(key, work);
  const outcome = await work;
  if (!outcome.ok && cache.get(key) === work) cache.delete(key);
  return outcome;
}

async function deliverTriggerNotifications({
  device,
  alert,
  delivery,
  canSendFirebase,
  debugEntry,
  result,
  externalCache,
}: {
  device: PushDeviceRecord;
  alert: ServerPushAlert;
  delivery: PendingPushAlertDelivery;
  canSendFirebase: boolean;
  debugEntry: AlertEvaluationDebug;
  result: EvaluationResult;
  externalCache: ExternalDeliveryCache;
}): Promise<PendingPushAlertDelivery | undefined> {
  const { candidate } = delivery;
  const message = formatAlertNotificationMessage({
    symbol: alert.symbol,
    condition: alert.condition,
    technicalTarget: alert.technicalTarget,
    targetPrice: candidate.targetPrice,
    triggerPrice: candidate.triggerPrice,
    triggeredAt: candidate.triggeredAt,
    timeZone:
      delivery.notificationTimeZone ??
      device.notificationTimeZone ??
      "UTC",
    note: alert.note,
    source: "closed-browser-worker",
  });
  let push = delivery.push;
  let telegram = delivery.telegram;
  let discord = delivery.discord;

  if (push) {
    try {
      if (!canSendFirebase) throw new Error("Firebase Admin is not configured.");
      debugEntry.messageId = await sendFirebasePush({
        token: device.token,
        title: message.title,
        body: message.body,
        data: {
          alertId: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          targetPrice: String(candidate.targetPrice),
          triggerPrice: String(candidate.triggerPrice),
          triggeredAt: String(candidate.triggeredAt),
          timeZone:
            delivery.notificationTimeZone ??
            device.notificationTimeZone ??
            "UTC",
          source: "server-worker",
        },
      });
      push = false;
    } catch (error) {
      result.errors.push(
        `${alert.symbol}/${alert.id}/push: ${error instanceof Error ? error.message : "push send failed"}`,
      );
    }
  }

  const externalResults: ExternalDeliveryResult[] = [];
  for (const channel of ["telegram", "discord"] as const) {
    if (channel === "telegram" ? !telegram : !discord) continue;
    const item = await deliverExternalOnce({
      cache: externalCache,
      channel,
      device,
      alert,
      delivery,
    });
    externalResults.push(item);
    if (item.ok) {
      if (channel === "telegram") telegram = false;
      else discord = false;
    }
    if (!item.ok) {
      result.errors.push(
        `${alert.symbol}/${alert.id}/${item.channel}: ${item.error ?? "external send failed"}`,
      );
    }
  }
  if (externalResults.length > 0) {
    debugEntry.external = [
      ...(debugEntry.external ?? []),
      ...externalResults,
    ];
  }

  return push || telegram || discord
    ? { ...delivery, push, telegram, discord }
    : undefined;
}

function committedAlertState(
  base: PushAlertState | undefined,
  signature: string,
  alert: ServerPushAlert,
  candidate: PendingPushAlertTrigger,
  pendingDelivery?: PendingPushAlertDelivery,
): PushAlertState {
  return {
    signature,
    lastTriggeredAt: candidate.triggeredAt,
    lastEvaluatedAt: base?.lastEvaluatedAt ?? candidate.triggeredAt,
    oneTimeFired: !alert.recurring,
    triggerPrice: candidate.triggerPrice,
    targetPrice: candidate.targetPrice,
    lastMarketTimestamp:
      base?.lastMarketTimestamp ?? candidate.triggerEvidence.current.timestamp * 1000,
    triggerEvidence: candidate.triggerEvidence,
    pendingDelivery,
    expiredAt: base?.expiredAt,
  };
}

function epochSeconds(value: number): number {
  return value >= 100_000_000_000 ? value / 1000 : value;
}

function epochMillis(value: number): number {
  return value >= 100_000_000_000 ? value : value * 1000;
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
  const receivedTicks = normalizeMt5AlertTicks(body.ticks ?? [], symbol);
  const receivedLatest = receivedTicks[receivedTicks.length - 1];
  if (!receivedLatest || !isFreshMt5Tick(receivedLatest.receivedAt)) return undefined;
  const ticks = orderedTechnicalPricePoints(undefined, receivedTicks);
  const latest = ticks[ticks.length - 1];
  if (!latest) return undefined;
  return {
    current: latest.price,
    ticks,
    receivedThrough: receivedLatest.receivedAt,
  };
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
    expired: 0,
    skipped: 0,
    errors: [],
  };
  if (options.debug) result.debug = [];

  const canSendFirebase = firebaseAdminConfigured();
  const externalCache: ExternalDeliveryCache = new Map();

  const devices = await listPushDevices();
  result.devices = devices.length;

  const symbols = new Set<string>();
  for (const device of devices) {
    if (
      !device.deliveryToken ||
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
    const alertsForDevice = [...device.alerts];
    const activeIds = new Set(alertsForDevice.map((alert) => alert.id));
    for (const state of Object.values(device.alertState)) {
      const retained = state.pendingDelivery?.alert;
      if (retained && !activeIds.has(retained.id)) {
        alertsForDevice.push(retained);
        activeIds.add(retained.id);
      }
    }
    const hasPendingDelivery = alertsForDevice.some(
      (alert) => device.alertState[alert.id]?.pendingDelivery !== undefined,
    );
    if (
      ((!device.settingsPush &&
        !device.settingsTelegram &&
        !device.settingsDiscord) &&
        !hasPendingDelivery) ||
      alertsForDevice.length === 0
    ) {
      continue;
    }
    if (!device.deliveryToken) {
      result.skipped += alertsForDevice.length;
      result.errors.push(
        `${device.token.slice(-8)}: closed-browser alerts skipped because the signed delivery token is missing.`,
      );
      continue;
    }
    const lastPrices = { ...device.lastPrices };
    const previousPrices = { ...device.lastPrices };
    const alertState = { ...device.alertState };

    for (const alert of alertsForDevice) {
      result.alerts += 1;
      const { signature, state } = shouldEvaluate(device, alert);
      if (state?.canonicalRejectedAt !== undefined) {
        result.skipped += 1;
        result.debug?.push({
          token: device.token.slice(-8),
          alertId: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          target: alert.price,
          skipped: state.canonicalRejectedReason ?? "canonical trigger rejected",
        });
        continue;
      }
      const pendingTrigger = state?.pendingTrigger;
      if (pendingTrigger) {
        const debugEntry: AlertEvaluationDebug = {
          token: device.token.slice(-8),
          alertId: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          target: pendingTrigger.targetPrice,
          current: pendingTrigger.triggerPrice,
          met: true,
          blocked: "pending canonical persistence",
        };
        result.debug?.push(debugEntry);
        const retry = await persistBeforeNotification(
          () =>
            acknowledgeCanonicalAlertTrigger(
              device.deliveryToken,
              alert,
              pendingTrigger,
            ),
          (canonical) => {
            const delivery = createPendingPushAlertDelivery(
              canonical.eventId,
              device,
              alert,
              pendingTrigger,
            );
            return delivery
              ? deliverTriggerNotifications({
                  device,
                  alert,
                  delivery,
                  canSendFirebase,
                  debugEntry,
                  result,
                  externalCache,
                })
              : Promise.resolve(undefined);
          },
        );
        if (!retry.committed) {
          result.skipped += 1;
          result.errors.push(
            `${alert.symbol}/${alert.id}: ${retry.persistenceError}`,
          );
          alertState[alert.id] = retry.retryable
            ? { ...state, signature, pendingTrigger }
            : {
                ...state,
                signature,
                pendingTrigger: undefined,
                canonicalRejectedAt: now,
                canonicalRejectedReason: retry.persistenceError,
              };
          continue;
        }
        if (!retry.canonical.alreadyTriggered) result.triggered += 1;
        if (retry.notificationError) {
          result.errors.push(
            `${alert.symbol}/${alert.id}: ${retry.notificationError}`,
          );
        }
        alertState[alert.id] = committedAlertState(
          state,
          signature,
          alert,
          pendingTrigger,
          retry.notificationError
            ? createPendingPushAlertDelivery(
                retry.canonical.eventId,
                device,
                alert,
                pendingTrigger,
              )
            : retry.notification,
        );
        continue;
      }

      const pendingDelivery = state?.pendingDelivery;
      if (pendingDelivery) {
        const debugEntry: AlertEvaluationDebug = {
          token: device.token.slice(-8),
          alertId: alert.id,
          symbol: alert.symbol,
          condition: alert.condition,
          target: pendingDelivery.candidate.targetPrice,
          current: pendingDelivery.candidate.triggerPrice,
          met: true,
          blocked: "pending notification delivery",
        };
        result.debug?.push(debugEntry);
        const remaining = await deliverTriggerNotifications({
          device,
          alert,
          delivery: pendingDelivery,
          canSendFirebase,
          debugEntry,
          result,
          externalCache,
        });
        if (!remaining && !device.alerts.some((item) => item.id === alert.id)) {
          delete alertState[alert.id];
        } else {
          alertState[alert.id] = { ...state, pendingDelivery: remaining };
        }
        if (remaining) result.skipped += 1;
        continue;
      }

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
      const replayTicks = orderedTechnicalPricePoints(
        state?.lastMarketTimestamp,
        price.ticks.filter((tick) => tick.receivedAt > since),
      );
      const matchedTechnical = alert.technicalTarget
        ? findTechnicalAlertTrigger(
            alert.condition,
            alert.technicalTarget,
            prev === undefined || state?.lastMarketTimestamp === undefined
              ? undefined
              : { price: prev, timestamp: state.lastMarketTimestamp },
            replayTicks,
          )
        : undefined;
      const matchedLegacy = alert.technicalTarget
        ? undefined
        : findPriceConditionMatch(
            alert.condition,
            alert.price,
            prev === undefined || state?.lastMarketTimestamp === undefined
              ? undefined
              : { price: prev, timestamp: state.lastMarketTimestamp },
            replayTicks,
          );
      const matchedTick = matchedTechnical?.point ?? matchedLegacy?.point;
      const matchedTargetPrice = matchedTechnical?.targetPrice ?? alert.price;
      const triggerEvidence: TechnicalAlertEvidence | undefined = matchedTick
        ? matchedTechnical?.evidence ?? {
            ...(matchedLegacy?.previous && Number.isFinite(matchedLegacy.previous.timestamp)
              ? {
                  previous: {
                    price: matchedLegacy.previous.price,
                    timestamp: epochSeconds(matchedLegacy.previous.timestamp),
                  },
                }
              : {}),
            current: {
              price: matchedTick.price,
              timestamp: epochSeconds(matchedTick.timestamp),
            },
          }
        : undefined;
      const met = matchedTick !== undefined;
      const finalTick = replayTicks[replayTicks.length - 1];
      const evaluatedThrough = price.receivedThrough;
      const lastMarketTimestamp = finalTick?.timestamp ?? state?.lastMarketTimestamp;
      const acceptedCurrent = finalTick?.price ?? previousPrices[alert.symbol] ?? price.current;
      const finalTarget = alert.technicalTarget && finalTick
        ? targetAt(alert.technicalTarget, finalTick.timestamp)
        : undefined;
      const expiredAt = finalTarget && !finalTarget.active && finalTarget.reason === "expired"
        ? epochMillis(finalTick!.timestamp)
        : state?.expiredAt;
      const alreadyExpired = state?.expiredAt !== undefined;
      if (!alreadyExpired && expiredAt !== undefined) result.expired += 1;

      const debugEntry: AlertEvaluationDebug = {
        token: device.token.slice(-8),
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        target: alert.price,
        prev,
        current: acceptedCurrent,
        since,
        candles: replayTicks.length,
        met,
        blocked: oneTimeFired
          ? "one-time fired"
          : alreadyExpired
            ? "expired"
          : rearmBlocked
            ? "recurring rearm"
            : undefined,
      };
      result.debug?.push(debugEntry);

      if (
        !oneTimeFired &&
        !alreadyExpired &&
        !rearmBlocked &&
        matchedTick &&
        triggerEvidence
      ) {
        const candidate: PendingPushAlertTrigger = {
          triggerPrice: matchedTick.price,
          targetPrice: matchedTargetPrice,
          triggeredAt: epochMillis(matchedTick.timestamp),
          triggerEvidence,
        };
        const cursorState: PushAlertState = {
          signature,
          lastTriggeredAt: state?.lastTriggeredAt,
          lastEvaluatedAt: evaluatedThrough,
          triggerPrice: state?.triggerPrice,
          targetPrice: state?.targetPrice,
          lastMarketTimestamp,
          oneTimeFired: state?.oneTimeFired,
          triggerEvidence: state?.triggerEvidence,
          expiredAt,
        };
        const attempt = await persistBeforeNotification(
          () =>
            acknowledgeCanonicalAlertTrigger(
              device.deliveryToken,
              alert,
              candidate,
            ),
          (canonical) => {
            const delivery = createPendingPushAlertDelivery(
              canonical.eventId,
              device,
              alert,
              candidate,
            );
            return delivery
              ? deliverTriggerNotifications({
                  device,
                  alert,
                  delivery,
                  canSendFirebase,
                  debugEntry,
                  result,
                  externalCache,
                })
              : Promise.resolve(undefined);
          },
        );
        if (!attempt.committed) {
          result.skipped += 1;
          result.errors.push(
            `${alert.symbol}/${alert.id}: ${attempt.persistenceError}`,
          );
          alertState[alert.id] = attempt.retryable
            ? { ...cursorState, pendingTrigger: candidate }
            : {
                ...cursorState,
                pendingTrigger: undefined,
                canonicalRejectedAt: now,
                canonicalRejectedReason: attempt.persistenceError,
              };
        } else {
          if (!attempt.canonical.alreadyTriggered) result.triggered += 1;
          if (attempt.notificationError) {
            result.errors.push(
              `${alert.symbol}/${alert.id}: ${attempt.notificationError}`,
            );
          }
          alertState[alert.id] = committedAlertState(
            cursorState,
            signature,
            alert,
            candidate,
            attempt.notificationError
              ? createPendingPushAlertDelivery(
                  attempt.canonical.eventId,
                  device,
                  alert,
                  candidate,
                )
              : attempt.notification,
          );
        }
      } else {
        alertState[alert.id] = {
          signature,
          lastTriggeredAt: state?.lastTriggeredAt,
          lastEvaluatedAt: evaluatedThrough,
          oneTimeFired: state?.oneTimeFired,
          triggerPrice: state?.triggerPrice,
          targetPrice: state?.targetPrice,
          lastMarketTimestamp,
          triggerEvidence: state?.triggerEvidence,
          expiredAt,
        };
      }

      lastPrices[alert.symbol] = acceptedCurrent;
    }

    await updatePushDevice(device.token, { lastPrices, alertState });
  }

  return result;
}
