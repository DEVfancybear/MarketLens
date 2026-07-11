import type { Drawing } from "../../../../types/drawing";

type DrawingRecord = Record<string, unknown>;

function record(drawing: Drawing): DrawingRecord {
  return drawing as unknown as DrawingRecord;
}

function keysOf(a: Drawing, b: Drawing): Set<string> {
  return new Set([...Object.keys(a), ...Object.keys(b)]);
}

export function buildDrawingSettingsRevert(
  current: Drawing,
  snapshot: Drawing,
): Partial<Drawing> {
  const revert: DrawingRecord = {};
  for (const key of keysOf(current, snapshot)) revert[key] = record(snapshot)[key];
  return revert as Partial<Drawing>;
}

export function buildDrawingSettingsCommit(
  current: Drawing,
  snapshot: Drawing,
): { before: Partial<Drawing>; after: Partial<Drawing> } | null {
  const before: DrawingRecord = {};
  const after: DrawingRecord = {};
  for (const key of keysOf(current, snapshot)) {
    if (key === "id" || key === "tool") continue;
    const oldValue = record(snapshot)[key];
    const newValue = record(current)[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      before[key] = structuredClone(oldValue);
      after[key] = structuredClone(newValue);
    }
  }
  return Object.keys(after).length
    ? { before: before as Partial<Drawing>, after: after as Partial<Drawing> }
    : null;
}
