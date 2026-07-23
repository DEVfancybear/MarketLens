"use client";

import { useEffect, useRef } from "react";
import { getDefaultStore, useAtomValue } from "jotai";
import { getMarketDataState, marketDataTickAtom } from "@/store/marketDataStore";
import {
  useAlertStore,
  getAlertState,
  RECURRING_REARM_MS,
  type Alert,
} from "@/store/alertStore";
import { marketSymbolsAtom } from "@/store/marketSymbolStore";
import {
  normalizeAlertSymbol,
  resolveAlertSymbol,
} from "@/services/alertSymbols";
import { symbolAliasCandidates } from "@/services/market-data/symbolAliases";
import {
  alertArmingRevision,
  previousPriceForRevision,
} from "@/services/alertConditions";
import { evaluateAlert } from "@/services/alertEngine";
import { technicalTargetSignature } from "@/services/dynamicAlertTargets";
import { deliverAlert } from "@/services/notifications/notify";
import {
  BrowserAlertTriggerQueue,
  type BrowserAlertTriggerCandidate,
} from "@/services/notifications/browserAlertTriggerQueue";
import { workspaceReadyAtom } from "@/store/authStore";

function latestPrice(symbol: string): { price: number; timestamp: number } | undefined {
  const marketData = getMarketDataState();
  for (const candidate of symbolAliasCandidates(normalizeAlertSymbol(symbol))) {
    const quote = marketData.quotes[candidate];
    if (quote && Number.isFinite(quote.last) && quote.last > 0) {
      return { price: quote.last, timestamp: quote.timestamp };
    }
  }
  return undefined;
}

function revisionOf(alert: Alert): string {
  return `${alertArmingRevision(
    alert.condition,
    alert.symbol,
    alert.price,
    alert.recurring,
    alert.armingRevision ?? alert.updatedAt,
  )}:${technicalTargetSignature(alert.technicalTarget)}`;
}

/** Evaluates alert revisions only from consecutive live MT5 prices. */
export function useAlertEngine() {
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const marketSymbols = useAtomValue(marketSymbolsAtom);
  const marketCatalogKey = marketSymbols
    .map((symbol) =>
      [symbol.id, symbol.base ?? "", symbol.quote ?? ""].join(":"),
    )
    .sort()
    .join(",");
  const alertSymbolsKey = useAlertStore((state) => {
    const symbols = new Set(
      state.alerts.map((alert) => normalizeAlertSymbol(alert.symbol)),
    );
    return [...symbols].sort().join(",");
  });
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());
  const previousPriceRef = useRef<Map<string, { price: number; timestamp: number }>>(new Map());
  const revisionByAlertRef = useRef<Map<string, string>>(new Map());

  // Alerts own a ticker subscription even when their symbol is not charted or
  // watch-listed. marketDataStore reference-counts shared subscriptions.
  useEffect(() => {
    const symbols = alertSymbolsKey ? alertSymbolsKey.split(",") : [];
    const desired = new Set<string>();
    const subscribed = subscribedSymbolsRef.current;

    for (const requestedSymbol of symbols) {
      const symbol = resolveAlertSymbol(requestedSymbol, marketSymbols);
      if (!symbol) continue;
      desired.add(symbol);
      if (subscribed.has(symbol)) continue;
      getMarketDataState().subscribe({ symbol, channels: ["ticker"] });
      subscribed.add(symbol);
    }

    for (const symbol of [...subscribed]) {
      if (desired.has(symbol)) continue;
      getMarketDataState().unsubscribe(symbol);
      subscribed.delete(symbol);
      previousPriceRef.current.delete(symbol);
    }
  }, [alertSymbolsKey, marketCatalogKey, marketSymbols]);

  useEffect(() => {
    const subscribed = subscribedSymbolsRef.current;
    return () => {
      for (const symbol of subscribed) {
        getMarketDataState().unsubscribe(symbol);
      }
      subscribed.clear();
    };
  }, []);

  useEffect(() => {
    if (!workspaceReady) {
      previousPriceRef.current.clear();
      revisionByAlertRef.current.clear();
      return;
    }
    const isCurrent = (candidate: BrowserAlertTriggerCandidate): boolean => {
      const current = getAlertState().alerts.find(
        (alert) => alert.id === candidate.alertId,
      );
      return Boolean(
        current &&
          current.enabled &&
          current.status === "active" &&
          revisionOf(current) === candidate.revision,
      );
    };
    const triggerQueue = new BrowserAlertTriggerQueue<Alert>({
      isCurrent,
      attempt: async (candidate) => {
        if (!isCurrent(candidate)) return { status: "discarded" };
        return getAlertState().triggerAlert(
          candidate.alertId,
          candidate.triggerPrice,
          candidate.targetPrice,
          candidate.evidence,
        );
      },
      notify: (fired, candidate) => {
        deliverAlert(fired, candidate.triggerPrice, getAlertState().settings);
      },
    });

    const evaluate = () => {
      const { alerts, expireAlert } = getAlertState();
      if (alerts.length === 0) return;

      const now = Date.now();
      const prices = new Map<string, { price: number; timestamp: number }>();
      for (const alert of alerts) {
        const symbol = resolveAlertSymbol(alert.symbol, marketSymbols);
        if (!symbol || prices.has(symbol)) continue;
        const snapshot = latestPrice(symbol);
        if (snapshot !== undefined) prices.set(symbol, snapshot);
      }

      for (const alert of alerts) {
        if (!alert.enabled) continue;
        const symbol = resolveAlertSymbol(alert.symbol, marketSymbols);
        if (!symbol) continue;
        const current = prices.get(symbol);
        if (!current) continue;

        const revision = revisionOf(alert);
        const previous = previousPriceForRevision(
          revision,
          revisionByAlertRef.current.get(alert.id),
          previousPriceRef.current.get(symbol)?.price,
        );
        const rearmBlocked =
          alert.recurring &&
          alert.triggeredAt !== undefined &&
          now - alert.triggeredAt * 1000 < RECURRING_REARM_MS;

        const previousPoint = previousPriceRef.current.get(symbol);
        const evaluated = evaluateAlert(
          alert,
          previous,
          { current: current.price, timestamp: current.timestamp },
          previous === undefined ? undefined : previousPoint,
        );
        if (!evaluated.active && evaluated.inactiveReason === "expired") {
          expireAlert(
            alert.id,
            current.timestamp >= 100_000_000_000
              ? current.timestamp
              : current.timestamp * 1000,
          );
          revisionByAlertRef.current.delete(alert.id);
          continue;
        }
        if (!rearmBlocked && evaluated.triggered) {
          triggerQueue.enqueue({
            alertId: alert.id,
            revision,
            triggerPrice: current.price,
            targetPrice: evaluated.targetPrice ?? alert.price,
            evidence: evaluated.evidence,
          });
        }
        revisionByAlertRef.current.set(alert.id, revision);
      }

      const activeIds = new Set(alerts.map((alert) => alert.id));
      for (const id of revisionByAlertRef.current.keys()) {
        if (!activeIds.has(id)) revisionByAlertRef.current.delete(id);
      }
      for (const [symbol, snapshot] of prices) {
        previousPriceRef.current.set(symbol, snapshot);
      }
    };

    evaluate();
    const unsubscribe = getDefaultStore().sub(marketDataTickAtom, evaluate);
    return () => {
      unsubscribe();
      triggerQueue.dispose();
    };
  }, [marketCatalogKey, marketSymbols, workspaceReady]);
}
