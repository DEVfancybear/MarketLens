export interface PositionLabelCandidate<T extends string = string> {
  id: T;
  y: number;
  height: number;
}

export interface PositionLabelPlacement<T extends string = string>
  extends PositionLabelCandidate<T> {
  top: number;
}

/** Clamp labels to the pane and resolve vertical collisions in input priority. */
export function layoutPositionLabels<T extends string>(
  labels: readonly PositionLabelCandidate<T>[],
  top: number,
  bottom: number,
  gap = 2,
): PositionLabelPlacement<T>[] {
  const placements: PositionLabelPlacement<T>[] = [];
  for (const label of labels) {
    const maxTop = Math.max(top, bottom - label.height);
    let candidateTop = Math.max(top, Math.min(maxTop, label.y - label.height));
    for (const placed of placements) {
      const overlaps =
        candidateTop < placed.top + placed.height + gap &&
        candidateTop + label.height + gap > placed.top;
      if (overlaps) candidateTop = placed.top + placed.height + gap;
    }
    candidateTop = Math.max(top, Math.min(maxTop, candidateTop));
    placements.push({ ...label, top: candidateTop });
  }
  return placements;
}
