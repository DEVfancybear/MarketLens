"use client";

import { useAtomValue, useSetAtom } from "jotai";
import type { Drawing } from "@/types";
import {
  addDrawingAtom,
  drawingsAtom,
  removeDrawingAtom,
  selectedDrawingIdsAtom,
  setSelectedDrawingIdsAtom,
  updateDrawingAtom,
} from "@/store/chartStore";
import {
  BatchPropertyChangeCommand,
  DeleteDrawingsCommand,
  drawingCommandManager,
} from "../history/CommandManager";
import {
  drawingBulkActionLabel,
  nextDrawingBulkPropertyValue,
  resolveDrawingBulkTargets,
  type DrawingBulkProperty,
  type DrawingBulkScope,
} from "./drawingBulkOperations";

export function useDrawingBulkActions() {
  const drawings = useAtomValue(drawingsAtom);
  const selectedIds = useAtomValue(selectedDrawingIdsAtom);
  const addDrawing = useSetAtom(addDrawingAtom);
  const removeDrawing = useSetAtom(removeDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const setSelected = useSetAtom(setSelectedDrawingIdsAtom);

  const targets = (scope: DrawingBulkScope) =>
    resolveDrawingBulkTargets(drawings, selectedIds, scope);

  const toggleProperty = (scope: DrawingBulkScope, property: DrawingBulkProperty) => {
    const items = targets(scope);
    if (items.length === 0) return;
    const value = nextDrawingBulkPropertyValue(items, property);
    drawingCommandManager.execute(new BatchPropertyChangeCommand(
      updateDrawing,
      items.map((drawing) => ({
        id: drawing.id,
        newProps: { [property]: value } as Partial<Drawing>,
        oldProps: { [property]: drawing[property] } as Partial<Drawing>,
      })),
      drawingBulkActionLabel(property, value),
    ));
    if (property === "visible" && value === false) {
      const affected = new Set(items.map((drawing) => drawing.id));
      setSelected([...selectedIds].filter((id) => !affected.has(id)));
    }
  };

  const remove = (scope: DrawingBulkScope) => {
    const items = targets(scope);
    if (items.length === 0) return;
    drawingCommandManager.execute(new DeleteDrawingsCommand(
      addDrawing,
      removeDrawing,
      items,
      () => setSelected([]),
      () => setSelected(items.map((drawing) => drawing.id)),
    ));
  };

  return {
    drawings,
    selectedIds,
    targets,
    toggleLock: (scope: DrawingBulkScope) => toggleProperty(scope, "locked"),
    toggleVisibility: (scope: DrawingBulkScope) => toggleProperty(scope, "visible"),
    remove,
  };
}
