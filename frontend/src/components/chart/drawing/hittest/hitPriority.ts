export type HitPriorityTarget = "body" | string;

export interface HitPriorityInput {
  target: HitPriorityTarget;
  distance: number;
}

export function hitPriorityScore(hit: HitPriorityInput, zIndex: number): number {
  const isAnchor = hit.target !== "body" ? 1 : 0;
  return isAnchor * 1e12 + zIndex * 1e6 + (1000 - Math.min(hit.distance, 999));
}
