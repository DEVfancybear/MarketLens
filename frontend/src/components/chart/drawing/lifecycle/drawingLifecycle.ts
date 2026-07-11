import type { Drawing } from "../../../../types/drawing";

export interface ResolvedDrawingHit {
  status: "tp_hit" | "sl_hit";
  time: number;
  price: number;
}

export interface DrawingLifecycleUpdate {
  id: string;
  patch: Partial<Drawing>;
}

export interface ReconcileDrawingLifecycleOptions<TSample> {
  drawings: readonly Drawing[];
  samples: readonly TSample[];
  draggingId: string | null;
  isEligible: (drawing: Drawing) => boolean;
  resolveHit: (drawing: Drawing, samples: readonly TSample[]) => ResolvedDrawingHit | null;
  samplesCoverEntry: (drawing: Drawing, samples: readonly TSample[]) => boolean;
}

export function reconcileDrawingLifecycle<TSample>(
  options: ReconcileDrawingLifecycleOptions<TSample>,
): { hasEligible: boolean; updates: DrawingLifecycleUpdate[] } {
  const updates: DrawingLifecycleUpdate[] = [];
  let hasEligible = false;
  for (const drawing of options.drawings) {
    if (!options.isEligible(drawing)) continue;
    hasEligible = true;
    if (drawing.id === options.draggingId || drawing.points.length < 3) continue;

    const entryTime = drawing.points[0].time;
    const resolved = options.resolveHit(drawing, options.samples);
    const hit = resolved
      ? {
          status: resolved.status,
          time: resolved.time - entryTime,
          price: resolved.price,
        }
      : null;
    if (hit) {
      if (
        drawing.tradeStatus !== hit.status ||
        drawing.hitTime !== hit.time ||
        drawing.hitPrice !== hit.price
      ) {
        updates.push({
          id: drawing.id,
          patch: {
            tradeStatus: hit.status,
            hitTime: hit.time,
            hitPrice: hit.price,
          },
        });
      }
      continue;
    }
    if (
      options.samplesCoverEntry(drawing, options.samples) &&
      (drawing.tradeStatus === "tp_hit" || drawing.tradeStatus === "sl_hit")
    ) {
      updates.push({
        id: drawing.id,
        patch: {
          tradeStatus: undefined,
          hitTime: undefined,
          hitPrice: undefined,
        },
      });
    }
  }
  return { hasEligible, updates };
}
