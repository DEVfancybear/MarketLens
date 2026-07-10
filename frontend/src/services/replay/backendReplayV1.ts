import {
  getReplaySession,
  getReplayTrackBars,
  type ReplaySessionSnapshot,
} from "@/services/api/resources/replayApi";
import { isReplayBackendV1Enabled } from "./backendReplayFlag";
import { replayClientStore } from "@/store/replayClientStore";

export { isReplayBackendV1Enabled } from "./backendReplayFlag";

/** Fetch and hydrate the backend projection without mutating the legacy cursor. */
export async function inspectReplaySession(
  sessionId: string,
): Promise<ReplaySessionSnapshot | null> {
  if (!isReplayBackendV1Enabled()) return null;
  const snapshot = await getReplaySession(sessionId);
  replayClientStore.replaceSnapshot(snapshot);
  await Promise.all(snapshot.tracks.map(async (track) => {
    const revealed = await getReplayTrackBars(snapshot.id, track.id);
    replayClientStore.replaceBars(revealed.sessionId, revealed.trackId, revealed.bars);
  }));
  return snapshot;
}
