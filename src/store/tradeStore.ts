'use client';
import { create } from 'zustand';
import type { Candle, OrderRequest, Position } from '@/types';
import {
  checkExit, checkPendingTrigger, computeRisk, realizedFor, rMultiple, unrealized,
} from '@/services/tradeEngine';
import { uid } from '@/utils/id';
import { useJournalStore } from './journalStore';
import { useUIStore } from './uiStore';

const STARTING_EQUITY = 10_000;

interface TradeState {
  equity: number;
  startingEquity: number;
  positions: Position[];
  /** Latest known price/time (from the visible candle stream). */
  price: number;
  time: number;
  symbol: string;

  setMarket: (symbol: string, candle: Candle) => void;
  place: (order: OrderRequest) => void;
  closePosition: (id: string, fraction?: number) => void;
  cancelPending: (id: string) => void;
  closeAll: () => void;
  reset: () => void;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  equity: STARTING_EQUITY,
  startingEquity: STARTING_EQUITY,
  positions: [],
  price: 0,
  time: 0,
  symbol: '',

  /** Feed the latest candle: refresh marks and process pending/exit triggers. */
  setMarket: (symbol, candle) => {
    const price = candle.close;
    const state = get();

    const positions = state.positions.map((p) => ({ ...p }));
    const justClosed: Position[] = [];
    let equityDelta = 0;

    for (const p of positions) {
      if (p.status === 'pending') {
        const trig = checkPendingTrigger(p, candle);
        if (trig?.type === 'fill') {
          p.status = 'open';
          p.openTime = candle.time;
          p.fills.push({ time: candle.time, price: trig.price, quantity: p.quantity, kind: 'open' });
          useUIStore.getState().log('info', `${p.side.toUpperCase()} ${p.symbol} filled @ ${trig.price}`);
        }
      }
      if (p.status === 'open') {
        const exit = checkExit(p, candle);
        if (exit) {
          // Realize only the still-open remainder at the exit price.
          const pnl = realizedFor(p, exit.price, p.remaining);
          p.realizedPnl += pnl;
          equityDelta += pnl;
          p.fills.push({ time: candle.time, price: exit.price, quantity: -p.remaining, kind: 'close' });
          p.remaining = 0;
          p.status = 'closed';
          p.closeTime = candle.time;
          p.unrealizedPnl = 0;
          justClosed.push(p);
          useUIStore
            .getState()
            .log(exit.type === 'target' ? 'info' : 'warn', `${p.symbol} ${exit.type} hit @ ${exit.price} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})`);
        } else {
          p.unrealizedPnl = unrealized(p, price);
        }
      }
    }

    justClosed.forEach((p) => journalize(p));

    set({ symbol, price, time: candle.time, positions, equity: state.equity + equityDelta });
  },

  place: (order) => {
    const { price, time, equity, symbol } = get();
    const entryPrice = order.price ?? price;
    if (!entryPrice) return;
    const risk = computeRisk(order, price, equity);
    const isMarket = order.type === 'market';

    const pos: Position = {
      id: uid('pos'),
      symbol: order.symbol || symbol,
      side: order.side,
      type: order.type,
      status: isMarket ? 'open' : 'pending',
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
        ? [{ time, price, quantity: risk.positionSize, kind: 'open' }]
        : [],
      notes: order.notes,
    };

    set({ positions: [pos, ...get().positions] });
    useUIStore
      .getState()
      .log('info', `${isMarket ? 'Market' : order.type} ${order.side.toUpperCase()} ${pos.symbol} ${risk.positionSize.toFixed(4)} @ ${pos.entry.toFixed(5)}`);
  },

  closePosition: (id, fraction = 1) => {
    const { price, time } = get();
    const positions = get().positions.map((p) => ({ ...p }));
    const p = positions.find((x) => x.id === id);
    if (!p || p.status !== 'open') return;

    const qty = Math.min(p.remaining, p.remaining * fraction);
    const pnl = realizedFor(p, price, qty);
    p.realizedPnl += pnl;
    p.remaining -= qty;
    p.fills.push({ time, price, quantity: -qty, kind: p.remaining > 1e-9 ? 'partial' : 'close' });

    let equityDelta = pnl;
    if (p.remaining <= 1e-9) {
      p.remaining = 0;
      p.status = 'closed';
      p.closeTime = time;
      p.unrealizedPnl = 0;
      journalize(p);
    } else {
      p.unrealizedPnl = unrealized(p, price);
    }

    set({ positions, equity: get().equity + equityDelta });
    useUIStore.getState().log('info', `Closed ${(fraction * 100).toFixed(0)}% ${p.symbol} (${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)})`);
  },

  cancelPending: (id) => {
    set({
      positions: get().positions.map((p) =>
        p.id === id && p.status === 'pending' ? { ...p, status: 'cancelled' } : p,
      ),
    });
  },

  closeAll: () => {
    get().positions.filter((p) => p.status === 'open').forEach((p) => get().closePosition(p.id, 1));
  },

  reset: () =>
    set({ positions: [], equity: get().startingEquity, price: 0, time: 0 }),
}));

// --- helpers ---

/** Persist a closed position as a journal entry. */
function journalize(p: Position) {
  if (p.status !== 'closed') return;
  const closeFills = p.fills.filter((f) => f.kind !== 'open');
  const exitQty = closeFills.reduce((s, f) => s + Math.abs(f.quantity), 0) || p.quantity;
  const exitPrice =
    closeFills.reduce((s, f) => s + f.price * Math.abs(f.quantity), 0) / (exitQty || 1);

  useJournalStore.getState().add({
    id: uid('jrn'),
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
