'use client';
import { cn } from '@/utils/cn';
import { useResizable } from '@/hooks/useResizable';
import { clamp } from '@/utils/math';

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
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    let delta = 0;
    if (props.axis === 'col' && event.key === 'ArrowLeft') delta = -step;
    if (props.axis === 'col' && event.key === 'ArrowRight') delta = step;
    if (props.axis === 'row' && event.key === 'ArrowUp') delta = -step;
    if (props.axis === 'row' && event.key === 'ArrowDown') delta = step;
    if (event.key === 'Home') {
      event.preventDefault();
      props.onChange(props.min);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      props.onChange(props.max);
      return;
    }
    if (!delta) return;
    event.preventDefault();
    if (props.edge === 'right' || props.edge === 'bottom') delta *= -1;
    props.onChange(clamp(props.value + delta, props.min, props.max));
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${props.axis === 'col' ? 'side' : 'bottom'} panel`}
      aria-orientation={props.axis === 'col' ? 'vertical' : 'horizontal'}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'resizer bg-terminal-border/50 transition-colors',
        props.axis === 'col' ? 'resizer-col' : 'resizer-row',
        active && 'resizer-active',
      )}
    />
  );
}
