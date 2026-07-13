'use client';
/**
 * AlertEditDialog (Phase 2.1) — modal to edit an existing alert (opened from the
 * alert right-click menu "Edit Alert"). Edits condition / target price / message /
 * recurring / enabled / per-alert sound/browser/push/external flags via `updateAlert`.
 * Driven by `alertStore.editingAlertId`.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  useAlertStore,
  CONDITION_LABEL,
  CONDITION_SYMBOL,
  type AlertCondition,
} from '@/store/alertStore';
import { getMarketSymbol } from '@/services/market-data/symbols';
import { useDraggableDialog } from '@/hooks/useDraggableDialog';
import { cn } from '@/utils/cn';

const CONDITIONS: AlertCondition[] = ['above', 'below', 'crossUp', 'crossDown'];

function Chk({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded border px-2 py-1 text-2xs font-medium transition-colors',
        on ? 'border-brand/40 bg-brand/15 text-brand' : 'border-terminal-border text-ink-muted hover:bg-terminal-hover',
      )}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}

export function AlertEditDialog() {
  const editingId = useAlertStore((s) => s.editingAlertId);
  const alert = useAlertStore((s) => s.alerts.find((a) => a.id === s.editingAlertId));
  const editAlert = useAlertStore((s) => s.editAlert);
  const updateAlert = useAlertStore((s) => s.updateAlert);
  const deleteAlert = useAlertStore((s) => s.deleteAlert);

  const [condition, setCondition] = useState<AlertCondition>('above');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [sound, setSound] = useState(true);
  const [browser, setBrowser] = useState(false);
  const [push, setPush] = useState(false);
  const [telegram, setTelegram] = useState(false);
  const [discord, setDiscord] = useState(false);
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  // Load the alert into the form whenever the edit target changes.
  useEffect(() => {
    if (!alert) return;
    setCondition(alert.condition);
    setPrice(String(alert.price));
    setNote(alert.note ?? '');
    setRecurring(alert.recurring);
    setEnabled(alert.enabled);
    setSound(alert.sound);
    setBrowser(alert.browser);
    setPush(alert.push);
    setTelegram(alert.telegram);
    setDiscord(alert.discord);
  }, [alert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editingId) editAlert(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, editAlert]);

  if (typeof document === 'undefined' || !editingId || !alert) return null;

  const prec = getMarketSymbol(alert.symbol)?.pricePrecision ?? 2;
  const close = () => editAlert(null);

  const save = () => {
    const target = Number(price);
    if (!Number.isFinite(target) || target <= 0) return;
    updateAlert(alert.id, {
      condition,
      price: target,
      note: note.trim() || undefined,
      recurring,
      enabled,
      sound,
      browser,
      push,
      telegram,
      discord,
    });
    close();
  };

  return createPortal(
    <div data-chart-ui className="fixed inset-0 z-[1300] flex items-end justify-center bg-[var(--scrim)] p-3 backdrop-blur-sm sm:items-center" onClick={close}>
      <div
        ref={dialogRef}
        style={dialogStyle}
        className="platform-dialog w-full max-w-[400px] rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit alert"
      >
        <div
          {...dragHandleProps}
          className={cn(
            "flex min-h-14 items-center justify-between border-b border-terminal-border px-4",
            dragHandleClassName,
          )}
        >
          <span className="text-sm font-semibold text-ink">Edit alert · {alert.symbol}</span>
          <button type="button" onClick={close} className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-1">
            {CONDITIONS.map((c) => (
              <button
                key={c}
                onClick={() => setCondition(c)}
                className={cn(
                  'flex items-center justify-center gap-1 rounded border px-2 py-1 text-2xs font-medium transition-colors',
                  condition === c ? 'border-brand/40 bg-brand/15 text-brand' : 'border-terminal-border text-ink-muted hover:bg-terminal-hover',
                )}
              >
                <span>{CONDITION_SYMBOL[c]}</span>
                {CONDITION_LABEL[c]}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-2xs text-ink-faint">Target price (precision {prec})</span>
            <input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="h-10 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-2xs text-ink-faint">Message (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Shown in the notification"
              className="h-10 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>

          <div className="flex flex-wrap gap-1.5">
            <Chk on={enabled} onClick={() => setEnabled((v) => !v)} label={enabled ? 'Enabled' : 'Disabled'} />
            <Chk on={recurring} onClick={() => setRecurring((v) => !v)} label={recurring ? 'Every time' : 'Only once'} />
            <Chk on={sound} onClick={() => setSound((v) => !v)} label="Sound" />
            <Chk on={browser} onClick={() => setBrowser((v) => !v)} label="Browser" />
            <Chk on={push} onClick={() => setPush((v) => !v)} label="Push" />
            <Chk on={telegram} onClick={() => setTelegram((v) => !v)} label="Telegram" />
            <Chk on={discord} onClick={() => setDiscord((v) => !v)} label="Discord" />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-terminal-border px-3 py-2">
          <button
            onClick={() => { deleteAlert(alert.id); close(); }}
            className="min-h-10 rounded-xl px-3 text-xs font-semibold text-bear hover:bg-bear/10"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={close} className="min-h-10 rounded-xl border border-terminal-border-strong px-3 text-xs font-semibold text-ink-muted hover:bg-terminal-hover">Cancel</button>
            <button type="button" onClick={save} className="min-h-10 rounded-xl bg-brand px-4 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover">Save</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
