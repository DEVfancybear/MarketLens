"use client";

import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { activeAtom, cursorTimeAtom, playingAtom, speedAtom } from "@/store/replayStore";
import { symbolAtom, timeframeAtom } from "@/store/chartStore";
import {
  closeReplaySession,
  createReplaySession,
  getReplayTrackBars,
  sendReplayCommand,
  type ReplayCommandInput,
} from "@/services/api/resources/replayApi";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import { ReplaySocket } from "@/services/replay/replaySocket";
import { replayClientStore } from "@/store/replayClientStore";

let shadowCommandSequence = 0;
function commandKey(type: string): string {
  shadowCommandSequence += 1;
  return `shadow:${type}:${Date.now().toString(36)}:${shadowCommandSequence}`;
}

/**
 * Phase 3 compatibility controller. Legacy controls are mirrored to Go, while
 * chart consumers read the separate server-revealed projection. Server state
 * never mutates replayStore, so disabling the flag restores the rollback path.
 */
export function useReplayBackendShadow(): void {
  const active = useAtomValue(activeAtom);
  const playing = useAtomValue(playingAtom);
  const speed = useAtomValue(speedAtom);
  const cursorTime = useAtomValue(cursorTimeAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const socketRef = useRef<ReplaySocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const configurationRef = useRef<string | null>(null);
  const previousLegacyTime = useRef<number | null>(null);
  const commandChain = useRef(Promise.resolve());
  const [sessionEpoch, setSessionEpoch] = useState(0);

  useEffect(() => {
    if (!isReplayBackendV1Enabled()) return;
    if (!active) {
      const sessionId = sessionRef.current;
      socketRef.current?.stop();
      socketRef.current = null;
      sessionRef.current = null;
      configurationRef.current = null;
      previousLegacyTime.current = null;
      replayClientStore.clear();
      if (sessionId) void closeReplaySession(sessionId).catch(() => undefined);
      return;
    }
    const configuration = `${symbol}:${timeframe}`;
    if (
      sessionRef.current &&
      configurationRef.current !== configuration
    ) {
      const previousSession = sessionRef.current;
      socketRef.current?.stop();
      socketRef.current = null;
      sessionRef.current = null;
      configurationRef.current = null;
      replayClientStore.clear();
      void closeReplaySession(previousSession).catch(() => undefined);
    }
    if (sessionRef.current || cursorTime == null) return;
    let cancelled = false;
    void createReplaySession({
      mode: "single_chart",
      start: { kind: "time", time: new Date(cursorTime * 1000).toISOString() },
      replayInterval: "auto",
      speed,
      tracks: [{ slot: 0, symbol, chartTimeframe: timeframe }],
    })
      .then(async (snapshot) => {
        if (cancelled) {
          await closeReplaySession(snapshot.id).catch(() => undefined);
          return;
        }
        sessionRef.current = snapshot.id;
        configurationRef.current = configuration;
        previousLegacyTime.current = cursorTime;
        replayClientStore.replaceSnapshot(snapshot);
        const socket = new ReplaySocket(snapshot.id);
        socketRef.current = socket;
        await socket.connect();
        if (!cancelled && sessionRef.current === snapshot.id) {
          setSessionEpoch((value) => value + 1);
        }
      })
      .catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("[replay-shadow] backend session unavailable", error);
        }
      });
    return () => {
      cancelled = true;
    };
    // cursorTime/speed are creation values; subsequent changes are mirrored by
    // the command effect below and must not recreate the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, symbol, timeframe]);

  useEffect(() => {
    if (!isReplayBackendV1Enabled() || !active || !sessionRef.current) return;
    const sessionId = sessionRef.current;
    const enqueue = (type: ReplayCommandInput["type"], payload?: Record<string, unknown>) => {
      commandChain.current = commandChain.current.then(async () => {
        const snapshot = replayClientStore.getState().snapshot;
        if (!snapshot || snapshot.id !== sessionId || snapshot.status === "closed") return;
        const result = await sendReplayCommand(sessionId, {
          idempotencyKey: commandKey(type),
          expectedVersion: snapshot.version,
          type,
          payload,
        });
        replayClientStore.replaceSnapshot(result.snapshot);
        await Promise.all(result.snapshot.tracks.map(async (track) => {
          const revealed = await getReplayTrackBars(result.snapshot.id, track.id);
          replayClientStore.replaceBars(revealed.sessionId, revealed.trackId, revealed.bars);
        }));
      }).catch((error) => {
        if (process.env.NODE_ENV === "development") console.warn("[replay-shadow] command failed", error);
      });
    };

    const server = replayClientStore.getState().snapshot;
    if (!server) return;
    if (server.speed !== speed) enqueue("set_speed", { speed });
    if (playing && server.status === "paused") enqueue("play");
    if (!playing && server.status === "playing") enqueue("pause");

    const previous = previousLegacyTime.current;
    previousLegacyTime.current = cursorTime;
    if (!playing && cursorTime != null && previous != null && cursorTime !== previous) {
      const interval = server.replayIntervalSeconds;
      const delta = cursorTime - previous;
      const count = Math.round(delta / interval);
      if (delta > 0 && count >= 1 && count <= 100 && Math.abs(delta - count * interval) < 1) {
        enqueue("step", { count });
      } else {
        enqueue("seek", { time: new Date(cursorTime * 1000).toISOString() });
      }
    }
  }, [active, cursorTime, playing, speed, sessionEpoch]);

  useEffect(() => {
    if (!isReplayBackendV1Enabled() || process.env.NODE_ENV !== "development") return;
    return replayClientStore.subscribe(({ snapshot }) => {
      const legacyTime = previousLegacyTime.current;
      const serverTime = snapshot?.tracks[0]?.visibleThrough;
      if (legacyTime == null || !serverTime || !snapshot) return;
      const divergenceSeconds = Math.abs(Date.parse(serverTime) / 1000 - legacyTime);
      if (divergenceSeconds >= snapshot.replayIntervalSeconds) {
        console.warn("[replay-shadow] cursor divergence", {
          sessionId: snapshot.id,
          divergenceSeconds,
          legacyTime,
          serverTime,
        });
      }
    });
  }, []);
}
