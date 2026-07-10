import {
  getReplaySession,
  type ReplaySessionSnapshot,
} from "@/services/api/resources/replayApi";
import { isReplayBackendV1Enabled } from "./backendReplayFlag";

export { isReplayBackendV1Enabled } from "./backendReplayFlag";

/** Phase 1 is intentionally read-only from the active Replay UI. */
export async function inspectReplaySession(
  sessionId: string,
): Promise<ReplaySessionSnapshot | null> {
  if (!isReplayBackendV1Enabled()) return null;
  return getReplaySession(sessionId);
}
