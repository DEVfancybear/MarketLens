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
      className="flex h-7 items-center gap-1.5 rounded px-2 text-2xs text-ink-muted"
      title={`Market data: ${label}`}
      aria-label={`Market data ${label}`}
    >
      <span
        className={cn('h-2 w-2 rounded-full', pulsing && 'animate-pulse')}
        style={{ backgroundColor: color }}
      />
      <span className="hidden whitespace-nowrap font-medium min-[1720px]:inline">{label}</span>
    </div>
  );
}
