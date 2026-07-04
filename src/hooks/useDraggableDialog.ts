"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Bounds = Size;

export type DialogPosition = { left: number; top: number };

export type DraggableDialogOptions = {
  boundsMargin?: number;
  initialPosition?: () => DialogPosition | null;
};

const DEFAULT_BOUNDS_MARGIN = 8;
const INTERACTIVE_SELECTOR =
  "button,input,textarea,select,a,[role='button'],[data-dialog-no-drag]";

function viewportBounds(): Bounds {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export function clampDialogPosition(
  position: DialogPosition,
  dialogSize: Size,
  bounds: Bounds,
  margin = DEFAULT_BOUNDS_MARGIN,
): DialogPosition {
  const maxLeft = Math.max(margin, bounds.width - dialogSize.width - margin);
  const maxTop = Math.max(margin, bounds.height - dialogSize.height - margin);
  return {
    left: Math.min(Math.max(position.left, margin), maxLeft),
    top: Math.min(Math.max(position.top, margin), maxTop),
  };
}

function elementSize(element: HTMLElement): Size {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function eventTargetIsInteractive(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(INTERACTIVE_SELECTOR);
}

export function useDraggableDialog(options: DraggableDialogOptions = {}) {
  const { boundsMargin = DEFAULT_BOUNDS_MARGIN, initialPosition } = options;
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    pointerStart: Point;
    dialogStart: DialogPosition;
    dialogSize: Size;
  } | null>(null);
  const [position, setPosition] = useState<DialogPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const measured = element.getBoundingClientRect();
    const nextPosition = initialPosition?.() ?? {
      left: measured.left,
      top: measured.top,
    };
    setPosition(
      clampDialogPosition(
        nextPosition,
        { width: measured.width, height: measured.height },
        viewportBounds(),
        boundsMargin,
      ),
    );
  }, [boundsMargin, initialPosition]);

  useLayoutEffect(() => {
    if (!position) return;
    const onResize = () => {
      const element = dialogRef.current;
      if (!element) return;
      setPosition((current) =>
        current
          ? clampDialogPosition(
              current,
              elementSize(element),
              viewportBounds(),
              boundsMargin,
            )
          : current,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [boundsMargin, position]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || eventTargetIsInteractive(event.target)) return;
      const element = dialogRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const start = position ?? { left: rect.left, top: rect.top };
      dragRef.current = {
        pointerId: event.pointerId,
        pointerStart: { x: event.clientX, y: event.clientY },
        dialogStart: start,
        dialogSize: { width: rect.width, height: rect.height },
      };
      setPosition(start);
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [position],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const next = {
        left: drag.dialogStart.left + event.clientX - drag.pointerStart.x,
        top: drag.dialogStart.top + event.clientY - drag.pointerStart.y,
      };
      setPosition(
        clampDialogPosition(
          next,
          drag.dialogSize,
          viewportBounds(),
          boundsMargin,
        ),
      );
    },
    [boundsMargin],
  );

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const dialogStyle = useMemo<CSSProperties>(
    () =>
      position
        ? {
            position: "fixed",
            left: position.left,
            top: position.top,
            margin: 0,
          }
        : {},
    [position],
  );

  return {
    dialogRef,
    dialogStyle,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
    },
    dragHandleClassName: dragging ? "cursor-grabbing select-none" : "cursor-move",
    dragging,
  };
}
