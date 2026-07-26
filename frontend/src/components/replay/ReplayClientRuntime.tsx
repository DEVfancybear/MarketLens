"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { backendSessionAtom } from "@/store/authStore";
import { symbolAtom, timeframeAtom } from "@/store/chartStore";
import {
  activeChartSlotAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  replayLayoutModeAtom,
  replayTracksForBackend,
  replayTracksForLayout,
  visibleChartSlots,
} from "@/store/replayLayoutStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import {
  exitReplaySession,
  runReplayCommand,
  startReplaySession,
} from "@/services/replay/replaySocket";
import { replayTrackIdentity } from "@/services/replay/replayAvailability";
import {
  cancelReplaySelectionAtom,
  replayAutoIntervalSeconds,
} from "./replayUiState";

/** Owns only backend transport lifecycle; it never advances market time. */
export function ReplayClientRuntime(): null {
  const backendSession = useAtomValue(backendSessionAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const layoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const panes = useAtomValue(chartPanesAtom);
  const activeSlot = useAtomValue(activeChartSlotAtom);
  const projection = useReplayClientProjection();
  const cancelSelection = useSetAtom(cancelReplaySelectionAtom);
  const replacingRef = useRef(false);
  const normalizingIntervalRef = useRef<string | null>(null);

  useEffect(() => {
    if (backendSession && isReplayBackendV1Enabled()) return;
    cancelSelection();
    if (projection.snapshot || projection.connection === "connecting") {
      void exitReplaySession();
    }
  }, [backendSession, cancelSelection, projection.connection, projection.snapshot]);

  useEffect(() => {
    const snapshot = projection.snapshot;
    if (!backendSession || !snapshot || snapshot.tracks.length === 0) return;
    const autoInterval = replayAutoIntervalSeconds(snapshot.tracks);
    if (!autoInterval) return;
    if (snapshot.replayIntervalSeconds === autoInterval) {
      normalizingIntervalRef.current = null;
      return;
    }
    const key = `${snapshot.id}:${autoInterval}`;
    if (normalizingIntervalRef.current === key) return;
    normalizingIntervalRef.current = key;
    void runReplayCommand("set_replay_interval", { replayInterval: "auto" })
      .catch(() => undefined)
      .finally(() => {
        if (normalizingIntervalRef.current === key) {
          normalizingIntervalRef.current = null;
        }
      });
  }, [backendSession, projection.snapshot]);

  useEffect(() => {
    const snapshot = projection.snapshot;
    if (!backendSession || !isReplayBackendV1Enabled() || !snapshot || replacingRef.current) {
      return;
    }
    const visibleSlots = visibleChartSlots(layoutPreset);
    const snapshotOwnerSlot = snapshot.mode === "single_chart"
      ? snapshot.tracks[0]?.slot
      : undefined;
    const replayOwnerSlot = replayMode === "single_chart" &&
        snapshotOwnerSlot !== undefined &&
        visibleSlots.includes(snapshotOwnerSlot)
      ? snapshotOwnerSlot
      : activeSlot;
    const ownerPane = panes.find((pane) => pane.slot === replayOwnerSlot);
    const activeSelection = replayMode === "single_chart" && ownerPane?.initialized
      ? { symbol: ownerPane.symbol, chartTimeframe: ownerPane.timeframe }
      : { symbol, chartTimeframe: timeframe };
    const layoutTracks = replayTracksForLayout(
      replayMode,
      layoutPreset,
      {
        ...activeSelection,
        slot: replayOwnerSlot,
      },
      panes,
      replayOwnerSlot,
    ).map((track) => ({
      ...track,
      required: replayMode === "single_chart" || track.slot === replayOwnerSlot,
    }));
    const wantedTracks = replayTracksForBackend(
      replayMode,
      layoutTracks,
    );
    const activeTracks = new Set(snapshot.tracks.map(replayTrackIdentity));
    const unavailableTracks = new Set(
      projection.unavailableTracks.map(replayTrackIdentity),
    );
    const requiredTrackUnavailable = wantedTracks.some(
      (track) => track.required && unavailableTracks.has(replayTrackIdentity(track)),
    );
    const configurationMatches = snapshot.mode === replayMode &&
      !requiredTrackUnavailable &&
      snapshot.tracks.length + projection.unavailableTracks.length === wantedTracks.length &&
      wantedTracks.every((track) => {
        const identity = replayTrackIdentity(track);
        return activeTracks.has(identity) || unavailableTracks.has(identity);
      });
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
    activeSlot,
    layoutPreset,
    panes,
    projection.snapshot,
    projection.unavailableTracks,
    replayMode,
    symbol,
    timeframe,
  ]);

  return null;
}
