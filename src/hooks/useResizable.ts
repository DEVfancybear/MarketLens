'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp } from '@/utils/math';

interface Options {
  /** 'col' drags horizontally (width), 'row' drags vertically (height). */
  axis: 'col' | 'row';
  /** Drag from this edge. For 'col' a 'right' panel grows when dragged left. */
  edge: 'left' | 'right' | 'top' | 'bottom';
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}

/**
 * Generic resizer. Attach `onPointerDown` to a handle element; the hook
 * tracks the pointer and reports the new size, clamped to [min, max].
 */
export function useResizable({ axis, edge, min, max, value, onChange }: Options) {
  const [active, setActive] = useState(false);
  const start = useRef({ pos: 0, size: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      start.current = { pos: axis === 'col' ? e.clientX : e.clientY, size: value };
      setActive(true);
    },
    [axis, value],
  );

  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      const pos = axis === 'col' ? e.clientX : e.clientY;
      let delta = pos - start.current.pos;
      // For panels anchored to the right/bottom, dragging toward the centre grows them.
      if (edge === 'right' || edge === 'bottom') delta = -delta;
      onChange(clamp(start.current.size + delta, min, max));
    };
    const up = () => setActive(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [active, axis, edge, min, max, onChange]);

  return { onPointerDown, active };
}
