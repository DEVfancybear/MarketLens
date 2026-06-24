'use client';
import { Settings, Grid3x3, Maximize, Sun, Moon, Check } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useUIStore } from '@/store/uiStore';
import { getMainChart } from '@/components/chart/chartRegistry';
import { cn } from '@/utils/cn';

/** TradingView-style chart settings: grid, theme, reset view. */
export function ChartSettingsMenu() {
  const gridVisible = useUIStore((s) => s.gridVisible);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const resetView = () => getMainChart()?.timeScale().fitContent();

  return (
    <Dropdown
      align="right"
      width={210}
      trigger={(open) => (
        <button
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink',
            open && 'bg-terminal-hover text-ink',
          )}
          title="Chart settings"
        >
          <Settings size={15} />
        </button>
      )}
    >
      {(close) => (
        <div className="py-0.5">
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Chart settings
          </div>
          <Row icon={<Grid3x3 size={14} />} label="Grid lines" onClick={toggleGrid} checked={gridVisible} />
          <Row
            icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            onClick={toggleTheme}
          />
          <Row icon={<Maximize size={14} />} label="Reset chart view" onClick={() => { resetView(); close(); }} />
        </div>
      )}
    </Dropdown>
  );
}

function Row({ icon, label, onClick, checked }: { icon: React.ReactNode; label: string; onClick: () => void; checked?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-ink hover:bg-terminal-hover"
    >
      <span className="text-ink-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {checked !== undefined && checked && <Check size={13} className="text-bull" />}
    </button>
  );
}
