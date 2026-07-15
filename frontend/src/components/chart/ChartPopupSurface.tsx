"use client";

import { GripVertical } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useDraggableSurface } from "@/hooks/useDraggableSurface";
import { cn } from "@/utils/cn";

type ChartPopupSurfaceProps = {
  dragLabel: string;
  children: ReactNode;
  handleClassName?: string;
  showDragHandle?: boolean;
  resetKey?: unknown;
  dragHandleRole?: ButtonHTMLAttributes<HTMLButtonElement>["role"];
  onDismiss?: () => void;
  consumeOutsidePointerDown?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

function setForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export const ChartPopupSurface = forwardRef<HTMLDivElement, ChartPopupSurfaceProps>(
  function ChartPopupSurface({
    dragLabel,
    children,
    className,
    handleClassName,
    showDragHandle = true,
    resetKey,
    dragHandleRole,
    onDismiss,
    consumeOutsidePointerDown = false,
    ...props
  }, forwardedRef) {
    const {
      surfaceRef,
      surfaceStyle,
      dragHandleProps,
      dragHandleClassName,
      dragging,
      resetPosition,
    } = useDraggableSurface({ resetKey });
    const mergeSurfaceRef = useCallback((element: HTMLDivElement | null) => {
      surfaceRef.current = element;
      setForwardedRef(forwardedRef, element);
    }, [forwardedRef, surfaceRef]);

    useEffect(() => {
      if (!onDismiss) return;
      const handlePointerDown = (event: PointerEvent) => {
        const element = surfaceRef.current;
        if (!element || element.contains(event.target as Node)) return;
        if (consumeOutsidePointerDown) {
          event.preventDefault();
          event.stopPropagation();
        }
        onDismiss();
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") onDismiss();
      };
      window.addEventListener("pointerdown", handlePointerDown, true);
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("pointerdown", handlePointerDown, true);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [consumeOutsidePointerDown, onDismiss, surfaceRef]);

    return (
      <div
        {...props}
        ref={mergeSurfaceRef}
        data-chart-ui
        data-chart-popup
        data-dragging={dragging || undefined}
        className={cn("chart-popup-draggable", className)}
        style={{ ...props.style, ...surfaceStyle }}
      >
        {showDragHandle && (
          <ChartPopupDragHandle
            {...dragHandleProps}
            role={dragHandleRole}
            label={dragLabel}
            onDoubleClick={resetPosition}
            className={cn(dragHandleClassName, handleClassName)}
          />
        )}
        {children}
      </div>
    );
  },
);

export function ChartPopupDragHandle({
  label,
  className,
  ...props
}: {
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      data-chart-popup-drag-handle
      aria-label={`${label}. Use drag or arrow keys to move; Home resets the position.`}
      title={`${label} (drag, arrow keys, or Home to reset)`}
      className={cn("chart-popup-drag-handle", className)}
    >
      <GripVertical size={16} aria-hidden="true" />
    </button>
  );
}
