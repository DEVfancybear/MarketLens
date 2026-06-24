'use client';
import { useUIStore, type BottomTab } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import { fmtDateTime } from '@/utils/time';
import { ReplayPanel } from '@/components/replay/ReplayPanel';
import { TradePanel } from '@/components/trade/TradePanel';
import { JournalPanel } from '@/components/journal/JournalPanel';
import { AnalyticsPanel } from '@/components/analytics/AnalyticsPanel';

const TABS: { key: BottomTab; label: string }[] = [
  { key: 'replay', label: 'Replay' },
  { key: 'trade', label: 'Trade' },
  { key: 'journal', label: 'Journal' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'logs', label: 'Logs' },
];

export function BottomPanel() {
  const { bottomTab, setBottomTab } = useUIStore();

  return (
    <div className="flex h-full flex-col">
      {/* Tab strip */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-terminal-border px-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setBottomTab(t.key)}
            className={cn(
              'h-7 rounded px-3 text-xs font-medium transition-colors',
              bottomTab === t.key
                ? 'bg-terminal-hover text-ink'
                : 'text-ink-muted hover:bg-terminal-hover/50 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {bottomTab === 'replay' && <ReplayPanel />}
        {bottomTab === 'trade' && <TradePanel />}
        {bottomTab === 'journal' && <JournalPanel />}
        {bottomTab === 'analytics' && <AnalyticsPanel />}
        {bottomTab === 'logs' && <LogsView />}
      </div>
    </div>
  );
}

function LogsView() {
  const logs = useUIStore((s) => s.logs);
  return (
    <div className="h-full overflow-auto p-2 font-mono text-2xs">
      {logs.length === 0 && <div className="p-3 text-ink-faint">No events yet.</div>}
      {logs.map((l) => (
        <div key={l.id} className="flex gap-2 py-0.5">
          <span className="text-ink-faint">{fmtDateTime(l.time)}</span>
          <span
            className={cn(
              'uppercase',
              l.level === 'error' && 'text-bear',
              l.level === 'warn' && 'text-choch',
              l.level === 'info' && 'text-ink-muted',
            )}
          >
            {l.level}
          </span>
          <span className="text-ink">{l.msg}</span>
        </div>
      ))}
    </div>
  );
}
