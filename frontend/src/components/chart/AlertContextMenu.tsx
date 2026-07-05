'use client';
/**
 * AlertContextMenu (Phase 2.1) — TradingView-style right-click / long-press menu
 * for a chart alert: Edit · Clone · Disable/Enable · Delete. Rendered via a
 * portal, clamped to the viewport, closes on outside-click / Esc.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Copy, BellOff, Bell, Trash2 } from 'lucide-react';
import { useAlertStore } from '@/store/alertStore';
import { cn } from '@/utils/cn';

export interface AlertMenuState {
  id: string;
  x: number;
  y: number;
}

export function AlertContextMenu({
  state,
  onClose,
  onEdit,
  onClone,
  onToggleEnabled,
  onDelete,
}: {
  state: AlertMenuState;
  onClose: () => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const alert = useAlertStore((s) => s.alerts.find((a) => a.id === state.id));
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

  if (typeof document === 'undefined' || !alert) return null;

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const items = [
    { icon: <Pencil size={14} className="text-ink-muted" />, label: 'Edit Alert', onClick: act(() => onEdit(alert.id)) },
    { icon: <Copy size={14} className="text-ink-muted" />, label: 'Clone Alert', onClick: act(() => onClone(alert.id)) },
    alert.enabled
      ? { icon: <BellOff size={14} className="text-choch" />, label: 'Disable Alert', onClick: act(() => onToggleEnabled(alert.id, false)) }
      : { icon: <Bell size={14} className="text-bull" />, label: 'Enable Alert', onClick: act(() => onToggleEnabled(alert.id, true)) },
    { divider: true as const },
    { icon: <Trash2 size={14} className="text-bear" />, label: 'Delete Alert', onClick: act(() => onDelete(alert.id)), danger: true },
  ];

  return createPortal(
    <div
      ref={ref}
      className="context-menu-pop fixed z-[120] min-w-[170px] rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      <div className="px-3 py-1 text-2xs font-semibold text-ink-faint">{alert.symbol} alert</div>
      <div className="my-1 h-px bg-terminal-border" />
      {items.map((it, i) =>
        'divider' in it ? (
          <div key={i} className="my-1 h-px bg-terminal-border" />
        ) : (
          <button
            key={i}
            role="menuitem"
            onClick={it.onClick}
            className={cn(
              'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-terminal-hover',
              it.danger ? 'text-bear' : 'text-ink',
            )}
          >
            {it.icon}
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
