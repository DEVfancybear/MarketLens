"use client";
import { useMemo } from "react";
import {
  drawingCommandManager,
  type CommandManager,
  MoveDrawingCommand,
  DeleteDrawingCommand,
  type Command,
} from "../history/CommandManager";
import type { Drawing, Point } from "@/types";

export interface UseCommandHistory {
  manager: CommandManager;
  /** Schedule a move commit (called on pointerup after drag). */
  commitMove: (id: string, newPoints: Point[], oldPoints: Point[]) => void;
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
): UseCommandHistory {
  const commitMove = (id: string, newPoints: Point[], oldPoints: Point[]) => {
    drawingCommandManager.execute(
      new MoveDrawingCommand(updateDrawing, id, newPoints, oldPoints),
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
