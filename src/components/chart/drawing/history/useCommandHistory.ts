"use client";
import { useRef, useMemo } from "react";
import {
  CommandManager,
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
  updateDrawing: (id: string, patch: Partial<Drawing>) => void,
): UseCommandHistory {
  const managerRef = useRef(new CommandManager());

  const commitMove = (id: string, newPoints: Point[], oldPoints: Point[]) => {
    managerRef.current.execute(
      new MoveDrawingCommand(updateDrawing, id, newPoints, oldPoints),
    );
  };

  const commitDelete = (drawing: Drawing, addFn: (d: Drawing) => void) => {
    managerRef.current.execute(
      new DeleteDrawingCommand(addFn, removeDrawing, drawing),
    );
  };

  const execute = (cmd: Command) => {
    managerRef.current.execute(cmd);
  };

  return useMemo(
    () => ({
      manager: managerRef.current,
      commitMove,
      commitDelete,
      execute,
      undo: () => managerRef.current.undo(),
      redo: () => managerRef.current.redo(),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [],
  );
}
