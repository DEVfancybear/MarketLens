'use client';
import { create } from 'zustand';

export type ReplaySpeed = 1 | 2 | 5 | 10 | 25 | 50 | 100;
export const REPLAY_SPEEDS: ReplaySpeed[] = [1, 2, 5, 10, 25, 50, 100];

interface ReplayState {
  /** Replay armed (future candles hidden). */
  active: boolean;
  /**
   * Bar-selection mode: the user is picking the replay start by clicking a
   * candle (TradingView "Bar Replay"). Normal chart interactions are disabled
   * and a snapping vertical cursor is shown while this is true.
   */
  selecting: boolean;
  playing: boolean;
  speed: ReplaySpeed;

  /**
   * Index into the master series of the LAST visible candle. The engine never
   * exposes candles beyond this cursor — the core no-look-ahead guarantee.
   */
  cursor: number;
  /** Index the user selected as the replay start. */
  anchor: number;
  /** Total candles in the master series (set when arming). */
  total: number;

  /** Enter / leave bar-selection mode. */
  beginSelect: () => void;
  cancelSelect: () => void;
  arm: (anchor: number, total: number) => void;
  disarm: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  restart: () => void;
  setSpeed: (s: ReplaySpeed) => void;
  step: (delta: number) => void;
  setCursor: (i: number) => void;
  setTotal: (n: number) => void;
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  active: false,
  selecting: false,
  playing: false,
  speed: 5,
  cursor: 0,
  anchor: 0,
  total: 0,

  beginSelect: () => set({ selecting: true, active: false, playing: false }),
  cancelSelect: () => set({ selecting: false }),

  arm: (anchor, total) =>
    set({ active: true, selecting: false, playing: false, anchor, cursor: anchor, total }),
  disarm: () => set({ active: false, selecting: false, playing: false }),

  play: () => {
    if (get().cursor < get().total - 1) set({ playing: true });
  },
  pause: () => set({ playing: false }),
  stop: () => set({ playing: false, cursor: get().anchor }),
  restart: () => set({ playing: false, cursor: get().anchor }),

  setSpeed: (speed) => set({ speed }),

  step: (delta) => {
    const { cursor, total, anchor } = get();
    const next = Math.max(anchor, Math.min(total - 1, cursor + delta));
    set({ cursor: next, playing: next >= total - 1 ? false : get().playing });
  },

  setCursor: (i) => {
    const { total, anchor } = get();
    set({ cursor: Math.max(anchor, Math.min(total - 1, i)) });
  },
  setTotal: (total) => set({ total }),
}));
