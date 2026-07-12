import type { Drawing, DrawingTool } from "../../../../types";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import { uid } from "../../../../utils/id";

export const MAX_DRAWING_OBJECT_NAME_LENGTH = 120;

export type DrawingObjectTreeNode =
  | { kind: "drawing"; drawing: Drawing }
  | {
      kind: "group";
      id: string;
      name: string;
      drawings: Drawing[];
      zIndex: number;
    };

export function normalizeDrawingObjectName(value: string): string | undefined {
  const normalized = value.trim().slice(0, MAX_DRAWING_OBJECT_NAME_LENGTH);
  return normalized || undefined;
}

export function drawingObjectLabel(
  drawing: { name?: string; tool: DrawingTool },
): string {
  return normalizeDrawingObjectName(drawing.name ?? "") ??
    getDrawingToolManifestEntry(drawing.tool as DrawingTool).displayName;
}

/** Builds the visible stacking tree, highest layer first. */
export function buildDrawingObjectTree(
  drawings: readonly Drawing[],
): DrawingObjectTreeNode[] {
  const groups = new Map<string, Extract<DrawingObjectTreeNode, { kind: "group" }>>();
  const nodes: DrawingObjectTreeNode[] = [];
  for (const drawing of drawings) {
    if (!drawing.group) {
      nodes.push({ kind: "drawing", drawing });
      continue;
    }
    const existing = groups.get(drawing.group.id);
    if (existing) {
      existing.drawings.push(drawing);
      existing.zIndex = Math.max(existing.zIndex, drawing.zIndex ?? 0);
    } else {
      const group: Extract<DrawingObjectTreeNode, { kind: "group" }> = {
        kind: "group",
        id: drawing.group.id,
        name: drawing.group.name,
        drawings: [drawing],
        zIndex: drawing.zIndex ?? 0,
      };
      groups.set(group.id, group);
      nodes.push(group);
    }
  }
  for (const group of groups.values()) {
    group.drawings.sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0));
  }
  return nodes.sort((a, b) => {
    const az = a.kind === "drawing" ? (a.drawing.zIndex ?? 0) : a.zIndex;
    const bz = b.kind === "drawing" ? (b.drawing.zIndex ?? 0) : b.zIndex;
    return bz - az;
  });
}

export function createDrawingGroup(
  drawings: readonly Drawing[],
  name = "Group",
): NonNullable<Drawing["group"]> {
  const used = new Set(drawings.map((drawing) => drawing.group?.name).filter(Boolean));
  const base = normalizeDrawingObjectName(name) ?? "Group";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base} ${suffix++}`;
  return { id: uid("group"), name: candidate };
}

/** Produces contiguous z-indices after moving a tree node one slot. */
export function reorderDrawingObjectTree(
  drawings: readonly Drawing[],
  nodeId: string,
  direction: "up" | "down",
): Map<string, number> {
  const tree = buildDrawingObjectTree(drawings);
  const index = tree.findIndex((node) =>
    node.kind === "group" ? node.id === nodeId : node.drawing.id === nodeId,
  );
  if (index >= 0) {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= tree.length) return new Map();
    [tree[index], tree[target]] = [tree[target], tree[index]];
  } else {
    const group = tree.find(
      (node): node is Extract<DrawingObjectTreeNode, { kind: "group" }> =>
        node.kind === "group" && node.drawings.some((drawing) => drawing.id === nodeId),
    );
    if (!group) return new Map();
    const memberIndex = group.drawings.findIndex((drawing) => drawing.id === nodeId);
    const target = direction === "up" ? memberIndex - 1 : memberIndex + 1;
    if (target < 0 || target >= group.drawings.length) return new Map();
    [group.drawings[memberIndex], group.drawings[target]] = [
      group.drawings[target],
      group.drawings[memberIndex],
    ];
  }
  const ordered = tree.flatMap((node) =>
    node.kind === "group" ? node.drawings : [node.drawing],
  );
  const zIndices = new Map<string, number>();
  ordered.forEach((drawing, orderedIndex) => {
    zIndices.set(drawing.id, ordered.length - orderedIndex);
  });
  return zIndices;
}
