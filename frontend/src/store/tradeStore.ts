"use client";
import { atom, getDefaultStore } from "jotai";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { Candle, OrderPrefill, OrderRequest, Position } from "@/types";
import {
  checkExit,
  checkPendingTrigger,
  computeRisk,
  realizedFor,
  rMultiple,
  unrealized,
} from "@/services/tradeEngine";
import { uid } from "@/utils/id";
import { addJournalEntryAtom } from "./journalStore";
import { logAtom } from "./uiStore";
import {
  positionToWrite,
  resetSimAccount,
  upsertSimPosition,
  type SimAccount,
} from "@/services/api/resources/simTradingApi";
import { reportFrontendError } from "@/services/feedback/errorReporter";

const STARTING_EQUITY = 10_000;

// ── Individual state atoms ───────────────────────────────────────────────────
export const equityAtom = atom(STARTING_EQUITY);
export const startingEquityAtom = atom(STARTING_EQUITY);
export const positionsAtom = atom<Position[]>([]);
export const activeSimAccountAtom = atom<SimAccount | null>(null);
export const activeSimOwnerAtom = atom<string | null>(null);
export const simTradingHydratedAtom = atom(false);
export const simMutationVersionAtom = atom(0);
export const priceAtom = atom(0);
export const timeAtom = atom(0);
export const tradeSymbolAtom = atom("");
const orderPrefillVersionAtom = atom(0);
export type OrderPrefillState = OrderPrefill & { version: number };
export const orderPrefillAtom = atom<OrderPrefillState | null>(null);

const pendingRemoteSync = new Map<string, ReturnType<typeof setTimeout>>();
const remoteSyncQueues = new Map<string, Promise<void>>();

function enqueueRemote(accountId: string, task: () => Promise<void>): Promise<void> {
  const previous = remoteSyncQueues.get(accountId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  remoteSyncQueues.set(accountId, next);
  void next.then(
    () => { if (remoteSyncQueues.get(accountId) === next) remoteSyncQueues.delete(accountId); },
    () => { if (remoteSyncQueues.get(accountId) === next) remoteSyncQueues.delete(accountId); },
  );
  return next;
}

function cancelDebouncedSync(accountId: string) {
  for (const [key, timer] of pendingRemoteSync) {
    if (!key.startsWith(`${accountId}:`)) continue;
    clearTimeout(timer);
    pendingRemoteSync.delete(key);
  }
}

function syncPosition(accountId: string | undefined, position: Position, immediate = false) {
  if (!accountId || typeof window === "undefined") return;
  const key = `${accountId}:${position.id}`;
  const existing = pendingRemoteSync.get(key);
  if (existing) clearTimeout(existing);
  const run = () => {
    pendingRemoteSync.delete(key);
    void enqueueRemote(accountId, async () => {
      try {
        await upsertSimPosition(accountId, positionToWrite(position));
        const store = getDefaultStore();
        store.set(simMutationVersionAtom, store.get(simMutationVersionAtom) + 1);
      } catch (error) {
        reportFrontendError(error, { title: "Trade sync failed", logPrefix: "Sim position sync failed" });
      }
    });
  };
  if (immediate) run();
  else pendingRemoteSync.set(key, setTimeout(run, 500));
}

// ── Write atoms (actions) ────────────────────────────────────────────────────

/** Feed the latest candle: refresh marks and process pending/exit triggers. */
export const setTradeMarketAtom = atom(
  null,
  (get, set, payload: { symbol: string; candle: Candle }) => {
    const { symbol, candle } = payload;
    const price = candle.close;

    const positions = get(positionsAtom).map((p) => ({ ...p }));
    const justClosed: Position[] = [];
    let equityDelta = 0;

    for (const p of positions) {
      if (p.status === "pending") {
        const trig = checkPendingTrigger(p, candle);
        if (trig?.type === "fill") {
          p.status = "open";
          p.openTime = candle.time;
          p.fills.push({
            time: candle.time,
            price: trig.price,
            quantity: p.quantity,
            kind: "open",
          });
          getDefaultStore().set(
            logAtom,
            "info",
            `${p.side.toUpperCase()} ${p.symbol} filled @ ${trig.price}`,
          );
        }
      }
      if (p.status === "open") {
        const exit = checkExit(p, candle);
        if (exit) {
          const pnl = realizedFor(p, exit.price, p.remaining);
          p.realizedPnl += pnl;
          equityDelta += pnl;
          p.fills.push({
            time: candle.time,
            price: exit.price,
            quantity: -p.remaining,
            kind: "close",
          });
          p.remaining = 0;
          p.status = "closed";
          p.closeTime = candle.time;
          p.unrealizedPnl = 0;
          justClosed.push(p);
          getDefaultStore().set(
            logAtom,
            exit.type === "target" ? "info" : "warn",
            `${p.symbol} ${exit.type} hit @ ${exit.price} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)})`,
          );
        } else {
          p.unrealizedPnl = unrealized(p, price);
        }
      }
    }

    justClosed.forEach((p) => journalize(p));

    set(tradeSymbolAtom, symbol);
    set(priceAtom, price);
    set(timeAtom, candle.time);
    set(positionsAtom, positions);
    set(equityAtom, get(equityAtom) + equityDelta);
    const accountId = get(activeSimAccountAtom)?.id;
    for (const position of positions) {
      if (position.status === "open" || position.status === "pending" || justClosed.includes(position)) {
        syncPosition(accountId, position, position.status === "closed");
      }
    }
  },
);

export const placeOrderAtom = atom(null, (get, set, order: OrderRequest) => {
  const price = get(priceAtom);
  const time = get(timeAtom);
  const equity = get(equityAtom);
  const symbol = get(tradeSymbolAtom);
  const entryPrice = order.price ?? price;
  if (!entryPrice) return;
  const risk = computeRisk(order, price, equity);
  const isMarket = order.type === "market";

  const pos: Position = {
    id: uid("pos"),
    symbol: order.symbol || symbol,
    side: order.side,
    type: order.type,
    status: isMarket ? "open" : "pending",
    entry: isMarket ? price : entryPrice,
    quantity: risk.positionSize,
    remaining: risk.positionSize,
    stopLoss: order.stopLoss,
    takeProfit: order.takeProfit,
    riskPct: order.riskPct,
    riskAmount: risk.riskAmount,
    openTime: time,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fills: isMarket
      ? [{ time, price, quantity: risk.positionSize, kind: "open" }]
      : [],
    notes: order.notes,
  };

  set(positionsAtom, [pos, ...get(positionsAtom)]);
  syncPosition(get(activeSimAccountAtom)?.id, pos, true);
  getDefaultStore().set(
    logAtom,
    "info",
    `${isMarket ? "Market" : order.type} ${order.side.toUpperCase()} ${pos.symbol} ${risk.positionSize.toFixed(4)} @ ${pos.entry.toFixed(5)}`,
  );
});

export const closePositionAtom = atom(
  null,
  (get, set, payload: { id: string; fraction?: number }) => {
    const { id, fraction = 1 } = payload;
    const price = get(priceAtom);
    const time = get(timeAtom);
    const positions = get(positionsAtom).map((p) => ({ ...p }));
    const p = positions.find((x) => x.id === id);
    if (!p || p.status !== "open") return;

    const qty = Math.min(p.remaining, p.remaining * fraction);
    const pnl = realizedFor(p, price, qty);
    p.realizedPnl += pnl;
    p.remaining -= qty;
    p.fills.push({
      time,
      price,
      quantity: -qty,
      kind: p.remaining > 1e-9 ? "partial" : "close",
    });

    let equityDelta = pnl;
    if (p.remaining <= 1e-9) {
      p.remaining = 0;
      p.status = "closed";
      p.closeTime = time;
      p.unrealizedPnl = 0;
      journalize(p);
    } else {
      p.unrealizedPnl = unrealized(p, price);
    }

    set(positionsAtom, positions);
    set(equityAtom, get(equityAtom) + equityDelta);
    syncPosition(get(activeSimAccountAtom)?.id, p, true);
    getDefaultStore().set(
      logAtom,
      "info",
      `Closed ${(fraction * 100).toFixed(0)}% ${p.symbol} (${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)})`,
    );
  },
);

export const cancelPendingAtom = atom(null, (get, set, id: string) => {
  let cancelled: Position | undefined;
  set(
    positionsAtom,
    get(positionsAtom).map((p) => {
      if (p.id !== id || p.status !== "pending") return p;
      cancelled = { ...p, status: "cancelled" as const };
      return cancelled;
    }),
  );
  if (cancelled) syncPosition(get(activeSimAccountAtom)?.id, cancelled, true);
});

export const closeAllAtom = atom(null, (get, set) => {
  const positions = get(positionsAtom);
  for (const p of positions.filter((p) => p.status === "open")) {
    set(closePositionAtom, { id: p.id, fraction: 1 });
  }
});

export const resetTradeAtom = atom(null, (get, set) => {
  set(positionsAtom, []);
  set(equityAtom, get(startingEquityAtom));
  set(priceAtom, 0);
  set(timeAtom, 0);
  set(tradeSymbolAtom, "");
  set(orderPrefillAtom, null);
  set(orderPrefillVersionAtom, get(orderPrefillVersionAtom) + 1);
});

export const resetPersistedTradeAtom = atom(null, async (get, set) => {
  const account = get(activeSimAccountAtom);
  set(resetTradeAtom);
  if (!account) return;
  try {
    cancelDebouncedSync(account.id);
    let updated: SimAccount | undefined;
    await enqueueRemote(account.id, async () => { updated = await resetSimAccount(account.id); });
    if (!updated) return;
    set(activeSimAccountAtom, updated);
    set(simMutationVersionAtom, get(simMutationVersionAtom) + 1);
  } catch (error) {
    reportFrontendError(error, { title: "Account reset failed", logPrefix: "Sim account reset failed" });
  }
});

export const applyRemoteSimTradingAtom = atom(
  null,
  (_get, set, payload: { ownerId: string; account: SimAccount; positions: Position[] }) => {
    set(activeSimOwnerAtom, payload.ownerId);
    set(activeSimAccountAtom, payload.account);
    set(startingEquityAtom, payload.account.startingEquity);
    set(equityAtom, payload.account.equity);
    set(positionsAtom, payload.positions);
    set(simTradingHydratedAtom, true);
  },
);

export const clearRemoteSimTradingAtom = atom(null, (_get, set) => {
  const account = _get(activeSimAccountAtom);
  if (account) cancelDebouncedSync(account.id);
  set(startingEquityAtom, STARTING_EQUITY);
  set(resetTradeAtom);
  set(activeSimAccountAtom, null);
  set(activeSimOwnerAtom, null);
  set(simTradingHydratedAtom, false);
});

export const setOrderPrefillAtom = atom(
  null,
  (get, set, prefill: OrderPrefill) => {
    const version = get(orderPrefillVersionAtom) + 1;
    set(orderPrefillVersionAtom, version);
    set(orderPrefillAtom, { ...prefill, version });
  },
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Persist a closed position as a journal entry. */
function journalize(p: Position) {
  if (p.status !== "closed") return;
  const closeFills = p.fills.filter((f) => f.kind !== "open");
  const exitQty =
    closeFills.reduce((s, f) => s + Math.abs(f.quantity), 0) || p.quantity;
  const exitPrice =
    closeFills.reduce((s, f) => s + f.price * Math.abs(f.quantity), 0) /
    (exitQty || 1);

  getDefaultStore().set(addJournalEntryAtom, {
    id: uid("jrn"),
    symbol: p.symbol,
    side: p.side,
    entryTime: p.openTime,
    exitTime: p.closeTime ?? p.openTime,
    entryPrice: p.entry,
    exitPrice,
    quantity: p.quantity,
    pnl: p.realizedPnl,
    rr: rMultiple(p.realizedPnl, p.riskAmount),
    riskAmount: p.riskAmount,
    notes: p.notes,
  });
}

// ── Combined state (read-only derived atom) ──────────────────────────────────
export interface TradeState {
  equity: number;
  startingEquity: number;
  positions: Position[];
  price: number;
  time: number;
  symbol: string;
}

export interface TradeActions {
  setMarket: (symbol: string, candle: Candle) => void;
  place: (order: OrderRequest) => void;
  closePosition: (id: string, fraction?: number) => void;
  cancelPending: (id: string) => void;
  closeAll: () => void;
  reset: () => void;
}

type TradeStoreInterface = TradeState & TradeActions;

const tradeStateAtom = atom<TradeState>((get) => ({
  equity: get(equityAtom),
  startingEquity: get(startingEquityAtom),
  positions: get(positionsAtom),
  price: get(priceAtom),
  time: get(timeAtom),
  symbol: get(tradeSymbolAtom),
}));

const tradeCombinedAtom = atom<TradeStoreInterface>((get) => {
  const state = get(tradeStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    setMarket: (symbol, candle) =>
      store.set(setTradeMarketAtom, { symbol, candle }),
    place: (order) => store.set(placeOrderAtom, order),
    closePosition: (id, fraction = 1) =>
      store.set(closePositionAtom, { id, fraction }),
    cancelPending: (id) => store.set(cancelPendingAtom, id),
    closeAll: () => store.set(closeAllAtom),
    reset: () => store.set(resetTradeAtom),
  };
});

// ── Compatibility hook ───────────────────────────────────────────────────────
export function useTradeStore(): TradeStoreInterface;
export function useTradeStore<T>(
  selector: (state: TradeStoreInterface) => T,
): T;
export function useTradeStore<T>(
  selector?: (state: TradeStoreInterface) => T,
): TradeStoreInterface | T {
  const combined = useAtomValue(tradeCombinedAtom);
  if (!selector) return combined;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useMemo(() => selector(combined), [combined, selector]);
}

// ── Non-React accessor ───────────────────────────────────────────────────────
export function getTradeState(): TradeStoreInterface {
  return getDefaultStore().get(tradeCombinedAtom);
}
