import type { Drawing } from "@/types";

/** A single drawing mutation accepted by the atomic batch writer. */
export interface DrawingPatchUpdate {
  id: string;
  patch: Partial<Drawing>;
}

export interface DrawingBatchUpdateResult {
  /** The next collection. It is unchanged when no requested id exists. */
  drawings: Drawing[];
  /** Final updated value for every id touched by the batch. */
  updatedById: ReadonlyMap<string, Drawing>;
}

/**
 * Apply drawing patches without publishing intermediate collection states.
 *
 * Repeated ids retain the singular writer's sequential semantics: patches are
 * applied in request order and each patch advances clientRevision once.
 */
export function applyDrawingBatchUpdates(
  current: readonly Drawing[],
  updates: readonly DrawingPatchUpdate[],
): DrawingBatchUpdateResult {
  if (updates.length === 0) {
    return { drawings: current as Drawing[], updatedById: new Map() };
  }

  const updatesById = new Map<string, DrawingPatchUpdate[]>();
  for (const update of updates) {
    const queued = updatesById.get(update.id);
    if (queued) queued.push(update);
    else updatesById.set(update.id, [update]);
  }

  const updatedById = new Map<string, Drawing>();
  let changed = false;
  const drawings = current.map((drawing) => {
    const requested = updatesById.get(drawing.id);
    if (!requested) return drawing;

    changed = true;
    let next = drawing;
    for (const { patch } of requested) {
      next = {
        ...next,
        ...patch,
        clientRevision: (next.clientRevision ?? 0) + 1,
      };
    }
    updatedById.set(drawing.id, next);
    return next;
  });

  return {
    drawings: changed ? drawings : (current as Drawing[]),
    updatedById,
  };
}
