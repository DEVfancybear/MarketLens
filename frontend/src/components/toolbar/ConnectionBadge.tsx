'use client';
/**
 * ConnectionBadge (Phase 1, Step 14).
 *
 * Realtime feed status chip for the TopToolbar. Reads the aggregated
 * `marketDataStore.connectionStatus` via `useConnectionMeta()` and renders a
 * 🟢/🟡/🔴 dot + label using `CONNECTION_STATUS_META` (label / colour). The dot
 * pulses while connecting/reconnecting so a transient state reads as "in motion"
 * rather than stuck. Pure read — no sockets, no side effects.
 */
import { useConnectionMeta } from '@/hooks/useConnectionStatus';
import { cn } from '@/utils/cn';

export function ConnectionBadge() {
  const { status, label, color } = useConnectionMeta();
  const pulsing = status === 'connecting' || status === 'reconnecting';

  return (
    <div
      className="flex h-8 items-center gap-2 rounded-full border border-terminal-border bg-terminal-input px-2.5 text-[10px] text-ink-muted shadow-[inset_0_1px_0_var(--panel-highlight)]"
      title={`Market data: ${label}`}
      aria-label={`Market data ${label}`}
    >
      <span
        className={cn('h-2 w-2 rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,currentColor_12%,transparent)]', pulsing && 'animate-pulse')}
        style={{ backgroundColor: color }}
      />
      <span className="hidden font-semibold md:inline">{label}</span>
    </div>
  );
}
