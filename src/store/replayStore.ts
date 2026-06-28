"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";

export type ReplaySpeed = 1 | 2 | 5 | 10 | 25 | 50 | 100;
export const REPLAY_SPEEDS: ReplaySpeed[] = [1, 2, 5, 10, 25, 50, 100];

// ── State atoms ────────────────────────────────────────────────────────────
export const activeAtom = atom(false);
export const selectingAtom = atom(false);
export const playingAtom = atom(false);
export const speedAtom = atom<ReplaySpeed>(5);
export const cursorAtom = atom(0);
export const anchorAtom = atom(0);
export const totalAtom = atom(0);

// ── Write atoms (actions) ──────────────────────────────────────────────────
export const beginSelectAtom = atom(null, (_get, set) => {
  set(selectingAtom, true);
  set(activeAtom, false);
  set(playingAtom, false);
});

export const cancelSelectAtom = atom(null, (_get, set) => {
  set(selectingAtom, false);
});

export const armAtom = atom(
  null,
  (_get, set, anchor: number, total: number) => {
    set(activeAtom, true);
    set(selectingAtom, false);
    set(playingAtom, false);
    set(anchorAtom, anchor);
    set(cursorAtom, anchor);
    set(totalAtom, total);
  },
);

export const disarmAtom = atom(null, (_get, set) => {
  set(activeAtom, false);
  set(selectingAtom, false);
  set(playingAtom, false);
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
});

export const restartAtom = atom(null, (get, set) => {
  set(playingAtom, false);
  set(cursorAtom, get(anchorAtom));
});

export const setSpeedAtom = atom(null, (_get, set, speed: ReplaySpeed) => {
  set(speedAtom, speed);
});

export const stepAtom = atom(null, (get, set, delta: number) => {
  const cursor = get(cursorAtom);
  const total = get(totalAtom);
  const anchor = get(anchorAtom);
  const next = Math.max(anchor, Math.min(total - 1, cursor + delta));
  set(cursorAtom, next);
  if (next >= total - 1) {
    set(playingAtom, false);
  }
});

export const setCursorAtom = atom(null, (get, set, i: number) => {
  const total = get(totalAtom);
  const anchor = get(anchorAtom);
  set(cursorAtom, Math.max(anchor, Math.min(total - 1, i)));
});

// Guarded: only update when the value actually changes.
export const setTotalAtom = atom(null, (get, set, total: number) => {
  if (total !== get(totalAtom)) set(totalAtom, total);
});

// ── Combined state + actions (for compatibility hook) ──────────────────────
interface ReplayState {
  active: boolean;
  selecting: boolean;
  playing: boolean;
  speed: ReplaySpeed;
  cursor: number;
  anchor: number;
  total: number;
}

export interface ReplayActions {
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

type ReplayStoreInterface = ReplayState & ReplayActions;

const replayStateAtom = atom<ReplayState>((get) => ({
  active: get(activeAtom),
  selecting: get(selectingAtom),
  playing: get(playingAtom),
  speed: get(speedAtom),
  cursor: get(cursorAtom),
  anchor: get(anchorAtom),
  total: get(totalAtom),
}));

const replayCombinedAtom = atom<ReplayStoreInterface>((get) => {
  const state = get(replayStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    beginSelect: () => store.set(beginSelectAtom),
    cancelSelect: () => store.set(cancelSelectAtom),
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
