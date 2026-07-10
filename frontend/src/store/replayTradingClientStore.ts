"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  getReplayReport,
  sendReplayCommand,
  type ReplayCommandInput,
  type ReplayReport,
} from "@/services/api/resources/replayApi";
import { replayClientStore } from "@/store/replayClientStore";
import type { OrderRequest } from "@/types";

let commandSequence = 0;
let commandQueue = Promise.resolve<unknown>(undefined);

function commandKey(type: string): string {
  commandSequence += 1;
  return `replay-trade:${type}:${Date.now().toString(36)}:${commandSequence}`;
}

function enqueueTradingCommand(
  type: ReplayCommandInput["type"],
  payload?: Record<string, unknown>,
): Promise<void> {
  const run = async () => {
    const snapshot = replayClientStore.getState().snapshot;
    if (!snapshot?.trading || snapshot.status === "closed") {
      throw new Error("Replay trading session is unavailable");
    }
    const result = await sendReplayCommand(snapshot.id, {
      idempotencyKey: commandKey(type),
      expectedVersion: snapshot.version,
      type,
      payload,
    });
    replayClientStore.replaceSnapshot(result.snapshot);
  };
  const next = commandQueue.then(run, run);
  const safe = next.catch((error) => {
    const current = replayClientStore.getState();
    replayClientStore.setConnection(
      current.connection,
      error instanceof Error ? error.message : "Replay trading command failed",
    );
  });
  commandQueue = safe;
  return safe;
}

export function useReplayTrading() {
  const projection = useSyncExternalStore(
    (listener) => replayClientStore.subscribe(listener),
    () => replayClientStore.getState(),
    () => replayClientStore.getState(),
  );
  return useMemo(() => {
    const snapshot = projection.snapshot;
    const trading = snapshot?.trading ?? null;
    const track = snapshot?.tracks[0];
    const bars = track ? projection.barsByTrack[track.id] ?? [] : [];
    const price = bars[bars.length - 1]?.close ?? 0;
    return {
      active: Boolean(trading && track),
      sessionId: snapshot?.id ?? null,
      symbol: track?.symbol ?? null,
      account: trading?.account ?? null,
      orders: trading?.orders ?? [],
      fills: trading?.fills ?? [],
      positions: trading?.positions ?? [],
      price,
      place: (order: OrderRequest, quantity: number) => {
        if (!track) return Promise.reject(new Error("Replay track is unavailable"));
        return enqueueTradingCommand("place_order", {
          clientOrderId: commandKey("client-order"),
          trackId: track.id,
          side: order.side === "long" ? "buy" : "sell",
          orderType: order.type,
          quantity,
          limitPrice: order.type === "limit" ? order.price : undefined,
          stopPrice: order.type === "stop" ? order.price : undefined,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
        });
      },
      cancel: (orderId: string) => enqueueTradingCommand("cancel_order", { orderId }),
      close: (positionId: string, fraction = 1) =>
        enqueueTradingCommand("close_position", { positionId, fraction }),
      updateBracket: (orderId: string, stopLoss?: number, takeProfit?: number) =>
        enqueueTradingCommand("update_order", { orderId, stopLoss, takeProfit }),
      reset: () => enqueueTradingCommand("reset_trading"),
      closeAll: async () => {
        for (const position of trading?.positions ?? []) {
          if (Math.abs(position.netQuantity) > 1e-12) {
            await enqueueTradingCommand("close_position", {
              positionId: position.id,
              fraction: 1,
            });
          }
        }
      },
      report: (): Promise<ReplayReport> => {
        if (!snapshot) return Promise.reject(new Error("Replay session is unavailable"));
        return getReplayReport(snapshot.id);
      },
    };
  }, [projection]);
}
