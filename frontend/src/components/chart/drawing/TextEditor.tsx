"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { clampTextEditorPosition } from "./textEditorGeometry";

interface TextEditorProps {
  initialText: string;
  x: number;
  y: number;
  onSaveAction: (text: string) => void;
  onCancelAction: () => void;
  onDraftChangeAction?: (text: string) => void;
}

/**
 * Inline text editor rendered over the chart — TradingView-style.
 * Auto-focuses, selects all text, and handles Enter/Escape/blur.
 */
export function TextEditor({
  initialText,
  x,
  y,
  onSaveAction,
  onCancelAction,
  onDraftChangeAction,
}: TextEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [text, setText] = useState(initialText);
  const [position, setPosition] = useState({ left: x, top: y - 10 });

  const updatePosition = useCallback(() => {
    const editor = inputRef.current;
    const viewport = editor?.offsetParent as HTMLElement | null;
    if (!editor || !viewport) {
      setPosition({ left: x, top: y - 10 });
      return;
    }
    const next = clampTextEditorPosition({
      left: x,
      top: y - 10,
      editorWidth: editor.offsetWidth,
      editorHeight: editor.offsetHeight,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
    });
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  }, [x, y]);

  useLayoutEffect(() => {
    updatePosition();
    const editor = inputRef.current;
    const viewport = editor?.offsetParent as HTMLElement | null;
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    if (editor) observer?.observe(editor);
    if (viewport) observer?.observe(viewport);
    window.addEventListener("resize", updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialText) el.select();
  }, [initialText]);

  useEffect(() => {
    setText(initialText);
    doneRef.current = false;
  }, [initialText]);

  const commit = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = text.trim();
    if (trimmed) onSaveAction(trimmed);
    else onCancelAction();
  }, [onCancelAction, onSaveAction, text]);

  const cancel = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancelAction();
  }, [onCancelAction]);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && inputRef.current?.contains(target)) return;
      commit();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDown,
        true,
      );
    };
  }, [commit]);

  return (
    <input
      ref={inputRef}
      data-chart-ui
      data-inline-text-editor
      type="text"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        onDraftChangeAction?.(next);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        e.stopPropagation();
      }}
      onBlur={commit}
      className="absolute z-[100] rounded border border-brand bg-terminal-panel px-2 py-0.5 text-xs text-ink outline-none"
      style={{
        left: position.left,
        top: position.top,
        minWidth: 80,
        maxWidth: "calc(100% - 8px)",
        pointerEvents: "auto",
      }}
      placeholder="Enter text..."
      spellCheck={false}
    />
  );
}
