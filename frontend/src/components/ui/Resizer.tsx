'use client';
import { cn } from '@/utils/cn';
import { useResizable } from '@/hooks/useResizable';

interface Props {
  axis: 'col' | 'row';
  edge: 'left' | 'right' | 'top' | 'bottom';
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}

/** Draggable divider between two panels. */
export function Resizer(props: Props) {
  const { onPointerDown, active } = useResizable(props);
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        'resizer bg-terminal-border/50 transition-colors',
        props.axis === 'col' ? 'resizer-col' : 'resizer-row',
        active && 'resizer-active',
      )}
    />
  );
}
