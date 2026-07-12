/**
 * Command pattern for undo/redo support.
 *
 * Every mutating drawing operation is encapsulated as a Command
 * with execute() and undo(). The CommandManager maintains two stacks:
 * undoStack (past) and redoStack (future).
 *
 * Snapshots are NOT used — each command stores only the delta.
 */
import type { Drawing, Point } from "@/types";
import { uid } from "../../../../utils/id";

export interface Command {
  /** Human-readable label (for UI display). */
  readonly label: string;
  /** Apply the command. */
  execute(): void;
  /** Reverse the command. */
  undo(): void;
}

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  /** Execute a command and push it onto the undo stack. */
  execute(cmd: Command): void {
    cmd.execute();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift(); // drop oldest
    }
    this.redoStack = []; // new action invalidates redo
  }

  /** Undo the last command. */
  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  /** Redo the last undone command. */
  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Clear all history. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Get the last command label (for UI). */
  get lastUndoLabel(): string | null {
    return this.undoStack.length > 0
      ? this.undoStack[this.undoStack.length - 1].label
      : null;
  }
}

// ---- Built-in command types ----

/** Creates a new drawing. Undo removes it. */
export class CreateDrawingCommand implements Command {
  readonly label = "Create Drawing";
  constructor(
    private addFn: (d: Drawing) => void,
    private removeFn: (id: string) => void,
    private drawing: Drawing,
  ) {}
  execute() {
    this.addFn(this.drawing);
  }
  undo() {
    this.removeFn(this.drawing.id);
  }
}

/** Removes a drawing. Undo recreates it. */
export class DeleteDrawingCommand implements Command {
  readonly label = "Delete Drawing";
  constructor(
    private addFn: (d: Drawing) => void,
    private removeFn: (id: string) => void,
    private drawing: Drawing,
  ) {}
  execute() {
    this.removeFn(this.drawing.id);
  }
  undo() {
    this.addFn(this.drawing);
  }
}

/** Deletes several drawings as one undo/redo transaction. */
export class DeleteDrawingsCommand implements Command {
  readonly label = "Delete Drawings";
  constructor(
    private addFn: (drawing: Drawing) => void,
    private removeFn: (id: string) => void,
    private drawings: readonly Drawing[],
    private onExecute?: () => void,
    private onUndo?: () => void,
  ) {}
  execute() {
    for (const drawing of this.drawings) this.removeFn(drawing.id);
    this.onExecute?.();
  }
  undo() {
    for (const drawing of [...this.drawings].sort(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
    )) {
      this.addFn(drawing);
    }
    this.onUndo?.();
  }
}

/** Moves/resizes a drawing (point change). Undo restores original points. */
export class MoveDrawingCommand implements Command {
  readonly label = "Move Drawing";
  constructor(
    private updateFn: (arg: { id: string; patch: Partial<Drawing> }) => void,
    private drawingId: string,
    private newPoints: Point[],
    private oldPoints: Point[],
  ) {}
  execute() {
    this.updateFn({ id: this.drawingId, patch: { points: this.newPoints } });
  }
  undo() {
    this.updateFn({ id: this.drawingId, patch: { points: this.oldPoints } });
  }
}

/** Duplicates a drawing. Undo removes the copy. */
export class DuplicateDrawingCommand implements Command {
  readonly label = "Duplicate Drawing";
  private copyId: string | null = null;
  constructor(
    private addFn: (d: Drawing) => void,
    private removeFn: (id: string) => void,
    private sourceDrawing: Drawing,
    /** Invoked with the created copy right after it's added — e.g. to select it. */
    private onCreated?: (copy: Drawing) => void,
  ) {}
  execute() {
    // Always generate a fresh valid ID to prevent empty-id corruption.
    this.copyId = uid("dw");
    const copy: Drawing = {
      ...this.sourceDrawing,
      id: this.copyId,
      points: this.sourceDrawing.points.map((p) => ({ ...p })),
    };
    this.addFn(copy);
    this.onCreated?.(copy);
  }
  undo() {
    if (this.copyId) this.removeFn(this.copyId);
  }
}

/** Changes drawing properties (color, style, locked, hidden, etc.). */
export class PropertyChangeCommand implements Command {
  readonly label = "Change Properties";
  constructor(
    private updateFn: (arg: { id: string; patch: Partial<Drawing> }) => void,
    private drawingId: string,
    private newProps: Partial<Drawing>,
    private oldProps: Partial<Drawing>,
  ) {}
  execute() {
    this.updateFn({ id: this.drawingId, patch: this.newProps });
  }
  undo() {
    this.updateFn({ id: this.drawingId, patch: this.oldProps });
  }
}

export interface DrawingPropertyChange {
  id: string;
  newProps: Partial<Drawing>;
  oldProps: Partial<Drawing>;
}

/** Applies a multi-object mutation as one undo/redo history entry. */
export class BatchPropertyChangeCommand implements Command {
  constructor(
    private updateFn: (arg: { id: string; patch: Partial<Drawing> }) => void,
    private changes: readonly DrawingPropertyChange[],
    readonly label = "Change Objects",
  ) {}
  execute() {
    for (const change of this.changes) {
      this.updateFn({ id: change.id, patch: change.newProps });
    }
  }
  undo() {
    for (const change of [...this.changes].reverse()) {
      this.updateFn({ id: change.id, patch: change.oldProps });
    }
  }
}

/**
 * Records a property edit that has already been previewed in the store.
 * The first execute is intentionally a no-op; redo applies the committed state.
 */
export class PreviewedPropertyChangeCommand implements Command {
  readonly label = "Change Properties";
  private recorded = false;
  constructor(
    private updateFn: (arg: { id: string; patch: Partial<Drawing> }) => void,
    private drawingId: string,
    private newProps: Partial<Drawing>,
    private oldProps: Partial<Drawing>,
  ) {}
  execute() {
    if (!this.recorded) {
      this.recorded = true;
      return;
    }
    this.updateFn({ id: this.drawingId, patch: this.newProps });
  }
  undo() {
    this.updateFn({ id: this.drawingId, patch: this.oldProps });
  }
}

/** One history shared by chart interactions and settings transactions. */
export const drawingCommandManager = new CommandManager();
