"use client";
import { useMemo } from "react";
import {
  drawingCommandManager,
  type CommandManager,
  BatchMoveDrawingsCommand,
  MoveDrawingCommand,
  DeleteDrawingCommand,
  type BatchDrawingUpdate,
  type Command,
  type DrawingMoveChange,
} from "../history/CommandManager";
import type { Drawing, Point } from "@/types";

export interface UseCommandHistory {
  manager: CommandManager;
  /** Schedule a move commit (called on pointerup after drag). */
  commitMove: (id: string, newPoints: Point[], oldPoints: Point[]) => void;
  /** Commit a group move/resize with one atomic write and one history entry. */
  commitMoves: (changes: readonly DrawingMoveChange[]) => void;
  /** Schedule a delete commit. */
  commitDelete: (drawing: Drawing, addFn: (d: Drawing) => void) => void;
  /** Execute a generic command. */
  execute: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
}

export function useCommandHistory(
  addDrawing: (d: Drawing) => void,
  removeDrawing: (id: string) => void,
  updateDrawing: (arg: { id: string; patch: Partial<Drawing> }) => void,
  updateDrawings?: BatchDrawingUpdate,
): UseCommandHistory {
  const commitMove = (id: string, newPoints: Point[], oldPoints: Point[]) => {
    drawingCommandManager.execute(
      new MoveDrawingCommand(updateDrawing, id, newPoints, oldPoints),
    );
  };

  const commitMoves = (changes: readonly DrawingMoveChange[]) => {
    if (changes.length === 0) return;
    const updateBatch: BatchDrawingUpdate = updateDrawings ?? ((updates) => {
      for (const update of updates) updateDrawing(update);
    });
    drawingCommandManager.execute(
      new BatchMoveDrawingsCommand(updateBatch, changes),
    );
  };

  const commitDelete = (drawing: Drawing, addFn: (d: Drawing) => void) => {
    drawingCommandManager.execute(
      new DeleteDrawingCommand(addFn, removeDrawing, drawing),
    );
  };

  const execute = (cmd: Command) => {
    drawingCommandManager.execute(cmd);
  };

  return useMemo(
    () => ({
      manager: drawingCommandManager,
      commitMove,
      commitMoves,
      commitDelete,
      execute,
      undo: () => drawingCommandManager.undo(),
      redo: () => drawingCommandManager.redo(),
    }),
    // The shared manager is stable for the lifetime of the chart application.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}
