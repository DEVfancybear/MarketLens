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
      role="separator"
      tabIndex={0}
      aria-orientation={props.axis === 'col' ? 'vertical' : 'horizontal'}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      onKeyDown={(event) => {
        const decrease = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const increase = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        if (!decrease && !increase) return;
        event.preventDefault();
        const direction = decrease ? -1 : 1;
        const edgeDirection = props.edge === 'right' || props.edge === 'bottom' ? 1 : -1;
        props.onChange(Math.min(props.max, Math.max(props.min, props.value + direction * edgeDirection * 8)));
      }}
      className={cn(
        'resizer bg-terminal-border/40 transition-colors focus-visible:bg-brand',
        props.axis === 'col' ? 'resizer-col' : 'resizer-row',
        active && 'resizer-active',
      )}
    />
  );
}
