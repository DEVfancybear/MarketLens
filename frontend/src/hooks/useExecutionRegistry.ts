"use client";

import { useEffect } from "react";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import {
  getExecutionAccountState,
  getExecutionAccounts,
  getExecutionInstruments,
  routeExecutionOrder,
  submitExecutionCommand,
} from "@/services/api/resources/executionApi";
import { projectExecutionInstrumentsToMt5Symbols } from "@/services/execution/instrumentProjection";
import { buildExecutionOrderRequest } from "@/services/execution/orderRouting";
import {
  buildCancelOrderCommand,
  buildClosePositionCommand,
  buildModifyPositionCommand,
} from "@/services/execution/lifecycleCommands";
import { setExecutionRuntimeHandlers } from "@/services/execution/runtime";
import {
  applyExecutionAccountsAtom,
  copyTargetsAtom,
  executionAccountsAtom,
  selectedExecutionAccountAtom,
} from "@/store/executionRegistryStore";
import {
  addMt5LogAtom,
  mt5AccountAtom,
  mt5LastHeartbeatAtom,
  mt5PendingCommandsAtom,
  mt5PendingOrdersAtom,
  mt5PositionsAtom,
  mt5StatusAtom,
  mt5SymbolInfoAtom,
} from "@/store/mt5Store";
import { pushToastAtom } from "@/store/toastStore";
import {
  backendSessionAtom,
  backendSessionResolvedAtom,
} from "@/store/authStore";
import type {
  Mt5CancelRequest,
  Mt5CloseAllRequest,
  Mt5CloseRequest,
  Mt5ModifyRequest,
  Mt5OrderRequest,
} from "@/types/mt5";

const REFRESH_INTERVAL_MS = 2_000;
const STATE_REFRESH_INTERVAL_MS = 2_000;

/** Hydrates the broker-neutral account registry through the authenticated BFF. */
export function useExecutionRegistry() {
  const applyAccounts = useSetAtom(applyExecutionAccountsAtom);
  const selected = useAtomValue(selectedExecutionAccountAtom);
  const setMt5Account = useSetAtom(mt5AccountAtom);
  const setMt5Status = useSetAtom(mt5StatusAtom);
  const setLastHeartbeat = useSetAtom(mt5LastHeartbeatAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const backendSessionResolved = useAtomValue(backendSessionResolvedAtom);

  useEffect(() => {
    // Auth bootstrap and the execution registry mount together. Wait for the
    // httpOnly backend session instead of creating an avoidable initial 401.
    if (!backendSessionResolved || !backendSession) return;
    let cancelled = false;
    let running = false;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const accounts = await getExecutionAccounts();
        if (!cancelled) applyAccounts(accounts);
      } catch {
        // Preserve the last known registry during a transient BFF/gateway
        // outage. Account freshness drives status below; no order is unlocked
        // merely because a previous fetch succeeded.
      } finally {
        running = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyAccounts, backendSession, backendSessionResolved]);

  useEffect(() => {
    if (!selected || selected.venueKind !== "metatrader5") {
      setMt5Account(null);
      setMt5Status("disabled");
      setLastHeartbeat(null);
      return;
    }
    const updatedAt = selected.updatedAt ?? 0;
    const fresh = Date.now() - updatedAt < 30_000;
    const connected = backendSession && selected.status === "ready" && fresh;
    setMt5Status(connected ? "connected" : selected.status === "offline" ? "disconnected" : "stale");
    setLastHeartbeat(updatedAt || null);
    setMt5Account({
      accountId: selected.id,
      broker: selected.brokerCode,
      server: selected.server ?? "",
      mode:
        selected.mode === "live" || selected.mode === "demo"
          ? selected.mode
          : "unknown",
      currency: selected.currency,
      balance: selected.balance ?? 0,
      equity: selected.equity ?? 0,
      margin: 0,
      freeMargin: 0,
      leverage: 0,
      tradeAllowed: connected && selected.tradeAllowed,
      updatedAt,
    });
  }, [
    backendSession,
    selected,
    setLastHeartbeat,
    setMt5Account,
    setMt5Status,
  ]);

  useEffect(() => {
    const store = getDefaultStore();
    store.set(mt5SymbolInfoAtom, {});
    if (
      !backendSession ||
      !selected ||
      selected.venueKind !== "metatrader5"
    ) {
      return;
    }
    let cancelled = false;
    let running = false;
    const accountId = selected.id;
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const registry = await getExecutionInstruments(accountId);
        if (cancelled || registry.accountId !== accountId) return;
        store.set(
          mt5SymbolInfoAtom,
          projectExecutionInstrumentsToMt5Symbols(registry),
        );
      } catch {
        // Preserve the current account's last safe catalog during a transient
        // read outage. Account changes clear it before any new request starts.
      } finally {
        running = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [backendSession, selected]);

  useEffect(() => {
    const store = getDefaultStore();
    if (
      !backendSession ||
      !selected ||
      selected.venueKind !== "metatrader5"
    ) {
      store.set(mt5PositionsAtom, []);
      store.set(mt5PendingOrdersAtom, []);
      return;
    }
    let cancelled = false;
    let running = false;
    const mountedAt = Date.now();
    const seenOutcomeKeys = new Set<string>();
    store.set(mt5PositionsAtom, []);
    store.set(mt5PendingOrdersAtom, []);
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const state = await getExecutionAccountState(selected.id);
        if (cancelled || state.accountId !== selected.id) return;
        store.set(
          mt5PositionsAtom,
          state.positions.map((position) => ({
            ticket: position.brokerPositionId,
            symbol: position.canonicalSymbol,
            brokerSymbol: position.venueSymbol,
            side: position.side === "buy" ? ("long" as const) : ("short" as const),
            volume: wireNumber(position.quantity),
            openPrice: wireNumber(position.openPrice),
            currentPrice: wireNumber(position.currentPrice),
            ...(position.stopLoss != null
              ? { sl: wireNumber(position.stopLoss) }
              : {}),
            ...(position.takeProfit != null
              ? { tp: wireNumber(position.takeProfit) }
              : {}),
            profit: wireNumber(position.profit),
            swap: wireNumber(position.swap),
            commission: wireNumber(position.commission),
            magic: position.magic,
            comment: position.comment,
            openedAt: position.openedAtMs,
            updatedAt: position.observedAtMs,
          })),
        );
        store.set(
          mt5PendingOrdersAtom,
          state.pendingOrders.map((order) => ({
            ticket: order.brokerOrderId,
            symbol: order.canonicalSymbol,
            brokerSymbol: order.venueSymbol,
            side: order.side,
            type: order.kind,
            volume: wireNumber(order.quantity),
            price: wireNumber(order.price),
            ...(order.stopLoss != null
              ? { sl: wireNumber(order.stopLoss) }
              : {}),
            ...(order.takeProfit != null
              ? { tp: wireNumber(order.takeProfit) }
              : {}),
            createdAt: order.createdAtMs,
            updatedAt: order.observedAtMs,
          })),
        );
        const outcomes = state.commandOutcomes ?? [];
        store.set(mt5PendingCommandsAtom, (commands) =>
          commands.map((command) => {
            const related = outcomes.filter(
              (outcome) =>
                outcome.commandId === command.id ||
                outcome.parentCommandId === command.id ||
                outcome.parentCommandId.startsWith(`${command.id}:`),
            );
            if (related.length === 0) return command;
            const successful = related.filter((outcome) =>
              ["accepted", "filled", "cancelled"].includes(outcome.status),
            ).length;
            const failed = related.filter((outcome) =>
              ["failed", "rejected"].includes(outcome.status),
            ).length;
            const unknown = related.some(
              (outcome) => outcome.status === "unknown",
            );
            const nonterminal = related.some((outcome) =>
              ["ready", "queued", "submitted"].includes(outcome.status),
            );
            const status =
              failed > 0 && successful > 0
                ? "partial"
                : failed > 0
                  ? "rejected"
                  : unknown
                    ? "unknown"
                    : successful > 0 && !nonterminal
                      ? "acked"
                      : "sent";
            return status === command.status ? command : { ...command, status };
          }),
        );
        for (const outcome of outcomes) {
          if (
            ![
              "accepted",
              "filled",
              "cancelled",
              "failed",
              "rejected",
              "unknown",
            ].includes(outcome.status)
          ) {
            continue;
          }
          const outcomeKey = `${outcome.commandId}:${outcome.status}:${outcome.updatedAtMs}`;
          if (seenOutcomeKeys.has(outcomeKey)) continue;
          seenOutcomeKeys.add(outcomeKey);
          const isFailure =
            outcome.status === "failed" || outcome.status === "rejected";
          const isUnknown = outcome.status === "unknown";
          store.set(addMt5LogAtom, {
            level: isFailure ? "error" : isUnknown ? "warn" : "info",
            direction: "agent",
            type: `command.${outcome.status}`,
            message:
              outcome.message ??
              `${outcome.commandId} ${outcome.status} by ${selected.label}`,
            requestId: outcome.commandId,
            clientOrderId: outcome.parentCommandId,
            time: outcome.updatedAtMs,
          });
          if (outcome.updatedAtMs >= mountedAt && (isFailure || isUnknown)) {
            store.set(pushToastAtom, {
              title: isFailure
                ? `Broker rejected command on ${selected.label}`
                : `Broker outcome unknown on ${selected.label}`,
              message:
                outcome.message ??
                (isFailure
                  ? "The execution agent reported that the broker rejected this command."
                  : "The execution agent will reconcile this command and will not blindly resubmit it."),
              variant: isFailure ? "error" : "warn",
            });
          }
        }
      } catch {
        // Preserve the last broker snapshot during a transient read outage.
      } finally {
        running = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, STATE_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [backendSession, selected]);

  useEffect(() => {
    const store = getDefaultStore();
    setExecutionRuntimeHandlers({
      send: (type, payload) => {
        const selectedAccount = store.get(selectedExecutionAccountAtom);
        if (!selectedAccount || selectedAccount.venueKind !== "metatrader5") {
          return null;
        }
        if (type !== "order.place") {
          let clientCommandId = "";
          let commands: Record<string, unknown>[] = [];
          try {
            if (type === "order.close") {
              const request = payload as Mt5CloseRequest;
              clientCommandId = request.clientOrderId;
              commands = [
                buildClosePositionCommand(selectedAccount.id, request),
              ];
            } else if (type === "order.modify") {
              const request = payload as Mt5ModifyRequest;
              clientCommandId = request.clientOrderId;
              commands = [
                buildModifyPositionCommand(selectedAccount.id, request),
              ];
            } else if (type === "order.cancel") {
              const request = payload as Mt5CancelRequest;
              clientCommandId = request.clientOrderId;
              commands = [
                buildCancelOrderCommand(selectedAccount.id, request),
              ];
            } else if (type === "order.closeAll") {
              const request = payload as Mt5CloseAllRequest;
              clientCommandId = request.clientOrderId;
              const positions = store
                .get(mt5PositionsAtom)
                .filter(
                  (position) =>
                    (!request.chartSymbol ||
                      position.symbol === request.chartSymbol) &&
                    (!request.side || position.side === request.side),
                );
              commands = positions.map((position) =>
                buildClosePositionCommand(selectedAccount.id, {
                  clientOrderId: `${request.clientOrderId}:${position.ticket}`,
                  ticket: position.ticket,
                  deviationPoints: request.deviationPoints,
                }),
              );
              if (commands.length === 0) return null;
            } else {
              return null;
            }
          } catch {
            return null;
          }
          void Promise.allSettled(commands.map(submitExecutionCommand)).then(
            (results) => {
              const accepted = results.filter(
                (result) => result.status === "fulfilled",
              ).length;
              const rejected = results.length - accepted;
              store.set(mt5PendingCommandsAtom, (pending) =>
                pending.map((command) =>
                  command.id === clientCommandId
                    ? {
                        ...command,
                        status: accepted > 0 ? "acked" : "rejected",
                      }
                    : command,
                ),
              );
              store.set(addMt5LogAtom, {
                level: rejected > 0 ? "warn" : "info",
                direction: "gateway",
                type,
                message: `${accepted} queued, ${rejected} rejected`,
                requestId: clientCommandId,
                clientOrderId: clientCommandId,
              });
              if (rejected > 0) {
                store.set(pushToastAtom, {
                  title:
                    accepted > 0
                      ? "Command partially queued"
                      : "Command rejected",
                  message:
                    "One or more broker-account commands were not accepted by the durable queue.",
                  variant: accepted > 0 ? "warn" : "error",
                });
              }
            },
          );
          return clientCommandId;
        }
        const order = payload as Mt5OrderRequest;
        let request;
        try {
          request = buildExecutionOrderRequest({
            order,
            selected: selectedAccount,
            copyTargets: store.get(copyTargetsAtom),
            accounts: store.get(executionAccountsAtom),
          });
        } catch {
          return null;
        }
        void routeExecutionOrder(request)
          .then((response) => {
            const queued = response.targets.filter(
              (target) => target.status === "queued",
            );
            const rejected = response.targets.filter(
              (target) => target.status !== "queued",
            );
            store.set(mt5PendingCommandsAtom, (commands) =>
              commands.map((command) =>
                command.id === order.clientOrderId
                  ? {
                      ...command,
                      status: queued.length > 0 ? "acked" : "rejected",
                    }
                  : command,
              ),
            );
            store.set(addMt5LogAtom, {
              level: rejected.length > 0 ? "warn" : "info",
              direction: "gateway",
              type: "order.route",
              message: `${queued.length} queued, ${rejected.length} rejected`,
              requestId: order.clientOrderId,
              clientOrderId: order.clientOrderId,
            });
            if (rejected.length > 0) {
              store.set(pushToastAtom, {
                title:
                  queued.length > 0
                    ? "Order partially routed"
                    : "Order rejected",
                message: rejected
                  .map((target) => `${target.accountId}: ${target.message}`)
                  .join(" · "),
                variant: queued.length > 0 ? "warn" : "error",
              });
            }
          })
          .catch(() => {
            store.set(mt5PendingCommandsAtom, (commands) =>
              commands.map((command) =>
                command.id === order.clientOrderId
                  ? { ...command, status: "rejected" }
                  : command,
              ),
            );
            store.set(pushToastAtom, {
              title: "Execution service unavailable",
              message:
                "The order was not accepted by the durable execution queue.",
              variant: "error",
            });
          });
        return order.clientOrderId;
      },
      connect: () => undefined,
      disconnect: () => undefined,
    });
    return () => setExecutionRuntimeHandlers(null);
  }, []);
}

function wireNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Test helper for forcing a registry refresh without mounting React. */
export async function refreshExecutionRegistryForTests(): Promise<void> {
  const accounts = await getExecutionAccounts();
  getDefaultStore().set(applyExecutionAccountsAtom, accounts);
}
