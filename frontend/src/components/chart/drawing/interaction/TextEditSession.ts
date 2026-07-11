import type { Drawing, Point } from "../../../../types/drawing";
import type { DrawingToolManifestEntry } from "../../../../types/drawingToolManifest";

export type AttachedTextEditorKind = NonNullable<DrawingToolManifestEntry["selectionTextEditor"]>;

export type TextEditOutcome =
  | { kind: "create"; placeholderId: string; drawing: Drawing }
  | { kind: "update"; drawingId: string; oldText: string; newText: string }
  | { kind: "cancel-create"; placeholderId: string }
  | { kind: "close" };

export class TextEditSession {
  private constructor(
    readonly drawing: Drawing,
    readonly editorKind: "standalone" | AttachedTextEditorKind,
    readonly draftText: string,
    readonly screenPoint?: { x: number; y: number },
  ) {}

  static standalone(
    drawing: Drawing,
    screenPoint: { x: number; y: number },
  ): TextEditSession {
    return new TextEditSession(drawing, "standalone", drawing.text ?? "", screenPoint);
  }

  static attached(
    drawing: Drawing,
    editorKind: AttachedTextEditorKind,
  ): TextEditSession {
    return new TextEditSession(drawing, editorKind, drawing.text ?? "");
  }

  get drawingId(): string {
    return this.drawing.id;
  }

  get initialText(): string {
    return this.drawing.text ?? "";
  }

  withDraft(draftText: string): TextEditSession {
    return new TextEditSession(this.drawing, this.editorKind, draftText, this.screenPoint);
  }

  finish(text = this.draftText, allowEmpty = true): TextEditOutcome {
    const nextText = allowEmpty ? text : text.trim();
    if (this.editorKind === "standalone") {
      return nextText
        ? {
            kind: "create",
            placeholderId: this.drawing.id,
            drawing: { ...this.drawing, text: nextText, points: clonePoints(this.drawing.points) },
          }
        : { kind: "cancel-create", placeholderId: this.drawing.id };
    }
    if (!allowEmpty && !nextText) return { kind: "close" };
    if (nextText === this.initialText) return { kind: "close" };
    return {
      kind: "update",
      drawingId: this.drawing.id,
      oldText: this.initialText,
      newText: nextText,
    };
  }

  cancel(): TextEditOutcome {
    return this.editorKind === "standalone"
      ? { kind: "cancel-create", placeholderId: this.drawing.id }
      : { kind: "close" };
  }
}

function clonePoints(points: readonly Point[]): Point[] {
  return points.map((point) => ({ ...point }));
}
