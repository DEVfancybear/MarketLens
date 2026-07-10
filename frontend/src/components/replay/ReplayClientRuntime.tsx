"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { backendSessionAtom } from "@/store/authStore";
import { symbolAtom, timeframeAtom } from "@/store/chartStore";
import {
  chartLayoutPresetAtom,
  replayLayoutModeAtom,
  replayTracksForLayout,
} from "@/store/replayLayoutStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import {
  exitReplaySession,
  startReplaySession,
} from "@/services/replay/replaySocket";
import { cancelReplaySelectionAtom } from "./replayUiState";

/** Owns only backend transport lifecycle; it never advances market time. */
export function ReplayClientRuntime(): null {
  const backendSession = useAtomValue(backendSessionAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const layoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const projection = useReplayClientProjection();
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const replacingRef = useRef(false);

  useEffect(() => {
    if (backendSession && isReplayBackendV1Enabled()) return;
    cancelSelection();
    if (projection.snapshot || projection.connection === "connecting") {
      void exitReplaySession();
    }
  }, [backendSession, cancelSelection, projection.connection, projection.snapshot]);

  useEffect(() => {
    const snapshot = projection.snapshot;
    if (!backendSession || !isReplayBackendV1Enabled() || !snapshot || replacingRef.current) {
      return;
    }
    const wantedTracks = replayTracksForLayout(replayMode, layoutPreset, {
      symbol,
      chartTimeframe: timeframe,
    });
    const configurationMatches = snapshot.mode === replayMode &&
      snapshot.tracks.length === wantedTracks.length &&
      snapshot.tracks.every((track, index) =>
        track.slot === wantedTracks[index]?.slot &&
        track.symbol === wantedTracks[index]?.symbol &&
        track.chartTimeframe === wantedTracks[index]?.chartTimeframe
      );
    if (configurationMatches) return;

    replacingRef.current = true;
    void startReplaySession({
      mode: replayMode,
      start: { kind: "time", time: snapshot.simulatedTime },
      replayInterval: "auto",
      speed: snapshot.speed,
      tracks: wantedTracks,
      trading: {
        enabled: true,
        startingEquity: String(snapshot.trading?.account.startingEquity ?? 10_000),
        baseCurrency: snapshot.trading?.account.baseCurrency ?? "USD",
        commission: { kind: "per_unit", value: "0" },
        barPathModel: "conservative_ohlc",
      },
    }).finally(() => {
      replacingRef.current = false;
    });
  }, [
    backendSession,
    layoutPreset,
    projection.snapshot,
    replayMode,
    symbol,
    timeframe,
  ]);

  return null;
}
