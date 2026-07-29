"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { resolveCenteredTextEditorPosition } from "./textEditorGeometry";

interface TextEditorProps {
  initialText: string;
  x: number;
  y: number;
  width?: number;
  angle?: number;
  offsetY?: number;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  textAlign?: "left" | "center" | "right";
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
  width = 160,
  angle = 0,
  offsetY = 0,
  fontSize = 13,
  fontWeight = 400,
  italic = false,
  color,
  textAlign = "center",
  onSaveAction,
  onCancelAction,
  onDraftChangeAction,
}: TextEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const [text, setText] = useState(initialText);
  const [position, setPosition] = useState({ x, y });

  const updatePosition = useCallback(() => {
    const editor = inputRef.current;
    const viewport = editor?.offsetParent as HTMLElement | null;
    if (!editor || !viewport) {
      setPosition({ x, y });
      return;
    }
    const next = resolveCenteredTextEditorPosition({
      x,
      y,
      editorWidth: editor.offsetWidth,
      editorHeight: editor.offsetHeight,
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      angleDegrees: angle,
      offsetY,
    });
    setPosition((current) =>
      current.x === next.x && current.y === next.y ? current : next,
    );
  }, [angle, offsetY, x, y]);

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
      aria-label="Edit drawing text"
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
      className="absolute z-[100] appearance-none border-0 bg-transparent p-0 text-ink outline-none shadow-none ring-0 placeholder:text-current placeholder:opacity-70 focus:border-transparent focus:bg-transparent focus:outline-none focus:ring-0"
      style={{
        left: position.x,
        top: position.y,
        width,
        height: Math.max(20, Math.ceil(fontSize * 1.4)),
        maxWidth: "calc(100% - 8px)",
        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
        transformOrigin: "center",
        pointerEvents: "auto",
        border: 0,
        borderRadius: 0,
        background: "transparent",
        boxShadow: "none",
        color,
        caretColor: color ?? "currentColor",
        fontFamily: "var(--font-sans)",
        fontSize,
        fontStyle: italic ? "italic" : "normal",
        fontWeight,
        lineHeight: 1.25,
        padding: 0,
        textAlign,
        WebkitAppearance: "none",
      }}
      placeholder="Add text"
      spellCheck={false}
    />
  );
}
