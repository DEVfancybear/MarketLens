"use client";
import { useEffect, useRef, useState } from "react";
import { useChartCtx } from "@/components/chart/ChartContext";

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
  const ctx = useChartCtx();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (initialText) el.select();
  }, [initialText]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed) onSaveAction(trimmed);
    else onCancelAction();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancelAction();
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
