import type {
  BackendDrawing,
  BackendDrawingBatchRequest,
} from "@/services/api/resources/drawingsApi";

/**
 * Last-write-wins conflict policy: after observing the current server revision,
 * retry the pending local operation against that revision. Missing rows clear
 * the precondition so a later local create can resurrect a tombstoned client id.
 */
export function rebaseDrawingBatchForLastWriteWins(
  request: BackendDrawingBatchRequest,
  remote: readonly BackendDrawing[],
): BackendDrawingBatchRequest {
  const revisions = new Map(
    remote.map((row) => [row.clientId || row.payload.id, row.revision]),
  );
  return {
    upserts: request.upserts.map((item) => ({
      ...item,
      expectedRevision: revisions.get(item.clientId || item.payload.id),
    })),
    deletes: request.deletes.map((item) => ({
      ...item,
      expectedRevision: revisions.get(item.clientId || item.id || ""),
    })),
  };
}
