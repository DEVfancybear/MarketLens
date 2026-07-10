'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Bell, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface WatchlistMenuState {
  ticker: string;
  x: number;
  y: number;
}

interface Props {
  state: WatchlistMenuState;
  onClose: () => void;
  onRemove: (ticker: string) => void;
  onCreateAlert: (ticker: string) => void;
  disableAlertCreation?: boolean;
}

/** Right-click context menu for a watchlist row. */
export function WatchlistContextMenu({ state, onClose, onRemove, onCreateAlert, disableAlertCreation }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let x = state.x;
    let y = state.y;
    if (x + width + pad > window.innerWidth) x = window.innerWidth - width - pad;
    if (y + height + pad > window.innerHeight) y = window.innerHeight - height - pad;
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [state.x, state.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const items = [
    { icon: <Bell size={14} className="text-choch" />, label: `Create Alert for ${state.ticker}`, onClick: act(() => onCreateAlert(state.ticker)), disabled: disableAlertCreation },
    { icon: <X size={14} className="text-bear" />, label: `Remove from Watchlist`, onClick: act(() => onRemove(state.ticker)) },
  ];

  return createPortal(
    <div
      ref={ref}
      className="context-menu-pop fixed z-[120] min-w-[200px] rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      <div className="px-3 py-1 text-2xs font-semibold text-ink-faint">{state.ticker}</div>
      <div className="my-1 h-px bg-terminal-border" />
      {items.map((it, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={it.disabled}
          onClick={it.onClick}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-ink transition-colors hover:bg-terminal-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
