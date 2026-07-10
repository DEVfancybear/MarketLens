"use client";

import { atom } from "jotai";
import type { CreateReplaySessionInput } from "../../services/api/resources/replayApi";
import {
  replayTracksForLayout,
  type ChartLayoutPreset,
  type ReplayLayoutMode,
} from "../../store/replayLayoutStore";
import type { Timeframe } from "../../types";

export type ReplaySelectionMode = "idle" | "selecting" | "reselecting";
export type ReplaySpeed = 0.1 | 0.3 | 0.5 | 1 | 3 | 10;

export const REPLAY_SPEEDS: ReplaySpeed[] = [0.1, 0.3, 0.5, 1, 3, 10];
export const replaySelectionModeAtom = atom<ReplaySelectionMode>("idle");

export const beginReplaySelectionAtom = atom(null, (_get, set) => {
  set(replaySelectionModeAtom, "selecting");
});

export const beginReplayReselectionAtom = atom(null, (_get, set) => {
  set(replaySelectionModeAtom, "reselecting");
});

export const cancelReplaySelectionAtom = atom(null, (_get, set) => {
  set(replaySelectionModeAtom, "idle");
});

export function replaySpeedLabel(speed: number): string {
  return `${speed}x`;
}

export function replaySpeedDescription(speed: number): string {
  if (speed < 1) return `1 update per ${Math.round(1 / speed)} sec`;
  return `${speed} update${speed === 1 ? "" : "s"} per sec`;
}

export function replayControlMessage(input: {
  enabled: boolean;
  authenticated: boolean;
  connection: string;
  error: string | null;
}): string | null {
  if (!input.enabled) return "Replay is disabled by the deployment kill switch.";
  if (!input.authenticated) return "Sign in to use backend Replay.";
  if (input.connection === "connecting") return "Preparing Replay dataset...";
  return input.error;
}

export function replaySessionInputAt(
  timeSeconds: number,
  active: { symbol: string; chartTimeframe: Timeframe },
  mode: ReplayLayoutMode,
  preset: ChartLayoutPreset,
  speed = 1,
): CreateReplaySessionInput {
  return {
    mode,
    start: { kind: "time", time: new Date(timeSeconds * 1000).toISOString() },
    replayInterval: "auto",
    speed,
    tracks: replayTracksForLayout(mode, preset, active),
    trading: {
      enabled: true,
      startingEquity: "10000",
      baseCurrency: "USD",
      commission: { kind: "per_unit", value: "0" },
      barPathModel: "conservative_ohlc",
    },
  };
}
