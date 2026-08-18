'use client';
/**
 * AlertContextMenu (Phase 2.1) — TradingView-style right-click / long-press menu
 * for a chart alert: Edit · Clone · Disable/Enable · Delete. Rendered via a
 * portal, clamped to the viewport, closes on outside-click / Esc.
 */
import { createPortal } from 'react-dom';
import { Pencil, Copy, BellOff, Bell, Trash2 } from 'lucide-react';
import { useAlertStore } from '@/store/alertStore';
import { cn } from '@/utils/cn';
import { useFloatingSurface } from '@/hooks/useFloatingSurface';
import { useTerminalPlatform } from '@/hooks/useTerminalPlatform';
import { ChartPopupSurface } from './ChartPopupSurface';

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
  const mobile = useTerminalPlatform() === 'mobile';
  const { surfaceRef, layout } = useFloatingSurface({
    x: state.x,
    y: state.y,
  });

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
    <ChartPopupSurface
      ref={surfaceRef}
      dragLabel="Move alert actions menu"
      showDragHandle={mobile}
      dragHandleRole={mobile ? 'menuitem' : undefined}
      resetKey={`${state.id}:${state.x}:${state.y}`}
      onDismiss={onClose}
      consumeOutsidePointerDown={mobile}
      className={cn(
        'context-menu-pop fixed z-120 min-w-[170px] overflow-x-hidden overflow-y-auto rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl',
        mobile && 'mobile-chart-popup-portal',
      )}
      style={{
        left: layout.x,
        top: layout.y,
        maxWidth: layout.maxWidth || undefined,
        maxHeight: layout.maxHeight || undefined,
      }}
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
    </ChartPopupSurface>,
    document.body,
  );
}
