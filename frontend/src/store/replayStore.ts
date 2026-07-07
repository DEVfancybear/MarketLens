"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import type { Candle } from "@/types";

export type ReplaySpeed = 0.1 | 0.3 | 0.5 | 1 | 3 | 10;
export const REPLAY_SPEEDS: ReplaySpeed[] = [0.1, 0.3, 0.5, 1, 3, 10];

// ── State atoms ────────────────────────────────────────────────────────────
export const activeAtom = atom(false);
export const selectingAtom = atom(false);
export const reSelectingAtom = atom(false);
export const playingAtom = atom(false);
export const speedAtom = atom<ReplaySpeed>(1);
export const cursorAtom = atom(0);
export const anchorAtom = atom(0);
export const totalAtom = atom(0);
export const cursorTimeAtom = atom<number | null>(null);
export const anchorTimeAtom = atom<number | null>(null);

function indexAtOrBefore(candles: Candle[], time: number): number {
  if (candles.length === 0) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function clampIndex(index: number, total: number): number {
  return Math.max(0, Math.min(Math.max(0, total - 1), index));
}

// ── Write atoms (actions) ──────────────────────────────────────────────────
export const beginSelectAtom = atom(null, (_get, set) => {
  set(selectingAtom, true);
  set(activeAtom, false);
  set(playingAtom, false);
});

export const cancelSelectAtom = atom(null, (_get, set) => {
  set(selectingAtom, false);
});

// ── Re-select mode (Select Bar while replay is already active) ──────────────
export const beginReSelectAtom = atom(null, (get, set) => {
  if (!get(activeAtom)) return; // only valid when replay is armed
  set(reSelectingAtom, true);
  set(playingAtom, false); // auto-pause
});

export const cancelReSelectAtom = atom(null, (_get, set) => {
  set(reSelectingAtom, false);
});

/** Commit the re-selection: move anchor + cursor to the chosen bar. */
export const confirmReSelectAtom = atom(null, (get, set, index: number) => {
  const total = get(totalAtom);
  const clamped = Math.max(0, Math.min(total - 1, index));
  const candle = get(candlesAtom)[clamped];
  set(anchorAtom, clamped);
  set(cursorAtom, clamped);
  set(anchorTimeAtom, candle?.time ?? null);
  set(cursorTimeAtom, candle?.time ?? null);
  set(reSelectingAtom, false);
  // remain paused — tradingview does NOT auto-play after a bar re-select
});

export const armAtom = atom(
  null,
  (get, set, anchor: number, total: number) => {
    const clamped = clampIndex(anchor, total);
    const candle = get(candlesAtom)[clamped];
    set(activeAtom, true);
    set(selectingAtom, false);
    set(reSelectingAtom, false);
    set(playingAtom, false);
    set(anchorAtom, clamped);
    set(cursorAtom, clamped);
    set(anchorTimeAtom, candle?.time ?? null);
    set(cursorTimeAtom, candle?.time ?? null);
    set(totalAtom, total);
  },
);

export const disarmAtom = atom(null, (_get, set) => {
  set(activeAtom, false);
  set(selectingAtom, false);
  set(reSelectingAtom, false);
  set(playingAtom, false);
  set(anchorTimeAtom, null);
  set(cursorTimeAtom, null);
});

export const playAtom = atom(null, (get, set) => {
  if (get(cursorAtom) < get(totalAtom) - 1) {
    set(playingAtom, true);
  }
});

export const pauseAtom = atom(null, (_get, set) => {
  set(playingAtom, false);
});

export const stopAtom = atom(null, (get, set) => {
  set(playingAtom, false);
  set(cursorAtom, get(anchorAtom));
  set(cursorTimeAtom, get(anchorTimeAtom));
});

export const restartAtom = atom(null, (get, set) => {
  set(playingAtom, false);
  set(cursorAtom, get(anchorAtom));
  set(cursorTimeAtom, get(anchorTimeAtom));
});

export const setSpeedAtom = atom(null, (_get, set, speed: ReplaySpeed) => {
  set(speedAtom, speed);
});

export const stepAtom = atom(null, (get, set, delta: number) => {
  const cursor = get(cursorAtom);
  const total = get(totalAtom);
  const anchor = get(anchorAtom);
  const next = Math.max(anchor, Math.min(total - 1, cursor + delta));
  const candle = get(candlesAtom)[next];
  set(cursorAtom, next);
  if (candle) set(cursorTimeAtom, candle.time);
  if (next >= total - 1) {
    set(playingAtom, false);
  }
});

export const setCursorAtom = atom(null, (get, set, i: number) => {
  const total = get(totalAtom);
  const anchor = get(anchorAtom);
  const next = Math.max(anchor, Math.min(total - 1, i));
  const candle = get(candlesAtom)[next];
  set(cursorAtom, next);
  if (candle) set(cursorTimeAtom, candle.time);
});

// Guarded: only update when the value actually changes.
export const setTotalAtom = atom(null, (get, set, total: number) => {
  const safeTotal = Math.max(0, total);
  if (safeTotal !== get(totalAtom)) set(totalAtom, safeTotal);
  if (safeTotal === 0) {
    set(activeAtom, false);
    set(selectingAtom, false);
    set(reSelectingAtom, false);
    set(playingAtom, false);
    set(anchorAtom, 0);
    set(cursorAtom, 0);
    set(anchorTimeAtom, null);
    set(cursorTimeAtom, null);
    return;
  }
  const max = safeTotal - 1;
  const anchor = Math.min(get(anchorAtom), max);
  if (anchor !== get(anchorAtom)) set(anchorAtom, anchor);
  const cursor = Math.max(anchor, Math.min(max, get(cursorAtom)));
  if (cursor !== get(cursorAtom)) set(cursorAtom, cursor);
  if (cursor >= max) set(playingAtom, false);
});

// ── Combined state + actions (for compatibility hook) ──────────────────────
/**
 * Re-map replay indices after the chart swaps to a different timeframe.
 *
 * Replay is anchored by absolute candle time, not by the old timeframe's array
 * index. When the user starts replay on M15 and switches to M5, index 120 in
 * M15 is not index 120 in M5; the cursor must snap to the candle whose open
 * time is at or before the saved replay timestamp. This preserves no-look-ahead
 * behavior across timeframe changes.
 */
export const reconcileReplayToCandlesAtom = atom(
  null,
  (get, set, candles: Candle[]) => {
    const total = candles.length;
    if (!get(activeAtom)) {
      set(totalAtom, total);
      return;
    }

    if (total === 0) {
      set(totalAtom, 0);
      set(playingAtom, false);
      return;
    }

    const max = total - 1;
    const savedAnchorTime = get(anchorTimeAtom);
    const savedCursorTime = get(cursorTimeAtom);
    const anchorFromTime =
      savedAnchorTime == null ? -1 : indexAtOrBefore(candles, savedAnchorTime);
    const cursorFromTime =
      savedCursorTime == null ? -1 : indexAtOrBefore(candles, savedCursorTime);

    const nextAnchor = clampIndex(
      anchorFromTime >= 0 ? anchorFromTime : get(anchorAtom),
      total,
    );
    const nextCursor = Math.max(
      nextAnchor,
      clampIndex(cursorFromTime >= 0 ? cursorFromTime : get(cursorAtom), total),
    );

    set(totalAtom, total);
    set(anchorAtom, nextAnchor);
    set(cursorAtom, nextCursor);
    set(anchorTimeAtom, candles[nextAnchor]?.time ?? null);
    set(cursorTimeAtom, candles[nextCursor]?.time ?? null);
    if (nextCursor >= max) set(playingAtom, false);
  },
);

interface ReplayState {
  active: boolean;
  selecting: boolean;
  reSelecting: boolean;
  playing: boolean;
  speed: ReplaySpeed;
  cursor: number;
  anchor: number;
  total: number;
  cursorTime: number | null;
  anchorTime: number | null;
}

export interface ReplayActions {
  beginSelect: () => void;
  cancelSelect: () => void;
  beginReSelect: () => void;
  cancelReSelect: () => void;
  confirmReSelect: (index: number) => void;
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
  reconcileToCandles: (candles: Candle[]) => void;
}

type ReplayStoreInterface = ReplayState & ReplayActions;

const replayStateAtom = atom<ReplayState>((get) => ({
  active: get(activeAtom),
  selecting: get(selectingAtom),
  reSelecting: get(reSelectingAtom),
  playing: get(playingAtom),
  speed: get(speedAtom),
  cursor: get(cursorAtom),
  anchor: get(anchorAtom),
  total: get(totalAtom),
  cursorTime: get(cursorTimeAtom),
  anchorTime: get(anchorTimeAtom),
}));

const replayCombinedAtom = atom<ReplayStoreInterface>((get) => {
  const state = get(replayStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    beginSelect: () => store.set(beginSelectAtom),
    cancelSelect: () => store.set(cancelSelectAtom),
    beginReSelect: () => store.set(beginReSelectAtom),
    cancelReSelect: () => store.set(cancelReSelectAtom),
    confirmReSelect: (i) => store.set(confirmReSelectAtom, i),
    arm: (a, t) => store.set(armAtom, a, t),
    disarm: () => store.set(disarmAtom),
    play: () => store.set(playAtom),
    pause: () => store.set(pauseAtom),
    stop: () => store.set(stopAtom),
    restart: () => store.set(restartAtom),
    setSpeed: (s) => store.set(setSpeedAtom, s),
    step: (d) => store.set(stepAtom, d),
    setCursor: (i) => store.set(setCursorAtom, i),
    setTotal: (n) => store.set(setTotalAtom, n),
    reconcileToCandles: (candles) =>
      store.set(reconcileReplayToCandlesAtom, candles),
  };
});

// ── Compatibility hook ─────────────────────────────────────────────────────
export function useReplayStore(): ReplayStoreInterface;
export function useReplayStore<T>(
  selector: (state: ReplayStoreInterface) => T,
): T;
export function useReplayStore<T>(
  selector?: (state: ReplayStoreInterface) => T,
): ReplayStoreInterface | T {
  const combined = useAtomValue(replayCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

// Static getState() for non-React code.
export function getReplayState(): ReplayStoreInterface {
  return getDefaultStore().get(replayCombinedAtom);
}
