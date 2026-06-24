'use client';
import { LineChart, Check } from 'lucide-react';
import { Dropdown, MenuItem } from '@/components/ui/Dropdown';
import { useChartStore } from '@/store/chartStore';
import type { IndicatorType } from '@/types';

const OPTIONS: { type: IndicatorType; label: string }[] = [
  { type: 'SMA', label: 'Simple Moving Average' },
  { type: 'EMA', label: 'Exponential Moving Average' },
  { type: 'VWAP', label: 'VWAP (session)' },
  { type: 'RSI', label: 'Relative Strength Index' },
  { type: 'MACD', label: 'MACD' },
  { type: 'ADR', label: 'Average Daily Range' },
];

export function IndicatorMenu() {
  const indicators = useChartStore((s) => s.indicators);
  const toggleIndicator = useChartStore((s) => s.toggleIndicator);
  // Derived from live store state every render — never stale.
  const active = new Set(indicators.map((i) => i.type));

  return (
    <Dropdown
      width={240}
      trigger={() => (
        <button className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink">
          <LineChart size={14} />
          Indicators
        </button>
      )}
    >
      {() => (
        <div>
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Add indicator
          </div>
          {OPTIONS.map((o) => (
            <MenuItem key={o.type} active={active.has(o.type)} onClick={() => toggleIndicator(o.type)}>
              <span className="w-10 font-mono text-2xs text-brand">{o.type}</span>
              <span className="flex-1">{o.label}</span>
              {active.has(o.type) && <Check size={13} className="text-bull" />}
            </MenuItem>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
