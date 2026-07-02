"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface TextEditorProps {
  initialText: string;
  x: number;
  y: number;
  onSaveAction: (text: string) => void;
  onCancelAction: () => void;
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
}: TextEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [text, setText] = useState(initialText);

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
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
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
        left: x,
        top: y - 10,
        minWidth: 80,
        pointerEvents: "auto",
      }}
      placeholder="Enter text..."
      spellCheck={false}
    />
  );
}
